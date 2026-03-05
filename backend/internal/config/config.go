package config

import (
	"fmt"
	"os"
	"strings"

	"gopkg.in/yaml.v3"
)

type Config struct {
	Server   Server   `yaml:"server"`
	Postgres Postgres `yaml:"postgres"`
	MongoDB  MongoDB  `yaml:"mongodb"`
	Redis    Redis    `yaml:"redis"`
	Kafka    Kafka    `yaml:"kafka"`
	OpenAI   OpenAI   `yaml:"openai"`
}

type OpenAI struct {
	APIKey string `yaml:"api_key"`
	Model  string `yaml:"model"`
}

type Server struct {
	Port int `yaml:"port"`
}

type Postgres struct {
	URL string `yaml:"url"`
}

type MongoDB struct {
	URI      string `yaml:"uri"`
	Database string `yaml:"database"`
}

type Redis struct {
	Addr          string `yaml:"addr"`
	RateLimit     int    `yaml:"rate_limit"`
	RateWindowSec int    `yaml:"rate_window_sec"`
}

type Kafka struct {
	Brokers          []string `yaml:"brokers"`
	TopicRequirement string   `yaml:"topic_requirement"`
	TopicDesign      string   `yaml:"topic_design"`
	TopicImplementation string `yaml:"topic_implementation"`
	TopicFeedback    string   `yaml:"topic_feedback"`
	ConsumerGroup   string   `yaml:"consumer_group"`
}

func Load(path string) (*Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var c Config
	if err := yaml.Unmarshal(data, &c); err != nil {
		return nil, err
	}
	// Env overrides
	if u := os.Getenv("POSTGRES_URL"); u != "" {
		c.Postgres.URL = u
	}
	if u := os.Getenv("MONGODB_URI"); u != "" {
		c.MongoDB.URI = u
	}
	if u := os.Getenv("REDIS_ADDR"); u != "" {
		c.Redis.Addr = u
	}
	if n := os.Getenv("REDIS_RATE_LIMIT"); n != "" {
		var v int
		if _, err := fmt.Sscanf(n, "%d", &v); err == nil {
			c.Redis.RateLimit = v
		}
	}
	if n := os.Getenv("REDIS_RATE_WINDOW_SEC"); n != "" {
		var v int
		if _, err := fmt.Sscanf(n, "%d", &v); err == nil && v > 0 {
			c.Redis.RateWindowSec = v
		}
	}
	if u := os.Getenv("KAFKA_BROKERS"); u != "" {
		c.Kafka.Brokers = []string{u}
	}
	if u := os.Getenv("OPENAI_API_KEY"); u != "" {
		c.OpenAI.APIKey = u
	}
	if u := os.Getenv("OPENAI_MODEL"); u != "" {
		c.OpenAI.Model = u
	}
	// When running in Docker (Postgres host is service name), use Kafka service name if brokers still localhost
	if len(c.Kafka.Brokers) > 0 && (c.Kafka.Brokers[0] == "localhost:9092" || strings.HasPrefix(c.Kafka.Brokers[0], "127.0.0.1")) {
		if strings.Contains(c.Postgres.URL, "@postgres:") {
			c.Kafka.Brokers = []string{"kafka:9092"}
		}
	}
	return &c, nil
}
