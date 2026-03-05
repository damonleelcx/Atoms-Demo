package redis

import (
	"context"
	"fmt"
	"time"

	redispkg "github.com/redis/go-redis/v9"
	"atoms-demo/backend/internal/config"
)

func NewClient(cfg *config.Config) (*redispkg.Client, error) {
	client := redispkg.NewClient(&redispkg.Options{Addr: cfg.Redis.Addr})
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := client.Ping(ctx).Err(); err != nil {
		return nil, fmt.Errorf("redis ping: %w", err)
	}
	return client, nil
}

func RateLimitKey(identifier string) string {
	return "ratelimit:" + identifier
}
