package kafka

import (
	"context"
	"encoding/json"
	"fmt"

	kafkago "github.com/segmentio/kafka-go"
	"atoms-demo/backend/internal/config"
)

type (
	Writer = kafkago.Writer
	Reader = kafkago.Reader
)

type PipelineMessage struct {
	QuestionID string   `json:"question_id"`
	SessionID  string   `json:"session_id"`
	RunID      string   `json:"run_id"`
	Stage      int      `json:"stage"`
	Input      string   `json:"input"`
	Context    string   `json:"context,omitempty"`
	Feedback   string   `json:"feedback,omitempty"`
	History    []string `json:"history,omitempty"`
}

func NewWriter(cfg *config.Config, topic string) *Writer {
	return &Writer{
		Addr:     kafkago.TCP(cfg.Kafka.Brokers...),
		Topic:    topic,
		Balancer: &kafkago.LeastBytes{},
	}
}

func NewReader(cfg *config.Config, topic string) *Reader {
	return kafkago.NewReader(kafkago.ReaderConfig{
		Brokers:  cfg.Kafka.Brokers,
		Topic:    topic,
		GroupID:  cfg.Kafka.ConsumerGroup,
		MinBytes: 1,
		MaxBytes: 10e6,
	})
}

func WriteMessage(ctx context.Context, w *Writer, msg *PipelineMessage) error {
	data, err := json.Marshal(msg)
	if err != nil {
		return fmt.Errorf("marshal: %w", err)
	}
	return w.WriteMessages(ctx, kafkago.Message{Value: data})
}

func ReadMessage(ctx context.Context, r *Reader) (*PipelineMessage, error) {
	m, err := r.FetchMessage(ctx)
	if err != nil {
		return nil, err
	}
	var msg PipelineMessage
	if err := json.Unmarshal(m.Value, &msg); err != nil {
		return nil, fmt.Errorf("unmarshal: %w", err)
	}
	return &msg, nil
}

func CommitMessage(ctx context.Context, r *Reader, m kafkago.Message) error {
	return r.CommitMessages(ctx, m)
}
