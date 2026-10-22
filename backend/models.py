from sqlalchemy import Column, Integer, String, DateTime, JSON
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
