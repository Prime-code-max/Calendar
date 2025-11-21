from fastapi import FastAPI, Request, HTTPException, Header
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel
from typing import Optional
import os
from dotenv import load_dotenv
from jose import JWTError, jwt
from langchain_openai import ChatOpenAI
from langchain.agents import create_react_agent, AgentExecutor
from langchain import hub
from .tools import get_current_time, get_user_by_id, add_user, add_event_to_db, get_events_by_user
from .db_utils import init_chat_sessions_table, save_chat_message, get_chat_history, fetch_user_by_username
from .context import set_user_id, clear_user_id

load_dotenv()

# JWT settings (should match auth-service)
SECRET_KEY = os.getenv("SECRET_KEY", "fallback-secret-key")
ALGORITHM = "HS256"

# Initialize chat_sessions table on startup
init_chat_sessions_table()

def get_user_id_from_token(authorization: Optional[str] = Header(None)) -> Optional[int]:
    """Extract user_id from JWT token in Authorization header."""
    if not authorization:
        return None
    
    try:
        # Extract token from "Bearer <token>"
        token = authorization.replace("Bearer ", "").strip()
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username = payload.get("sub")
        if not username:
            return None
        
        # Get user_id from database by username
        user = fetch_user_by_username(username)
        return user["id"] if user else None
    except (JWTError, Exception):
        return None

scheduler_llm = ChatOpenAI(
    model="Qwen/Qwen3-235B-A22B-Instruct-2507",
    api_key="ZGMyMjU5NGItNTFkYi00MjQwLWI4NTYtN2I0ZmY0NmU3YzUz.d6efa3e5133a169b0f4f23b5a0fed976",
    base_url="https://foundation-models.api.cloud.ru/v1",
    temperature=0.01,
    max_tokens=512,
)

scheduler_tools = [get_current_time, get_user_by_id, add_user, add_event_to_db, get_events_by_user]

prompt = hub.pull("hwchase17/react")
scheduler_agent = create_react_agent(scheduler_llm, scheduler_tools, prompt)

scheduler_agent_executor = AgentExecutor(
    agent=scheduler_agent,
    tools=scheduler_tools,
    verbose=True,
    handle_parsing_errors="Попробуй снова. Следуй формату: Thought, Action, Action Input.",
    max_iterations=10
)


planner_llm = ChatOpenAI(
    model="GigaChat/GigaChat-2-Max",
    api_key="ZGMyMjU5NGItNTFkYi00MjQwLWI4NTYtN2I0ZmY0NmU3YzUz.d6efa3e5133a169b0f4f23b5a0fed976",
    base_url="https://foundation-models.api.cloud.ru/v1",
    temperature=0.5,
    max_tokens=512,
)


app = FastAPI()


class QuestionRequest(BaseModel):
    question: str
    user_id: Optional[int] = None


@app.get("/chat/history")
async def get_chat_history_endpoint(
    authorization: Optional[str] = Header(None)
):
    """Get chat history for the current user."""
    try:
        # Extract user_id from JWT token
        user_id = get_user_id_from_token(authorization)
        
        if not user_id:
            raise HTTPException(
                status_code=401,
                detail="Authentication required. Include a valid JWT token in the Authorization header."
            )
        
        # Fetch chat history
        history = get_chat_history(user_id, limit=100)  # Get more messages for frontend
        
        # Format for frontend
        messages = [
            {
                "role": msg["role"],
                "content": msg["content"],
                "timestamp": msg["timestamp"].isoformat() if msg["timestamp"] else None
            }
            for msg in history
        ]
        
        return {"messages": messages}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/ask")
async def ask_agent(
    request: QuestionRequest,
    authorization: Optional[str] = Header(None)
):
    user_id = None
    try:
        # Get user_id from request body or extract from JWT token
        user_id = request.user_id
        if not user_id:
            user_id = get_user_id_from_token(authorization)
        
        if not user_id:
            raise HTTPException(
                status_code=401,
                detail="user_id is required. Provide it in the request body or include a valid JWT token in the Authorization header."
            )
        
        # Fetch chat history for the user
        history = get_chat_history(user_id, limit=20)
        
        # Format chat history for the agent
        # For ReAct agent, we'll prepend the conversation history to the input
        history_text = ""
        if history:
            history_lines = []
            for msg in history:
                role_label = "User" if msg["role"] == "user" else "Assistant"
                history_lines.append(f"{role_label}: {msg['content']}")
            history_text = "\n".join(history_lines) + "\n\n"
        
        # Prepare the full input with history context
        full_input = f"{history_text}User: {request.question}"
        
        # Set user_id in context so tools can access it
        set_user_id(user_id)
        
        try:
            # Invoke the agent with the full context
            # Tools will automatically use user_id from context
            result = scheduler_agent_executor.invoke({
                "input": full_input,
                "instructions": "Отвечай кратко и точно. Учитывай контекст предыдущих сообщений в беседе. Все события создаются для текущего пользователя автоматически - не нужно указывать owner_id."
            })
            
            agent_response = result["output"]
        finally:
            # Clean up context after request (even if agent execution fails)
            clear_user_id()
        
        # Save user message and agent response to database
        if user_id:
            save_chat_message(user_id, "user", request.question)
            save_chat_message(user_id, "assistant", agent_response)
        
        return {"answer": agent_response}
    except HTTPException:
        # Re-raise HTTP exceptions (like 401)
        raise
    except Exception as e:
        # Make sure context is cleared even on error
        clear_user_id()
        return {"error": str(e)}