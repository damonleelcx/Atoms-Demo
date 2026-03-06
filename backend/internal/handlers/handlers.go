package handlers

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"sync"
	"time"

	"atoms-demo/backend/internal/agents"
	"atoms-demo/backend/internal/kafka"
	"atoms-demo/backend/internal/llm"
	"atoms-demo/backend/internal/middleware"
	"atoms-demo/backend/internal/mongo"
	"atoms-demo/backend/internal/postgres"
	"atoms-demo/backend/internal/stream"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

// Transcriber converts audio to text (e.g. Whisper). May be nil; then audio handlers use fallback text.
type Transcriber interface {
	Transcribe(ctx context.Context, audio []byte, filename string) (string, error)
}

type Handlers struct {
	Questions       *postgres.Repo
	Responses       *mongo.Repo
	WriterReq       *kafka.Writer
	Transcriber     Transcriber
	Broker          *stream.Broker
	LLMClient       *llm.Client
	QuestionsCache  *middleware.QuestionsListCache
	ResponseCache   *middleware.ResponseCache
	pipelineStarted sync.Map // runID -> *sync.Mutex, to start pipeline only once per run_id
}

func (h *Handlers) SubmitQuestion(c *gin.Context) {
	var body struct {
		Content   string `json:"content"`
		SessionID string `json:"session_id"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.Content == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "content required"})
		return
	}
	q, err := h.Questions.CreateQuestion(c.Request.Context(), body.Content, body.SessionID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	h.QuestionsCache.Invalidate(c.Request.Context())
	if h.ResponseCache != nil {
		h.ResponseCache.InvalidateQuestion(c.Request.Context(), q.ID.String())
	}
	runID := uuid.New().String()
	// Pipeline runs when the client connects to GET .../responses?run_id=... (streaming only, no Kafka queue)
	log.Printf("pipeline: question %s run %s (pipeline will run when client connects to stream)", q.ID, runID)
	c.JSON(http.StatusOK, gin.H{
		"question_id": q.ID.String(),
		"run_id":      runID,
		"content":     q.Content,
		"created_at":  q.CreatedAt,
	})
}

func (h *Handlers) ListQuestions(c *gin.Context) {
	ctx := c.Request.Context()
	if data, ok := h.QuestionsCache.Get(ctx); ok {
		log.Printf("[cache] GET /api/questions (list): hit")
		c.Data(http.StatusOK, "application/json", data)
		return
	}
	log.Printf("[cache] GET /api/questions (list): miss")
	list, err := h.Questions.ListQuestions(ctx, 50)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	payload := gin.H{"questions": list}
	data, err := json.Marshal(payload)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	h.QuestionsCache.Set(ctx, data)
	c.Data(http.StatusOK, "application/json", data)
}

func (h *Handlers) GetQuestion(c *gin.Context) {
	idStr := c.Param("id")
	id, err := uuid.Parse(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}
	q, err := h.Questions.GetQuestionByID(c.Request.Context(), id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		return
	}
	c.JSON(http.StatusOK, q)
}

func (h *Handlers) GetResponses(c *gin.Context) {
	questionID := c.Param("id")
	runID := c.Query("run_id")
	listOnly := c.Query("list") == "1"
	if questionID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "questionId required"})
		return
	}
	ctx := c.Request.Context()

	// run_id + list=1: return stored responses for that run from Mongo/cache (one-shot SSE).
	if runID != "" && listOnly {
		h.serveResponsesListStream(c, questionID, runID, ctx)
		return
	}
	// run_id without list: live pipeline stream.
	if runID != "" {
		h.serveResponsesStream(c, questionID, runID, ctx)
		return
	}
	h.serveResponsesListStream(c, questionID, "", ctx)
}

// GetResponsesList returns stored responses as JSON (Mongo/cache). For previous questions only; do not use stream API.
func (h *Handlers) GetResponsesList(c *gin.Context) {
	questionID := c.Param("id")
	runID := c.Query("run_id")
	if questionID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "questionId required"})
		return
	}
	ctx := c.Request.Context()
	list, err := h.getResponsesListFromStore(ctx, questionID, runID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"responses": list})
}

// getResponsesListFromStore returns responses from cache or Mongo for the given question and optional runID.
func (h *Handlers) getResponsesListFromStore(ctx context.Context, questionID, runID string) ([]mongo.AgentResponse, error) {
	var list []mongo.AgentResponse
	useCache := h.ResponseCache != nil
	cacheKey := "responses:" + questionID + ":" + runID
	if useCache && runID != "" {
		if data, ok := h.ResponseCache.Get(ctx, cacheKey); ok {
			var payload struct {
				Responses []mongo.AgentResponse `json:"responses"`
			}
			if json.Unmarshal(data, &payload) == nil {
				return payload.Responses, nil
			}
		}
	}
	if useCache && runID == "" {
		if data, ok := h.ResponseCache.Get(ctx, "responses:"+questionID+":"); ok {
			var payload struct {
				Responses []mongo.AgentResponse `json:"responses"`
			}
			if json.Unmarshal(data, &payload) == nil {
				return payload.Responses, nil
			}
		}
	}
	var err error
	list, err = h.Responses.ListByQuestionID(ctx, questionID, runID)
	if err != nil {
		return nil, err
	}
	if useCache {
		payload := gin.H{"responses": list}
		data, _ := json.Marshal(payload)
		h.ResponseCache.Set(ctx, cacheKey, data)
	}
	return list, nil
}

// serveResponsesListStream returns SSE stream with a single data event containing {"responses": [...]}, then closes.
// If runID is non-empty, only responses for that run are returned (for Mongo/cache fetch by run).
func (h *Handlers) serveResponsesListStream(c *gin.Context, questionID, runID string, ctx context.Context) {
	list, err := h.getResponsesListFromStore(ctx, questionID, runID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache, no-store, must-revalidate")
	c.Header("Connection", "keep-alive")
	c.Header("X-Accel-Buffering", "no")
	c.Status(http.StatusOK)
	if _, err := c.Writer.Write([]byte(": connected\n\n")); err != nil {
		return
	}
	c.Writer.Flush()
	payload := gin.H{"responses": list}
	data, _ := json.Marshal(payload)
	if _, err := c.Writer.Write([]byte("data: " + string(data) + "\n\n")); err != nil {
		return
	}
	c.Writer.Flush()
}

// serveResponsesStream streams agent output as SSE for the given run_id. Starts the in-process pipeline once when the first client connects.
func (h *Handlers) serveResponsesStream(c *gin.Context, questionID, runID string, ctx context.Context) {
	if h.Broker == nil || h.LLMClient == nil {
		c.JSON(http.StatusNotImplemented, gin.H{"error": "streaming not enabled"})
		return
	}
	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache, no-store, must-revalidate")
	c.Header("Connection", "keep-alive")
	c.Header("X-Accel-Buffering", "no")
	c.Status(http.StatusOK)
	if _, err := c.Writer.Write([]byte(": connected\n\n")); err != nil {
		return
	}
	c.Writer.Flush()

	ch := make(chan stream.Event, 64)
	h.Broker.Subscribe(runID, ch)
	defer h.Broker.Unsubscribe(runID)
	log.Printf("[stream] client subscribed run_id=%s question_id=%s", runID, questionID)

	// Start pipeline once per run_id (in-process; no Kafka). Load question to get content.
	type runGuard struct{ mu sync.Mutex; started bool }
	guardVal, _ := h.pipelineStarted.LoadOrStore(runID, &runGuard{})
	guard := guardVal.(*runGuard)
	guard.mu.Lock()
	list, _ := h.Responses.ListByQuestionID(ctx, questionID, runID)
	shouldStart := len(list) == 0 && !guard.started
	if shouldStart {
		guard.started = true
		qID, parseErr := uuid.Parse(questionID)
		if parseErr == nil {
			if q, getErr := h.Questions.GetQuestionByID(ctx, qID); getErr == nil {
				content, sessionID := q.Content, q.SessionID
				go func() {
					// Use Background so pipeline keeps running after client disconnects; results are saved to Mongo.
					pipeCtx := context.Background()
					_ = agents.RunPipelineSync(pipeCtx, questionID, runID, content, sessionID, h.Broker, h.Responses, h.LLMClient)
				}()
			}
		}
	}
	guard.mu.Unlock()

	heartbeat := time.NewTicker(15 * time.Second)
	defer heartbeat.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-heartbeat.C:
			if _, err := c.Writer.Write([]byte(": heartbeat\n\n")); err != nil {
				return
			}
			c.Writer.Flush()
		case ev, ok := <-ch:
			if !ok {
				return
			}
			data, _ := json.Marshal(ev)
			if _, err := c.Writer.Write([]byte("data: " + string(data) + "\n\n")); err != nil {
				return
			}
			c.Writer.Flush()
		}
	}
}

func (h *Handlers) GetRunIDs(c *gin.Context) {
	questionID := c.Param("id")
	if questionID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "questionId required"})
		return
	}
	ctx := c.Request.Context()
	cacheKey := "runs:" + questionID
	if h.ResponseCache != nil {
		if data, ok := h.ResponseCache.Get(ctx, cacheKey); ok {
			log.Printf("[cache] GET /api/questions/%s/runs: hit", questionID)
			c.Data(http.StatusOK, "application/json", data)
			return
		}
	}
	log.Printf("[cache] GET /api/questions/%s/runs: miss", questionID)
	ids, err := h.Responses.GetRunIDs(ctx, questionID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	payload := gin.H{"run_ids": ids}
	data, err := json.Marshal(payload)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if h.ResponseCache != nil {
		h.ResponseCache.Set(ctx, cacheKey, data)
	}
	c.Data(http.StatusOK, "application/json", data)
}

// SubmitFeedback submits user feedback and re-triggers the pipeline from requirement stage.
func (h *Handlers) SubmitFeedback(c *gin.Context) {
	questionID := c.Param("id")
	var body struct {
		Feedback  string `json:"feedback"`
		RunID     string `json:"run_id"`
		SessionID string `json:"session_id"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.Feedback == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "feedback required"})
		return
	}
	if questionID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "questionId required"})
		return
	}
	// Optionally load previous responses to pass as history
	history, _ := h.Responses.ListByQuestionID(c.Request.Context(), questionID, body.RunID)
	var historyStrs []string
	for _, r := range history {
		historyStrs = append(historyStrs, r.StageName+": "+r.Content)
	}
	msg := &kafka.PipelineMessage{
		QuestionID: questionID,
		SessionID:  body.SessionID,
		RunID:      body.RunID,
		Stage:      1,
		Input:      "", // will be filled from question if needed
		Feedback:   body.Feedback,
		History:    historyStrs,
	}
	// Load question content for Input
	qID, _ := uuid.Parse(questionID)
	if q, err := h.Questions.GetQuestionByID(c.Request.Context(), qID); err == nil {
		msg.Input = q.Content
	}
	if err := kafka.WriteMessage(c.Request.Context(), h.WriterReq, msg); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to restart pipeline"})
		return
	}
	if h.ResponseCache != nil {
		h.ResponseCache.InvalidateQuestion(c.Request.Context(), questionID)
	}
	c.JSON(http.StatusOK, gin.H{"status": "pipeline_restarted"})
}

