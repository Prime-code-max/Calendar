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

def fetch_user_by_username(username: str):
    """Fetch user by username."""
    with get_db_sync() as conn:
        result = conn.execute(text("SELECT id, username FROM users WHERE username = :username"), {"username": username})
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

def init_chat_sessions_table():
    """Initialize the chat_sessions table if it doesn't exist."""
    with get_db_sync() as conn:
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS chat_sessions (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL,
                role VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant')),
                content TEXT NOT NULL,
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        """))
        conn.execute(text("CREATE INDEX IF NOT EXISTS idx_chat_sessions_user_id ON chat_sessions(user_id)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS idx_chat_sessions_timestamp ON chat_sessions(timestamp)"))
        conn.commit()

def save_chat_message(user_id: int, role: str, content: str):
    """Save a chat message to the database."""
    with get_db_sync() as conn:
        result = conn.execute(
            text("""
                INSERT INTO chat_sessions (user_id, role, content, timestamp)
                VALUES (:user_id, :role, :content, CURRENT_TIMESTAMP)
                RETURNING id, timestamp
            """),
            {
                "user_id": user_id,
                "role": role,
                "content": content
            }
        )
        conn.commit()
        row = result.fetchone()
        return {"id": row.id, "timestamp": row.timestamp}

def get_chat_history(user_id: int, limit: int = 20):
    """Retrieve the last N messages for a user."""
    with get_db_sync() as conn:
        result = conn.execute(
            text("""
                SELECT role, content, timestamp
                FROM chat_sessions
                WHERE user_id = :user_id
                ORDER BY timestamp ASC
                LIMIT :limit
            """),
            {"user_id": user_id, "limit": limit}
        )
        rows = result.fetchall()
        return [
            {
                "role": r.role,
                "content": r.content,
                "timestamp": r.timestamp
            }
            for r in rows
        ]