import http from 'node:http'
import type { AddressInfo } from 'node:net'

export interface Received { path: string; headers: http.IncomingHttpHeaders; body: any } // eslint-disable-line @typescript-eslint/no-explicit-any
export type Responder = (req: Received, n: number) => { status: number; body?: unknown; headers?: Record<string, string> }

/** Minimal local HTTP server that records requests and answers via `responder`. */
export async function startMock(responder: Responder) {
  const received: Received[] = []
  const server = http.createServer((req, res) => {
    let raw = ''
    req.on('data', c => { raw += c })
    req.on('end', () => {
      const rec: Received = { path: req.url ?? '', headers: req.headers, body: raw ? JSON.parse(raw) : null }
      received.push(rec)
      const out = responder(rec, received.length)
      res.writeHead(out.status, { 'Content-Type': 'application/json', ...(out.headers ?? {}) })
      res.end(out.body === undefined ? '{}' : JSON.stringify(out.body))
    })
  })
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  const port = (server.address() as AddressInfo).port
  return {
    url: `http://127.0.0.1:${port}`,
    received,
    close: () => new Promise<void>(r => server.close(() => r())),
  }
}
