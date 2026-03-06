package mongo

import (
	"context"
	"time"

	"github.com/google/uuid"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

const collectionAgentResponses = "agent_responses"

type AgentResponse struct {
	ID            primitive.ObjectID `bson:"_id,omitempty" json:"id"`
	QuestionID    string             `bson:"question_id" json:"question_id"`
	SessionID     string             `bson:"session_id" json:"session_id"`
	RunID         string             `bson:"run_id" json:"run_id"`
	Stage         int                `bson:"stage" json:"stage"` // 1=requirement, 2=design, 3=implementation, 4=feedback
	StageName     string             `bson:"stage_name" json:"stage_name"`
	Content       string             `bson:"content" json:"content"`
	Payload       map[string]any     `bson:"payload,omitempty" json:"payload,omitempty"`
	AwaitingFeedback bool            `bson:"awaiting_feedback" json:"awaiting_feedback"`
	CreatedAt     time.Time          `bson:"created_at" json:"created_at"`
}

type Repo struct {
	coll *mongo.Collection
}

func NewRepo(db *mongo.Database) *Repo {
	return &Repo{coll: db.Collection(collectionAgentResponses)}
}

func (r *Repo) Create(ctx context.Context, ar *AgentResponse) error {
	if ar.RunID == "" {
		ar.RunID = uuid.New().String()
	}
	ar.CreatedAt = time.Now().UTC()
	_, err := r.coll.InsertOne(ctx, ar)
	return err
}

func (r *Repo) ListByQuestionID(ctx context.Context, questionID string, runID string) ([]AgentResponse, error) {
	filter := bson.M{"question_id": questionID}
	if runID != "" {
		filter["run_id"] = runID
	}
	opts := options.Find().SetSort(bson.D{{Key: "stage", Value: 1}, {Key: "created_at", Value: 1}})
	cur, err := r.coll.Find(ctx, filter, opts)
	if err != nil {
		return nil, err
	}
	defer cur.Close(ctx)
	var out []AgentResponse
	if err := cur.All(ctx, &out); err != nil {
		return nil, err
	}
	return out, nil
}

// DeleteByQuestionIDAndRunID removes all responses for the given question and run (e.g. before restarting pipeline after feedback).
func (r *Repo) DeleteByQuestionIDAndRunID(ctx context.Context, questionID string, runID string) error {
	if questionID == "" || runID == "" {
		return nil
	}
	_, err := r.coll.DeleteMany(ctx, bson.M{"question_id": questionID, "run_id": runID})
	return err
}

func (r *Repo) LatestByQuestionID(ctx context.Context, questionID string) (*AgentResponse, error) {
	opts := options.FindOne().SetSort(bson.D{{Key: "created_at", Value: -1}})
	var ar AgentResponse
	err := r.coll.FindOne(ctx, bson.M{"question_id": questionID}, opts).Decode(&ar)
	if err == mongo.ErrNoDocuments {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &ar, nil
}

func (r *Repo) GetRunIDs(ctx context.Context, questionID string) ([]string, error) {
	pipe := []bson.M{
		{"$match": bson.M{"question_id": questionID}},
		{"$group": bson.M{"_id": "$run_id"}},
		{"$sort": bson.M{"_id": -1}},
		{"$limit": 20},
	}
	cur, err := r.coll.Aggregate(ctx, pipe)
	if err != nil {
		return nil, err
	}
	defer cur.Close(ctx)
	var results []struct {
		ID string `bson:"_id"`
	}
	if err := cur.All(ctx, &results); err != nil {
		return nil, err
	}
	ids := make([]string, 0, len(results))
	for _, r := range results {
		ids = append(ids, r.ID)
	}
	return ids, nil
}
