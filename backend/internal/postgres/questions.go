package postgres

import (
	"context"
	"time"

	"github.com/google/uuid"
)

type Question struct {
	ID        uuid.UUID `json:"id"`
	Content   string    `json:"content"`
	SessionID string    `json:"session_id,omitempty"`
	CreatedAt time.Time `json:"created_at"`
}

func (r *Repo) CreateQuestion(ctx context.Context, content, sessionID string) (*Question, error) {
	var q Question
	err := r.pool.QueryRow(ctx,
		`INSERT INTO user_questions (content, session_id) VALUES ($1, $2)
		 RETURNING id, content, COALESCE(session_id,''), created_at`,
		content, nullString(sessionID),
	).Scan(&q.ID, &q.Content, &q.SessionID, &q.CreatedAt)
	if err != nil {
		return nil, err
	}
	return &q, nil
}

func (r *Repo) ListQuestions(ctx context.Context, limit int) ([]Question, error) {
	if limit <= 0 {
		limit = 50
	}
	rows, err := r.pool.Query(ctx,
		`SELECT id, content, COALESCE(session_id,''), created_at
		 FROM user_questions ORDER BY created_at DESC LIMIT $1`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var list []Question
	for rows.Next() {
		var q Question
		if err := rows.Scan(&q.ID, &q.Content, &q.SessionID, &q.CreatedAt); err != nil {
			return nil, err
		}
		list = append(list, q)
	}
	return list, rows.Err()
}

func (r *Repo) GetQuestionByID(ctx context.Context, id uuid.UUID) (*Question, error) {
	var q Question
	err := r.pool.QueryRow(ctx,
		`SELECT id, content, COALESCE(session_id,''), created_at
		 FROM user_questions WHERE id = $1`, id,
	).Scan(&q.ID, &q.Content, &q.SessionID, &q.CreatedAt)
	if err != nil {
		return nil, err
	}
	return &q, nil
}

func nullString(s string) interface{} {
	if s == "" {
		return nil
	}
	return s
}
