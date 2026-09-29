package db

import (
	"testing"

	"github.com/tokenfin/backend/internal/models"
)

func sp(s string) *string { return &s }

func TestFilterInsertedKeepsOnlyReturnedRows(t *testing.T) {
	a := &models.UsageEvent{ID: "1", EventID: sp("direct:org:a")}
	b := &models.UsageEvent{ID: "2", EventID: sp("direct:org:b")} // duplicate — not returned
	c := &models.UsageEvent{ID: "3", EventID: sp("ingest:3")}
	d := &models.UsageEvent{ID: "4"} // no event_id — always new

	got := FilterInserted([]*models.UsageEvent{a, b, c, d}, []InsertedRow{
		{ID: "x", EventID: sp("ingest:3")},
		{ID: "y", EventID: sp("direct:org:a")},
		{ID: "z"}, // row for d
	})

	want := []*models.UsageEvent{a, c, d}
	if len(got) != len(want) {
		t.Fatalf("got %d events, want %d", len(got), len(want))
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("got[%d] = %s, want %s", i, got[i].ID, want[i].ID)
		}
	}
}

func TestFilterInsertedAllDuplicates(t *testing.T) {
	e := &models.UsageEvent{ID: "1", EventID: sp("direct:org:a")}
	if got := FilterInserted([]*models.UsageEvent{e}, nil); len(got) != 0 {
		t.Errorf("got %d events, want 0", len(got))
	}
}

func TestNormalizeEventAssignsEventID(t *testing.T) {
	e := &models.UsageEvent{ID: "abc"}
	normalizeEvent(e)
	if e.EventID == nil || *e.EventID != "ingest:abc" {
		t.Errorf("event_id = %v, want ingest:abc", e.EventID)
	}
	if e.Tags == nil || e.Metadata == nil || e.Optimizations == nil {
		t.Error("nil maps not normalized")
	}
	k := &models.UsageEvent{ID: "abc", EventID: sp("direct:org:k")}
	normalizeEvent(k)
	if *k.EventID != "direct:org:k" {
		t.Errorf("existing event_id overwritten: %s", *k.EventID)
	}
}
