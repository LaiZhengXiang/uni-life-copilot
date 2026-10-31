from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Depends, Response
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from typing import List, Optional
import ai_service
import agent
import memory
import models
import rag
import subjects
import tasks
import timetable
from database import engine, SessionLocal

# Create database tables automatically
models.Base.metadata.create_all(bind=engine)
if models.add_missing_columns(engine):
    # Subjects are new: put the PDFs and tasks you already had into their folders, once
    print(f"[Subjects] Sorted {subjects.sort_old_documents()} saved document(s) into subject folders")

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
async def parse_assignment(file: UploadFile = File(...), subject_id: Optional[int] = Form(None),
                           db: Session = Depends(get_db)):
    """
    Upload a PDF: the AI reads it and it's saved as tasks or lecture notes.
    subject_id: the folder it was dropped into; without one, it goes in the folder of its course code.
    """
    if not file.filename.lower().endswith('.pdf'):
        raise HTTPException(status_code=400, detail="Only PDF files are supported.")
    
    try:
        # Read the file bytes
        file_bytes = await file.read()
        
        # Parse the assignment with the AI (Groq first, Gemini as backup)
        assignments = ai_service.parse_assignment(file_bytes)
        
        # Save each parsed document to the database
        saved = []
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
                raw_text=item.raw_text,  # Store the full extracted text for chat
                subject_id=subject_id or subjects.subject_for_course(db, item.course_name),
            )
            db.add(db_task)
            saved.append(db_task)

        db.commit()

        # RAG: cut the new PDF into searchable pieces now, so Copilot can answer questions about it.
        # If that fails (e.g. rate limit), the upload still works: it gets indexed on the next search.
        for db_task in saved:
            try:
                rag.index_task(db_task.id)
            except rag.RagError as e:
                print(f"[RAG] Will index '{db_task.title}' later: {e}")

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
    rag.delete_task_chunks(task_id)  # so the notes search never quotes a deleted PDF
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
    return agent.run_agent(req.message, req.conversation_id)

@app.get("/api/agent/history/{conversation_id}", response_model=List[memory.HistoryMessage])
async def get_agent_history(conversation_id: str):
    """The messages of a conversation, so the chat still shows them after you refresh the page."""
    # Only the chat bubbles; the "system" notes are just for the AI
    history = memory.load_history(conversation_id, limit=50, max_chars=None)  # full text for you to read
    return [m for m in history if m.role in ("user", "assistant")]

@app.delete("/api/agent/history/{conversation_id}")
async def clear_agent_history(conversation_id: str):
    """New chat: forget this conversation (your preferences are kept)."""
    memory.clear_history(conversation_id)
    return {"message": "Conversation cleared"}

@app.get("/api/preferences", response_model=List[memory.PreferenceOut])
async def get_preferences():
    """Everything Copilot remembers about you long-term."""
    return memory.list_preferences()

@app.delete("/api/preferences/{preference_id}")
async def forget_preference(preference_id: int):
    return memory.delete_preference(preference_id)

@app.post("/api/agent/save-task", response_model=tasks.TaskOut)
async def save_agent_task(task: agent.PendingTask):
    """The student clicked Save on a task the agent prepared, so now we really save it."""
    return agent.save_task(task)

@app.post("/api/agent/save-note", response_model=subjects.NoteOut)
async def save_agent_note(note: agent.PendingNote):
    """The student clicked Save on a note the agent prepared."""
    return subjects.create_note(subjects.NoteIn(subject_id=note.subject_id, title=note.title, body=note.body))


# ---------- Subjects: one folder per course, with its PDFs, tasks and your notes ----------

@app.get("/api/subjects", response_model=List[subjects.SubjectOut])
async def get_subjects():
    return subjects.list_subjects()

@app.get("/api/subjects/other")
async def get_other_counts():
    """How much is in the "Other" folder (things with no subject)."""
    return subjects.other_counts()

@app.post("/api/subjects", response_model=subjects.SubjectOut)
async def add_subject(data: subjects.SubjectIn):
    return subjects.create_subject(data)

@app.patch("/api/subjects/{subject_id}", response_model=subjects.SubjectOut)
async def edit_subject(subject_id: int, changes: subjects.SubjectUpdate):
    return subjects.update_subject(subject_id, changes)

@app.delete("/api/subjects/{subject_id}")
async def remove_subject(subject_id: int):
    """Removes the folder; its PDFs, tasks and notes move to Other (nothing is lost)."""
    return subjects.delete_subject(subject_id)

@app.get("/api/subjects/{subject_id}/contents", response_model=subjects.SubjectDetail)
async def get_subject_contents(subject_id: str):
    """Everything in one folder. Use "other" for the things with no subject."""
    if subject_id == "other":
        return subjects.subject_detail(None)
    if not subject_id.isdigit():
        raise HTTPException(status_code=404, detail="Subject not found")
    return subjects.subject_detail(int(subject_id))

@app.put("/api/documents/{document_id}/subject", response_model=subjects.DocumentBrief)
async def move_document(document_id: int, req: subjects.MoveRequest):
    """Moves a PDF or task to another subject folder."""
    return subjects.move_document(document_id, req.subject_id)

@app.post("/api/documents/{document_id}/summary", response_model=subjects.SummaryOut)
async def summarise_document(document_id: int, pages: Optional[str] = None, refresh: bool = False):
    """A revision summary of a lecture PDF. pages like "3-10" summarises only those pages."""
    return subjects.summarise_document(document_id, pages, refresh)

# ---------- Your own notes ----------

@app.post("/api/notes", response_model=subjects.NoteOut)
async def add_note(data: subjects.NoteIn):
    return subjects.create_note(data)

@app.get("/api/notes/{note_id}", response_model=subjects.NoteOut)
async def read_note(note_id: int):
    return subjects.get_note(note_id)

@app.patch("/api/notes/{note_id}", response_model=subjects.NoteOut)
async def edit_note(note_id: int, changes: subjects.NoteUpdate):
    return subjects.update_note(note_id, changes)

@app.delete("/api/notes/{note_id}")
async def remove_note(note_id: int):
    return subjects.delete_note(note_id)


# ---------- Timetable: your weekly classes and the free time between them ----------

@app.get("/api/timetable", response_model=timetable.Week)
async def get_timetable():
    """Every class, plus the free gaps in each day."""
    return timetable.week()

@app.post("/api/timetable/classes", response_model=timetable.SlotOut)
async def add_class(data: timetable.SlotIn):
    return timetable.create_slot(data)

@app.put("/api/timetable/classes/{slot_id}", response_model=timetable.SlotOut)
async def edit_class(slot_id: int, data: timetable.SlotIn):
    return timetable.update_slot(slot_id, data)

@app.delete("/api/timetable/classes/{slot_id}")
async def remove_class(slot_id: int):
    return timetable.delete_slot(slot_id)

@app.post("/api/timetable/read", response_model=List[timetable.DraftSlot])
async def read_timetable(file: UploadFile = File(...)):
    """Reads a timetable picture or PDF and gives back the classes for you to check. Saves nothing."""
    return timetable.read_timetable(await file.read(), file.content_type)

@app.post("/api/timetable/save", response_model=List[timetable.SlotOut])
async def save_timetable(data: timetable.SaveMany):
    """Saves the classes you checked after an upload."""
    return timetable.save_many(data)
