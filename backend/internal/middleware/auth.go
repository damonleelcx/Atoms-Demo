package middleware

import (
	"net/http"
	"strings"

	"atoms-demo/backend/internal/auth"

	"github.com/gin-gonic/gin"
)

// RequireAuth returns a Gin middleware that ensures requests to protected paths
// include a valid Authorization: Bearer <token>. /api/auth/login, /health, and / are not protected.
func RequireAuth() gin.HandlerFunc {
	return func(c *gin.Context) {
		path := c.Request.URL.Path
		if path == "/api/auth/login" || path == "/health" || path == "/" {
			c.Next()
			return
		}
		authHeader := c.GetHeader("Authorization")
		token := ""
		if strings.HasPrefix(authHeader, "Bearer ") {
			token = strings.TrimPrefix(authHeader, "Bearer ")
		}
		if token != auth.DemoToken {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
			return
		}
		c.Next()
	}
}
