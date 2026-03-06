package handlers

import (
	"io"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"atoms-demo/backend/internal/kafka"
)

const (
	fallbackQuestionText = "Describe the app you want to build."
	fallbackFeedbackText = "Please refine the design or add more features."
)

// audioFilenameFromContentType returns a short filename hint for Whisper from Content-Type (e.g. audio/webm -> audio.webm).
func audioFilenameFromContentType(contentType string) string {
	contentType = strings.TrimSpace(strings.Split(contentType, ";")[0])
	switch {
	case strings.HasSuffix(contentType, "/webm"):
		return "audio.webm"
	case strings.HasSuffix(contentType, "/mpeg"), strings.HasSuffix(contentType, "/mp3"):
		return "audio.mp3"
	case strings.HasSuffix(contentType, "/wav"):
		return "audio.wav"
	case strings.HasSuffix(contentType, "/ogg"):
		return "audio.ogg"
	case strings.HasSuffix(contentType, "/mp4"):
		return "audio.mp4"
	default:
		return "audio.webm"
	}
}

// SubmitQuestionAudio accepts audio in body, transcribes with Whisper, then creates question and starts pipeline.
func (h *Handlers) SubmitQuestionAudio(c *gin.Context) {
	body, err := io.ReadAll(c.Request.Body)
	if err != nil || len(body) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "audio body required"})
		return
	}
	text := fallbackQuestionText
	if h.Transcriber != nil {
		filename := audioFilenameFromContentType(c.GetHeader("Content-Type"))
		transcript, err := h.Transcriber.Transcribe(c.Request.Context(), body, filename)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "transcription failed: " + err.Error()})
			return
		}
		if transcript != "" {
			text = transcript
		}
	}
	sessionID := c.GetHeader("X-Session-ID")
	q, err := h.Questions.CreateQuestion(c.Request.Context(), text, sessionID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	runID := uuid.New().String()
	msg := &kafka.PipelineMessage{
		QuestionID: q.ID.String(),
		SessionID:  sessionID,
		RunID:      runID,
		Input:      text,
	}
	if err := kafka.WriteMessage(c.Request.Context(), h.WriterReq, msg); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to start pipeline"})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"question_id": q.ID.String(),
		"run_id":      runID,
		"content":     text,
		"created_at":  q.CreatedAt,
	})
}

// SubmitFeedbackAudio accepts audio in body, transcribes with Whisper, then restarts pipeline with feedback.
func (h *Handlers) SubmitFeedbackAudio(c *gin.Context) {
	questionID := c.Param("id")
	if questionID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "questionId required"})
		return
	}
	body, err := io.ReadAll(c.Request.Body)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "audio body required"})
		return
	}
	feedback := fallbackFeedbackText
	if h.Transcriber != nil && len(body) > 0 {
		filename := audioFilenameFromContentType(c.GetHeader("Content-Type"))
		transcript, err := h.Transcriber.Transcribe(c.Request.Context(), body, filename)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "transcription failed: " + err.Error()})
			return
		}
		if transcript != "" {
			feedback = transcript
		}
	}
	runID := c.GetHeader("X-Run-ID")
	sessionID := c.GetHeader("X-Session-ID")
	history, _ := h.Responses.ListByQuestionID(c.Request.Context(), questionID, runID)
	var historyStrs []string
	for _, r := range history {
		historyStrs = append(historyStrs, r.StageName+": "+r.Content)
	}
	newRunID := uuid.New().String()
	msg := &kafka.PipelineMessage{
		QuestionID: questionID,
		SessionID:  sessionID,
		RunID:      newRunID,
		Stage:      1,
		Feedback:   feedback,
		History:    historyStrs,
	}
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
	c.JSON(http.StatusOK, gin.H{"status": "pipeline_restarted", "feedback": feedback, "run_id": newRunID})
}
