package handlers

import (
	"context"
	"encoding/json"
	"log"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"atoms-demo/backend/internal/kafka"
	"atoms-demo/backend/internal/middleware"
	"atoms-demo/backend/internal/mongo"
	"atoms-demo/backend/internal/postgres"
	"atoms-demo/backend/internal/stream"
)

// Transcriber converts audio to text (e.g. Whisper). May be nil; then audio handlers use fallback text.
type Transcriber interface {
	Transcribe(ctx context.Context, audio []byte, filename string) (string, error)
}

type Handlers struct {
	Questions      *postgres.Repo
	Responses      *mongo.Repo
	WriterReq      *kafka.Writer
	Transcriber    Transcriber
	Broker         *stream.Broker
	QuestionsCache *middleware.QuestionsListCache
	ResponseCache  *middleware.ResponseCache
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
	msg := &kafka.PipelineMessage{
		QuestionID: q.ID.String(),
		SessionID:  body.SessionID,
		RunID:      runID,
		Input:      body.Content,
	}
	if err := kafka.WriteMessage(c.Request.Context(), h.WriterReq, msg); err != nil {
		log.Printf("pipeline: kafka write failed for question %s: %v", q.ID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to start pipeline"})
		return
	}
	log.Printf("pipeline: started for question %s run %s", q.ID, runID)
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
	if questionID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "questionId required"})
		return
	}
	ctx := c.Request.Context()
	cacheKey := "responses:" + questionID + ":" + runID
	if h.ResponseCache != nil {
		if data, ok := h.ResponseCache.Get(ctx, cacheKey); ok {
			log.Printf("[cache] GET /api/questions/%s/responses run_id=%s: hit", questionID, runID)
			c.Data(http.StatusOK, "application/json", data)
			return
		}
	}
	log.Printf("[cache] GET /api/questions/%s/responses run_id=%s: miss", questionID, runID)
	list, err := h.Responses.ListByQuestionID(ctx, questionID, runID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	payload := gin.H{"responses": list}
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
	c.JSON(http.StatusOK, gin.H{"status": "pipeline_restarted"})
}

// GetResponsesStream streams agent output as SSE for the given run_id.
func (h *Handlers) GetResponsesStream(c *gin.Context) {
	questionID := c.Param("id")
	runID := c.Query("run_id")
	if questionID == "" || runID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "id and run_id required"})
		return
	}
	if h.Broker == nil {
		c.JSON(http.StatusNotImplemented, gin.H{"error": "streaming not enabled"})
		return
	}
	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")
	c.Header("X-Accel-Buffering", "no")
	ch := make(chan stream.Event, 64)
	h.Broker.Subscribe(runID, ch)
	defer h.Broker.Unsubscribe(runID)
	for {
		select {
		case <-c.Request.Context().Done():
			return
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
