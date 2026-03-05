package mongo

import (
	"context"
	"fmt"

	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
	"atoms-demo/backend/internal/config"
)

func NewClient(ctx context.Context, cfg *config.Config) (*mongo.Client, error) {
	opts := options.Client().ApplyURI(cfg.MongoDB.URI)
	client, err := mongo.Connect(ctx, opts)
	if err != nil {
		return nil, fmt.Errorf("mongo connect: %w", err)
	}
	if err := client.Ping(ctx, nil); err != nil {
		return nil, fmt.Errorf("mongo ping: %w", err)
	}
	return client, nil
}

func DB(client *mongo.Client, cfg *config.Config) *mongo.Database {
	return client.Database(cfg.MongoDB.Database)
}
