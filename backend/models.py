from sqlalchemy import Boolean, Column, Integer, String, DateTime, JSON
from datetime import datetime

from database import Base

class TaskRecord(Base):
    __tablename__ = "tasks"

    id = Column(Integer, primary_key=True, index=True)
    document_type = Column(String, index=True)
    course_name = Column(String)
    title = Column(String)
    deadline = Column(DateTime, nullable=True)
    details = Column(String)
    task_type = Column(String, nullable=True)
    estimated_hours = Column(Integer, nullable=True)
    key_concepts = Column(JSON)
    milestones = Column(JSON)
    urgency_score = Column(Integer)
    raw_text = Column(String, nullable=True)
    is_done = Column(Boolean, default=False)
    completed_milestones = Column(JSON, default=list)  # positions of the ticked steps, e.g. [0, 2]



# ---------- Memory for the agent ----------

class ChatMessage(Base):
    """One message in an Ask Copilot conversation, so the agent remembers what you said earlier."""
    __tablename__ = "chat_messages"

    id = Column(Integer, primary_key=True, index=True)
    conversation_id = Column(String, index=True)
    role = Column(String)      # "user", "assistant", or "system" (a note of the tools it ran)
    content = Column(String)
    created_at = Column(DateTime, default=datetime.now)


class Preference(Base):
    """Something lasting about you, e.g. "I don't study after 11pm". The agent reads these every time."""
    __tablename__ = "preferences"

    id = Column(Integer, primary_key=True, index=True)
    text = Column(String)
    created_at = Column(DateTime, default=datetime.now)

def add_missing_columns(engine):
    """create_all() only makes NEW tables, so add new columns to your existing tasks.db ourselves."""
    with engine.begin() as conn:
        existing = [row[1] for row in conn.exec_driver_sql("PRAGMA table_info(tasks)")]
        if "is_done" not in existing:
            conn.exec_driver_sql("ALTER TABLE tasks ADD COLUMN is_done BOOLEAN DEFAULT 0")
        if "completed_milestones" not in existing:
            conn.exec_driver_sql("ALTER TABLE tasks ADD COLUMN completed_milestones JSON DEFAULT '[]'")
