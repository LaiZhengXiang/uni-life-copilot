from sqlalchemy import Boolean, Column, Integer, String, DateTime, JSON
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


def add_missing_columns(engine):
    """create_all() only makes NEW tables, so add new columns to your existing tasks.db ourselves."""
    with engine.begin() as conn:
        existing = [row[1] for row in conn.exec_driver_sql("PRAGMA table_info(tasks)")]
        if "is_done" not in existing:
            conn.exec_driver_sql("ALTER TABLE tasks ADD COLUMN is_done BOOLEAN DEFAULT 0")
        if "completed_milestones" not in existing:
            conn.exec_driver_sql("ALTER TABLE tasks ADD COLUMN completed_milestones JSON DEFAULT '[]'")
