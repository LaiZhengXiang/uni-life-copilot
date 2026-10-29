"""
The study-secretary agent.

Week 1, TOOL CALLING: the AI never touches the database itself. We show it a "menu" of tools,
it replies "please run get_deadlines(days_ahead=7)", OUR code runs it,
and we send the result back so the AI can answer in normal words.

Week 2, THE AGENT LOOP: the AI may ask for tools again and again (check deadlines, then add a task...)
until it has everything it needs. We stop it after MAX_ROUNDS so it can never loop forever.
add_task does NOT save by itself: it only prepares the task, and the student clicks Save to confirm.

Week 3, MEMORY (see memory.py): every question also carries the last few messages of this chat,
and the instructions list the student's saved preferences, so the agent "remembers".
"""
import json
import os
from datetime import datetime, timedelta
from typing import List, Optional

from fastapi import HTTPException
from pydantic import BaseModel

import ai_service
import memory
import models
import rag
from database import SessionLocal
from tasks import TaskUpdate, urgency_score


class AgentRequest(BaseModel):
    message: str
    conversation_id: str = "default"  # the browser makes one per chat; "New chat" starts a new one


class ToolUse(BaseModel):
    name: str
    args: dict


class PendingTask(BaseModel):
    """A task the agent wants to add. Only saved after the student clicks Save."""
    title: str
    course_name: str
    deadline: datetime
    estimated_hours: Optional[int] = None
    details: str = ""


class PendingEdit(BaseModel):
    """Changes the agent wants to make to a saved task. Only applied after the student clicks Save."""
    task_id: int
    task_title: str
    changes: dict  # only the fields that change, e.g. {"deadline": "2026-11-06T15:00:00"}


class Source(BaseModel):
    """A note the answer was based on, shown under the answer."""
    title: str
    course: str
    page: Optional[int] = None


class AgentResponse(BaseModel):
    answer: str
    tools_used: List[ToolUse]  # shown in the UI so you can see the agent "doing" things
    pending_task: Optional[PendingTask] = None  # the UI shows a Save / Cancel card for it
    pending_edit: Optional[PendingEdit] = None  # same idea, for changing an existing task
    sources: List[Source] = []  # notes found by search_notes, so you can check the answer yourself


MAX_ROUNDS = 5  # the most times the AI may ask for tools in one question


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
            .filter(models.TaskRecord.is_done.isnot(True))  # finished tasks don't need reminding
            .filter(models.TaskRecord.deadline >= start_of_today)
            .filter(models.TaskRecord.deadline < until)
            .order_by(models.TaskRecord.deadline)
            .all()
        )
        # Send only what the AI needs (not the whole PDF text), to keep it cheap
        return [
            {
                "task_id": t.id,  # edit_task needs this to know which task to change
                "title": t.title,
                "course": t.course_name,
                "deadline": t.deadline.strftime("%A %d %B %Y, %I:%M %p"),
                "urgency_score": t.urgency_score,
                "estimated_hours": t.estimated_hours,
                "milestones": t.milestones,
                "steps_done": f"{len(t.completed_milestones or [])} of {len(t.milestones or [])}",
            }
            for t in tasks
        ]
    finally:
        db.close()


def _read_deadline(deadline: str):
    """Turns '2026-11-05 23:59' into a datetime. Returns an error message if it can't be used."""
    try:
        when = datetime.strptime(deadline.strip(), "%Y-%m-%d %H:%M")
    except ValueError:
        return None, "deadline must look like 2026-11-05 23:59"
    if when < datetime.now():
        return None, "That deadline is in the past. Ask the student for the right date."
    return when, None


def add_task(title: str, course_name: str, deadline: str,
             estimated_hours: Optional[int] = None, details: str = "") -> dict:
    """Prepares a new task. It is NOT saved yet: the student must click Save first."""
    when, error = _read_deadline(deadline)
    if error:
        return {"error": error}
    task = PendingTask(title=title, course_name=course_name, deadline=when,
                       estimated_hours=estimated_hours, details=details)
    # The weekday helps the AI notice if it picked the wrong date
    return {"status": "waiting_for_student_to_click_save", "deadline_is_a": when.strftime("%A"),
            "task": task.model_dump(mode="json")}


def edit_task(task_id: int, title: Optional[str] = None, course_name: Optional[str] = None,
              deadline: Optional[str] = None, estimated_hours: Optional[int] = None,
              details: Optional[str] = None, is_done: Optional[bool] = None) -> dict:
    """Prepares changes to a saved task. Nothing changes until the student clicks Save."""
    db = SessionLocal()
    try:
        task = db.query(models.TaskRecord).filter(models.TaskRecord.id == int(task_id)).first()
    finally:
        db.close()
    if not task:
        return {"error": f"There is no task with task_id {task_id}. Use get_deadlines to find the right one."}

    changes = {"title": title, "course_name": course_name, "estimated_hours": estimated_hours,
               "details": details, "is_done": is_done}
    changes = {name: value for name, value in changes.items() if value is not None}  # only what changes
    if deadline:
        when, error = _read_deadline(deadline)
        if error:
            return {"error": error}
        changes["deadline"] = when
    if not changes:
        return {"error": "Nothing to change. Ask the student what they want to change."}

    checked = TaskUpdate(**changes).model_dump(mode="json", exclude_unset=True)  # checks the types
    edit = PendingEdit(task_id=task.id, task_title=task.title, changes=checked)
    return {"status": "waiting_for_student_to_click_save", "edit": edit.model_dump()}


def save_task(task: PendingTask) -> models.TaskRecord:
    """Runs when the student clicks Save: this is the only place a chat-added task gets saved."""
    db = SessionLocal()
    try:
        record = models.TaskRecord(
            document_type="Assignment",
            course_name=task.course_name,
            title=task.title,
            deadline=task.deadline,
            details=task.details or "Added by chatting with Copilot.",
            estimated_hours=task.estimated_hours,
            key_concepts=[],
            milestones=[],
            urgency_score=urgency_score(task.deadline),
        )
        db.add(record)
        db.commit()
        db.refresh(record)
        return record
    finally:
        db.close()


# Which Python function runs for each tool name the AI may ask for
TOOL_FUNCTIONS = {
    "get_deadlines": get_deadlines,
    "add_task": add_task,
    "edit_task": edit_task,
    "search_notes": rag.search_notes,
    "remember_preference": memory.add_preference,
    "forget_preference": memory.delete_preference,
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
    },
    {
        "type": "function",
        "function": {
            "name": "add_task",
            "description": (
                "Add a new assignment or task to the student's task board. "
                "It is not saved straight away: the student sees a Save button and must click it. "
                "Only use this when the student gave the title, the course and the due date. "
                "If any of these is missing, ask the student instead of guessing."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "title": {"type": "string", "description": "Short task name, e.g. 'Linked List Assignment'."},
                    "course_name": {"type": "string", "description": "Course code or name, e.g. 'BACS2063 Data Structures'."},
                    "deadline": {
                        "type": "string",
                        "description": "Due date and time as 'YYYY-MM-DD HH:MM' (24-hour). Use 23:59 if no time was given.",
                    },
                    "estimated_hours": {"type": "integer", "description": "Hours of work, only if the student said."},
                    "details": {"type": "string", "description": "Any extra notes the student gave."},
                },
                "required": ["title", "course_name", "deadline"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "edit_task",
            "description": (
                "Change a task that is already on the board: rename it, move its deadline, change its hours "
                "or notes, or mark it as done. Call get_deadlines first to find the task_id. "
                "Only send the fields that change. Nothing is saved until the student clicks Save."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "task_id": {"type": "integer", "description": "The task_id from get_deadlines."},
                    "title": {"type": "string", "description": "New title."},
                    "course_name": {"type": "string", "description": "New course."},
                    "deadline": {"type": "string", "description": "New due date as 'YYYY-MM-DD HH:MM' (24-hour)."},
                    "estimated_hours": {"type": "integer", "description": "New hours estimate."},
                    "details": {"type": "string", "description": "New notes."},
                    "is_done": {"type": "boolean", "description": "true when the student says they finished it."},
                },
                "required": ["task_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "search_notes",
            "description": (
                "Search the student's uploaded lecture notes and assignment PDFs. Returns the most relevant pieces "
                "with their source title and page. Use it whenever the student asks about course content, "
                "a concept, an assignment's requirements, or says 'my notes'. "
                "Search with the key words of the question, e.g. 'difference between GET and POST form methods'."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "What to look for, in a few clear words."},
                    "course": {
                        "type": "string",
                        "description": "Optional course code or name to search only that course, e.g. 'BMIT2013'.",
                    },
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "remember_preference",
            "description": (
                "Save something lasting about the student so you remember it in every future chat, "
                "e.g. 'Doesn't study after 11pm', 'Prefers to start assignments 1 week early', 'Is in Year 2'. "
                "Use it when the student tells you a habit, rule or fact about themselves, or says 'remember that...'. "
                "Do not use it for one-off tasks or deadlines (use add_task for those). "
                "If it changes or contradicts something you already remember (a new name, a new study time...), "
                "pass that old memory's id as replaces_id so the old one is deleted."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "text": {"type": "string", "description": "One short sentence, written about the student."},
                    "replaces_id": {
                        "type": "integer",
                        "description": "The id of an old memory this one corrects or updates, from 'What you remember'.",
                    },
                },
                "required": ["text"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "forget_preference",
            "description": "Delete a saved preference when the student says it is wrong or no longer true.",
            "parameters": {
                "type": "object",
                "properties": {
                    "preference_id": {"type": "integer", "description": "The id shown in 'What you remember'."},
                },
                "required": ["preference_id"],
            },
        },
    },
]


def _system_prompt() -> str:
    # The AI doesn't know today's date, so we tell it every time.
    # AIs are bad at date maths, so we also list the next two weeks for it.
    now = datetime.now()
    today = now.strftime("%A %d %B %Y, %I:%M %p")
    upcoming = "\n".join((now + timedelta(days=i)).strftime("- %A = %Y-%m-%d") for i in range(1, 15))
    return (
        "You are Ollie, a chill and slightly nerdy orange cat with big round glasses, the study buddy inside "
        "the UniLife Copilot app. You can be a little playful, but you are useful first. You help a university "
        "student understand "
        "their course material and keep on top of their deadlines. "
        f"Today is {today}.\n"
        "STUDY QUESTIONS: when the student asks about course content, call search_notes first and teach from "
        "what it finds, in simple words with a small example if helpful. After each fact from the notes, "
        "cite it like (Chapter 2A: HTML, p.12), or without the page if it has none. "
        "If search_notes finds nothing useful, say 'Your notes don't cover this' and then explain from general "
        "knowledge, clearly marked as not from their notes. Never invent what the notes say. "
        "Questions that have nothing to do with their studies can be answered normally.\n"
        f"Calendar for the next 14 days (copy dates from here, never calculate them yourself):\n{upcoming}\n"
        "'This Friday' or 'next Friday' means the FIRST Friday in this list.\n"
        "Use your tools to look up the student's real data; never make up deadlines. "
        "You may use several tools one after another, for example check the deadlines before adding a task "
        "so you don't add the same task twice. "
        "add_task and edit_task do not save anything: after they work, say it is READY (not saved) "
        "and tell the student to press Save to confirm. "
        "get_deadlines only shows unfinished tasks; to find a task that is further away, use a bigger days_ahead. "
        "Earlier messages of this chat come before the new question; use them to understand words like "
        "'it' or 'that one'. If you prepared a task earlier and the student changes it before saving, "
        "call add_task again with the fix. "
        "IMPORTANT: to add or change anything you MUST call the tool in this turn. The Save button only appears "
        "after a real tool call, so never just write that you did it. "
        "When the student tells you a lasting habit or preference, save it with remember_preference, "
        "and use what you remember when you give advice. Your memories must never disagree: before saving, "
        "check the list below, and if the new fact updates an old one, use replaces_id. If two memories "
        "already disagree, ask the student which is right, then fix it.\n"
        f"What you remember about the student:\n{_preferences_text()}\n"
        "The chat window is narrow: prefer short bullet lists; only use a table for a small comparison "
        "(3 columns at most, short cells). "
        "Answer briefly in simple English."
    )


def _preferences_text() -> str:
    prefs = memory.list_preferences()
    if not prefs:
        return "- (nothing yet)"
    return "\n".join(f"- [id {p.id}] {p.text}" for p in prefs)


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


def run_agent(user_message: str, conversation_id: str = "default") -> AgentResponse:
    if ai_service.USE_FAKE_AI:
        # No AI call, but the tool still runs for real so you can test it for free
        result = get_deadlines(7)
        print(f"[Agent] Fake AI mode: ran get_deadlines(7) -> {len(result)} task(s)")
        titles = ", ".join(t["title"] for t in result) or "nothing"
        response = AgentResponse(
            answer=f"**[FAKE AI]** get_deadlines(7) found: {titles}",
            tools_used=[ToolUse(name="get_deadlines", args={"days_ahead": 7})],
        )
    else:
        response = _agent_loop(user_message, conversation_id)

    # The AI sometimes copies our memory note into its answer instead of really using a tool; hide that
    response.answer = response.answer.split(ACTIONS_NOTE)[0].strip()

    # MEMORY: save both sides of this exchange, so the next question can see them
    memory.save_message(conversation_id, "user", user_message)
    memory.save_message(conversation_id, "assistant", response.answer)
    # Plus a note of the tools it ran, kept as a "system" message so the AI reads it as a fact,
    # not as an example of how to write its own answers
    actions = [f"{t.name}({json.dumps(t.args)})" for t in response.tools_used if t.name != "get_deadlines"]
    if actions:
        memory.save_message(conversation_id, "system", f"{ACTIONS_NOTE} {'; '.join(actions)}")
    return response


ACTIONS_NOTE = "Tools the assistant actually ran for the message above:"


def _agent_loop(user_message: str, conversation_id: str) -> AgentResponse:
    # System instructions, then the earlier messages of this chat, then the new question
    history = [{"role": m.role, "content": m.content} for m in memory.load_history(conversation_id)]
    messages = [
        {"role": "system", "content": _system_prompt()},
        *history,
        {"role": "user", "content": user_message},
    ]
    tools_used = []
    pending_task = None
    pending_edit = None
    sources = []

    # THE AGENT LOOP: ask -> run the tools it wants -> ask again ... until it answers in words
    for round_number in range(1, MAX_ROUNDS + 1):
        # On the last round we take the tools away, so it must answer now
        last_round = round_number == MAX_ROUNDS
        reply = _ask_groq_with_tools(messages, tool_choice="none" if last_round else "auto")
        tool_calls = reply.get("tool_calls") or []

        if not tool_calls:
            print(f"[Agent] Final answer after {round_number} round(s)")
            return AgentResponse(answer=reply.get("content") or "", tools_used=tools_used,
                                 pending_task=pending_task, pending_edit=pending_edit, sources=sources)

        # Run each tool the AI asked for, and add the results to the conversation
        messages.append({"role": "assistant", "content": reply.get("content") or "", "tool_calls": tool_calls})
        for call in tool_calls:
            name = call["function"]["name"]
            args, result = _run_tool(name, call["function"].get("arguments"))
            print(f"[Agent] Round {round_number}: {name}({args}) -> {result if isinstance(result, dict) else f'{len(result)} task(s)'}")
            tools_used.append(ToolUse(name=name, args=args))
            if name == "add_task" and isinstance(result, dict) and "task" in result:
                pending_task = PendingTask(**result["task"])  # the UI will show Save / Cancel
            if name == "edit_task" and isinstance(result, dict) and "edit" in result:
                pending_edit = PendingEdit(**result["edit"])
            if name == "search_notes" and isinstance(result, dict):
                for found in result.get("results", []):
                    source = Source(title=found["source"], course=found["course"], page=found["page"])
                    if source not in sources:
                        sources.append(source)
            messages.append({"role": "tool", "tool_call_id": call["id"], "content": json.dumps(result)})

    # Not reached (the last round has no tools), but just in case
    return AgentResponse(answer="Sorry, I got stuck. Please ask again.", tools_used=tools_used,
                         pending_task=pending_task, pending_edit=pending_edit, sources=sources)
