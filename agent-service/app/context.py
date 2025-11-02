"""Context management for storing current user_id during agent execution."""
import threading

# Thread-local storage for request context
_context = threading.local()

def set_user_id(user_id: int):
    """Set the current user_id for this thread/request."""
    _context.user_id = user_id

def get_user_id() -> int:
    """Get the current user_id for this thread/request."""
    if not hasattr(_context, 'user_id'):
        raise RuntimeError("user_id not set in context. This should be set before calling agent tools.")
    return _context.user_id

def clear_user_id():
    """Clear the user_id from context (cleanup)."""
    if hasattr(_context, 'user_id'):
        delattr(_context, 'user_id')

