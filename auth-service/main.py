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
import datetime
import time
import uuid

from icalendar import Calendar
from dateutil import tz
from dotenv import load_dotenv

# =========================
# ENV / CONFIG
# =========================
load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")  # e.g. postgresql+psycopg2://user:password@postgres:5432/auth_db
SECRET_KEY = os.getenv("SECRET_KEY", "fallback-secret-key")
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
    telegram_chat_id = Column(String, nullable=True)
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
    start_time: str
    end_time: str


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
    expire = datetime.datetime.utcnow() + datetime.timedelta(minutes=expires_minutes)
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
    return datetime.datetime.utcnow().replace(tzinfo=datetime.timezone.utc).isoformat()


# =========================
# FASTAPI APP
# =========================
app = FastAPI(title="Auth & Calendar API", version="1.0.0")

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",  # CRA dev
        "http://localhost",
        "http://127.0.0.1",
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
    existing = db.query(User).filter(User.username == user.username).first()
    if existing:
        raise HTTPException(status_code=400, detail="Username already registered")
    hashed_pw = get_password_hash(user.password)
    new_user = User(username=user.username, hashed_password=hashed_pw)
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
    new_event = Event(
        title=event.title,
        description=event.description,
        color=event.color,
        start_time=event.start_time,
        end_time=event.end_time,
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
        if isinstance(start, datetime.date) and not isinstance(start, datetime.datetime):
            start = datetime.datetime.combine(start, datetime.time.min)
        if isinstance(end, datetime.date) and not isinstance(end, datetime.datetime):
            end = datetime.datetime.combine(end, datetime.time.min)

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
@app.post("/telegram/link")
def telegram_link(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    code = str(uuid.uuid4())[:8]
    expires = (
        datetime.datetime.utcnow() + datetime.timedelta(minutes=15)
    ).replace(tzinfo=datetime.timezone.utc).isoformat()

    user.telegram_link_code = code
    user.telegram_link_expires = expires
    db.add(user)
    db.commit()
    return {"link_code": code, "expires_at": expires}


@app.delete("/telegram/unlink")
def telegram_unlink(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    user.telegram_chat_id = None
    user.telegram_link_code = None
    user.telegram_link_expires = None
    db.add(user)
    db.commit()
    return {"msg": "Telegram отвязан"}


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
