from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel
import os
from dotenv import load_dotenv
from langchain_openai import ChatOpenAI
from langchain.agents import create_react_agent, AgentExecutor
from langchain import hub
from .tools import get_current_time, get_user_by_id, add_user, add_event_to_db, get_events_by_user

load_dotenv()

llm = ChatOpenAI(
    model="Qwen/Qwen3-235B-A22B-Instruct-2507",
    api_key=os.getenv("API_LLM"),
    base_url="https://foundation-models.api.cloud.ru/v1",
    temperature=0.01,
    max_tokens=512,
)

tools = [get_current_time, get_user_by_id, add_user, add_event_to_db, get_events_by_user]

prompt = hub.pull("hwchase17/react")
agent = create_react_agent(llm, tools, prompt)

agent_executor = AgentExecutor(
    agent=agent,
    tools=tools,
    verbose=True,
    handle_parsing_errors="Попробуй снова. Следуй формату: Thought, Action, Action Input.",
    max_iterations=10
)

app = FastAPI()
templates = Jinja2Templates(directory="app/templates")

class QuestionRequest(BaseModel):
    question: str

@app.get("/", response_class=HTMLResponse)
async def chat_ui(request: Request):
    return templates.TemplateResponse("chat.html", {"request": request})

@app.post("/ask")
async def ask_agent(request: QuestionRequest):
    try:
        result = agent_executor.invoke({
            "input": request.question,
            "instructions": "Отвечай кратко и точно."
        })
        return {"answer": result["output"]}
    except Exception as e:
        return {"error": str(e)}