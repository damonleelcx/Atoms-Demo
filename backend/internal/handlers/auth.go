package handlers

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
)

// LoginRequest is the JSON body for POST /api/auth/login.
type LoginRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

// SignupRequest is the JSON body for POST /api/auth/signup.
type SignupRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

// LoginResponse is the JSON response on success.
type LoginResponse struct {
	Token string `json:"token"`
}

func normalizeUsername(s string) string {
	return strings.ToLower(strings.TrimSpace(s))
}

// Signup handles POST /api/auth/signup. Creates a user and returns a JWT.
func (h *Handlers) Signup(c *gin.Context) {
	if h.Auth == nil || h.Questions == nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "auth not configured"})
		return
	}
	var body SignupRequest
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "username and password required"})
		return
	}
	username := normalizeUsername(body.Username)
	if username == "" || len(body.Password) < 8 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "username required; password must be at least 8 characters"})
		return
	}
	hash, err := h.Auth.HashPassword(body.Password)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to hash password"})
		return
	}
	u, err := h.Questions.CreateUser(c.Request.Context(), username, hash)
	if err != nil {
		// Unique violation → username taken
		c.JSON(http.StatusConflict, gin.H{"error": "username already exists"})
		return
	}
	tok, err := h.Auth.IssueToken(u.ID, u.Username)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to issue token"})
		return
	}
	c.JSON(http.StatusOK, LoginResponse{Token: tok})
}

// Login handles POST /api/auth/login. Accepts username/password and returns a JWT when valid.
func (h *Handlers) Login(c *gin.Context) {
	if h.Auth == nil || h.Questions == nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "auth not configured"})
		return
	}
	var body LoginRequest
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "username and password required"})
		return
	}
	username := normalizeUsername(body.Username)
	if username == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "username and password required"})
		return
	}
	u, err := h.Questions.GetUserByUsername(c.Request.Context(), username)
	if err != nil {
		if err == pgx.ErrNoRows {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid username or password"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load user"})
		return
	}
	if !h.Auth.ComparePassword(u.PasswordHash, body.Password) {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid username or password"})
		return
	}
	tok, err := h.Auth.IssueToken(u.ID, u.Username)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to issue token"})
		return
	}
	c.JSON(http.StatusOK, LoginResponse{Token: tok})
}
