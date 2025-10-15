import os, httpx
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import Application, CommandHandler, ContextTypes

BOT_TOKEN = os.getenv("BOT_TOKEN")
BACKEND_URL = os.getenv("BACKEND_URL", "http://auth-service:8000")
SITE_URL = os.getenv("SITE_URL", "http://localhost:3000/profile")

HELP = ("Привязка: сгенерируйте код на сайте (Профиль → Telegram), затем /link <код>.")

async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    kb = [[InlineKeyboardButton("Открыть сайт", url=SITE_URL)]]
    await update.message.reply_text("Здравствуйте! " + HELP,
                                    reply_markup=InlineKeyboardMarkup(kb))

async def link_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not context.args:
        return await update.message.reply_text("Укажите код: /link <КОД>")
    code = context.args[0].strip()
    payload = {
        "code": code,
        "telegram_id": update.effective_user.id,
        "telegram_username": update.effective_user.username or ""
    }
    async with httpx.AsyncClient(timeout=10) as cl:
        r = await cl.post(f"{BACKEND_URL}/telegram/confirm", json=payload)
    if r.status_code == 200:
        await update.message.reply_text("Готово! Аккаунт привязан ✅")
    else:
        try: detail = r.json().get("detail", r.text)
        except: detail = r.text
        await update.message.reply_text(f"Ошибка: {detail}")

async def unlink_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE):
    async with httpx.AsyncClient(timeout=10) as cl:
        r = await cl.delete(f"{BACKEND_URL}/telegram/unlink",
                            params={"telegram_id": update.effective_user.id})
    await update.message.reply_text("Отвязан." if r.status_code == 200 else "Не удалось отвязать.")

def main():
    if not BOT_TOKEN: raise RuntimeError("BOT_TOKEN not set")
    app = Application.builder().token(BOT_TOKEN).build()
    app.add_handler(CommandHandler("start", start))
    app.add_handler(CommandHandler("help", lambda u,c: u.message.reply_text(HELP)))
    app.add_handler(CommandHandler("link", link_cmd))
    app.add_handler(CommandHandler("unlink", unlink_cmd))
    app.run_polling()

if __name__ == "__main__":
    main()
