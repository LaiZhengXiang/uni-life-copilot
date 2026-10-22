from fastapi import FastAPI, UploadFile, File, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from typing import List
import ai_service
import models
from database import engine, SessionLocal

# Create database tables automatically
models.Base.metadata.create_all(bind=engine)

app = FastAPI(
    title="Uni-Life Copilot API",
    description="Backend for AI-powered university student planner"
)

# Configure CORS so the frontend can communicate with the backend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Dependency to get DB session
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

@app.get("/api/health")
async def health_check():
    """Simple endpoint to test connection between frontend and backend."""
    return {"message": "Successfully connected to Uni-Life Copilot Backend!", "status": "ok"}

@app.get("/api/tasks", response_model=List[ai_service.ParsedDocument])
async def get_tasks(db: Session = Depends(get_db)):
    """Fetch all saved tasks from the database sorted by urgency descending."""
    tasks = db.query(models.TaskRecord).order_by(models.TaskRecord.urgency_score.desc()).all()
    # The Pydantic model response_model handles serialization
    return tasks

@app.post("/api/parse-assignment", response_model=List[ai_service.ParsedDocument])
async def parse_assignment(file: UploadFile = File(...), db: Session = Depends(get_db)):
    """Endpoint to upload a PDF assignment, parse via AI, and save to database."""
    if not file.filename.lower().endswith('.pdf'):
        raise HTTPException(status_code=400, detail="Only PDF files are supported.")
    
    try:
        # Read the file bytes
        file_bytes = await file.read()
        
        # Parse the assignment using our AI service (or get mock data if 503)
        assignments = ai_service.parse_assignment_with_gemini(file_bytes)
        
        # Save each parsed document to the database
        for item in assignments:
            db_task = models.TaskRecord(
                document_type=item.document_type,
                course_name=item.course_name,
                title=item.title,
                deadline=item.deadline,
                details=item.details,
                task_type=item.task_type,
                estimated_hours=item.estimated_hours,
                key_concepts=item.key_concepts,
                milestones=item.milestones,
                urgency_score=item.urgency_score,
                raw_text=item.raw_text  # Store the full extracted text for chat
            )
            db.add(db_task)
        
        db.commit()
        
        return assignments
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error parsing assignment: {str(e)}")

@app.delete("/api/tasks/{task_id}")
async def delete_task(task_id: int, db: Session = Depends(get_db)):
    """Deletes a saved task from the database."""
    task = db.query(models.TaskRecord).filter(models.TaskRecord.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    
    db.delete(task)
    db.commit()
    return {"message": "Task deleted successfully"}

@app.post("/api/chat", response_model=ai_service.ChatResponse)
async def chat_document(req: ai_service.ChatRequest, db: Session = Depends(get_db)):
    """Endpoint to ask questions about a parsed document."""
    task = db.query(models.TaskRecord).filter(models.TaskRecord.id == req.task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    
    if not task.raw_text:
        raise HTTPException(status_code=400, detail="No raw text available for this document.")
        
    answer = ai_service.chat_with_document(task.raw_text, req.question)
    return {"answer": answer}

@app.get("/api/calendar/sync")
async def sync_calendar():
    """Endpoint for syncing to Google Calendar (To be implemented)"""
    return {"message": "Google Calendar sync endpoint - Not implemented yet"}
