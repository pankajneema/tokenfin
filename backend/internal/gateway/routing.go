package gateway

import (
	"context"
	"encoding/json"
	"time"
)

// Eval-informed model routing. The gateway caches active routes (org → from →
// to) and, when routing is enabled, rewrites a request's model to the cheaper
// approved target. Savings are recorded as baseline(from) − actual(to).

// routeFor returns the target model for (org, from), or "" if none.
func (s *Service) routeFor(orgID, from string) string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if m := s.routes[orgID]; m != nil {
		return m[from]
	}
	return ""
}

// RefreshRoutes reloads the route cache from the DB.
func (s *Service) RefreshRoutes(ctx context.Context) {
	rows, err := s.db.LoadModelRoutes(ctx)
	if err != nil {
		s.log.Warn("route refresh failed", "err", err)
		return
	}
	next := map[string]map[string]string{}
	for _, r := range rows {
		if next[r.OrgID] == nil {
			next[r.OrgID] = map[string]string{}
		}
		next[r.OrgID][r.FromModel] = r.ToModel
	}
	s.mu.Lock()
	s.routes = next
	s.mu.Unlock()
	s.log.Info("routes refreshed", "orgs", len(next))
}

// RefreshRoutesLoop refreshes on start then every 2 minutes until ctx is done.
func (s *Service) RefreshRoutesLoop(ctx context.Context) {
	s.RefreshRoutes(ctx)
	t := time.NewTicker(2 * time.Minute)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			s.RefreshRoutes(ctx)
		}
	}
}

// rewriteModel parses a JSON body, sets "model" to `to`, and re-marshals.
// Returns nil on failure (caller keeps the original — fail open).
func rewriteModel(body []byte, to string) []byte {
	var m map[string]any
	if json.Unmarshal(body, &m) != nil {
		return nil
	}
	m["model"] = to
	out, err := json.Marshal(m)
	if err != nil {
		return nil
	}
	return out
}
