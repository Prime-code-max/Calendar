from fastapi import FastAPI, Depends, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy import create_engine, Column, Integer, String, Text, func, desc, text, DateTime, Boolean, and_, or_
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, Session
from sqlalchemy.exc import OperationalError
from pydantic import BaseModel, ConfigDict
from typing import Optional, List, Dict, Any
from jose import JWTError, jwt
from fastapi.responses import StreamingResponse, JSONResponse
from passlib.context import CryptContext
import os
import time
from dotenv import load_dotenv
import datetime as dt
import csv
import json
import io
from collections import defaultdict

# =========================
# ENV / CONFIG
# =========================
load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")
SECRET_KEY = os.getenv("SECRET_KEY", "fallback-secret-key")
ALGORITHM = "HS256"
ADMIN_USERNAME = os.getenv("ADMIN_USERNAME", "admin")

# =========================
# DB SETUP
# =========================
engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def wait_for_db():
    """Ждём готовности БД."""
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
    theme = Column(String, default="dark")
    hide_done = Column(Integer, default=0)
    timezone = Column(String, default="Europe/Amsterdam")
    telegram_chat_id = Column(String, nullable=True)
    telegram_username = Column(String, nullable=True)
    telegram_link_code = Column(String, nullable=True)
    telegram_link_expires = Column(String, nullable=True)


class Event(Base):
    __tablename__ = "events"
    id = Column(Integer, primary_key=True, index=True)
    title = Column(String, index=True, nullable=False)
    description = Column(Text, nullable=True)
    color = Column(String, default="#3788d8")
    start_time = Column(String, nullable=False)
    end_time = Column(String, nullable=False)
    owner_id = Column(Integer, nullable=False)
    status = Column(String, default="pending")


class AdminLog(Base):
    """Логи действий администратора"""
    __tablename__ = "admin_logs"
    id = Column(Integer, primary_key=True, index=True)
    admin_username = Column(String, nullable=False)
    action = Column(String, nullable=False)  # create_user, delete_event, etc.
    entity_type = Column(String, nullable=False)  # user, event, etc.
    entity_id = Column(Integer, nullable=True)
    details = Column(Text, nullable=True)  # JSON строка с деталями
    created_at = Column(String, nullable=False)  # ISO datetime string


class UserHistory(Base):
    """История изменений пользователей"""
    __tablename__ = "user_history"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, nullable=False, index=True)
    changed_by = Column(String, nullable=False)  # admin username
    field_name = Column(String, nullable=False)
    old_value = Column(Text, nullable=True)
    new_value = Column(Text, nullable=True)
    created_at = Column(String, nullable=False)


class EventHistory(Base):
    """История изменений событий"""
    __tablename__ = "event_history"
    id = Column(Integer, primary_key=True, index=True)
    event_id = Column(Integer, nullable=False, index=True)
    changed_by = Column(String, nullable=False)
    field_name = Column(String, nullable=False)
    old_value = Column(Text, nullable=True)
    new_value = Column(Text, nullable=True)
    created_at = Column(String, nullable=False)


# Инициализация БД
wait_for_db()
Base.metadata.create_all(bind=engine)

# Password hashing
pwd_context = CryptContext(schemes=["argon2"], deprecated="auto")

# =========================
# SCHEMAS (Pydantic)
# =========================
class UserOut(BaseModel):
    id: int
    username: str
    theme: str
    hide_done: int
    timezone: str
    telegram_chat_id: Optional[str] = None
    telegram_username: Optional[str] = None
    model_config = ConfigDict(from_attributes=True)


class UserUpdate(BaseModel):
    username: Optional[str] = None
    theme: Optional[str] = None
    hide_done: Optional[int] = None
    timezone: Optional[str] = None


class EventOut(BaseModel):
    id: int
    title: str
    description: Optional[str] = None
    color: str
    start_time: str
    end_time: str
    owner_id: int
    status: str
    model_config = ConfigDict(from_attributes=True)


class EventUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    color: Optional[str] = None
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    status: Optional[str] = None


class StatsOut(BaseModel):
    total_users: int
    total_events: int
    active_users: int
    pending_events: int
    done_events: int
    telegram_linked_users: int


class ExtendedStatsOut(BaseModel):
    basic: StatsOut
    events_by_day: Dict[str, int]
    events_by_status: Dict[str, int]
    top_users: List[Dict[str, Any]]
    telegram_stats: Dict[str, int]
    recent_activity: List[Dict[str, Any]]


class BulkOperationRequest(BaseModel):
    ids: List[int]
    action: str  # delete, update_status, etc.
    data: Optional[Dict[str, Any]] = None


class SearchRequest(BaseModel):
    query: Optional[str] = None
    filters: Optional[Dict[str, Any]] = None
    skip: int = 0
    limit: int = 100


class UserCreateRequest(BaseModel):
    username: str
    password: str
    theme: Optional[str] = "dark"
    timezone: Optional[str] = "Europe/Amsterdam"


class PasswordResetRequest(BaseModel):
    new_password: str


class AdminLogOut(BaseModel):
    id: int
    admin_username: str
    action: str
    entity_type: str
    entity_id: Optional[int]
    details: Optional[str]
    created_at: str
    model_config = ConfigDict(from_attributes=True)


class HistoryOut(BaseModel):
    id: int
    changed_by: str
    field_name: str
    old_value: Optional[str]
    new_value: Optional[str]
    created_at: str
    model_config = ConfigDict(from_attributes=True)


# =========================
# AUTH UTILS
# =========================
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    """Проверка токена и получение пользователя."""
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


def require_admin(user: User = Depends(get_current_user)):
    """Проверка, что пользователь - администратор."""
    if user.username != ADMIN_USERNAME:
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


def log_admin_action(
    db: Session,
    admin_username: str,
    action: str,
    entity_type: str,
    entity_id: Optional[int] = None,
    details: Optional[Dict[str, Any]] = None
):
    """Логирование действия администратора."""
    log = AdminLog(
        admin_username=admin_username,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        details=json.dumps(details) if details else None,
        created_at=dt.datetime.utcnow().isoformat()
    )
    db.add(log)
    db.commit()


def get_password_hash(password: str) -> str:
    """Хеширование пароля."""
    return pwd_context.hash(password)


def now_iso() -> str:
    """Текущее время в ISO формате."""
    return dt.datetime.utcnow().isoformat()


# =========================
# FASTAPI APP
# =========================
app = FastAPI(title="Admin API", version="1.0.0", root_path="/admin-api")

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://localhost",
        "http://127.0.0.1",
        "http://localhost:8080",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# =========================
# STATS ROUTES
# =========================
@app.get("/stats", response_model=StatsOut)
def get_stats(db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    """Получение статистики системы."""
    total_users = db.query(func.count(User.id)).scalar() or 0
    total_events = db.query(func.count(Event.id)).scalar() or 0
    
    # Пользователи с событиями
    active_users = db.query(func.count(func.distinct(Event.owner_id))).scalar() or 0
    
    # События по статусам
    pending_events = db.query(func.count(Event.id)).filter(Event.status == "pending").scalar() or 0
    done_events = db.query(func.count(Event.id)).filter(Event.status == "done").scalar() or 0
    
    # Пользователи с привязанным Telegram
    telegram_linked_users = db.query(func.count(User.id)).filter(
        User.telegram_chat_id.isnot(None)
    ).scalar() or 0
    
    return StatsOut(
        total_users=total_users,
        total_events=total_events,
        active_users=active_users,
        pending_events=pending_events,
        done_events=done_events,
        telegram_linked_users=telegram_linked_users,
    )


# =========================
# USERS ROUTES
# =========================
@app.get("/users", response_model=List[UserOut])
def get_users(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Получение списка пользователей с пагинацией."""
    users = db.query(User).offset(skip).limit(limit).all()
    return users


@app.get("/users/{user_id}", response_model=UserOut)
def get_user(
    user_id: int,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Получение пользователя по ID."""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user


@app.put("/users/{user_id}", response_model=UserOut)
def update_user(
    user_id: int,
    data: UserUpdate,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Обновление пользователя."""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    changes = {}
    if data.username is not None and data.username != user.username:
        # Проверка уникальности username
        existing = db.query(User).filter(User.username == data.username, User.id != user_id).first()
        if existing:
            raise HTTPException(status_code=400, detail="Username already exists")
        changes["username"] = {"old": user.username, "new": data.username}
        user.username = data.username
    if data.theme is not None and data.theme != user.theme:
        changes["theme"] = {"old": user.theme, "new": data.theme}
        user.theme = data.theme
    if data.hide_done is not None and data.hide_done != user.hide_done:
        changes["hide_done"] = {"old": user.hide_done, "new": data.hide_done}
        user.hide_done = data.hide_done
    if data.timezone is not None and data.timezone != user.timezone:
        changes["timezone"] = {"old": user.timezone, "new": data.timezone}
        user.timezone = data.timezone
    
    # Сохраняем историю изменений
    for field, values in changes.items():
        history = UserHistory(
            user_id=user_id,
            changed_by=admin.username,
            field_name=field,
            old_value=str(values["old"]),
            new_value=str(values["new"]),
            created_at=now_iso()
        )
        db.add(history)
    
    db.add(user)
    db.commit()
    db.refresh(user)
    
    log_admin_action(db, admin.username, "update_user", "user", user_id, changes)
    return user


@app.delete("/users/{user_id}")
def delete_user(
    user_id: int,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Удаление пользователя и всех его событий."""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Удаляем все события пользователя
    events_count = db.query(Event).filter(Event.owner_id == user_id).count()
    db.query(Event).filter(Event.owner_id == user_id).delete()
    
    # Удаляем пользователя
    db.delete(user)
    db.commit()
    
    log_admin_action(db, admin.username, "delete_user", "user", user_id, {
        "username": user.username,
        "deleted_events": events_count
    })
    return {"msg": "User deleted"}


# =========================
# EVENTS ROUTES
# =========================
@app.get("/events", response_model=List[EventOut])
def get_events(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    owner_id: Optional[int] = Query(None),
    status: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Получение списка событий с фильтрацией."""
    query = db.query(Event)
    
    if owner_id is not None:
        query = query.filter(Event.owner_id == owner_id)
    if status is not None:
        query = query.filter(Event.status == status)
    
    events = query.order_by(desc(Event.id)).offset(skip).limit(limit).all()
    return events


@app.get("/events/{event_id}", response_model=EventOut)
def get_event(
    event_id: int,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Получение события по ID."""
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    return event


@app.put("/events/{event_id}", response_model=EventOut)
def update_event(
    event_id: int,
    data: EventUpdate,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Обновление события."""
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    
    changes = {}
    if data.title is not None and data.title != event.title:
        changes["title"] = {"old": event.title, "new": data.title}
        event.title = data.title
    if data.description is not None and data.description != event.description:
        changes["description"] = {"old": event.description, "new": data.description}
        event.description = data.description
    if data.color is not None and data.color != event.color:
        changes["color"] = {"old": event.color, "new": data.color}
        event.color = data.color
    if data.start_time is not None and data.start_time != event.start_time:
        changes["start_time"] = {"old": event.start_time, "new": data.start_time}
        event.start_time = data.start_time
    if data.end_time is not None and data.end_time != event.end_time:
        changes["end_time"] = {"old": event.end_time, "new": data.end_time}
        event.end_time = data.end_time
    if data.status is not None and data.status != event.status:
        changes["status"] = {"old": event.status, "new": data.status}
        event.status = data.status
    
    # Сохраняем историю изменений
    for field, values in changes.items():
        history = EventHistory(
            event_id=event_id,
            changed_by=admin.username,
            field_name=field,
            old_value=str(values["old"]),
            new_value=str(values["new"]),
            created_at=now_iso()
        )
        db.add(history)
    
    db.add(event)
    db.commit()
    db.refresh(event)
    
    log_admin_action(db, admin.username, "update_event", "event", event_id, changes)
    return event


@app.delete("/events/{event_id}")
def delete_event(
    event_id: int,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Удаление события."""
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    
    title = event.title
    db.delete(event)
    db.commit()
    
    log_admin_action(db, admin.username, "delete_event", "event", event_id, {"title": title})
    return {"msg": "Event deleted"}


# =========================
# EXTENDED STATS & ANALYTICS
# =========================
@app.get("/stats/extended", response_model=ExtendedStatsOut)
def get_extended_stats(
    days: int = Query(30, ge=1, le=365),
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Расширенная статистика с аналитикой."""
    # Базовая статистика
    basic_stats = get_stats(db=db, admin=admin)
    
    # События по дням (последние N дней)
    events_by_day = defaultdict(int)
    cutoff_date = dt.datetime.utcnow() - dt.timedelta(days=days)
    
    # Получаем все события и фильтруем по дате
    all_events = db.query(Event).all()
    
    for event in all_events:
        try:
            event_date = dt.datetime.fromisoformat(event.start_time.replace('Z', '+00:00'))
            if event_date.date() >= cutoff_date.date():
                day_key = event_date.strftime('%Y-%m-%d')
                events_by_day[day_key] += 1
        except:
            pass
    
    # События по статусам
    events_by_status = {}
    for status in ['pending', 'done']:
        count = db.query(func.count(Event.id)).filter(Event.status == status).scalar() or 0
        events_by_status[status] = count
    
    # Топ пользователей по количеству событий
    top_users_query = db.query(
        Event.owner_id,
        func.count(Event.id).label('event_count')
    ).group_by(Event.owner_id).order_by(desc('event_count')).limit(10).all()
    
    top_users = []
    for owner_id, count in top_users_query:
        user = db.query(User).filter(User.id == owner_id).first()
        if user:
            top_users.append({
                "user_id": owner_id,
                "username": user.username,
                "event_count": count
            })
    
    # Telegram статистика
    telegram_stats = {
        "linked": db.query(func.count(User.id)).filter(User.telegram_chat_id.isnot(None)).scalar() or 0,
        "unlinked": db.query(func.count(User.id)).filter(User.telegram_chat_id.is_(None)).scalar() or 0,
    }
    
    # Последняя активность (последние логи)
    recent_logs = db.query(AdminLog).order_by(desc(AdminLog.id)).limit(10).all()
    recent_activity = []
    for log in recent_logs:
        recent_activity.append({
            "id": log.id,
            "admin": log.admin_username,
            "action": log.action,
            "entity_type": log.entity_type,
            "created_at": log.created_at
        })
    
    return ExtendedStatsOut(
        basic=basic_stats,
        events_by_day=dict(events_by_day),
        events_by_status=events_by_status,
        top_users=top_users,
        telegram_stats=telegram_stats,
        recent_activity=recent_activity
    )


# =========================
# SEARCH & FILTERS
# =========================
@app.post("/users/search", response_model=List[UserOut])
def search_users(
    request: SearchRequest,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Поиск пользователей с фильтрами."""
    query = db.query(User)
    
    if request.query:
        query = query.filter(
            or_(
                User.username.ilike(f"%{request.query}%"),
                User.telegram_username.ilike(f"%{request.query}%"),
                User.telegram_chat_id.ilike(f"%{request.query}%")
            )
        )
    
    if request.filters:
        if "telegram_linked" in request.filters:
            if request.filters["telegram_linked"]:
                query = query.filter(User.telegram_chat_id.isnot(None))
            else:
                query = query.filter(User.telegram_chat_id.is_(None))
        if "theme" in request.filters:
            query = query.filter(User.theme == request.filters["theme"])
    
    users = query.offset(request.skip).limit(request.limit).all()
    return users


@app.post("/events/search", response_model=List[EventOut])
def search_events(
    request: SearchRequest,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Поиск событий с фильтрами."""
    query = db.query(Event)
    
    if request.query:
        query = query.filter(
            or_(
                Event.title.ilike(f"%{request.query}%"),
                Event.description.ilike(f"%{request.query}%")
            )
        )
    
    if request.filters:
        if "owner_id" in request.filters:
            query = query.filter(Event.owner_id == request.filters["owner_id"])
        if "status" in request.filters:
            query = query.filter(Event.status == request.filters["status"])
        if "date_from" in request.filters:
            query = query.filter(Event.start_time >= request.filters["date_from"])
        if "date_to" in request.filters:
            query = query.filter(Event.start_time <= request.filters["date_to"])
    
    events = query.order_by(desc(Event.id)).offset(request.skip).limit(request.limit).all()
    return events


# =========================
# BULK OPERATIONS
# =========================
@app.post("/events/bulk")
def bulk_events_operation(
    request: BulkOperationRequest,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Массовые операции над событиями."""
    if request.action == "delete":
        deleted = db.query(Event).filter(Event.id.in_(request.ids)).delete(synchronize_session=False)
        db.commit()
        log_admin_action(db, admin.username, "bulk_delete", "event", None, {"count": deleted, "ids": request.ids})
        return {"deleted": deleted, "msg": f"Deleted {deleted} events"}
    
    elif request.action == "update_status" and request.data and "status" in request.data:
        updated = db.query(Event).filter(Event.id.in_(request.ids)).update(
            {"status": request.data["status"]}, synchronize_session=False
        )
        db.commit()
        log_admin_action(db, admin.username, "bulk_update_status", "event", None, {"count": updated, "ids": request.ids})
        return {"updated": updated, "msg": f"Updated {updated} events"}
    
    raise HTTPException(status_code=400, detail="Invalid action or missing data")


@app.post("/users/bulk")
def bulk_users_operation(
    request: BulkOperationRequest,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Массовые операции над пользователями."""
    if request.action == "delete":
        # Удаляем события пользователей
        for user_id in request.ids:
            db.query(Event).filter(Event.owner_id == user_id).delete()
        deleted = db.query(User).filter(User.id.in_(request.ids)).delete(synchronize_session=False)
        db.commit()
        log_admin_action(db, admin.username, "bulk_delete", "user", None, {"count": deleted, "ids": request.ids})
        return {"deleted": deleted, "msg": f"Deleted {deleted} users"}
    
    raise HTTPException(status_code=400, detail="Invalid action")


# =========================
# EXPORT DATA
# =========================
@app.get("/export/users")
def export_users(
    format: str = Query("csv", regex="^(csv|json)$"),
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Экспорт пользователей."""
    users = db.query(User).all()
    
    if format == "csv":
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(["ID", "Username", "Theme", "Timezone", "Telegram Username", "Telegram Chat ID"])
        for user in users:
            writer.writerow([
                user.id, user.username, user.theme, user.timezone,
                user.telegram_username or "", user.telegram_chat_id or ""
            ])
        output.seek(0)
        return StreamingResponse(
            iter([output.getvalue()]),
            media_type="text/csv",
            headers={"Content-Disposition": f"attachment; filename=users_{now_iso()[:10]}.csv"}
        )
    else:  # json
        data = [{
            "id": u.id,
            "username": u.username,
            "theme": u.theme,
            "timezone": u.timezone,
            "telegram_username": u.telegram_username,
            "telegram_chat_id": u.telegram_chat_id
        } for u in users]
        return JSONResponse(content=data)


@app.get("/export/events")
def export_events(
    format: str = Query("csv", regex="^(csv|json)$"),
    owner_id: Optional[int] = None,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Экспорт событий."""
    query = db.query(Event)
    if owner_id:
        query = query.filter(Event.owner_id == owner_id)
    events = query.all()
    
    if format == "csv":
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(["ID", "Title", "Description", "Start Time", "End Time", "Status", "Color", "Owner ID"])
        for event in events:
            writer.writerow([
                event.id, event.title, event.description or "",
                event.start_time, event.end_time, event.status, event.color, event.owner_id
            ])
        output.seek(0)
        return StreamingResponse(
            iter([output.getvalue()]),
            media_type="text/csv",
            headers={"Content-Disposition": f"attachment; filename=events_{now_iso()[:10]}.csv"}
        )
    else:  # json
        data = [{
            "id": e.id,
            "title": e.title,
            "description": e.description,
            "start_time": e.start_time,
            "end_time": e.end_time,
            "status": e.status,
            "color": e.color,
            "owner_id": e.owner_id
        } for e in events]
        return JSONResponse(content=data)


# =========================
# USER MANAGEMENT EXTENDED
# =========================
@app.post("/users", response_model=UserOut)
def create_user(
    user_data: UserCreateRequest,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Создание пользователя администратором."""
    existing = db.query(User).filter(User.username == user_data.username).first()
    if existing:
        raise HTTPException(status_code=400, detail="Username already exists")
    
    hashed_password = get_password_hash(user_data.password)
    new_user = User(
        username=user_data.username,
        hashed_password=hashed_password,
        theme=user_data.theme,
        timezone=user_data.timezone
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    
    log_admin_action(db, admin.username, "create_user", "user", new_user.id, {"username": new_user.username})
    return new_user


@app.post("/users/{user_id}/reset-password")
def reset_user_password(
    user_id: int,
    request: PasswordResetRequest,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Сброс пароля пользователя."""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    user.hashed_password = get_password_hash(request.new_password)
    db.add(user)
    db.commit()
    
    log_admin_action(db, admin.username, "reset_password", "user", user_id, {})
    return {"msg": "Password reset successfully"}


@app.get("/users/{user_id}/events", response_model=List[EventOut])
def get_user_events(
    user_id: int,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Получение всех событий пользователя."""
    events = db.query(Event).filter(Event.owner_id == user_id).order_by(desc(Event.id)).all()
    return events


# =========================
# TELEGRAM MANAGEMENT
# =========================
@app.get("/telegram/links")
def get_telegram_links(
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Получение всех Telegram привязок."""
    users = db.query(User).filter(User.telegram_chat_id.isnot(None)).all()
    links = []
    for user in users:
        links.append({
            "user_id": user.id,
            "username": user.username,
            "telegram_chat_id": user.telegram_chat_id,
            "telegram_username": user.telegram_username
        })
    return links


@app.delete("/telegram/links/{user_id}")
def unlink_telegram(
    user_id: int,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Отвязка Telegram от пользователя."""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    user.telegram_chat_id = None
    user.telegram_username = None
    db.add(user)
    db.commit()
    
    log_admin_action(db, admin.username, "unlink_telegram", "user", user_id, {})
    return {"msg": "Telegram unlinked"}


# =========================
# HISTORY & LOGS
# =========================
@app.get("/logs", response_model=List[AdminLogOut])
def get_admin_logs(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Получение логов администратора."""
    logs = db.query(AdminLog).order_by(desc(AdminLog.id)).offset(skip).limit(limit).all()
    return logs


@app.get("/users/{user_id}/history", response_model=List[HistoryOut])
def get_user_history(
    user_id: int,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """История изменений пользователя."""
    history = db.query(UserHistory).filter(UserHistory.user_id == user_id).order_by(desc(UserHistory.id)).all()
    return history


@app.get("/events/{event_id}/history", response_model=List[HistoryOut])
def get_event_history(
    event_id: int,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """История изменений события."""
    history = db.query(EventHistory).filter(EventHistory.event_id == event_id).order_by(desc(EventHistory.id)).all()
    return history


# =========================
# SYSTEM MANAGEMENT
# =========================
@app.post("/system/cleanup")
def cleanup_old_data(
    days: int = Query(30, ge=1, le=365),
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Очистка старых данных."""
    cutoff_date = (dt.datetime.utcnow() - dt.timedelta(days=days)).isoformat()
    
    # Удаляем старые логи (старше N дней)
    deleted_logs = db.query(AdminLog).filter(AdminLog.created_at < cutoff_date).delete()
    
    # Удаляем старые записи истории
    deleted_user_history = db.query(UserHistory).filter(UserHistory.created_at < cutoff_date).delete()
    deleted_event_history = db.query(EventHistory).filter(EventHistory.created_at < cutoff_date).delete()
    
    db.commit()
    
    log_admin_action(db, admin.username, "cleanup", "system", None, {
        "days": days,
        "deleted_logs": deleted_logs,
        "deleted_user_history": deleted_user_history,
        "deleted_event_history": deleted_event_history
    })
    
    return {
        "msg": "Cleanup completed",
        "deleted_logs": deleted_logs,
        "deleted_user_history": deleted_user_history,
        "deleted_event_history": deleted_event_history
    }


@app.get("/system/info")
def get_system_info(
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Информация о системе."""
    return {
        "admin_username": ADMIN_USERNAME,
        "database_connected": True,
        "total_tables": len(Base.metadata.tables),
        "service_version": "1.0.0"
    }


# =========================
# HEALTH CHECK
# =========================
@app.get("/health")
def health_check():
    """Проверка работоспособности сервиса."""
    return {"status": "ok", "service": "admin-service"}

