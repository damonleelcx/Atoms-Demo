package agents

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"time"

	"github.com/google/uuid"
	kafkago "github.com/segmentio/kafka-go"
	"atoms-demo/backend/internal/kafka"
	"atoms-demo/backend/internal/llm"
	"atoms-demo/backend/internal/mongo"
	"atoms-demo/backend/internal/stream"
)

const requirementSystemPrompt = `You are a senior product and technical requirements analyst. Given a user's description of an app they want to build, produce a clear, structured requirements document in Markdown.

Include:
1. **User Request** – brief summary of what they want
2. **Functional Requirements** – numbered list (FR1, FR2, …) of features and behaviors
3. **Non-Functional Requirements** – performance, accessibility, security, maintainability where relevant
4. **Architecture Overview** – high-level stack (e.g. frontend: React/Next.js, backend: API, data: DB/cache)
5. **User Flows** – key flows in bullet form

Output only the Markdown document, no preamble or meta-commentary.`

// RequirementAgent consumes from requirement-stage, produces requirements doc via LLM, saves to Mongo, produces to design-stage.
func RequirementAgent(ctx context.Context, reader *kafkago.Reader, writerDesign *kafkago.Writer, mongoRepo *mongo.Repo, llmClient *llm.Client, broker *stream.Broker) error {
	for {
		m, err := reader.FetchMessage(ctx)
		if err != nil {
			if isRetriableKafkaError(err) {
				log.Printf("requirement agent: transient Kafka error, retrying in %v: %v", retryBackoff, err)
				time.Sleep(retryBackoff)
				continue
			}
			return err
		}
		var msg kafka.PipelineMessage
		if err := json.Unmarshal(m.Value, &msg); err != nil {
			_ = reader.CommitMessages(ctx, m)
			continue
		}
		runID := msg.RunID
		if runID == "" {
			runID = uuid.New().String()
		}
		input := msg.Input
		if msg.Feedback != "" {
			input = input + "\n\nUser feedback: " + msg.Feedback
		}
		for _, h := range msg.History {
			input = input + "\n" + h
		}
		fallback := generateRequirementDocFallback(input)
		var reqDoc string
		if broker != nil {
			reqDoc, err = llmClient.CompleteStream(ctx, requirementSystemPrompt, input, fallback, func(chunk string) error {
				broker.Send(runID, stream.Event{Stage: 1, Chunk: chunk})
				return nil
			})
		} else {
			reqDoc, err = llmClient.Complete(ctx, requirementSystemPrompt, input, fallback)
		}
		if err != nil {
			log.Printf("requirement agent: LLM complete failed for question %s: %v", msg.QuestionID, err)
			_ = reader.CommitMessages(ctx, m)
			continue
		}
		if err := mongoRepo.Create(ctx, &mongo.AgentResponse{
			QuestionID: msg.QuestionID,
			SessionID:  msg.SessionID,
			RunID:      runID,
			Stage:      1,
			StageName:  "requirement",
			Content:    reqDoc,
		}); err != nil {
			log.Printf("requirement agent: mongo create failed for question %s: %v", msg.QuestionID, err)
			_ = reader.CommitMessages(ctx, m)
			continue
		}
		if broker != nil {
			broker.Send(runID, stream.Event{Stage: 1, Done: true})
		}
		next := kafka.PipelineMessage{
			QuestionID: msg.QuestionID,
			SessionID:  msg.SessionID,
			RunID:      runID,
			Stage:      2,
			Input:      input,
			Context:    reqDoc,
		}
		if err := kafka.WriteMessage(ctx, writerDesign, &next); err != nil {
			if isRetriableKafkaError(err) {
				log.Printf("requirement agent: transient Kafka write error, retrying in %v: %v", retryBackoff, err)
				time.Sleep(retryBackoff)
				continue
			}
			log.Printf("requirement agent: kafka write to design failed for question %s: %v", msg.QuestionID, err)
			_ = reader.CommitMessages(ctx, m)
			continue
		}
		if err := reader.CommitMessages(ctx, m); err != nil {
			if isRetriableKafkaError(err) {
				log.Printf("requirement agent: transient Kafka commit error, retrying in %v: %v", retryBackoff, err)
				time.Sleep(retryBackoff)
				continue
			}
			return err
		}
	}
}

func generateRequirementDocFallback(input string) string {
	return fmt.Sprintf(`# Requirements Document

## User Request
%s

## Functional Requirements
- FR1: Core functionality as described by user
- FR2: Responsive and accessible UI
- FR3: Clear user flows

## Non-Functional Requirements
- NFR1: Performance and scalability
- NFR2: Maintainable codebase

## Architecture Overview
- Frontend: React/Next.js
- Backend: API layer
- Data: Persistence as needed

---
*Fallback (no OpenAI API key configured).*`, input)
}
