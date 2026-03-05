package agents

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"time"

	kafkago "github.com/segmentio/kafka-go"
	"atoms-demo/backend/internal/kafka"
	"atoms-demo/backend/internal/llm"
	"atoms-demo/backend/internal/mongo"
	"atoms-demo/backend/internal/stream"
)

const implementationSystemPrompt = `You are a senior frontend engineer. Given:
1) The user's original app idea (short text)
2) A requirements document (Markdown)
3) A wireframe specification (JSON) describing UI layout and elements: title, layout (row/column), and children (containers, text, box, button, input)

Produce a complete, runnable React app: a single file that implements the full solution following the wireframe layout and elements.

Rules:
- Output only valid React/JSX/TS code. No markdown code fences, no explanation.
- Export a default component (e.g. "export default function App() { ... }") that represents the full app.
- Match the wireframe structure: use the same hierarchy, labels, and element types (header, content areas, buttons, inputs). Implement the wireframe as the UI.
- Use React hooks (useState, etc.) where needed. Use inline styles or a simple style object; no external CSS.
- The code must be self-contained and runnable in a browser (e.g. with React and ReactDOM from UMD).
- Prefer a single file.
- Never render an object as a React child: only render strings, numbers, or React elements. If a hook returns an object (e.g. { animated, replay }), destructure it and use the properties to build JSX; do not put the object in JSX. Do not use third-party animation or UI libraries—only React and inline styles.`

// ImplementationAgent consumes from implementation-stage, produces full code via LLM, saves to Mongo, produces to feedback-stage.
func ImplementationAgent(ctx context.Context, reader *kafkago.Reader, writerFeedback *kafkago.Writer, mongoRepo *mongo.Repo, llmClient *llm.Client, broker *stream.Broker) error {
	for {
		m, err := reader.FetchMessage(ctx)
		if err != nil {
			if isRetriableKafkaError(err) {
				log.Printf("implementation agent: transient Kafka error, retrying in %v: %v", retryBackoff, err)
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
		userPrompt := "User's app idea:\n" + msg.Input + "\n\nWireframe (JSON layout and UI elements to implement):\n" + msg.Context
		if len(msg.History) > 0 {
			userPrompt += "\n\nPrevious context (for reference):\n"
			for _, h := range msg.History {
				userPrompt += h + "\n"
			}
		}
		fallback := generateFullSolutionFallback(msg.Input)
		var fullSolution string
		if broker != nil {
			fullSolution, err = llmClient.CompleteStream(ctx, implementationSystemPrompt, userPrompt, fallback, func(chunk string) error {
				broker.Send(msg.RunID, stream.Event{Stage: 3, Chunk: chunk})
				return nil
			}, 16384)
		} else {
			fullSolution, err = llmClient.Complete(ctx, implementationSystemPrompt, userPrompt, fallback, 16384)
		}
		if err != nil {
			_ = reader.CommitMessages(ctx, m)
			continue
		}
		fullSolution = extractCodeBlock(fullSolution)
		if err := mongoRepo.Create(ctx, &mongo.AgentResponse{
			QuestionID: msg.QuestionID,
			SessionID:  msg.SessionID,
			RunID:      msg.RunID,
			Stage:      3,
			StageName:  "implementation",
			Content:    fullSolution,
			Payload:    map[string]any{"type": "code"},
		}); err != nil {
			_ = reader.CommitMessages(ctx, m)
			continue
		}
		if broker != nil {
			broker.Send(msg.RunID, stream.Event{Stage: 3, Done: true})
		}
		next := kafka.PipelineMessage{
			QuestionID: msg.QuestionID,
			SessionID:  msg.SessionID,
			RunID:      msg.RunID,
			Stage:      4,
			Input:      msg.Input,
			Context:    fullSolution,
		}
		if err := kafka.WriteMessage(ctx, writerFeedback, &next); err != nil {
			if isRetriableKafkaError(err) {
				log.Printf("implementation agent: transient Kafka write error, retrying in %v: %v", retryBackoff, err)
				time.Sleep(retryBackoff)
				continue
			}
			_ = reader.CommitMessages(ctx, m)
			continue
		}
		if err := reader.CommitMessages(ctx, m); err != nil {
			if isRetriableKafkaError(err) {
				log.Printf("implementation agent: transient Kafka commit error, retrying in %v: %v", retryBackoff, err)
				time.Sleep(retryBackoff)
				continue
			}
			return err
		}
	}
}

func generateFullSolutionFallback(input string) string {
	return fmt.Sprintf(`// Full solution based on: %s

import React, { useState } from 'react';

export default function App() {
  const [value, setValue] = useState('');
  return (
    <div style={{ padding: 24, fontFamily: 'system-ui', maxWidth: 600 }}>
      <h1>Your App</h1>
      <input
        value={value}
        onChange={e => setValue(e.target.value)}
        placeholder="Enter something..."
        style={{ padding: 8, width: '100%%' }}
      />
      <p>You entered: {value}</p>
    </div>
  );
}
`, input)
}
