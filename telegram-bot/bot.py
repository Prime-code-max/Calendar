import os
import httpx
from urllib.parse import urlparse, urlunparse
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import Application, CommandHandler, ContextTypes

"""
Expected environment variables (provided via docker-compose):
  - BOT_TOKEN   : Telegram bot token
  - BACKEND_URL : Internal URL for the auth-service (default: http://auth-service:8000)
  - SITE_URL    : Public site base URL; will be normalized to https://.../profile
"""

BOT_TOKEN = os.getenv("BOT_TOKEN")
BACKEND_URL = os.getenv("BACKEND_URL", "http://auth-service:8000")
RAW_SITE_URL = os.getenv("SITE_URL", "")  # ожидание: https://ваш-домен

HELP = (
    "Привязка: сгенерируйте код на сайте (Профиль → Telegram), затем используйте команду:\n"
    "/link <КОД>"
)

def normalize_site_url(raw: str) -> str:
    """
    Приводим SITE_URL к безопасному виду:
    - должен быть https
    - убираем лишний путь/квери/фрагменты
    - добавляем /profile
    """
    if not raw:
        return ""

    parsed = urlparse(raw.strip())
    # Telegram требует https-ссылки
    if parsed.scheme not in ("https",):
        parsed = parsed._replace(scheme="https")

    # оставляем только схему и хост (и порт, если был), путь = /profile
    netloc = parsed.netloc or parsed.path  # если указали просто "example.com"
    parsed_fixed = parsed._replace(path="/profile", params="", query="", fragment="", netloc=netloc)

    return urlunparse(parsed_fixed)

SITE_URL = normalize_site_url(RAW_SITE_URL)
if not SITE_URL:
    # Не валим контейнер — делаем понятный fallback и варнинг в лог
    print("[bot][WARN] SITE_URL missing or invalid; using fallback https://example.com/profile")
    SITE_URL = "https://example.com/profile"

# ---------- Утилита безопасного ответа ----------
async def safe_reply(update: Update, context: ContextTypes.DEFAULT_TYPE, text: str, **kwargs):
    """
    Безопасно отвечает:
    - если есть исходное сообщение — reply
    - иначе пишет в чат по chat_id
    """
    if update.effective_message:
        await update.effective_message.reply_text(text, **kwargs)
    elif update.effective_chat:
        await context.bot.send_message(chat_id=update.effective_chat.id, text=text, **kwargs)

# ---------- Хэндлеры ----------
async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    kb = [[InlineKeyboardButton("Открыть сайт", url=SITE_URL)]]
    await safe_reply(
        update, context,
        "Здравствуйте! " + HELP,
        reply_markup=InlineKeyboardMarkup(kb),
    )

async def help_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await safe_reply(update, context, HELP)

async def link_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not context.args:
        return await safe_reply(update, context, "Укажите код: /link <КОД>")

    code = context.args[0].strip()
    payload = {
        "code": code,
        "telegram_id": (update.effective_user.id if update.effective_user else 0),
        "telegram_username": (update.effective_user.username if update.effective_user else "") or ""
    }

    try:
        async with httpx.AsyncClient(timeout=10) as cl:
            r = await cl.post(f"{BACKEND_URL}/telegram/confirm", json=payload)
        if r.status_code == 200:
            await safe_reply(update, context, "Готово! Аккаунт привязан ✅")
        else:
            try:
                detail = r.json().get("detail", r.text)
            except Exception:
                detail = r.text
            await safe_reply(update, context, f"Ошибка: {detail}")
    except Exception as e:
        await safe_reply(update, context, f"Ошибка запроса к бэкенду: {e}")

async def unlink_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE):
    try:
        async with httpx.AsyncClient(timeout=10) as cl:
            r = await cl.delete(
                f"{BACKEND_URL}/telegram/unlink",
                params={"telegram_id": (update.effective_user.id if update.effective_user else 0)},
            )
        await safe_reply(update, context, "Отвязан." if r.status_code == 200 else "Не удалось отвязать.")
    except Exception as e:
        await safe_reply(update, context, f"Ошибка запроса к бэкенду: {e}")

# Глобальный обработчик ошибок, чтобы видеть стек в логах и не терять фидбек
async def on_error(update: object, context: ContextTypes.DEFAULT_TYPE):
    try:
        print("BOT ERROR:", context.error)
        if isinstance(update, Update):
            await safe_reply(update, context, f"⚠️ Ошибка: {context.error}")
    except Exception:
        pass

def main():
    if not BOT_TOKEN:
        raise RuntimeError("BOT_TOKEN not set")

    print(f"[bot] BACKEND_URL = {BACKEND_URL}")
    print(f"[bot] SITE_URL    = {SITE_URL}")

    app = Application.builder().token(BOT_TOKEN).build()
    app.add_error_handler(on_error)

    app.add_handler(CommandHandler("start", start))
    app.add_handler(CommandHandler("help", help_cmd))
    app.add_handler(CommandHandler("link", link_cmd))
    app.add_handler(CommandHandler("unlink", unlink_cmd))

    app.run_polling()

if __name__ == "__main__":
    main()
