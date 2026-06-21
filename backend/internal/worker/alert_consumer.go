package worker

import (
	"context"
	"fmt"
	"log/slog"
	"strconv"
	"time"

	goredis "github.com/redis/go-redis/v9"

	"github.com/tokenfin/backend/internal/db"
	"github.com/tokenfin/backend/internal/redis"
)

// AlertConsumer reads warn/block events from the usage.alerts stream
// and writes them as notification records in Supabase.
// This is what makes warn alerts visible in the dashboard Alerts → History tab.
type AlertConsumer struct {
	redis *redis.Client
	db    *db.Client
	log   *slog.Logger
}

func NewAlertConsumer(rc *redis.Client, dbc *db.Client, log *slog.Logger) *AlertConsumer {
	return &AlertConsumer{redis: rc, db: dbc, log: log}
}

// Run polls the alerts stream until ctx is cancelled.
// Tracks the last-seen message ID so no alerts are dropped between calls.
func (a *AlertConsumer) Run(ctx context.Context) {
	a.log.Info("alert consumer started")

	// "$" on first call: only process alerts published after this worker starts.
	// On subsequent calls, pass the last received ID to avoid missing messages
	// published between the end of one batch and the start of the next.
	lastID := "$"

	for {
		select {
		case <-ctx.Done():
			a.log.Info("alert consumer stopping")
			return
		default:
		}

		msgs, err := a.redis.ReadAlerts(ctx, lastID)
		if err != nil {
			a.log.Error("alert stream read error", "err", err)
			select {
			case <-ctx.Done():
				return
			case <-time.After(2 * time.Second):
			}
			continue
		}

		for _, m := range msgs {
			if err := a.handle(ctx, m); err != nil {
				a.log.Warn("alert handle failed", "id", m.ID, "err", err)
			}
			lastID = m.ID // advance cursor regardless of handle success/failure
		}
	}
}

func (a *AlertConsumer) handle(ctx context.Context, m goredis.XMessage) error {
	orgID, _ := m.Values["org_id"].(string)
	alertType, _ := m.Values["type"].(string)   // "warn" | "block"
	metric, _ := m.Values["metric"].(string)     // "tokens:monthly" | "cost:monthly"
	usagePctStr, _ := m.Values["usage_pct"].(string)

	if orgID == "" || alertType == "" {
		return fmt.Errorf("malformed alert message: %v", m.Values)
	}

	usagePct, _ := strconv.ParseFloat(usagePctStr, 64)

	title, body := formatAlert(alertType, metric, usagePct)

	return a.db.InsertNotification(ctx, orgID, title, body, alertType)
}

func formatAlert(alertType, metric string, usagePct float64) (title, body string) {
	metricLabel := "cost"
	if metric != "cost:monthly" {
		metricLabel = metric
	}

	switch alertType {
	case "block":
		title = "Usage limit reached — requests blocked"
		body = fmt.Sprintf(
			"Monthly %s budget hit (%.1f%%). New requests are being rejected.",
			metricLabel, usagePct,
		)
	default: // "warn"
		title = fmt.Sprintf("Usage warning — %.0f%% of monthly %s budget", usagePct, metricLabel)
		body = fmt.Sprintf(
			"You have used %.1f%% of your monthly %s budget.",
			usagePct, metricLabel,
		)
	}
	return
}
