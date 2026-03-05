package agents

import (
	"context"
	"encoding/json"
	"log"
	"time"

	kafkago "github.com/segmentio/kafka-go"
	"atoms-demo/backend/internal/kafka"
	"atoms-demo/backend/internal/mongo"
)

// FeedbackAgent consumes from feedback-stage, saves "awaiting feedback" response; loop back is triggered by API when user submits feedback.
func FeedbackAgent(ctx context.Context, reader *kafkago.Reader, mongoRepo *mongo.Repo) error {
	for {
		m, err := reader.FetchMessage(ctx)
		if err != nil {
			if isRetriableKafkaError(err) {
				log.Printf("feedback agent: transient Kafka error, retrying in %v: %v", retryBackoff, err)
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
		feedbackPrompt := "Please review the solution above and tell us what you'd like to change or add. Your feedback will start another iteration."
		if err := mongoRepo.Create(ctx, &mongo.AgentResponse{
			QuestionID:        msg.QuestionID,
			SessionID:         msg.SessionID,
			RunID:             msg.RunID,
			Stage:             4,
			StageName:         "feedback",
			Content:           feedbackPrompt,
			AwaitingFeedback:  true,
		}); err != nil {
			_ = reader.CommitMessages(ctx, m)
			continue
		}
		if err := reader.CommitMessages(ctx, m); err != nil {
			if isRetriableKafkaError(err) {
				log.Printf("feedback agent: transient Kafka commit error, retrying in %v: %v", retryBackoff, err)
				time.Sleep(retryBackoff)
				continue
			}
			return err
		}
	}
}
