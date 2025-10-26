from fastapi import FastAPI, Depends, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm

from sqlalchemy import create_engine, Column, Integer, String, Text, text
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, Session
from sqlalchemy.exc import OperationalError

from passlib.context import CryptContext
from jose import JWTError, jwt

from pydantic import BaseModel, Field, ConfigDict
from typing import Optional, List
import os
import datetime as dt
import time
import uuid
import hashlib
import hmac
import json
import urllib.parse

from icalendar import Calendar
from dateutil import tz
from dotenv import load_dotenv

# =========================
# ENV / CONFIG
# =========================
load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")  # e.g. postgresql+psycopg2://user:password@postgres:5432/auth_db
SECRET_KEY = os.getenv("SECRET_KEY", "fallback-secret-key")
BOT_TOKEN = os.getenv("BOT_TOKEN")
ALGORITHM = "HS256"

# =========================
# DB SETUP
# =========================
engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def wait_for_db():
    """Ждём готовности БД, чтобы не падать при старте контейнера."""
    retries = 30
    delay = 2
    for i in range(retries):
        try:
            with engine.connect() as connection:
                connection.execute(text("SELECT 1"))
            print("Database is ready!")
            return
        except OperationalError:
            print(f"Waiting for database... Attempt {i + 1}/{retries}")
            time.sleep(delay)
    raise Exception("Database is not ready after maximum retries")


# =========================
# MODELS (SQLAlchemy)
# =========================
class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True, nullable=False)
    hashed_password = Column(String, nullable=False)

    # Профиль
    theme = Column(String, default="dark")                     # "dark" | "light"
    hide_done = Column(Integer, default=0)                     # 0/1 как bool
    timezone = Column(String, default="Europe/Amsterdam")      # IANA TZ

    # Telegram
    telegram_chat_id = Column(String, nullable=True)           # chat_id (строкой)
    telegram_username = Column(String, nullable=True)          # @username
    # Старые поля можно оставить, но код перенесём в отдельную таблицу:
    telegram_link_code = Column(String, nullable=True)
    telegram_link_expires = Column(String, nullable=True)      # ISO datetime


class Event(Base):
    __tablename__ = "events"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String, index=True, nullable=False)
    description = Column(Text, nullable=True)
    color = Column(String, default="#3788d8")
    start_time = Column(String, nullable=False)  # ISO string (для простоты)
    end_time = Column(String, nullable=False)    # ISO string
    owner_id = Column(Integer, nullable=False)
    status = Column(String, default="pending")   # "pending" | "done"


class TelegramLink(Base):
    """
    Отдельная таблица кодов привязки Telegram.
    Один активный код на пользователя.
    """
    __tablename__ = "telegram_links"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, index=True, nullable=False)
    code = Column(String, unique=True, index=True, nullable=False)
    expires_at = Column(String, nullable=True)   # ISO-строка (UTC)
    used = Column(Integer, default=0)            # 0/1


# Инициализация БД
wait_for_db()
Base.metadata.create_all(bind=engine)

# =========================
# SCHEMAS (Pydantic)
# =========================
class UserCreate(BaseModel):
    username: str
    password: str


class EventCreate(BaseModel):
    title: str
    description: Optional[str] = None
    color: str = "#3788d8"
    start_time: Optional[str] = None
    end_time: Optional[str] = None


class EventUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    color: Optional[str] = None
    start_time: Optional[str] = None
    end_time: Optional[str] = None


class EventOut(EventCreate):
    id: int
    owner_id: int
    status: str = "pending"
    model_config = ConfigDict(from_attributes=True)


class ProfileOut(BaseModel):
    username: str
    theme: str
    hide_done: bool
    timezone: str
    telegram_linked: bool


class ProfileUpdate(BaseModel):
    theme: Optional[str] = Field(None, pattern="^(dark|light)$")
    hide_done: Optional[bool] = None
    timezone: Optional[str] = None


class ChangePassword(BaseModel):
    old_password: str
    new_password: str


class ICSImportResult(BaseModel):
    created: int
    skipped: int


# =========================
# AUTH UTILS
# =========================
pwd_context = CryptContext(
    schemes=["argon2"],
    deprecated="auto"
)
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)


def get_password_hash(password: str) -> str:
    return pwd_context.hash(password)


def create_access_token(data: dict, expires_minutes: int = 60) -> str:
    to_encode = data.copy()
    expire = dt.datetime.utcnow() + dt.timedelta(minutes=expires_minutes)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)) -> User:
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        if not username:
            raise HTTPException(status_code=401, detail="Invalid token")
        user = db.query(User).filter(User.username == username).first()
        if not user:
            raise HTTPException(status_code=401, detail="User not found")
        return user
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid token")


def bool_to_int(b: bool) -> int:
    return 1 if b else 0


def int_to_bool(i: Optional[int]) -> bool:
    return bool(i or 0)


def now_utc_iso() -> str:
    return dt.datetime.utcnow().replace(tzinfo=dt.timezone.utc).isoformat()


def verify_telegram_webapp_data(init_data: str, bot_token: str) -> dict:
    """
    Verify Telegram WebApp initData signature according to Telegram docs.
    Returns parsed user data if valid, raises HTTPException if invalid.
    """
    print(f"[DEBUG] Verifying Telegram WebApp data...")
    print(f"[DEBUG] Bot token present: {bool(bot_token)}")
    print(f"[DEBUG] Init data length: {len(init_data) if init_data else 0}")
    
    if not bot_token:
        print("[ERROR] Bot token not configured")
        raise HTTPException(status_code=500, detail="Bot token not configured")
    
    if not init_data:
        print("[ERROR] No init data provided")
        raise HTTPException(status_code=401, detail="No init data provided")
    
    # Parse URL-encoded data
    parsed_data = urllib.parse.parse_qs(init_data)
    print(f"[DEBUG] Parsed data keys: {list(parsed_data.keys())}")
    
    # Extract hash
    hash_value = parsed_data.get('hash', [None])[0]
    if not hash_value:
        print("[ERROR] Missing hash in initData")
        raise HTTPException(status_code=401, detail="Missing hash in initData")
    
    print(f"[DEBUG] Hash found: {hash_value[:10]}...")
    
    # Remove hash from data and build data_check_string
    data_pairs = []
    for key, values in parsed_data.items():
        if key != 'hash' and values:
            data_pairs.append((key, values[0]))
    
    print(f"[DEBUG] Data pairs: {data_pairs}")
    
    # Sort pairs and build data_check_string
    data_pairs.sort()
    data_check_string = '\n'.join([f"{key}={value}" for key, value in data_pairs])
    print(f"[DEBUG] Data check string: {data_check_string}")
    
    # Alternative: try parsing as query string directly if the above fails
    if not data_check_string:
        print("[DEBUG] Trying alternative parsing method...")
        # Split by & and parse each pair
        pairs = init_data.split('&')
        data_pairs = []
        for pair in pairs:
            if '=' in pair and not pair.startswith('hash='):
                key, value = pair.split('=', 1)
                data_pairs.append((key, value))
        data_pairs.sort()
        data_check_string = '\n'.join([f"{key}={value}" for key, value in data_pairs])
        print(f"[DEBUG] Alternative data check string: {data_check_string}")
    
    # Compute secret key
    secret_key = hashlib.sha256(bot_token.encode()).digest()
    print(f"[DEBUG] Secret key computed: {secret_key.hex()[:10]}...")
    
    # Compute HMAC
    computed_hash = hmac.new(secret_key, data_check_string.encode(), hashlib.sha256).hexdigest()
    print(f"[DEBUG] Computed hash: {computed_hash}")
    print(f"[DEBUG] Received hash: {hash_value}")
    
    # Compare hashes
    if not hmac.compare_digest(hash_value, computed_hash):
        print("[ERROR] Hash comparison failed")
        raise HTTPException(status_code=401, detail="Invalid signature")
    
    print("[DEBUG] Hash verification successful")
    
    # Extract user data
    user_data = parsed_data.get('user', [None])[0]
    if not user_data:
        print("[ERROR] Missing user data")
        raise HTTPException(status_code=401, detail="Missing user data")
    
    print(f"[DEBUG] User data: {user_data}")
    
    try:
        user = json.loads(user_data)
        print(f"[DEBUG] Parsed user: {user}")
        return user
    except json.JSONDecodeError as e:
        print(f"[ERROR] JSON decode error: {e}")
        raise HTTPException(status_code=401, detail="Invalid user data format")


# =========================
# FASTAPI APP
# =========================
app = FastAPI(title="Auth & Calendar API", version="1.0.0", root_path="/api")

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",  # CRA dev
        "http://localhost",
        "http://127.0.0.1",
        "http://localhost:8080",  # Gateway
        # при необходимости добавь сюда свой ngrok-URL
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# =========================
# AUTH ROUTES
# =========================
@app.post("/register")
def register(user: UserCreate, db: Session = Depends(get_db)):
    # Validate username
    if not user.username or not user.username.strip():
        raise HTTPException(status_code=400, detail="username required")
    
    # Validate password
    if not user.password or not user.password.strip():
        raise HTTPException(status_code=400, detail="password required")
    
    # Trim and validate length
    username = user.username.strip()
    password = user.password.strip()
    
    if len(username) > 150:
        raise HTTPException(status_code=400, detail="username too long (max 150 characters)")
    
    if len(password) > 72:
        raise HTTPException(status_code=400, detail="password too long (max 72 characters)")
    
    existing = db.query(User).filter(User.username == username).first()
    if existing:
        raise HTTPException(status_code=400, detail="Username already registered")
    
    hashed_pw = get_password_hash(password)
    new_user = User(username=username, hashed_password=hashed_pw)
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    return {"msg": "User created"}


@app.post("/token")
def login(form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == form_data.username).first()
    if not user or not verify_password(form_data.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    token = create_access_token({"sub": user.username})
    return {"access_token": token, "token_type": "bearer"}


@app.get("/me")
def read_users_me(token: str = Depends(oauth2_scheme)):
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        if not username:
            raise HTTPException(status_code=401, detail="Invalid token")
        return {"username": username}
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid token")


# =========================
# PROFILE ROUTES
# =========================
@app.get("/profile", response_model=ProfileOut)
def get_profile(user: User = Depends(get_current_user)):
    return ProfileOut(
        username=user.username,
        theme=user.theme or "dark",
        hide_done=int_to_bool(user.hide_done),
        timezone=user.timezone or "Europe/Amsterdam",
        telegram_linked=bool(user.telegram_chat_id),
    )


@app.put("/profile", response_model=ProfileOut)
def update_profile(
    data: ProfileUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if data.theme is not None:
        user.theme = data.theme
    if data.hide_done is not None:
        user.hide_done = bool_to_int(data.hide_done)
    if data.timezone is not None:
        user.timezone = data.timezone
    db.add(user)
    db.commit()
    db.refresh(user)
    return ProfileOut(
        username=user.username,
        theme=user.theme,
        hide_done=int_to_bool(user.hide_done),
        timezone=user.timezone,
        telegram_linked=bool(user.telegram_chat_id),
    )


@app.put("/change-password")
def change_password(
    data: ChangePassword,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if not verify_password(data.old_password, user.hashed_password):
        raise HTTPException(status_code=400, detail="Старый пароль неверный")
    user.hashed_password = get_password_hash(data.new_password)
    db.add(user)
    db.commit()
    return {"msg": "Пароль изменён"}


# =========================
# EVENTS ROUTES
# =========================
@app.post("/events", response_model=EventOut)
def create_event(
    event: EventCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    # Handle missing start_time/end_time with defaults
    now_utc = dt.datetime.utcnow().replace(tzinfo=dt.timezone.utc)
    
    if event.start_time and event.end_time:
        # Both provided - use as is
        start_time = event.start_time
        end_time = event.end_time
    elif event.start_time and not event.end_time:
        # Only start provided - end = start + 1 day
        start_time = event.start_time
        try:
            start_dt = dt.datetime.fromisoformat(event.start_time.replace('Z', '+00:00'))
            end_dt = start_dt + dt.timedelta(days=1)
            end_time = end_dt.isoformat()
        except ValueError:
            # If parsing fails, use current time + 1 day
            end_dt = now_utc + dt.timedelta(days=1)
            end_time = end_dt.isoformat()
    elif not event.start_time and event.end_time:
        # Only end provided - start = now, end = provided
        start_time = now_utc.isoformat()
        end_time = event.end_time
    else:
        # Neither provided - start = now, end = now + 1 day
        start_time = now_utc.isoformat()
        end_dt = now_utc + dt.timedelta(days=1)
        end_time = end_dt.isoformat()
    
    new_event = Event(
        title=event.title,
        description=event.description,
        color=event.color,
        start_time=start_time,
        end_time=end_time,
        owner_id=user.id,
        status="pending",
    )
    db.add(new_event)
    db.commit()
    db.refresh(new_event)
    return new_event


@app.get("/events", response_model=List[EventOut])
def get_events(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return db.query(Event).filter(Event.owner_id == user.id).all()


@app.put("/events/{event_id}", response_model=EventOut)
def update_event(
    event_id: int,
    data: EventUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    ev = db.query(Event).filter(Event.id == event_id, Event.owner_id == user.id).first()
    if not ev:
        raise HTTPException(status_code=404, detail="Event not found")

    if data.title is not None:
        ev.title = data.title
    if data.description is not None:
        ev.description = data.description
    if data.color is not None:
        ev.color = data.color
    if data.start_time is not None:
        ev.start_time = data.start_time
    if data.end_time is not None:
        ev.end_time = data.end_time

    db.add(ev)
    db.commit()
    db.refresh(ev)
    return ev


@app.delete("/events/{event_id}")
def delete_event(event_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    ev = db.query(Event).filter(Event.id == event_id, Event.owner_id == user.id).first()
    if not ev:
        raise HTTPException(status_code=404, detail="Event not found")
    db.delete(ev)
    db.commit()
    return {"msg": "Event deleted"}


@app.put("/events/{event_id}/done", response_model=EventOut)
def mark_done(event_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    ev = db.query(Event).filter(Event.id == event_id, Event.owner_id == user.id).first()
    if not ev:
        raise HTTPException(status_code=404, detail="Event not found")
    ev.status = "done"
    db.add(ev)
    db.commit()
    db.refresh(ev)
    return ev


# =========================
# ICS IMPORT (Google Calendar)
# =========================
@app.post("/import-ics", response_model=ICSImportResult)
async def import_ics(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if not file.filename.lower().endswith(".ics"):
        raise HTTPException(status_code=400, detail="Ожидается .ics файл")

    content = await file.read()
    try:
        cal = Calendar.from_ical(content)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Некорректный ICS: {e}")

    created = 0
    skipped = 0
    default_color = "#3788d8"

    for component in cal.walk():
        if component.name != "VEVENT":
            continue

        summary = str(component.get("summary", "Без названия"))
        description = str(component.get("description", ""))

        dtstart = component.get("dtstart")
        dtend = component.get("dtend")
        if not dtstart or not dtend:
            skipped += 1
            continue

        start = dtstart.dt
        end = dtend.dt

        # Дата без времени (all-day) → приводим к 00:00
        if isinstance(start, dt.date) and not isinstance(start, dt.datetime):
            start = dt.datetime.combine(start, dt.time.min)
        if isinstance(end, dt.date) and not isinstance(end, dt.datetime):
            end = dt.datetime.combine(end, dt.time.min)

        # Приводим к TZ пользователя, если naive
        user_tz = tz.gettz(user.timezone or "Europe/Amsterdam")
        if start.tzinfo is None:
            start = start.replace(tzinfo=user_tz)
        if end.tzinfo is None:
            end = end.replace(tzinfo=user_tz)

        start_iso = start.isoformat(timespec="minutes")
        end_iso = end.isoformat(timespec="minutes")

        ev = Event(
            title=summary,
            description=description,
            color=default_color,
            start_time=start_iso,
            end_time=end_iso,
            owner_id=user.id,
            status="pending",
        )
        db.add(ev)
        created += 1

    db.commit()
    return ICSImportResult(created=created, skipped=skipped)


# =========================
# TELEGRAM LINK / UNLINK
# =========================
class TgLinkOut(BaseModel):
    link_code: str
    expires_at: str


@app.post("/telegram/link", response_model=TgLinkOut)
def telegram_link(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """
    Генерируем новый код привязки, старые активные коды помечаем использованными.
    """
    # инвалидируем предыдущие неиспользованные коды
    db.query(TelegramLink).filter(
        TelegramLink.user_id == user.id, TelegramLink.used == 0
    ).update({"used": 1})

    code = str(uuid.uuid4())[:8]
    expires = (dt.datetime.utcnow() + dt.timedelta(minutes=15)).replace(tzinfo=dt.timezone.utc).isoformat()

    link = TelegramLink(user_id=user.id, code=code, expires_at=expires, used=0)
    db.add(link)
    db.commit()
    return TgLinkOut(link_code=code, expires_at=expires)


@app.delete("/telegram/unlink")
def telegram_unlink(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    user.telegram_chat_id = None
    user.telegram_username = None
    db.add(user)
    db.commit()
    return {"msg": "Telegram отвязан"}


class TgConfirmIn(BaseModel):
    code: str
    telegram_id: int
    telegram_username: str | None = None


class TgWebAppLoginIn(BaseModel):
    initData: str


@app.post("/telegram/confirm")
def telegram_confirm(payload: TgConfirmIn, db: Session = Depends(get_db)):
    """
    Бот присылает code + telegram_id (+ username).
    Находим активную запись, проверяем срок годности, помечаем использованной,
    записываем chat_id/username в пользователя.
    """
    link = db.query(TelegramLink).filter(TelegramLink.code == payload.code).first()
    if not link:
        raise HTTPException(status_code=404, detail="Code not found")
    if link.used:
        raise HTTPException(status_code=400, detail="Code already used")

    # Проверка истечения срока
    if link.expires_at:
        try:
            exp = dt.datetime.fromisoformat(link.expires_at)
        except Exception:
            # если формат неожиданно сломан — перестрахуемся
            exp = dt.datetime.utcnow() - dt.timedelta(seconds=1)
        if exp < dt.datetime.utcnow().replace(tzinfo=exp.tzinfo):
            raise HTTPException(status_code=400, detail="Code expired")

    user = db.query(User).filter(User.id == link.user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    user.telegram_chat_id = str(payload.telegram_id)
    if payload.telegram_username:
        user.telegram_username = payload.telegram_username

    link.used = 1
    db.add(user)
    db.add(link)
    db.commit()
    return {"status": "ok"}


@app.post("/tg/webapp/login")
def telegram_webapp_login(payload: TgWebAppLoginIn, db: Session = Depends(get_db)):
    """
    Telegram Mini App login endpoint.
    Verifies initData signature and creates/returns JWT token.
    """
    print(f"[DEBUG] Telegram WebApp login attempt")
    print(f"[DEBUG] Payload received: {payload}")
    print(f"[DEBUG] BOT_TOKEN configured: {bool(BOT_TOKEN)}")
    
    try:
        # Verify Telegram WebApp data
        user_data = verify_telegram_webapp_data(payload.initData, BOT_TOKEN)
        telegram_user_id = user_data.get('id')
        
        print(f"[DEBUG] Telegram user ID: {telegram_user_id}")
        
        if not telegram_user_id:
            print("[ERROR] Missing user ID in Telegram data")
            raise HTTPException(status_code=401, detail="Missing user ID in Telegram data")
        
        # Look for existing user with this telegram_chat_id
        user = db.query(User).filter(User.telegram_chat_id == str(telegram_user_id)).first()
        
        if not user:
            print(f"[DEBUG] Creating new user for Telegram ID: {telegram_user_id}")
            # Create new user
            username = f"tg_{telegram_user_id}"
            # Generate random password (user won't need it for Telegram login)
            random_password = str(uuid.uuid4())
            hashed_password = get_password_hash(random_password)
            
            user = User(
                username=username,
                hashed_password=hashed_password,
                telegram_chat_id=str(telegram_user_id),
                telegram_username=user_data.get('username')
            )
            db.add(user)
            db.commit()
            db.refresh(user)
            print(f"[DEBUG] New user created: {username}")
        else:
            print(f"[DEBUG] Existing user found: {user.username}")
        
        # Create JWT token
        token = create_access_token({"sub": user.username})
        print(f"[DEBUG] JWT token created successfully")
        return {"access_token": token, "token_type": "bearer"}
        
    except HTTPException as e:
        print(f"[ERROR] HTTPException in login: {e.detail}")
        raise
    except Exception as e:
        print(f"[ERROR] Unexpected error in login: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Login failed: {str(e)}")


# =========================
# HEALTH / DB CHECK
# =========================
@app.get("/check-db")
def check_db(db: Session = Depends(get_db)):
    try:
        result = db.execute(text("SELECT 1")).scalar()
        return {"db_status": "ok", "result": int(result)}
    except Exception as e:
        return {"db_status": "error", "detail": str(e)}


@app.get("/tg/webapp/debug")
def telegram_webapp_debug():
    """
    Debug endpoint to check Telegram WebApp configuration
    """
    return {
        "bot_token_configured": bool(BOT_TOKEN),
        "bot_token_length": len(BOT_TOKEN) if BOT_TOKEN else 0,
        "telegram_webapp_available": True,
        "endpoint_accessible": True
    }
