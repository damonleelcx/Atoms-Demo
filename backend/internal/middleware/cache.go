package middleware

import (
	"context"
	"fmt"
	"time"

	redisclient "github.com/redis/go-redis/v9"
)

const questionsListKey = "questions:list"

// QuestionsListCache caches the GET /api/questions response in Redis to reduce DB load.
type QuestionsListCache struct {
	Rdb *redisclient.Client
	TTL time.Duration
}

// Get returns cached JSON bytes if present.
func (c *QuestionsListCache) Get(ctx context.Context) ([]byte, bool) {
	if c == nil || c.Rdb == nil {
		return nil, false
	}
	data, err := c.Rdb.Get(ctx, questionsListKey).Bytes()
	if err != nil {
		return nil, false
	}
	return data, true
}

// Set stores the response JSON with TTL.
func (c *QuestionsListCache) Set(ctx context.Context, data []byte) {
	if c == nil || c.Rdb == nil || len(data) == 0 {
		return
	}
	ttl := c.TTL
	if ttl <= 0 {
		ttl = 60 * time.Second
	}
	_ = c.Rdb.Set(ctx, questionsListKey, data, ttl).Err()
}

// Invalidate removes the cache entry (call after creating a new question).
func (c *QuestionsListCache) Invalidate(ctx context.Context) {
	if c == nil || c.Rdb == nil {
		return
	}
	_ = c.Rdb.Del(ctx, questionsListKey).Err()
}

// ResponseCache caches arbitrary GET responses by key (e.g. responses:questionID:runID, runs:questionID).
type ResponseCache struct {
	Rdb *redisclient.Client
	TTL time.Duration
}

func (c *ResponseCache) getTTL() time.Duration {
	if c != nil && c.TTL > 0 {
		return c.TTL
	}
	return 60 * time.Second
}

// Get returns cached bytes for key.
func (c *ResponseCache) Get(ctx context.Context, key string) ([]byte, bool) {
	if c == nil || c.Rdb == nil || key == "" {
		return nil, false
	}
	data, err := c.Rdb.Get(ctx, key).Bytes()
	if err != nil {
		return nil, false
	}
	return data, true
}

// Set stores data for key with TTL.
func (c *ResponseCache) Set(ctx context.Context, key string, data []byte) {
	if c == nil || c.Rdb == nil || key == "" || len(data) == 0 {
		return
	}
	_ = c.Rdb.Set(ctx, key, data, c.getTTL()).Err()
}

// InvalidateQuestion clears all cache entries for a question (responses and runs).
func (c *ResponseCache) InvalidateQuestion(ctx context.Context, questionID string) {
	if c == nil || c.Rdb == nil || questionID == "" {
		return
	}
	pattern := fmt.Sprintf("responses:%s:*", questionID)
	iter := c.Rdb.Scan(ctx, 0, pattern, 0).Iterator()
	for iter.Next(ctx) {
		_ = c.Rdb.Del(ctx, iter.Val()).Err()
	}
	_ = c.Rdb.Del(ctx, "runs:"+questionID).Err()
}
