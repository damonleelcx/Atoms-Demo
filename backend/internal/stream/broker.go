package stream

import (
	"log"
	"sync"
)

// Event is a single stream event (chunk or stage done).
type Event struct {
	Stage int    `json:"stage"`
	Chunk string `json:"chunk,omitempty"`
	Done  bool   `json:"done"`
}

const maxBufferEvents = 2000 // cap per run_id to avoid unbounded growth if no one subscribes

// Broker fans out stream events to subscribers by run_id.
// If there is no subscriber when Send is called, events are buffered and replayed when Subscribe is called.
type Broker struct {
	mu      sync.RWMutex
	subs    map[string]chan<- Event
	buffers map[string][]Event // events sent before anyone subscribed, replayed on Subscribe
}

// NewBroker creates a new stream broker.
func NewBroker() *Broker {
	return &Broker{
		subs:    make(map[string]chan<- Event),
		buffers: make(map[string][]Event),
	}
}

// Subscribe registers a subscriber for runID. Buffered events (if any) are replayed first, then live events.
// Caller must consume from the channel; the broker will not block on send.
func (b *Broker) Subscribe(runID string, ch chan<- Event) {
	b.mu.Lock()
	replay := b.buffers[runID]
	delete(b.buffers, runID)
	b.subs[runID] = ch
	b.mu.Unlock()
	for _, ev := range replay {
		select {
		case ch <- ev:
		default:
			log.Printf("[stream] broker: replay channel full for run_id=%s (event dropped)", runID)
			return
		}
	}
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

// Send sends an event to the subscriber for runID if any. If no subscriber, event is buffered (up to maxBufferEvents per run_id).
func (b *Broker) Send(runID string, ev Event) {
	b.mu.RLock()
	ch, ok := b.subs[runID]
	b.mu.RUnlock()
	if ok && ch != nil {
		select {
		case ch <- ev:
			return
		default:
			log.Printf("[stream] broker: channel full for run_id=%s (event dropped)", runID)
			return
		}
	}
	// No subscriber: buffer for later replay
	b.mu.Lock()
	defer b.mu.Unlock()
	buf := b.buffers[runID]
	if len(buf) >= maxBufferEvents {
		return
	}
	b.buffers[runID] = append(buf, ev)
}
