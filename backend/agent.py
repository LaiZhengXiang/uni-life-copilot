"""
Week 1 of the study-secretary agent: TOOL CALLING.

The AI never touches the database itself. We show it a "menu" of tools,
it replies "please run get_deadlines(days_ahead=7)", OUR code runs it,
and we send the result back so the AI can answer in normal words.
"""
import json
import os
from datetime import datetime, timedelta
from typing import List, Optional

from fastapi import HTTPException
from pydantic import BaseModel

import ai_service
import models
from database import SessionLocal


class AgentRequest(BaseModel):
    message: str


class ToolUse(BaseModel):
    name: str
    args: dict


class AgentResponse(BaseModel):
    answer: str
    tools_used: List[ToolUse]  # shown in the UI so you can see the agent "doing" things


# ---------- 1. The tools: normal Python functions ----------

def get_deadlines(days_ahead: int = 7) -> List[dict]:
    """Returns the user's tasks that are due between today and `days_ahead` days from now."""
    days_ahead = max(1, min(int(days_ahead), 365))
    start_of_today = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
    until = start_of_today + timedelta(days=days_ahead + 1)

    db = SessionLocal()
    try:
        tasks = (
            db.query(models.TaskRecord)
            .filter(models.TaskRecord.deadline.isnot(None))
            .filter(models.TaskRecord.deadline >= start_of_today)
            .filter(models.TaskRecord.deadline < until)
            .order_by(models.TaskRecord.deadline)
            .all()
        )
        # Send only what the AI needs (not the whole PDF text), to keep it cheap
        return [
            {
                "title": t.title,
                "course": t.course_name,
                "deadline": t.deadline.strftime("%A %d %B %Y, %I:%M %p"),
                "urgency_score": t.urgency_score,
                "estimated_hours": t.estimated_hours,
                "milestones": t.milestones,
            }
            for t in tasks
        ]
    finally:
        db.close()


# Which Python function runs for each tool name the AI may ask for
TOOL_FUNCTIONS = {
    "get_deadlines": get_deadlines,
}


# ---------- 2. The tool "menu" we show the AI ----------
# The AI only sees this description, never the Python code above.
# Clear descriptions = the AI knows WHEN to use the tool.

TOOLS_MENU = [
    {
        "type": "function",
        "function": {
            "name": "get_deadlines",
            "description": (
                "Get the student's assignments and their deadlines from their task board, "
                "for the next N days. Use this whenever the student asks what is due, "
                "what to work on, or about their workload."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "days_ahead": {
                        "type": "integer",
                        "description": "How many days ahead to look, e.g. 7 for this week, 30 for this month.",
                    }
                },
                "required": ["days_ahead"],
            },
        },
    }
]


def _system_prompt() -> str:
    # The AI doesn't know today's date, so we tell it every time
    today = datetime.now().strftime("%A %d %B %Y, %I:%M %p")
    return (
        "You are UniLife Copilot, a friendly study secretary for a university student. "
        f"Today is {today}. "
        "Use your tools to look up the student's real data; never make up deadlines. "
        "Answer briefly in simple English."
    )


# ---------- 3. Asking the AI, with the tool menu ----------

def _ask_groq_with_tools(messages: list, tool_choice: str) -> dict:
    """
    Sends the conversation and the tool menu to Groq (trying each model) and returns the AI's reply.
    tool_choice "auto" = the AI decides whether to use a tool; "none" = it must answer in words.
    """
    api_key = os.environ.get("GROQ_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="GROQ_API_KEY is not set.")
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}

    for model, extra in ai_service.GROQ_MODELS:
        payload = {
            "model": model, "messages": messages, "temperature": 0.1,
            "tools": TOOLS_MENU, "tool_choice": tool_choice, **extra,
        }
        try:
            data = ai_service._post_with_retry(f"Groq {model}", ai_service.GROQ_URL, payload, headers)
            print(f"[Agent] Answered by Groq {model}")
            return data["choices"][0]["message"]
        except ai_service.ProviderError as e:
            print(f"[Agent] {e}")
        except (KeyError, IndexError) as e:
            print(f"[Agent] Groq {model} gave an unexpected answer: {e}")

    raise HTTPException(status_code=503, detail=ai_service.BUSY_MESSAGE)


def _run_tool(name: str, args_json: Optional[str]) -> tuple:
    """Runs one tool the AI asked for. Returns (args, result) - errors go back to the AI as text."""
    try:
        args = json.loads(args_json or "{}")
    except json.JSONDecodeError:
        args = {}
    func = TOOL_FUNCTIONS.get(name)
    if func is None:
        return args, {"error": f"Unknown tool {name}"}
    try:
        return args, func(**args)
    except Exception as e:  # e.g. the AI sent a wrong argument
        return args, {"error": str(e)}


def run_agent(user_message: str) -> AgentResponse:
    if ai_service.USE_FAKE_AI:
        # No AI call, but the tool still runs for real so you can test it for free
        result = get_deadlines(7)
        print(f"[Agent] Fake AI mode: ran get_deadlines(7) -> {len(result)} task(s)")
        titles = ", ".join(t["title"] for t in result) or "nothing"
        return AgentResponse(
            answer=f"**[FAKE AI]** get_deadlines(7) found: {titles}",
            tools_used=[ToolUse(name="get_deadlines", args={"days_ahead": 7})],
        )

    messages = [
        {"role": "system", "content": _system_prompt()},
        {"role": "user", "content": user_message},
    ]

    # Step A: ask the AI. It either answers directly, or asks us to run tools.
    reply = _ask_groq_with_tools(messages, tool_choice="auto")
    tool_calls = reply.get("tool_calls") or []
    if not tool_calls:
        print("[Agent] AI answered without tools")
        return AgentResponse(answer=reply.get("content") or "", tools_used=[])

    # Step B: run each tool the AI asked for, and add the results to the conversation
    messages.append({"role": "assistant", "content": reply.get("content") or "", "tool_calls": tool_calls})
    tools_used = []
    for call in tool_calls:
        name = call["function"]["name"]
        args, result = _run_tool(name, call["function"].get("arguments"))
        print(f"[Agent] AI asked for {name}({args}) -> {result if isinstance(result, dict) else f'{len(result)} task(s)'}")
        tools_used.append(ToolUse(name=name, args=args))
        messages.append({"role": "tool", "tool_call_id": call["id"], "content": json.dumps(result)})

    # Step C: ask again, now with the tool results, for the final answer in normal words
    final = _ask_groq_with_tools(messages, tool_choice="none")
    return AgentResponse(answer=final.get("content") or "", tools_used=tools_used)
