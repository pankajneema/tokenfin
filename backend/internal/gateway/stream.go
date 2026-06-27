package gateway

import (
	"crypto/rand"
	"fmt"
	"io"
)

// cappedBuffer captures up to `limit` bytes and silently drops the rest. Used
// to sniff provider usage out of the response without holding huge streams.
type cappedBuffer struct {
	buf   []byte
	limit int
}

func (c *cappedBuffer) Write(p []byte) (int, error) {
	if remain := c.limit - len(c.buf); remain > 0 {
		take := p
		if len(take) > remain {
			take = take[:remain]
		}
		c.buf = append(c.buf, take...)
	}
	return len(p), nil // always report full write — we only sample
}

func (c *cappedBuffer) Bytes() []byte { return c.buf }

// streamCopy pumps src → client while mirroring into capture, flushing after
// each chunk so SSE reaches the client promptly.
func streamCopy(client io.Writer, src io.Reader, capture io.Writer, flusher interface{ Flush() }) error {
	buf := make([]byte, 32*1024)
	for {
		n, err := src.Read(buf)
		if n > 0 {
			if _, werr := client.Write(buf[:n]); werr != nil {
				return werr
			}
			_, _ = capture.Write(buf[:n])
			if flusher != nil {
				flusher.Flush()
			}
		}
		if err == io.EOF {
			return nil
		}
		if err != nil {
			return err
		}
	}
}

// newID generates a UUID v4 (no external deps).
func newID() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%08x-%04x-%04x-%04x-%012x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}
