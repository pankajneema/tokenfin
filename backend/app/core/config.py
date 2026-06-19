from pydantic_settings import BaseSettings
from functools import lru_cache

class Settings(BaseSettings):
    # Supabase
    supabase_url:              str
    supabase_anon_key:         str
    supabase_service_role_key: str

    # SMTP
    smtp_server:   str = "smtp.gmail.com"
    smtp_port:     int = 587
    smtp_email:    str = ""
    smtp_password: str = ""
    contact_email: str = "hello@curiousdevs.com"

    # Slack
    slack_bot_token:      str = ""
    slack_signing_secret: str = ""

    # Telegram
    telegram_bot_token: str = ""

    # Redis
    redis_url: str = "redis://localhost:6379/0"

    # App
    app_url:     str = "http://localhost:3001"
    backend_url: str = "http://localhost:8000"
    secret_key:  str = "change-me-in-production"
    debug:       bool = False
    host:        str = "0.0.0.0"
    port:        int = 8000

    class Config:
        env_file = ".env.local"
        env_file_encoding = "utf-8"
        extra = "ignore"

@lru_cache
def get_settings() -> Settings:
    return Settings()
