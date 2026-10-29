"""
Week 3 of the study-secretary agent: MEMORY.

The AI forgets everything between calls, so WE remember for it, in the database:
- Short-term memory: the last few messages of this chat, sent along with every new question,
  so "make it 3pm instead" still knows what "it" is.
- Long-term memory: preferences like "I don't study after 11pm", added to the instructions every time.
"""
from datetime import datetime
from typing import List

from pydantic import BaseModel

import models
from database import SessionLocal

HISTORY_MESSAGES = 12      # how many earlier messages we send back (more = more tokens = more 429s)
MAX_MESSAGE_CHARS = 800    # long answers get cut so one message can't eat the whole token budget


class HistoryMessage(BaseModel):
    role: str
    content: str


class PreferenceOut(BaseModel):
    model_config = {"from_attributes": True}
    id: int
    text: str


# ---------- Short-term memory: this conversation ----------

def save_message(conversation_id: str, role: str, content: str) -> None:
    db = SessionLocal()
    try:
        db.add(models.ChatMessage(conversation_id=conversation_id, role=role, content=content))
        db.commit()
    finally:
        db.close()


def load_history(conversation_id: str, limit: int = HISTORY_MESSAGES) -> List[HistoryMessage]:
    """The last `limit` messages of this conversation, oldest first."""
    db = SessionLocal()
    try:
        rows = (
            db.query(models.ChatMessage)
            .filter(models.ChatMessage.conversation_id == conversation_id)
            .order_by(models.ChatMessage.id.desc())
            .limit(limit)
            .all()
        )
    finally:
        db.close()
    return [HistoryMessage(role=r.role, content=r.content[:MAX_MESSAGE_CHARS]) for r in reversed(rows)]


def clear_history(conversation_id: str) -> None:
    db = SessionLocal()
    try:
        db.query(models.ChatMessage).filter(models.ChatMessage.conversation_id == conversation_id).delete()
        db.commit()
    finally:
        db.close()


# ---------- Long-term memory: preferences ----------

def list_preferences() -> List[models.Preference]:
    db = SessionLocal()
    try:
        return db.query(models.Preference).order_by(models.Preference.id).all()
    finally:
        db.close()


def add_preference(text: str) -> dict:
    """Agent tool: remember something lasting about the student."""
    text = text.strip()
    if not text:
        return {"error": "Nothing to remember."}
    db = SessionLocal()
    try:
        # Don't save the same thing twice
        if db.query(models.Preference).filter(models.Preference.text.ilike(text)).first():
            return {"status": "already remembered", "text": text}
        pref = models.Preference(text=text, created_at=datetime.now())
        db.add(pref)
        db.commit()
        return {"status": "remembered", "preference_id": pref.id, "text": text}
    finally:
        db.close()


def delete_preference(preference_id: int) -> dict:
    """Agent tool (and the x button in the UI): forget one preference."""
    db = SessionLocal()
    try:
        deleted = db.query(models.Preference).filter(models.Preference.id == int(preference_id)).delete()
        db.commit()
    finally:
        db.close()
    return {"status": "forgotten"} if deleted else {"error": f"No preference with id {preference_id}."}
