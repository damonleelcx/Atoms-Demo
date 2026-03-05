package llm

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"strings"

	openai "github.com/sashabaranov/go-openai"
)

// Client calls an LLM (OpenAI-compatible) for chat completion.
type Client struct {
	client *openai.Client
	model  string
}

// NewClient creates an LLM client. If apiKey is empty, all Complete calls return fallback and no error.
func NewClient(apiKey, model string) *Client {
	if model == "" {
		model = "gpt-5.1"
	}
	c := &Client{model: model}
	if apiKey != "" {
		c.client = openai.NewClient(apiKey)
	}
	return c
}

const DefaultMaxCompletionTokens = 4096

// Complete returns a single completion using the streaming API and accumulating the full response.
// If client has no API key, returns fallback and nil error.
// maxTokens optionally sets MaxCompletionTokens (default 4096); use 0 or omit for default.
func (c *Client) Complete(ctx context.Context, systemPrompt, userPrompt, fallback string, maxTokens ...int) (string, error) {
	if c.client == nil {
		return fallback, nil
	}
	n := DefaultMaxCompletionTokens
	if len(maxTokens) > 0 && maxTokens[0] > 0 {
		n = maxTokens[0]
	}
	req := openai.ChatCompletionRequest{
		Model: c.model,
		Messages: []openai.ChatCompletionMessage{
			{Role: openai.ChatMessageRoleSystem, Content: systemPrompt},
			{Role: openai.ChatMessageRoleUser, Content: userPrompt},
		},
		MaxCompletionTokens: n,
		Stream:              true,
	}
	stream, err := c.client.CreateChatCompletionStream(ctx, req)
	if err != nil {
		return "", fmt.Errorf("openai: %w", err)
	}
	defer stream.Close()

	var buf strings.Builder
	for {
		response, err := stream.Recv()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return "", fmt.Errorf("openai: stream: %w", err)
		}
		if len(response.Choices) > 0 && response.Choices[0].Delta.Content != "" {
			buf.WriteString(response.Choices[0].Delta.Content)
		}
	}
	content := strings.TrimSpace(buf.String())
	if content == "" {
		return "", fmt.Errorf("openai: empty completion content")
	}
	return content, nil
}

// CompleteStream streams the completion to onChunk for each delta, then returns the full content.
// If client has no API key, returns fallback and nil error without calling onChunk.
// maxTokens optionally sets MaxCompletionTokens (default 4096); use 0 or omit for default.
func (c *Client) CompleteStream(ctx context.Context, systemPrompt, userPrompt, fallback string, onChunk func(string) error, maxTokens ...int) (string, error) {
	if c.client == nil {
		return fallback, nil
	}
	n := DefaultMaxCompletionTokens
	if len(maxTokens) > 0 && maxTokens[0] > 0 {
		n = maxTokens[0]
	}
	req := openai.ChatCompletionRequest{
		Model: c.model,
		Messages: []openai.ChatCompletionMessage{
			{Role: openai.ChatMessageRoleSystem, Content: systemPrompt},
			{Role: openai.ChatMessageRoleUser, Content: userPrompt},
		},
		MaxCompletionTokens: n,
		Stream:              true,
	}
	stream, err := c.client.CreateChatCompletionStream(ctx, req)
	if err != nil {
		return "", fmt.Errorf("openai: %w", err)
	}
	defer stream.Close()

	var buf strings.Builder
	for {
		response, err := stream.Recv()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return "", fmt.Errorf("openai: stream: %w", err)
		}
		if len(response.Choices) > 0 && response.Choices[0].Delta.Content != "" {
			chunk := response.Choices[0].Delta.Content
			buf.WriteString(chunk)
			if onChunk != nil {
				if cbErr := onChunk(chunk); cbErr != nil {
					return "", cbErr
				}
			}
		}
	}
	content := strings.TrimSpace(buf.String())
	if content == "" {
		return "", fmt.Errorf("openai: empty completion content")
	}
	return content, nil
}

// Transcribe converts audio bytes to text using OpenAI Whisper. If client has no API key, returns empty string and nil (caller should use fallback).
func (c *Client) Transcribe(ctx context.Context, audio []byte, filename string) (string, error) {
	if c.client == nil || len(audio) == 0 {
		return "", nil
	}
	if filename == "" {
		filename = "audio.webm"
	}
	req := openai.AudioRequest{
		Model:    openai.Whisper1,
		FilePath: filename,
		Reader:   bytes.NewReader(audio),
	}
	resp, err := c.client.CreateTranscription(ctx, req)
	if err != nil {
		return "", fmt.Errorf("whisper: %w", err)
	}
	return strings.TrimSpace(resp.Text), nil
}
