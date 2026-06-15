import asyncio
import httpx
import aiosmtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text      import MIMEText
from typing import Optional
from app.core.config import get_settings
from app.core.logging import log
from app.models.schemas import NotificationPayload

settings = get_settings()

# ── Email ────────────────────────────────────────────────────────────────────

def _build_email_html(title: str, body: str) -> str:
    return f"""
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:Arial,sans-serif;background:#f5f5f5;padding:40px">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden">
    <div style="background:#E8533A;padding:24px 32px">
      <h1 style="color:#fff;margin:0;font-size:20px">TokenFin Alert</h1>
    </div>
    <div style="padding:32px">
      <h2 style="color:#1a1a1a;margin-top:0">{title}</h2>
      <p style="color:#444;line-height:1.6">{body}</p>
    </div>
    <div style="padding:16px 32px;background:#f9f9f9;border-top:1px solid #eee">
      <p style="color:#999;font-size:12px;margin:0">
        TokenFin by CuriousDevs · <a href="https://tokenfin.curiousdevs.com">Manage alerts</a>
      </p>
    </div>
  </div>
</body>
</html>"""


async def send_email(to: str, title: str, body: str) -> bool:
    if not settings.smtp_email or not settings.smtp_password:
        log.warning("smtp_not_configured")
        return False
    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = f"[TokenFin] {title}"
        msg["From"]    = settings.smtp_email
        msg["To"]      = to
        msg.attach(MIMEText(body, "plain"))
        msg.attach(MIMEText(_build_email_html(title, body), "html"))

        await aiosmtplib.send(
            msg,
            hostname=settings.smtp_server,
            port=settings.smtp_port,
            username=settings.smtp_email,
            password=settings.smtp_password,
            start_tls=True,
        )
        return True
    except Exception as e:
        log.error("email_send_failed", error=str(e))
        return False


# ── Slack ────────────────────────────────────────────────────────────────────

async def send_slack(webhook_url: str, title: str, body: str) -> bool:
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            res = await client.post(webhook_url, json={
                "attachments": [{
                    "color":  "#E8533A",
                    "blocks": [
                        {"type": "header",  "text": {"type": "plain_text", "text": f"🔔 {title}"}},
                        {"type": "section", "text": {"type": "mrkdwn",     "text": body}},
                    ],
                }]
            })
        return res.status_code == 200
    except Exception as e:
        log.error("slack_send_failed", error=str(e))
        return False


# ── Telegram ─────────────────────────────────────────────────────────────────

async def send_telegram(chat_id: str, title: str, body: str) -> bool:
    if not settings.telegram_bot_token:
        return False
    try:
        url  = f"https://api.telegram.org/bot{settings.telegram_bot_token}/sendMessage"
        text = f"*{title}*\n\n{body}"
        async with httpx.AsyncClient(timeout=10) as client:
            res = await client.post(url, json={"chat_id": chat_id, "text": text, "parse_mode": "Markdown"})
        return res.status_code == 200
    except Exception as e:
        log.error("telegram_send_failed", error=str(e))
        return False


# ── Webhook ───────────────────────────────────────────────────────────────────

async def send_webhook(url: str, payload: NotificationPayload) -> bool:
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            res = await client.post(
                url,
                json=payload.model_dump(),
                headers={"X-TokenFin-Event": "alert", "Content-Type": "application/json"},
            )
        return res.status_code < 400
    except Exception as e:
        log.error("webhook_send_failed", error=str(e))
        return False


# ── Dispatch ──────────────────────────────────────────────────────────────────

async def dispatch(payload: NotificationPayload) -> dict[str, bool]:
    tasks   = {}
    results = {}

    for channel in payload.channels:
        if channel.startswith("email:"):
            tasks[channel] = send_email(channel[6:], payload.title, payload.body)
        elif channel.startswith("slack:"):
            tasks[channel] = send_slack(channel[6:], payload.title, payload.body)
        elif channel.startswith("telegram:"):
            tasks[channel] = send_telegram(channel[9:], payload.title, payload.body)
        elif channel.startswith("webhook:"):
            tasks[channel] = send_webhook(channel[8:], payload)

    if tasks:
        done = await asyncio.gather(*tasks.values(), return_exceptions=True)
        for key, result in zip(tasks.keys(), done):
            results[key] = result if isinstance(result, bool) else False

    return results
