from fastapi import FastAPI, UploadFile, File, HTTPException, Depends, Response
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from typing import List
import ai_service
import agent
import models
import tasks
from database import engine, SessionLocal

# Create database tables automatically
models.Base.metadata.create_all(bind=engine)
models.add_missing_columns(engine)

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

@app.get("/api/tasks", response_model=List[tasks.TaskOut])
async def get_tasks():
    """All saved tasks: unfinished ones first, soonest deadline first."""
    return tasks.list_tasks()

@app.patch("/api/tasks/{task_id}", response_model=tasks.TaskOut)
async def edit_task(task_id: int, changes: tasks.TaskUpdate):
    """Edit a task, tick its steps, or mark it done. Only the fields you send are changed."""
    return tasks.update_task(task_id, changes)

@app.post("/api/parse-assignment", response_model=List[ai_service.ParsedDocument])
async def parse_assignment(file: UploadFile = File(...), db: Session = Depends(get_db)):
    """Endpoint to upload a PDF assignment, parse via AI, and save to database."""
    if not file.filename.lower().endswith('.pdf'):
        raise HTTPException(status_code=400, detail="Only PDF files are supported.")
    
    try:
        # Read the file bytes
        file_bytes = await file.read()
        
        # Parse the assignment with the AI (Groq first, Gemini as backup)
        assignments = ai_service.parse_assignment(file_bytes)
        
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

@app.get("/api/calendar.ics")
async def download_calendar():
    """Your unfinished deadlines as a calendar file to import into Google Calendar or your phone."""
    return Response(
        content=tasks.build_calendar(),
        media_type="text/calendar",
        headers={"Content-Disposition": 'attachment; filename="unilife-deadlines.ics"'},
    )

@app.post("/api/agent", response_model=agent.AgentResponse)
async def ask_agent(req: agent.AgentRequest):
    """Ask the study-secretary agent. It can use tools (like get_deadlines) to look up your real data."""
    if not req.message.strip():
        raise HTTPException(status_code=400, detail="Please type a question.")
    return agent.run_agent(req.message)

@app.post("/api/agent/save-task", response_model=tasks.TaskOut)
async def save_agent_task(task: agent.PendingTask):
    """The student clicked Save on a task the agent prepared, so now we really save it."""
    return agent.save_task(task)
