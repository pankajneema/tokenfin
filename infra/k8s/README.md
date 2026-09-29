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
- `web` — Next.js (UI + API routes, incl. SDK ingest and OTLP receivers), replicas: 2+

## Deploy
```bash
kubectl apply -k infra/k8s/overlays/production
```
