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

	// Write events — leave unACKed on transient failure so they retry.
	written, allIDs := events, goodIDs
	inserted, err := c.db.BulkInsertEvents(ctx, events)
	if err != nil {
		if !db.IsClientError(err) {
			c.log.Error("bulk insert failed — will retry", "count", len(events), "err", err)
			return
		}
		// 4xx: one bad row poisons the whole array insert. Retry row by row
		// so only the failing rows are dead-lettered and good events land.
		c.log.Warn("bulk insert rejected — isolating bad rows", "count", len(events), "err", err)
		written, allIDs, inserted = c.insertIndividually(ctx, events, goodIDs, msgs)
		if len(written) == 0 {
			return
		}
	}
	events, goodIDs = written, allIDs

	// Upsert daily aggregates only for rows actually inserted — duplicates
	// (redeliveries / replayed idempotency keys) were skipped by the DB and
	// must not be counted again. Non-fatal; reconciler corrects drift.
	if err := c.db.UpsertAgg(ctx, inserted); err != nil {
		c.log.Warn("agg upsert failed — reconciler will correct", "err", err)
	}

	if err := c.redis.Ack(ctx, goodIDs...); err != nil {
		c.log.Error("ACK failed — messages may be redelivered", "count", len(goodIDs), "err", err)
	}

	c.log.Debug("batch written", "events", len(events), "inserted", len(inserted), "acked", len(goodIDs))
}

// insertIndividually inserts each event on its own. Rows rejected with a 4xx
// go to the DLQ (which ACKs them); rows hit by a transient error are left
// unACKed for redelivery. Returns the events/IDs that were written and still
// need ACK, plus the subset that was newly inserted (needs agg upsert).
func (c *Consumer) insertIndividually(ctx context.Context, events []*models.UsageEvent, ids []string, msgs []goredis.XMessage) ([]*models.UsageEvent, []string, []*models.UsageEvent) {
	payloads := make(map[string]string, len(msgs))
	for _, m := range msgs {
		if p, ok := extractPayload(m); ok {
			payloads[m.ID] = p
		}
	}

	var okEvents, newEvents []*models.UsageEvent
	var okIDs []string
	for i, e := range events {
		ins, err := c.db.BulkInsertEvents(ctx, []*models.UsageEvent{e})
		switch {
		case err == nil:
			okEvents = append(okEvents, e)
			okIDs = append(okIDs, ids[i])
			newEvents = append(newEvents, ins...)
		case db.IsClientError(err):
			c.log.Error("event rejected by db — DLQ", "id", ids[i], "org_id", e.OrgID, "err", err)
			if derr := c.redis.MoveToDLQ(ctx, ids[i], payloads[ids[i]], fmt.Sprintf("insert: %v", err)); derr != nil {
				c.log.Error("DLQ move failed", "id", ids[i], "err", derr)
			}
		default:
			c.log.Error("single insert failed — will retry", "id", ids[i], "err", err)
		}
	}
	return okEvents, okIDs, newEvents
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
