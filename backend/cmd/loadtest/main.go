// Command loadtest fires concurrent POST /v1/ingest requests at the ingest
// service and reports throughput, latency percentiles, and status codes.
//
// Usage:
//   go run ./cmd/loadtest -url http://localhost:8001/v1/ingest -key tfk_... \
//       -rate 2000 -duration 5s -conns 200
//
// -rate is the target requests/sec (open-loop, paced). Set -rate 0 for
// closed-loop (fire as fast as -conns workers allow — measures max capacity).
package main

import (
	"bytes"
	"context"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"sort"
	"sync"
	"sync/atomic"
	"time"
)

func main() {
	url := flag.String("url", "http://localhost:8001/v1/ingest", "ingest endpoint")
	key := flag.String("key", "", "API key (tfk_...)")
	rate := flag.Int("rate", 0, "target req/sec (0 = max throughput / closed-loop)")
	dur := flag.Duration("duration", 5*time.Second, "test duration")
	conns := flag.Int("conns", 200, "concurrent workers")
	flag.Parse()
	if *key == "" {
		fmt.Println("error: -key required")
		os.Exit(1)
	}

	body := []byte(`{"model":"gpt-4o-mini","input_tokens":120,"output_tokens":60,"tags":{"src":"loadtest"}}`)
	client := &http.Client{
		Timeout: 10 * time.Second,
		Transport: &http.Transport{
			MaxIdleConns:        *conns * 2,
			MaxIdleConnsPerHost: *conns * 2,
			MaxConnsPerHost:     *conns * 2,
			IdleConnTimeout:     30 * time.Second,
		},
	}

	var (
		ok, errs, sent int64
		latsMu         sync.Mutex
		lats           []time.Duration
		statusMu       sync.Mutex
		statuses       = map[int]int64{}
	)

	ctx, cancel := context.WithTimeout(context.Background(), *dur)
	defer cancel()

	do := func() {
		start := time.Now()
		req, _ := http.NewRequestWithContext(ctx, http.MethodPost, *url, bytes.NewReader(body))
		req.Header.Set("Authorization", "Bearer "+*key)
		req.Header.Set("Content-Type", "application/json")
		resp, err := client.Do(req)
		lat := time.Since(start)
		if err != nil {
			atomic.AddInt64(&errs, 1)
			return
		}
		io.Copy(io.Discard, resp.Body)
		resp.Body.Close()
		statusMu.Lock()
		statuses[resp.StatusCode]++
		statusMu.Unlock()
		if resp.StatusCode < 300 {
			atomic.AddInt64(&ok, 1)
		} else {
			atomic.AddInt64(&errs, 1)
		}
		latsMu.Lock()
		lats = append(lats, lat)
		latsMu.Unlock()
	}

	wallStart := time.Now()
	var wg sync.WaitGroup

	if *rate > 0 {
		// Open-loop: a ticker paces requests at the target rate; a bounded
		// worker pool executes them so a slow server creates backpressure.
		jobs := make(chan struct{}, *rate)
		for i := 0; i < *conns; i++ {
			wg.Add(1)
			go func() { defer wg.Done(); for range jobs { atomic.AddInt64(&sent, 1); do() } }()
		}
		interval := time.Second / time.Duration(*rate)
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
	loop:
		for {
			select {
			case <-ctx.Done():
				break loop
			case <-ticker.C:
				select {
				case jobs <- struct{}{}:
				default: // pool saturated — server can't keep up at this rate
				}
			}
		}
		close(jobs)
	} else {
		// Closed-loop: workers fire continuously until the deadline.
		for i := 0; i < *conns; i++ {
			wg.Add(1)
			go func() {
				defer wg.Done()
				for ctx.Err() == nil {
					atomic.AddInt64(&sent, 1)
					do()
				}
			}()
		}
	}
	wg.Wait()
	wall := time.Since(wallStart)

	latsMu.Lock()
	sort.Slice(lats, func(i, j int) bool { return lats[i] < lats[j] })
	pct := func(p float64) time.Duration {
		if len(lats) == 0 {
			return 0
		}
		return lats[int(float64(len(lats)-1)*p)]
	}
	p50, p95, p99 := pct(0.50), pct(0.95), pct(0.99)
	latsMu.Unlock()

	total := ok + errs
	fmt.Printf("\n=== Load test results ===\n")
	fmt.Printf("Duration:     %.2fs\n", wall.Seconds())
	fmt.Printf("Sent:         %d\n", sent)
	fmt.Printf("Completed:    %d  (ok=%d errors=%d)\n", total, ok, errs)
	fmt.Printf("Throughput:   %.0f req/sec (accepted)\n", float64(ok)/wall.Seconds())
	fmt.Printf("Latency:      p50=%v  p95=%v  p99=%v\n", p50, p95, p99)
	fmt.Printf("Status codes: %v\n", statuses)
	if float64(ok)/wall.Seconds() >= 1000 {
		fmt.Printf("RESULT:       ✅ sustained ≥ 1000 req/sec\n\n")
	} else {
		fmt.Printf("RESULT:       ⚠️  below 1000 req/sec\n\n")
	}
}
