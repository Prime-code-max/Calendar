from datetime import datetime
from .database import get_db_sync
from sqlalchemy import text

def fetch_user_by_id(user_id: int):
    with get_db_sync() as conn:
        result = conn.execute(text("SELECT id, username FROM users WHERE id = :user_id"), {"user_id": user_id})
        row = result.fetchone()
        if row:
            return {"id": row.id, "username": row.username}
        return None

def add_user_to_db(name: str, email: str):
    with get_db_sync() as conn:
        existing = conn.execute(text("SELECT id FROM users WHERE email = :email"), {"email": email}).fetchone()
        if existing:
            raise ValueError(f"User with email {email} already exists")
        result = conn.execute(
            text("INSERT INTO users (username, email) VALUES (:name, :email) RETURNING id, username, email"),
            {"name": name, "email": email}
        )
        conn.commit()
        row = result.fetchone()
        return {"id": row.id, "username": row.username, "email": row.email}

def add_event_to_db(owner_id: int, title: str, description: str, start_time: datetime, end_time: datetime, color: str = "green", status: str = "pending"):
    with get_db_sync() as conn:
        result = conn.execute(
            text("""
                INSERT INTO events (owner_id, title, description, start_time, end_time, color, status)
                VALUES (:owner_id, :title, :description, :start_time, :end_time, :color, :status)
                RETURNING id
            """),
            {
                "owner_id": owner_id,
                "title": title,
                "description": description,
                "start_time": start_time,
                "end_time": end_time,
                "color": color,
                "status": status
            }
        )
        conn.commit()
        event_id = result.fetchone()[0]
        return {"id": event_id}

def get_events_by_user(owner_id: int):
    with get_db_sync() as conn:
        result = conn.execute(
            text("""
                SELECT id, title, description, start_time, end_time, color, status
                FROM events
                WHERE owner_id = :owner_id
                ORDER BY start_time ASC
            """),
            {"owner_id": owner_id}
        )
        rows = result.fetchall()
        return [
            {
                "id": r.id,
                "title": r.title,
                "description": r.description,
                "start_time": r.start_time,
                "end_time": r.end_time,
                "color": r.color,
                "status": r.status
            }
            for r in rows
        ]