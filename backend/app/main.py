"""
TokenFin Python Backend — FastAPI
Port: 8000

Architecture:
  Next.js (port 3001) — UI + lightweight API routes
  Python  (port 8000) — Heavy backend: processing, limits, alerts, notifications

Run:
  cd backend
  uvicorn main:app --host 0.0.0.0 --port 8000 --reload
"""
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from prometheus_client import make_asgi_app

from app.core.config import get_settings
from app.core.logging import setup_logging, log
from app.workers.scheduler import start_scheduler, stop_scheduler
from app.api import ingest, limits, analytics, notifications, health

settings = get_settings()

@asynccontextmanager
async def lifespan(app: FastAPI):
    setup_logging(settings.debug)
    start_scheduler()
    log.info("tokenfin_backend_started", port=settings.port)
    yield
    stop_scheduler()
    log.info("tokenfin_backend_stopped")

app = FastAPI(
    title="TokenFin Backend",
    description="LLM Cost Attribution & FinOps — Python Backend",
    version="0.1.0",
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.app_url, "http://localhost:3001", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(ingest.router,        prefix="/api")
app.include_router(limits.router,        prefix="/api")
app.include_router(analytics.router,     prefix="/api")
app.include_router(notifications.router, prefix="/api")

metrics_app = make_asgi_app()
app.mount("/metrics", metrics_app)
