package worker

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"time"

	goredis "github.com/redis/go-redis/v9"

	"github.com/tokenfin/backend/internal/db"
	"github.com/tokenfin/backend/internal/models"
	"github.com/tokenfin/backend/internal/redis"
)

// Consumer reads from the usage.events.raw stream, bulk-writes to Supabase,
// and ACKs successfully processed messages. Failed messages after MaxRetries
// are moved to the dead-letter queue.
type Consumer struct {
	name  string // unique consumer name within the group (e.g. "worker-0")
	redis *redis.Client
	db    *db.Client
	log   *slog.Logger
}

func NewConsumer(name string, rc *redis.Client, dbc *db.Client, log *slog.Logger) *Consumer {
	return &Consumer{name: name, redis: rc, db: dbc, log: log}
}

// Run is the main consumer loop. Blocks until ctx is cancelled.
// On startup it reprocesses any pending messages from a previous crashed run,
// then switches to reading new messages.
func (c *Consumer) Run(ctx context.Context) {
	c.log.Info("consumer started", "name", c.name)

	if err := c.redis.EnsureConsumerGroup(ctx); err != nil {
		c.log.Error("consumer group init failed", "err", err)
		return
	}

	// Phase 1: drain any pending messages from a previous crashed run
	if err := c.drainPending(ctx); err != nil {
		c.log.Warn("pending drain error — continuing", "err", err)
	}

	// Phase 2: steady-state read loop
	for {
		select {
		case <-ctx.Done():
			c.log.Info("consumer stopping", "name", c.name)
			return
		default:
		}

		msgs, err := c.redis.ReadNew(ctx, c.name)
		if err != nil {
			c.log.Error("stream read error", "err", err)
			select {
			case <-ctx.Done():
				return
			case <-time.After(2 * time.Second):
			}
			continue
		}

		if len(msgs) == 0 {
			continue // ReadNew block timed out — loop again
		}

		c.processBatch(ctx, msgs)
	}
}

// drainPending reprocesses messages in the PEL that were never ACKed.
func (c *Consumer) drainPending(ctx context.Context) error {
	for {
		// Respect shutdown signal during drain
		if ctx.Err() != nil {
			return ctx.Err()
		}

		msgs, err := c.redis.ReadPending(ctx, c.name)
		if err != nil {
			return err
		}
		if len(msgs) == 0 {
			return nil
		}
		c.log.Info("reprocessing pending messages", "count", len(msgs))
		c.processBatch(ctx, msgs)
	}
}

// processBatch parses, writes, and ACKs a slice of stream messages.
// Per-message parse/validation failures go to DLQ immediately.
// A DB write failure leaves all messages unACKed (they retry on next delivery).
func (c *Consumer) processBatch(ctx context.Context, msgs []goredis.XMessage) {
	if len(msgs) == 0 {
		return
	}

	// Collect delivery counts in one XPENDING call to detect over-limit messages
	ids := make([]string, len(msgs))
	for i, m := range msgs {
		ids[i] = m.ID
	}
	counts, err := c.redis.DeliveryCounts(ctx, ids)
	if err != nil {
		c.log.Warn("delivery count fetch failed — no DLQ guard this batch", "err", err)
		counts = map[string]int64{}
	}

	var (
		events  []*models.UsageEvent
		goodIDs []string
	)

	for _, m := range msgs {
		// Over retry limit → dead-letter queue
		if counts[m.ID] > redis.MaxRetries {
			payload, _ := extractPayload(m)
			c.log.Warn("max retries exceeded — DLQ", "id", m.ID, "deliveries", counts[m.ID])
			if err := c.redis.MoveToDLQ(ctx, m.ID, payload,
				fmt.Sprintf("delivery count %d", counts[m.ID])); err != nil {
				c.log.Error("DLQ move failed", "id", m.ID, "err", err)
			}
			continue
		}

		payload, ok := extractPayload(m)
		if !ok {
			c.log.Error("missing event field — DLQ", "id", m.ID)
			c.redis.MoveToDLQ(ctx, m.ID, "", "missing event field") //nolint:errcheck
			continue
		}

		event, err := parseEvent(payload)
		if err != nil {
			c.log.Error("parse error — DLQ", "id", m.ID, "err", err)
			c.redis.MoveToDLQ(ctx, m.ID, payload, fmt.Sprintf("parse: %v", err)) //nolint:errcheck
			continue
		}

		events = append(events, event)
		goodIDs = append(goodIDs, m.ID)
	}

	if len(events) == 0 {
		return
	}

	// Write events — leave unACKed on failure so they retry
	if err := c.db.BulkInsertEvents(ctx, events); err != nil {
		c.log.Error("bulk insert failed — will retry", "count", len(events), "err", err)
		return
	}

	// Upsert daily aggregates — non-fatal; reconciler corrects drift
	if err := c.db.UpsertAgg(ctx, events); err != nil {
		c.log.Warn("agg upsert failed — reconciler will correct", "err", err)
	}

	if err := c.redis.Ack(ctx, goodIDs...); err != nil {
		c.log.Error("ACK failed — messages may be redelivered", "count", len(goodIDs), "err", err)
	}

	c.log.Debug("batch written", "events", len(events), "acked", len(goodIDs))
}

// ─── helpers ──────────────────────────────────────────────────────────────────

func extractPayload(m goredis.XMessage) (string, bool) {
	v, ok := m.Values["event"]
	if !ok {
		return "", false
	}
	s, ok := v.(string)
	return s, ok
}

func parseEvent(payload string) (*models.UsageEvent, error) {
	var e models.UsageEvent
	if err := json.Unmarshal([]byte(payload), &e); err != nil {
		return nil, fmt.Errorf("unmarshal: %w", err)
	}
	if e.OrgID == "" || e.Model == "" {
		return nil, fmt.Errorf("invalid event: missing org_id or model")
	}
	return &e, nil
}
