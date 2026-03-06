package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"atoms-demo/backend/internal/agents"
	"atoms-demo/backend/internal/config"
	"atoms-demo/backend/internal/handlers"
	"atoms-demo/backend/internal/kafka"
	"atoms-demo/backend/internal/llm"
	"atoms-demo/backend/internal/middleware"
	"atoms-demo/backend/internal/mongo"
	"atoms-demo/backend/internal/postgres"
	"atoms-demo/backend/internal/redis"
	"atoms-demo/backend/internal/stream"

	"github.com/gin-gonic/gin"
)

func main() {
	cfgPath := "config.yaml"
	if p := os.Getenv("CONFIG_PATH"); p != "" {
		cfgPath = p
	}
	cfg, err := config.Load(cfgPath)
	if err != nil {
		log.Fatalf("config: %v", err)
	}
	// In Docker (Postgres uses service host), always use Kafka service name
	if strings.Contains(cfg.Postgres.URL, "@postgres:") {
		cfg.Kafka.Brokers = []string{"kafka:9092"}
		log.Printf("kafka: using broker kafka:9092 (Docker)")
	}

	ctx := context.Background()

	pool, err := postgres.NewPool(ctx, cfg)
	if err != nil {
		log.Fatalf("postgres: %v", err)
	}
	defer pool.Close()

	mongoClient, err := mongo.NewClient(ctx, cfg)
	if err != nil {
		log.Fatalf("mongo: %v", err)
	}
	defer mongoClient.Disconnect(ctx)

	rdb, err := redis.NewClient(cfg)
	if err != nil {
		log.Fatalf("redis: %v", err)
	}
	defer rdb.Close()

	// Kafka writers
	writerReq := kafka.NewWriter(cfg, cfg.Kafka.TopicRequirement)
	writerDesign := kafka.NewWriter(cfg, cfg.Kafka.TopicDesign)
	writerImpl := kafka.NewWriter(cfg, cfg.Kafka.TopicImplementation)
	writerFeedback := kafka.NewWriter(cfg, cfg.Kafka.TopicFeedback)
	defer writerReq.Close()
	defer writerDesign.Close()
	defer writerImpl.Close()
	defer writerFeedback.Close()

	// Kafka readers (consumers)
	readerReq := kafka.NewReader(cfg, cfg.Kafka.TopicRequirement)
	readerDesign := kafka.NewReader(cfg, cfg.Kafka.TopicDesign)
	readerImpl := kafka.NewReader(cfg, cfg.Kafka.TopicImplementation)
	readerFeedback := kafka.NewReader(cfg, cfg.Kafka.TopicFeedback)
	defer readerReq.Close()
	defer readerDesign.Close()
	defer readerImpl.Close()
	defer readerFeedback.Close()

	pgRepo := postgres.NewRepo(pool)
	mongoRepo := mongo.NewRepo(mongo.DB(mongoClient, cfg))
	streamBroker := stream.NewBroker()

	llmClient := llm.NewClient(cfg.OpenAI.APIKey, cfg.OpenAI.Model)

	// Start agent consumers in background
	go func() {
		if err := agents.RequirementAgent(ctx, readerReq, writerDesign, mongoRepo, llmClient, streamBroker); err != nil {
			log.Printf("requirement agent: %v", err)
		}
	}()
	go func() {
		if err := agents.DesignAgent(ctx, readerDesign, writerImpl, mongoRepo, llmClient, streamBroker); err != nil {
			log.Printf("design agent: %v", err)
		}
	}()
	go func() {
		if err := agents.ImplementationAgent(ctx, readerImpl, writerFeedback, mongoRepo, llmClient, streamBroker); err != nil {
			log.Printf("implementation agent: %v", err)
		}
	}()
	go func() {
		if err := agents.FeedbackAgent(ctx, readerFeedback, mongoRepo); err != nil {
			log.Printf("feedback agent: %v", err)
		}
	}()

	questionsCache := &middleware.QuestionsListCache{
		Rdb: rdb,
		TTL: 90 * time.Second,
	}
	responseCache := &middleware.ResponseCache{
		Rdb: rdb,
		TTL: 30 * time.Second,
	}
	h := &handlers.Handlers{
		Questions:      pgRepo,
		Responses:      mongoRepo,
		WriterReq:      writerReq,
		Transcriber:    llmClient,
		Broker:         streamBroker,
		LLMClient:      llmClient,
		QuestionsCache: questionsCache,
		ResponseCache:  responseCache,
	}

	gin.SetMode(gin.ReleaseMode)
	r := gin.Default()
	r.Use(gin.Recovery())
	r.Use(corsMiddleware())
	r.Use(stripNextPublicApiUrlPrefix()) // old frontend bundle may request /$NEXT_PUBLIC_API_URL/api/...
	// Reject empty POST /api/questions before rate limit so spam does not burn the bucket
	r.Use(middleware.RejectEmptyQuestionPOST())
	limit := cfg.Redis.RateLimit
	if limit <= 0 {
		limit = 120
	}
	window := time.Duration(cfg.Redis.RateWindowSec) * time.Second
	if window <= 0 {
		window = time.Minute
	}
	// Apply rate limit only if explicitly set > 0 (REDIS_RATE_LIMIT=0 disables it for demo)
	if cfg.Redis.RateLimit > 0 {
		r.Use(gin.WrapH(middleware.RateLimit(rdb, limit, window)(r)))
	}

	r.POST("/api/questions", h.SubmitQuestion)
	r.GET("/api/questions", h.ListQuestions)
	r.GET("/api/questions/:id", h.GetQuestion)
	r.POST("/api/questions/audio", h.SubmitQuestionAudio)
	r.GET("/api/questions/:id/responses", h.GetResponses)
	r.GET("/api/questions/:id/responses/list", h.GetResponsesList)
	r.GET("/api/questions/:id/runs", h.GetRunIDs)
	r.POST("/api/questions/:id/feedback", h.SubmitFeedback)
	r.POST("/api/questions/:id/feedback/audio", h.SubmitFeedbackAudio)

	r.GET("/", func(c *gin.Context) { c.JSON(http.StatusOK, gin.H{"status": "ok", "service": "atoms-backend"}) })
	r.GET("/health", func(c *gin.Context) { c.JSON(http.StatusOK, gin.H{"status": "ok"}) })

	srv := &http.Server{
		Addr:    fmt.Sprintf(":%d", cfg.Server.Port),
		Handler: r,
	}
	if cfg.Server.Port == 0 {
		srv.Addr = ":8080"
	}

	go func() {
		log.Printf("server listening on %s", srv.Addr)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("server: %v", err)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit
	log.Println("shutting down...")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		log.Printf("shutdown: %v", err)
	}
}

func corsMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Header("Access-Control-Allow-Origin", "*")
		c.Header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		c.Header("Access-Control-Allow-Headers", "Content-Type, X-Session-ID, X-Run-ID")
		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}
		c.Next()
	}
}

// stripNextPublicApiUrlPrefix rewrites paths like /$NEXT_PUBLIC_API_URL/api/questions to /api/questions
// so old frontend bundles that baked in the literal env var name still hit the correct routes.
func stripNextPublicApiUrlPrefix() gin.HandlerFunc {
	const prefix1 = "/$NEXT_PUBLIC_API_URL"
	const prefix2 = "/%24NEXT_PUBLIC_API_URL" // URL-encoded $
	return func(c *gin.Context) {
		p := c.Request.URL.Path
		if strings.HasPrefix(p, prefix1) {
			c.Request.URL.Path = p[len(prefix1):]
			if c.Request.URL.Path == "" {
				c.Request.URL.Path = "/"
			}
		} else if strings.HasPrefix(p, prefix2) {
			c.Request.URL.Path = p[len(prefix2):]
			if c.Request.URL.Path == "" {
				c.Request.URL.Path = "/"
			}
		}
		c.Next()
	}
}
