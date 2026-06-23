package redis

// Stream operations — separate file for clarity, same package as client.go

import (
	"context"
	"fmt"
	"time"

	goredis "github.com/redis/go-redis/v9"
)

// Stream and group name constants — single source of truth.
const (
	StreamRaw     = "usage.events.raw"
	StreamDLQ     = "usage.events.dlq"
	StreamAlerts  = "usage.alerts"
	GroupDBWriter = "db-writer"
	MaxRetries    = 3

	streamMaxLen  = 1_000_000 // approx cap — Redis trims to this
	readBatchSize = 1000
	blockTimeout  = 5 * time.Second
)

// ─── Publish ──────────────────────────────────────────────────────────────────

// Publish adds a JSON event payload to the main ingest stream.
// Returns the Redis message ID on success.
func (c *Client) Publish(ctx context.Context, payload string) (string, error) {
	id, err := c.rdb.XAdd(ctx, &goredis.XAddArgs{
		Stream: StreamRaw,
		MaxLen: streamMaxLen,
		Approx: true, // MAXLEN ~ is more efficient than exact
		Values: map[string]any{"event": payload},
	}).Result()
	if err != nil {
		return "", fmt.Errorf("XADD: %w", err)
	}
	return id, nil
}

// PublishAlert pushes a warn/block event to the alerts stream for the alert worker.
func (c *Client) PublishAlert(ctx context.Context, orgID, alertType, metric string, usagePct float64) error {
	return c.rdb.XAdd(ctx, &goredis.XAddArgs{
		Stream: StreamAlerts,
		MaxLen: 100_000,
		Approx: true,
		Values: map[string]any{
			"org_id":     orgID,
			"type":       alertType, // "warn" | "block"
			"metric":     metric,    // "tokens:monthly" | "cost:monthly"
			"usage_pct":  fmt.Sprintf("%.2f", usagePct),
			"created_at": time.Now().UTC().Format(time.RFC3339),
		},
	}).Err()
}

// ReadAlerts reads messages from the alerts stream after the given lastID.
// Pass "$" on the very first call (get only messages after connection time).
// Pass the ID of the last message received on subsequent calls — this prevents
// losing messages that arrive between consecutive calls.
// Returns nil, nil on timeout — not an error.
func (c *Client) ReadAlerts(ctx context.Context, lastID string) ([]goredis.XMessage, error) {
	streams, err := c.rdb.XRead(ctx, &goredis.XReadArgs{
		Streams: []string{StreamAlerts, lastID},
		Count:   100,
		Block:   blockTimeout,
	}).Result()

	if err == goredis.Nil || len(streams) == 0 || len(streams[0].Messages) == 0 {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("XREAD alerts: %w", err)
	}
	return streams[0].Messages, nil
}

// ─── Consumer Group ───────────────────────────────────────────────────────────

// EnsureConsumerGroup creates the consumer group idempotently.
// Uses "0" as start ID so it processes any backlog on first run.
func (c *Client) EnsureConsumerGroup(ctx context.Context) error {
	err := c.rdb.XGroupCreateMkStream(ctx, StreamRaw, GroupDBWriter, "0").Err()
	if err != nil && !isBusyGroup(err) {
		return fmt.Errorf("create consumer group: %w", err)
	}
	return nil
}

// ─── Read ─────────────────────────────────────────────────────────────────────

// ReadPending returns unacknowledged messages for this consumer.
// Called at startup to reprocess messages from a previous crashed run.
func (c *Client) ReadPending(ctx context.Context, consumer string) ([]goredis.XMessage, error) {
	streams, err := c.rdb.XReadGroup(ctx, &goredis.XReadGroupArgs{
		Group:    GroupDBWriter,
		Consumer: consumer,
		Streams:  []string{StreamRaw, "0"}, // "0" = pending for this consumer
		Count:    readBatchSize,
	}).Result()

	if err == goredis.Nil || len(streams) == 0 || len(streams[0].Messages) == 0 {
		return nil, nil // nothing pending
	}
	if err != nil {
		return nil, fmt.Errorf("XREADGROUP pending: %w", err)
	}
	return streams[0].Messages, nil
}

// ReadNew reads fresh (undelivered) messages, blocking up to blockTimeout.
// Returns nil, nil on timeout with no messages — not an error.
func (c *Client) ReadNew(ctx context.Context, consumer string) ([]goredis.XMessage, error) {
	streams, err := c.rdb.XReadGroup(ctx, &goredis.XReadGroupArgs{
		Group:    GroupDBWriter,
		Consumer: consumer,
		Streams:  []string{StreamRaw, ">"}, // ">" = new messages only
		Count:    readBatchSize,
		Block:    blockTimeout,
	}).Result()

	if err == goredis.Nil || len(streams) == 0 || len(streams[0].Messages) == 0 {
		return nil, nil // timeout or empty
	}
	if err != nil {
		return nil, fmt.Errorf("XREADGROUP new: %w", err)
	}
	return streams[0].Messages, nil
}

// ─── ACK / DLQ ────────────────────────────────────────────────────────────────

// Ack marks one or more messages as successfully processed.
func (c *Client) Ack(ctx context.Context, ids ...string) error {
	if len(ids) == 0 {
		return nil
	}
	return c.rdb.XAck(ctx, StreamRaw, GroupDBWriter, ids...).Err()
}

// MoveToDLQ transfers a message to the dead-letter stream and ACKs it from main.
// Uses a pipeline so both ops succeed or fail together.
func (c *Client) MoveToDLQ(ctx context.Context, msgID, payload, reason string) error {
	pipe := c.rdb.Pipeline()
	pipe.XAdd(ctx, &goredis.XAddArgs{
		Stream: StreamDLQ,
		Values: map[string]any{
			"event":     payload,
			"origin_id": msgID,
			"reason":    reason,
			"failed_at": time.Now().UTC().Format(time.RFC3339),
		},
	})
	pipe.XAck(ctx, StreamRaw, GroupDBWriter, msgID)

	if _, err := pipe.Exec(ctx); err != nil {
		return fmt.Errorf("move to DLQ (msg=%s): %w", msgID, err)
	}
	return nil
}

// ─── Pending info ─────────────────────────────────────────────────────────────

// DeliveryCounts returns a map of msgID → delivery count for the given IDs.
// Used to decide whether to move a pending message to DLQ.
func (c *Client) DeliveryCounts(ctx context.Context, ids []string) (map[string]int64, error) {
	if len(ids) == 0 {
		return nil, nil
	}

	// Use first and last ID as range bounds
	first, last := ids[0], ids[len(ids)-1]

	result, err := c.rdb.XPendingExt(ctx, &goredis.XPendingExtArgs{
		Stream: StreamRaw,
		Group:  GroupDBWriter,
		Start:  first,
		End:    last,
		Count:  int64(len(ids)),
	}).Result()
	if err != nil {
		return nil, fmt.Errorf("XPENDING: %w", err)
	}

	counts := make(map[string]int64, len(result))
	for _, p := range result {
		counts[p.ID] = p.RetryCount
	}
	return counts, nil
}

// ─── Redis SCAN for reconciler ────────────────────────────────────────────────

// ScanKeys returns all keys matching a pattern.
// Uses SCAN to avoid blocking the server.
func (c *Client) ScanKeys(ctx context.Context, pattern string) ([]string, error) {
	var keys []string
	iter := c.rdb.Scan(ctx, 0, pattern, 0).Iterator()
	for iter.Next(ctx) {
		keys = append(keys, iter.Val())
	}
	return keys, iter.Err()
}

// ─── helpers ──────────────────────────────────────────────────────────────────

func isBusyGroup(err error) bool {
	return err != nil && err.Error() == "BUSYGROUP Consumer Group name already exists"
}
