package stream

import (
	"sync"
)

// Event is a single stream event (chunk or stage done).
type Event struct {
	Stage int    `json:"stage"`
	Chunk string `json:"chunk,omitempty"`
	Done  bool   `json:"done"`
}

// Broker fans out stream events to subscribers by run_id.
type Broker struct {
	mu   sync.RWMutex
	subs map[string]chan<- Event
}

// NewBroker creates a new stream broker.
func NewBroker() *Broker {
	return &Broker{subs: make(map[string]chan<- Event)}
}

// Subscribe registers a subscriber for runID. The channel receives events until closed.
// Caller must consume from the channel; the broker will not block on send.
func (b *Broker) Subscribe(runID string, ch chan<- Event) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.subs[runID] = ch
}

// Unsubscribe removes the subscriber for runID and closes its channel.
func (b *Broker) Unsubscribe(runID string) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if ch, ok := b.subs[runID]; ok {
		delete(b.subs, runID)
		close(ch)
	}
}

// Send sends an event to the subscriber for runID if any. Non-blocking; drops if no subscriber or channel full.
func (b *Broker) Send(runID string, ev Event) {
	b.mu.RLock()
	ch, ok := b.subs[runID]
	b.mu.RUnlock()
	if !ok || ch == nil {
		return
	}
	select {
	case ch <- ev:
	default:
		// channel full or closed, skip
	}
}
