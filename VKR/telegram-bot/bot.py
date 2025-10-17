import os
import httpx
from urllib.parse import urlparse, urlunparse
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import Application, CommandHandler, ContextTypes

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
        return ""  # пусть дальше упадем с понятной ошибкой

    parsed = urlparse(raw.strip())
    # если пользователь случайно указал http — Telegram такое не принимает
    if parsed.scheme not in ("https",):
        # попробуем автоматически исправить на https
        parsed = parsed._replace(scheme="https")

    # оставляем только схему и хост (и порт, если был), путь заменим на /profile
    netloc = parsed.netloc or parsed.path  # на случай, если кто-то указал просто "example.com"
    parsed_fixed = parsed._replace(path="/profile", params="", query="", fragment="", netloc=netloc)

    return urlunparse(parsed_fixed)

SITE_URL = normalize_site_url(RAW_SITE_URL)

async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    # Кнопка всегда ведёт на https://.../profile
    kb = [[InlineKeyboardButton("Открыть сайт", url=SITE_URL)]]
    await update.message.reply_text(
        "Здравствуйте! " + HELP,
        reply_markup=InlineKeyboardMarkup(kb),
    )

async def link_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not context.args:
        return await update.message.reply_text("Укажите код: /link <КОД>")

    code = context.args[0].strip()
    payload = {
        "code": code,
        "telegram_id": update.effective_user.id,
        "telegram_username": update.effective_user.username or ""
    }

    try:
        async with httpx.AsyncClient(timeout=10) as cl:
            r = await cl.post(f"{BACKEND_URL}/telegram/confirm", json=payload)
        if r.status_code == 200:
            await update.message.reply_text("Готово! Аккаунт привязан ✅")
        else:
            try:
                detail = r.json().get("detail", r.text)
            except Exception:
                detail = r.text
            await update.message.reply_text(f"Ошибка: {detail}")
    except Exception as e:
        await update.message.reply_text(f"Ошибка запроса к бэкенду: {e}")

async def unlink_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE):
    try:
        async with httpx.AsyncClient(timeout=10) as cl:
            r = await cl.delete(
                f"{BACKEND_URL}/telegram/unlink",
                params={"telegram_id": update.effective_user.id},
            )
        await update.message.reply_text("Отвязан." if r.status_code == 200 else "Не удалось отвязать.")
    except Exception as e:
        await update.message.reply_text(f"Ошибка запроса к бэкенду: {e}")

def main():
    if not BOT_TOKEN:
        raise RuntimeError("BOT_TOKEN not set")
    if not SITE_URL:
        raise RuntimeError("SITE_URL not set or invalid")

    # Полезно увидеть в логах контейнера, что именно подхватилось
    print(f"[bot] BACKEND_URL = {BACKEND_URL}")
    print(f"[bot] SITE_URL    = {SITE_URL}")

    app = Application.builder().token(BOT_TOKEN).build()
    app.add_handler(CommandHandler("start", start))
    app.add_handler(CommandHandler("help", lambda u, c: u.message.reply_text(HELP)))
    app.add_handler(CommandHandler("link", link_cmd))
    app.add_handler(CommandHandler("unlink", unlink_cmd))
    app.run_polling()

if __name__ == "__main__":
    main()
