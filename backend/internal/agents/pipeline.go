package agents

import (
	"context"
	"log"

	"atoms-demo/backend/internal/kafka"
	"atoms-demo/backend/internal/llm"
	"atoms-demo/backend/internal/mongo"
	"atoms-demo/backend/internal/stream"
)

// RunPipelineSync runs requirement -> design -> implementation in process, streaming each stage to the broker.
// Call this when a client connects to the stream so the client receives events immediately (no Kafka queue).
func RunPipelineSync(
	ctx context.Context,
	questionID, runID, input, sessionID string,
	broker *stream.Broker,
	mongoRepo *mongo.Repo,
	llmClient *llm.Client,
) error {
	if broker == nil || mongoRepo == nil || llmClient == nil {
		return nil
	}
	msg := &kafka.PipelineMessage{
		QuestionID: questionID,
		SessionID:  sessionID,
		RunID:      runID,
		Input:      input,
	}
	// Stage 1: Requirement
	fallback := generateRequirementDocFallback(msg.Input)
	reqDoc, err := llmClient.CompleteStream(ctx, requirementSystemPrompt, msg.Input, fallback, func(chunk string) error {
		broker.Send(runID, stream.Event{Stage: 1, Chunk: chunk})
		return nil
	})
	if err != nil {
		log.Printf("pipeline sync: requirement failed question %s: %v", questionID, err)
		return err
	}
	if err := mongoRepo.Create(ctx, &mongo.AgentResponse{
		QuestionID: questionID,
		SessionID:  sessionID,
		RunID:      runID,
		Stage:      1,
		StageName:  "requirement",
		Content:    reqDoc,
	}); err != nil {
		log.Printf("pipeline sync: mongo requirement failed: %v", err)
		return err
	}
	broker.Send(runID, stream.Event{Stage: 1, Done: true})

	// Stage 2: Design
	msg.Context = reqDoc
	userPrompt := "Requirements:\n\n" + reqDoc
	designFallback := generateDesignWireframeFallback()
	wireframeJSON, err := llmClient.CompleteStream(ctx, designSystemPrompt, userPrompt, designFallback, func(chunk string) error {
		broker.Send(runID, stream.Event{Stage: 2, Chunk: chunk})
		return nil
	}, 8192)
	if err != nil {
		log.Printf("pipeline sync: design failed question %s: %v", questionID, err)
		return err
	}
	wireframeJSON = extractWireframeJSON(wireframeJSON)
	if wireframeJSON == "" {
		wireframeJSON = designFallback
	}
	if err := mongoRepo.Create(ctx, &mongo.AgentResponse{
		QuestionID: questionID,
		SessionID:  sessionID,
		RunID:      runID,
		Stage:      2,
		StageName:  "design",
		Content:    wireframeJSON,
		Payload:    map[string]any{"type": "wireframe"},
	}); err != nil {
		log.Printf("pipeline sync: mongo design failed: %v", err)
		return err
	}
	broker.Send(runID, stream.Event{Stage: 2, Done: true})

	// Stage 3: Implementation
	msg.Context = wireframeJSON
	implPrompt := "User's app idea:\n" + msg.Input + "\n\nWireframe (JSON layout and UI elements to implement):\n" + wireframeJSON
	implFallback := generateFullSolutionFallback(msg.Input)
	fullSolution, err := llmClient.CompleteStream(ctx, implementationSystemPrompt, implPrompt, implFallback, func(chunk string) error {
		broker.Send(runID, stream.Event{Stage: 3, Chunk: chunk})
		return nil
	}, 16384)
	if err != nil {
		log.Printf("pipeline sync: implementation failed question %s: %v", questionID, err)
		return err
	}
	fullSolution = extractCodeBlock(fullSolution)
	if err := mongoRepo.Create(ctx, &mongo.AgentResponse{
		QuestionID: questionID,
		SessionID:  sessionID,
		RunID:      runID,
		Stage:      3,
		StageName:  "implementation",
		Content:    fullSolution,
		Payload:    map[string]any{"type": "code"},
	}); err != nil {
		log.Printf("pipeline sync: mongo implementation failed: %v", err)
		return err
	}
	broker.Send(runID, stream.Event{Stage: 3, Done: true})
	return nil
}
