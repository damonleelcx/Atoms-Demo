package middleware

import (
	"context"
	"net/http"
	"strings"
	"time"

	redisclient "github.com/redis/go-redis/v9"
	"atoms-demo/backend/internal/redis"
)

// ClientIP returns the client IP for rate limiting (X-Real-IP, X-Forwarded-For, or RemoteAddr).
func ClientIP(r *http.Request) string {
	if s := r.Header.Get("X-Real-IP"); s != "" {
		return strings.TrimSpace(strings.Split(s, ",")[0])
	}
	if s := r.Header.Get("X-Forwarded-For"); s != "" {
		return strings.TrimSpace(strings.Split(s, ",")[0])
	}
	return r.RemoteAddr
}

// RateLimit limits requests per key (e.g. client IP) using Redis.
func RateLimit(rdb *redisclient.Client, limit int, window time.Duration) func(http.Handler) http.Handler {
	if limit <= 0 {
		limit = 10
	}
	if window <= 0 {
		window = time.Minute
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// Skip rate limit for read-only GETs to reduce 429s from polling and health/root checks
			if r.Method == http.MethodGet {
				p := r.URL.Path
				if p == "/" || p == "/api/questions" || p == "/health" {
					next.ServeHTTP(w, r)
					return
				}
				// GET /api/questions/:id, /api/questions/:id/responses, /api/questions/:id/runs
				if len(p) > 14 && p[:14] == "/api/questions/" {
					next.ServeHTTP(w, r)
					return
				}
			}
			key := redis.RateLimitKey(ClientIP(r))
			ctx := r.Context()
			count, err := rdb.Incr(ctx, key).Result()
			if err != nil {
				http.Error(w, "rate limit error", http.StatusServiceUnavailable)
				return
			}
			if count == 1 {
				rdb.Expire(ctx, key, window)
			}
			if count > int64(limit) {
				http.Error(w, "rate limit exceeded", http.StatusTooManyRequests)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

var _ = context.Background
