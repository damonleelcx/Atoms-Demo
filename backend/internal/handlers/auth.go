package handlers

import (
	"net/http"

	"atoms-demo/backend/internal/auth"

	"github.com/gin-gonic/gin"
)

// LoginRequest is the JSON body for POST /api/auth/login.
type LoginRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

// LoginResponse is the JSON response on success.
type LoginResponse struct {
	Token string `json:"token"`
}

// Login handles POST /api/auth/login. Accepts username/password and returns a token when they match the hardcoded demo credentials.
func (h *Handlers) Login(c *gin.Context) {
	var body LoginRequest
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "username and password required"})
		return
	}
	if body.Username != auth.DemoUsername || body.Password != auth.DemoPassword {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid username or password"})
		return
	}
	c.JSON(http.StatusOK, LoginResponse{Token: auth.DemoToken})
}
