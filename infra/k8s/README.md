# Kubernetes Manifests

Planned structure when moving to K8s:

```
k8s/
├── base/
│   ├── namespace.yaml
│   ├── web-deployment.yaml
│   ├── web-service.yaml
│   └── ingress.yaml
├── overlays/
│   ├── staging/
│   └── production/
└── README.md
```

## Services planned
- `web` — Next.js (UI + API routes), replicas: 2+
- `go-ingest` — Go ingest service (high throughput), replicas: 3+
- `go-worker` — Go background worker (alerts, aggregation), replicas: 1

## Deploy
```bash
kubectl apply -k infra/k8s/overlays/production
```
