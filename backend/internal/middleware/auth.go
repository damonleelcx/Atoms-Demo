package middleware

import (
	"net/http"
	"strings"

	"atoms-demo/backend/internal/auth"

	"github.com/gin-gonic/gin"
)

// RequireAuth returns a Gin middleware that ensures requests to protected paths
// include a valid Authorization: Bearer <token>. /api/auth/login, /api/auth/signup, /health, and / are not protected.
func RequireAuth(svc *auth.Service) gin.HandlerFunc {
	return func(c *gin.Context) {
		path := c.Request.URL.Path
		if path == "/api/auth/login" || path == "/api/auth/signup" || path == "/health" || path == "/" {
			c.Next()
			return
		}
		if svc == nil {
			c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{"error": "auth not configured"})
			return
		}
		authHeader := c.GetHeader("Authorization")
		token := ""
		if strings.HasPrefix(authHeader, "Bearer ") {
			token = strings.TrimPrefix(authHeader, "Bearer ")
		}
		claims, err := svc.VerifyToken(token)
		if err != nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
			return
		}
		c.Set("auth.user_id", claims.Subject)
		c.Set("auth.username", claims.Username)
		c.Next()
	}
}
