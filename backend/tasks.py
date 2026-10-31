"""
Everything you can do to a saved task: show it, edit it, tick its steps, mark it done,
and turn your tasks into a calendar file.
Both the website (main.py) and the agent (agent.py) use these, so they always behave the same.
"""
from datetime import datetime
from typing import List, Optional

from fastapi import HTTPException
from pydantic import BaseModel

import ai_service
import models
from database import SessionLocal


class TaskOut(ai_service.ParsedDocument):
    """A saved task as the website sees it: the parsed document plus your progress."""
    is_done: bool = False
    completed_milestones: List[int] = []
    subject_id: Optional[int] = None


class TaskUpdate(BaseModel):
    """Only the fields you send get changed; the rest stay as they are."""
    title: Optional[str] = None
    course_name: Optional[str] = None
    deadline: Optional[datetime] = None
    estimated_hours: Optional[int] = None
    details: Optional[str] = None
    is_done: Optional[bool] = None
    completed_milestones: Optional[List[int]] = None


def urgency_score(deadline: datetime) -> int:
    """10 = due today, going down by 1 every 2 days, never below 1."""
    days_left = (deadline - datetime.now()).days
    return max(1, min(10, 10 - days_left // 2))


def list_tasks() -> List[models.TaskRecord]:
    """Unfinished tasks first, soonest deadline first; tasks with no deadline after those."""
    db = SessionLocal()
    try:
        tasks = db.query(models.TaskRecord).all()
    finally:
        db.close()
    return sorted(tasks, key=lambda t: (bool(t.is_done), t.deadline is None, t.deadline or datetime.max))


def update_task(task_id: int, changes: TaskUpdate) -> models.TaskRecord:
    db = SessionLocal()
    try:
        task = db.query(models.TaskRecord).filter(models.TaskRecord.id == task_id).first()
        if not task:
            raise HTTPException(status_code=404, detail="Task not found")

        # Only what was actually sent; an empty value means "don't change", never "wipe it"
        fields = {name: value for name, value in changes.model_dump(exclude_unset=True).items() if value is not None}
        for name, value in fields.items():
            setattr(task, name, value)
        if fields.get("deadline"):
            task.urgency_score = urgency_score(task.deadline)
        if "completed_milestones" in fields:
            # Keep only real step positions, each once
            steps = len(task.milestones or [])
            task.completed_milestones = sorted({i for i in fields["completed_milestones"] if 0 <= i < steps})

        db.commit()
        db.refresh(task)
        return task
    finally:
        db.close()


def _ics_text(text: str) -> str:
    """Calendar files treat commas, semicolons and new lines as special, so escape them."""
    return (text or "").replace("\\", "\\\\").replace(",", "\\,").replace(";", "\\;").replace("\n", "\\n")


def build_calendar() -> str:
    """
    An .ics calendar file with one event per unfinished deadline.
    Google Calendar, Apple Calendar and Outlook can all import it, and each event
    reminds you 1 day before, even when this app and your laptop are off.
    """
    stamp = datetime.now().strftime("%Y%m%dT%H%M%S")
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//UniLife Copilot//Deadlines//EN",
        "X-WR-CALNAME:UniLife deadlines",
    ]
    for task in list_tasks():
        if task.is_done or not task.deadline or task.deadline < datetime.now():
            continue  # only deadlines you still have to meet
        due = task.deadline.strftime("%Y%m%dT%H%M%S")
        lines += [
            "BEGIN:VEVENT",
            f"UID:unilife-task-{task.id}@unilife-copilot",  # same UID = importing again updates, not duplicates
            f"DTSTAMP:{stamp}",
            f"DTSTART:{due}",
            f"DTEND:{due}",
            f"SUMMARY:{_ics_text(f'Due: {task.title} ({task.course_name})')}",
            f"DESCRIPTION:{_ics_text(task.details)}",
            "BEGIN:VALARM",
            "ACTION:DISPLAY",
            f"DESCRIPTION:{_ics_text(f'{task.title} is due tomorrow')}",
            "TRIGGER:-P1D",
            "END:VALARM",
            "END:VEVENT",
        ]
    lines.append("END:VCALENDAR")
    return "\r\n".join(lines) + "\r\n"  # the calendar standard wants Windows-style line endings
