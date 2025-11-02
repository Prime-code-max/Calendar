from datetime import datetime
import re
from langchain_core.tools import tool
from .db_utils import (
    fetch_user_by_id,
    add_user_to_db,
    add_event_to_db as db_add_event,
    get_events_by_user as db_get_events
)
from .context import get_user_id
import logging

logger = logging.getLogger(__name__)

@tool
def get_current_time() -> str:
    """Возвращает текущую дату и время в формате: ГГГГ-ММ-ДД ЧЧ:ММ:СС."""
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")

@tool
def get_user_by_id(user_id: int) -> str:
    """Получает данные пользователя по ID из базы данных."""
    try:
        user = fetch_user_by_id(user_id)
        if user:
            return f"User(id={user['id']}, name='{user['username']}')"
        else:
            return "User not found"
    except Exception as e:
        logger.error(f"DB error in get_user_by_id: {e}")
        return f"Error fetching user: {str(e)}"

@tool
def add_user(name: str, email: str) -> str:
    """Добавляет нового пользователя. Требует name и email."""
    try:
        user = add_user_to_db(name, email)
        return f"User created: id={user['id']}, name='{user['username']}', email='{user['email']}'"
    except Exception as e:
        return f"Error creating user: {str(e)}"

def safe_from_isoformat(dt_str: str) -> datetime:
    dt_str = dt_str.strip().replace(" ", "T")
    if "." in dt_str:
        return datetime.strptime(dt_str, "%Y-%m-%dT%H:%M:%S.%f")
    elif dt_str.count(":") >= 2:
        return datetime.strptime(dt_str, "%Y-%m-%dT%H:%M:%S")
    else:
        return datetime.strptime(dt_str, "%Y-%m-%dT%H:%M")

@tool
def add_event_to_db(input_str: str) -> str:
    """
    Добавляет событие для текущего пользователя. Формат:
    title="Встреча", description="Обсудить", start_time="2025-04-06T09:00", end_time="2025-04-06T10:00", color="blue"
    
    Примечание: owner_id определяется автоматически из текущей сессии пользователя.
    """
    try:
        # Get user_id from context (set by the request handler)
        owner_id = get_user_id()
        
        # Парсинг строки
        parsed = {}
        # Игнорируем owner_id если указан - используем из контекста
        owner_match = re.search(r'owner_id\s*=\s*(\d+)', input_str)
        if owner_match:
            logger.warning(f"User attempted to specify owner_id, but using context user_id={owner_id} instead")

        for field in ['title', 'description', 'color', 'status']:
            m = re.search(rf'{field}\s*=\s*"([^"]*)"', input_str)
            if m:
                parsed[field] = m.group(1)

        for field in ['start_time', 'end_time']:
            m = re.search(rf'{field}\s*=\s*"?(.*?)"?(?=[,\)])', input_str)
            if m:
                dt_str = m.group(1).strip()
                try:
                    parsed[field] = safe_from_isoformat(dt_str)
                except Exception as e:
                    return f"Ошибка парсинга даты {field}: {dt_str} — {e}"
            else:
                return f"Ошибка: поле {field} обязательно."

        title = parsed.get('title')
        description = parsed.get('description')
        start_time = parsed['start_time']
        end_time = parsed['end_time']
        color = parsed.get('color', 'green')
        status = parsed.get('status', 'pending')

        if not all([title, description]):
            return "Ошибка: title и description обязательны."

        # Use owner_id from context, not from user input
        event = db_add_event(owner_id, title, description, start_time, end_time, color, status)
        return f"Событие создано с ID {event['id']}. {title} ({start_time} – {end_time})"

    except RuntimeError as e:
        logger.error(f"Context error in add_event_to_db: {e}")
        return f"Ошибка контекста: {str(e)}"
    except Exception as e:
        logger.error(f"add_event_to_db error: {e}")
        return f"Ошибка: {str(e)}"

@tool
def get_events_by_user() -> str:
    """Возвращает все события текущего пользователя.
    
    Примечание: события возвращаются автоматически для пользователя текущей сессии.
    """
    try:
        # Get user_id from context (set by the request handler)
        owner_id = get_user_id()
        
        events = db_get_events(owner_id)
        if not events:
            return "No events found for this user."
        lines = []
        for e in events:
            lines.append(
                f"Event(id={e['id']}, title='{e['title']}', "
                f"description='{e['description']}', "
                f"start='{e['start_time']}', end='{e['end_time']}', "
                f"color='{e['color']}', status='{e['status']}')"
            )
        return "\n".join(lines)
    except RuntimeError as e:
        logger.error(f"Context error in get_events_by_user: {e}")
        return f"Ошибка контекста: {str(e)}"
    except Exception as e:
        logger.error(f"get_events_by_user error: {e}")
        return f"Ошибка получения событий: {str(e)}"