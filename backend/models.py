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
    subject_id = Column(Integer, index=True, nullable=True)  # which subject folder it's in (None = "Other")
    summary = Column(String, nullable=True)                 # the chapter summary, saved so it's made only once


# ---------- Subjects: one folder per course ----------

class Subject(Base):
    """A course, e.g. BMCS1113 Computer Organisation and Architecture. Holds its PDFs, tasks and notes."""
    __tablename__ = "subjects"

    id = Column(Integer, primary_key=True, index=True)
    code = Column(String, default="")       # "BMCS1113"; empty if the course has no code
    name = Column(String)
    lecturer = Column(String, default="")
    created_at = Column(DateTime, default=datetime.now)


class StudyNote(Base):
    """A note the student wrote (or saved from Ollie), kept in a subject folder."""
    __tablename__ = "study_notes"

    id = Column(Integer, primary_key=True, index=True)
    subject_id = Column(Integer, index=True, nullable=True)
    title = Column(String)
    body = Column(String, default="")
    created_at = Column(DateTime, default=datetime.now)
    updated_at = Column(DateTime, default=datetime.now, onupdate=datetime.now)



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

# ---------- RAG: your notes, cut into searchable pieces ----------

class NoteChunk(Base):
    """One small piece of a PDF, plus its embedding (768 numbers describing what it means)."""
    __tablename__ = "note_chunks"

    id = Column(Integer, primary_key=True, index=True)
    task_id = Column(Integer, index=True)     # which document it came from
    chunk_index = Column(Integer)             # 0, 1, 2... in reading order
    page = Column(Integer, nullable=True)     # None for PDFs uploaded before page numbers were saved
    text = Column(String)
    embedding = Column(JSON)


def add_missing_columns(engine) -> bool:
    """
    create_all() only makes NEW tables, so add new columns to your existing tasks.db ourselves.
    Returns True when the subject column was just added, so main.py sorts the old PDFs into subjects once.
    """
    with engine.begin() as conn:
        existing = [row[1] for row in conn.exec_driver_sql("PRAGMA table_info(tasks)")]
        if "is_done" not in existing:
            conn.exec_driver_sql("ALTER TABLE tasks ADD COLUMN is_done BOOLEAN DEFAULT 0")
        if "completed_milestones" not in existing:
            conn.exec_driver_sql("ALTER TABLE tasks ADD COLUMN completed_milestones JSON DEFAULT '[]'")
        if "summary" not in existing:
            conn.exec_driver_sql("ALTER TABLE tasks ADD COLUMN summary VARCHAR")
        if "subject_id" not in existing:
            conn.exec_driver_sql("ALTER TABLE tasks ADD COLUMN subject_id INTEGER")
            return True
    return False
