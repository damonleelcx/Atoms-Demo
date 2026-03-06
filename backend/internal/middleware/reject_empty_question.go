package middleware

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"

	"github.com/gin-gonic/gin"
)

// RejectEmptyQuestionPOST returns 400 for POST /api/questions with empty content
// before the request hits the rate limiter, so empty-body spam does not burn the limit.
func RejectEmptyQuestionPOST() gin.HandlerFunc {
	return func(c *gin.Context) {
		if c.Request.Method != http.MethodPost || c.Request.URL.Path != "/api/questions" {
			c.Next()
			return
		}
		body, err := io.ReadAll(c.Request.Body)
		c.Request.Body.Close()
		if err != nil {
			c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "content required"})
			return
		}
		c.Request.Body = io.NopCloser(bytes.NewReader(body))
		var v struct {
			Content string `json:"content"`
		}
		if err := json.Unmarshal(body, &v); err != nil || v.Content == "" {
			c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "content required"})
			return
		}
		c.Next()
	}
}
