package agents

import (
	"context"
	"encoding/json"
	"log"
	"time"

	"atoms-demo/backend/internal/kafka"
	"atoms-demo/backend/internal/llm"
	"atoms-demo/backend/internal/mongo"
	"atoms-demo/backend/internal/stream"

	kafkago "github.com/segmentio/kafka-go"
)

const designSystemPrompt = `You are a UI/UX designer. Given a requirements document (Markdown), produce a single wireframe specification as JSON. Do NOT generate any code.

Output ONLY valid JSON, no markdown code fences, no explanation. The JSON must describe the main screen layout and UI elements.

Schema (use these exact keys):
- Root object: { "title": "Screen title", "layout": "column" or "row", "children": [ ... ] }
- Child nodes can be:
  - { "type": "container", "layout": "column" or "row", "children": [ ... ] }  for grouping
  - { "type": "text", "content": "string", "variant": "h1" or "h2" or "body" }
  - { "type": "box", "label": "string", "hint": "optional short description" }  for content areas
  - { "type": "button", "label": "string", "primary": true or false }
  - { "type": "input", "label": "string", "placeholder": "string" }

Example minimal wireframe:
{"title":"Main","layout":"column","children":[{"type":"text","content":"App Title","variant":"h1"},{"type":"box","label":"Content area","hint":"List or form"},{"type":"button","label":"Submit","primary":true}]}

Produce one root object with "title", "layout", and "children". Use "container" nodes to create rows/columns. Keep it clear and representative of the requirements.`

// DesignAgent consumes from design-stage, produces UI design (React) via LLM, saves to Mongo, produces to implementation-stage.
func DesignAgent(ctx context.Context, reader *kafkago.Reader, writerImpl *kafkago.Writer, mongoRepo *mongo.Repo, llmClient *llm.Client, broker *stream.Broker) error {
	for {
		m, err := reader.FetchMessage(ctx)
		if err != nil {
			if isRetriableKafkaError(err) {
				log.Printf("design agent: transient Kafka error, retrying in %v: %v", retryBackoff, err)
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
		userPrompt := "Requirements:\n\n" + msg.Context
		fallback := generateDesignWireframeFallback()
		const designLLMMaxRetries = 3
		var wireframeJSON string
		var completeErr error
		for attempt := 0; attempt < designLLMMaxRetries; attempt++ {
			if broker != nil {
				wireframeJSON, completeErr = llmClient.CompleteStream(ctx, designSystemPrompt, userPrompt, fallback, func(chunk string) error {
					broker.Send(msg.RunID, stream.Event{Stage: 2, Chunk: chunk})
					return nil
				}, 8192)
			} else {
				wireframeJSON, completeErr = llmClient.Complete(ctx, designSystemPrompt, userPrompt, fallback, 8192)
			}
			if completeErr == nil {
				break
			}
			log.Printf("design agent: LLM complete attempt %d/%d failed for question %s: %v", attempt+1, designLLMMaxRetries, msg.QuestionID, completeErr)
			if attempt < designLLMMaxRetries-1 {
				time.Sleep(2 * time.Second)
			} else {
				_ = reader.CommitMessages(ctx, m)
				continue
			}
		}
		wireframeJSON = extractWireframeJSON(wireframeJSON)
		if wireframeJSON == "" {
			wireframeJSON = fallback
		}
		if err := mongoRepo.Create(ctx, &mongo.AgentResponse{
			QuestionID: msg.QuestionID,
			SessionID:  msg.SessionID,
			RunID:      msg.RunID,
			Stage:      2,
			StageName:  "design",
			Content:    wireframeJSON,
			Payload:    map[string]any{"type": "wireframe"},
		}); err != nil {
			_ = reader.CommitMessages(ctx, m)
			continue
		}
		if broker != nil {
			broker.Send(msg.RunID, stream.Event{Stage: 2, Done: true})
		}
		next := kafka.PipelineMessage{
			QuestionID: msg.QuestionID,
			SessionID:  msg.SessionID,
			RunID:      msg.RunID,
			Stage:      3,
			Input:      msg.Input,
			Context:    wireframeJSON,
		}
		if err := kafka.WriteMessage(ctx, writerImpl, &next); err != nil {
			if isRetriableKafkaError(err) {
				log.Printf("design agent: transient Kafka write error, retrying in %v: %v", retryBackoff, err)
				time.Sleep(retryBackoff)
				continue
			}
			_ = reader.CommitMessages(ctx, m)
			continue
		}
		if err := reader.CommitMessages(ctx, m); err != nil {
			if isRetriableKafkaError(err) {
				log.Printf("design agent: transient Kafka commit error, retrying in %v: %v", retryBackoff, err)
				time.Sleep(retryBackoff)
				continue
			}
			return err
		}
	}
}

func generateDesignWireframeFallback() string {
	return `{"title":"Main screen","layout":"column","children":[{"type":"text","content":"App","variant":"h1"},{"type":"box","label":"Content area","hint":"Main content"},{"type":"button","label":"Submit","primary":true}]}`
}

// extractWireframeJSON returns the first valid JSON object from s, stripping ```json if present.
func extractWireframeJSON(s string) string {
	s = trimSpace(s)
	// Strip markdown code fence
	const jsonFence = "```json"
	const fence = "```"
	if i := indexAt(s, jsonFence, 0); i >= 0 {
		start := i + len(jsonFence)
		if start < len(s) && s[start] == '\n' {
			start++
		}
		if j := indexAt(s, fence, start); j > start {
			s = trimSpace(s[start:j])
		} else {
			s = trimSpace(s[start:])
		}
	} else if i := indexAt(s, fence, 0); i >= 0 {
		start := i + len(fence)
		if start < len(s) && s[start] == '\n' {
			start++
		}
		if j := indexAt(s, fence, start); j > start {
			s = trimSpace(s[start:j])
		} else {
			s = trimSpace(s[start:])
		}
	}
	// Validate minimal wireframe: must be valid JSON with "children"
	var m map[string]any
	if err := json.Unmarshal([]byte(s), &m); err != nil {
		return ""
	}
	if _, ok := m["children"]; !ok {
		return ""
	}
	return s
}

// extractCodeBlock returns the first ```...``` block content, or s if none.
func extractCodeBlock(s string) string {
	const start = "```"
	const startJS = "```js"
	const startJSX = "```jsx"
	const startTS = "```ts"
	const startTSX = "```tsx"
	for _, prefix := range []string{startTSX, startJSX, startTS, startJS, start} {
		i := 0
		for {
			j := indexAt(s, prefix, i)
			if j < 0 {
				break
			}
			begin := j + len(prefix)
			if begin < len(s) && s[begin] == '\n' {
				begin++
			}
			end := indexAt(s, "```", begin)
			if end < 0 {
				return trimSpace(s[begin:])
			}
			return trimSpace(s[begin:end])
		}
	}
	return trimSpace(s)
}

func indexAt(s, sub string, start int) int {
	if start >= len(s) {
		return -1
	}
	for i := start; i <= len(s)-len(sub); i++ {
		if s[i:i+len(sub)] == sub {
			return i
		}
	}
	return -1
}

func trimSpace(s string) string {
	for len(s) > 0 && (s[0] == ' ' || s[0] == '\t' || s[0] == '\r' || s[0] == '\n') {
		s = s[1:]
	}
	for len(s) > 0 {
		last := s[len(s)-1]
		if last == ' ' || last == '\t' || last == '\r' || last == '\n' {
			s = s[:len(s)-1]
		} else {
			break
		}
	}
	return s
}
