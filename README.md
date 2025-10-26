# Calendar Stack - Runbook (Docker Compose)

This project uses Docker Compose to run: Postgres, Auth FastAPI, Whisper, Telegram Bot, Frontend (nginx), and Gateway (nginx).

## Prerequisites
- Docker Desktop 4.x
- Compose V2 (`docker compose ...`)

## .env configuration (root)
Create `.env` in the project root (same directory as `docker-compose.yml`) with Unix line endings (LF):

```
POSTGRES_USER=calendar
POSTGRES_PASSWORD=calendar
POSTGRES_DB=calendar
DATABASE_URL=postgresql+psycopg2://calendar:calendar@postgres:5432/calendar
SECRET_KEY=change-me
BOT_TOKEN=123456789:AA...your-token
SITE_URL=https://your-domain-or-ngrok.ngrok-free.app
```

- SITE_URL must be a public `https` URL. The bot will normalize it to `https://.../profile`.
- Use LF line endings. In editors like VS Code: bottom-right corner → set to LF.

## Start the stack

```
docker compose down
# explicitly pass the root .env for safety on Windows
docker compose --env-file ./.env up -d --build
```

## Verify Telegram bot environment

```
docker compose config | sed -n '/telegram-bot:/,/^[^ ]/p'
```
You should see `telegram-bot.environment` include `BACKEND_URL` and `SITE_URL` with values. Then check logs:

```
docker compose logs telegram-bot --tail=200 -f
# Expect lines:
# [bot] BACKEND_URL = http://auth-service:8000
# [bot] SITE_URL    = https://.../profile
```

If needed, exec into the container and confirm env:

```
docker compose exec telegram-bot sh -c 'env | grep -E "BOT_TOKEN|SITE_URL|BACKEND_URL"'
```

## Using the bot
- Send `/start` to receive a button that opens your `SITE_URL` normalized to `/profile`.
- On the website, generate a link code (Profile → Telegram). In Telegram, use:
  - `/link <CODE>` to bind, the bot will call `http://auth-service:8000/telegram/confirm` internally.
  - `/unlink` to unbind.

## Troubleshooting
- Container restarting with `BOT_TOKEN not set` or `SITE_URL not set or invalid`:
  - Ensure `.env` exists in project root and keys are present without quotes.
  - Convert `.env` to LF line endings.
  - Start with `docker compose --env-file ./.env up -d --build`.
- `SITE_URL` must be a public https URL (not localhost). Use an HTTPS tunnel/domain.
- Check `docker compose config` to confirm variables are interpolated.
