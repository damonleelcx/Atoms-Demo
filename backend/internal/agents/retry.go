package agents

import (
	"fmt"
	"strings"
	"time"
)

// isRetriableKafkaError returns true for transient Kafka errors that should be retried
// (e.g. Group Coordinator Not Available at startup, Rebalance, Leader Not Available) instead of exiting.
func isRetriableKafkaError(err error) bool {
	if err == nil {
		return false
	}
	// Use %v to include wrapped error text (same as log output)
	s := fmt.Sprintf("%v", err)
	return strings.Contains(s, "[15]") || // COORDINATOR_NOT_AVAILABLE
		strings.Contains(s, "Group Coordinator Not Available") ||
		strings.Contains(s, "Coordinator Not Available") ||
		strings.Contains(s, "Coordinator") && strings.Contains(s, "Not Available") ||
		strings.Contains(s, "Rebalance") ||
		strings.Contains(s, "Leader Not Available") ||
		strings.Contains(s, "leader not available") ||
		strings.Contains(s, "NotLeaderForPartition")
}

// retryBackoff is the delay before retrying after a transient Kafka error.
const retryBackoff = 5 * time.Second
