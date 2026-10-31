"""
Subjects: one folder per course (like a shelf of binders).
Each folder holds the course's lecture PDFs, its assignments, and the notes you write yourself.

PDFs and tasks are put in the right folder by their course code: "BMCS1113 Computer Organisation"
goes into the BMCS1113 folder, which is made the first time that code shows up.

Also here: chapter summaries. Ollie reads a lecture PDF (or some of its pages) and writes a short
revision summary, which is saved so the AI only has to write it once.
Both the website (main.py) and the agent (agent.py) use these functions.
"""
import re
from datetime import datetime
from typing import List, Optional

from fastapi import HTTPException
from pydantic import BaseModel

import ai_service
import models
from database import SessionLocal

# A course code like "BMCS1113" or "BACS 2063": 3-5 letters, then 3-5 digits
CODE_PATTERN = re.compile(r"\b([A-Z]{3,5})\s?(\d{3,5}[A-Z]?)\b")
MAX_SUMMARY_CHARS = 120_000   # about a 60-slide chapter; for more, summarise some pages at a time


# ---------- What the website sends and gets back ----------

class SubjectIn(BaseModel):
    code: str = ""
    name: str
    lecturer: str = ""


class SubjectUpdate(BaseModel):
    code: Optional[str] = None
    name: Optional[str] = None
    lecturer: Optional[str] = None


class SubjectOut(BaseModel):
    model_config = {"from_attributes": True}
    id: int
    code: str = ""
    name: str
    lecturer: str = ""
    documents: int = 0   # how many lecture PDFs, tasks and notes are inside, for the shelf
    tasks: int = 0
    notes: int = 0


class DocumentBrief(BaseModel):
    """A lecture PDF or a task, as listed inside a subject folder."""
    id: int
    title: str
    document_type: str
    course_name: str = ""
    deadline: Optional[datetime] = None
    is_done: bool = False
    has_text: bool = False      # only PDFs with text can be summarised or chatted with
    has_summary: bool = False
    pages: Optional[int] = None


class NoteIn(BaseModel):
    subject_id: Optional[int] = None
    title: str = "Untitled note"
    body: str = ""


class NoteUpdate(BaseModel):
    subject_id: Optional[int] = None
    title: Optional[str] = None
    body: Optional[str] = None


class NoteOut(BaseModel):
    model_config = {"from_attributes": True}
    id: int
    subject_id: Optional[int] = None
    title: str
    body: str = ""
    created_at: datetime
    updated_at: datetime


class NoteBrief(BaseModel):
    id: int
    title: str
    updated_at: datetime
    preview: str = ""


class SubjectDetail(BaseModel):
    subject: Optional[SubjectOut] = None   # None = the "Other" folder (things with no subject)
    documents: List[DocumentBrief] = []    # lecture notes
    tasks: List[DocumentBrief] = []        # assignments
    notes: List[NoteBrief] = []


class MoveRequest(BaseModel):
    subject_id: Optional[int] = None   # None = the "Other" folder


class SummaryOut(BaseModel):
    document_id: int
    title: str
    summary: str
    pages: Optional[str] = None   # "3-10" when only some pages were summarised
    saved: bool = False           # True when it came from the saved copy (no AI call)


# ---------- Putting things in the right folder ----------

def split_course(course_name: str):
    """'BMCS1113 Computer Organisation and Architecture' -> ('BMCS1113', 'Computer Organisation and Architecture')."""
    text = (course_name or "").strip()
    match = CODE_PATTERN.search(text.upper())
    if not match:
        return "", text
    code = match.group(1) + match.group(2)
    name = (text[:match.start()] + text[match.end():]).strip(" -:|()")
    return code, name or code


def subject_for_course(db, course_name: str) -> Optional[int]:
    """The id of the subject this course belongs to, making the subject if it's new."""
    code, name = split_course(course_name)
    if not name or "[FAKE AI]" in name:
        return None
    query = db.query(models.Subject)
    subject = (query.filter(models.Subject.code == code).first() if code
               else query.filter(models.Subject.name.ilike(name)).first())
    if not subject:
        subject = models.Subject(code=code, name=name)
        db.add(subject)
        db.flush()   # gives it an id now
    return subject.id


def sort_old_documents() -> int:
    """Runs once, when subjects are added to an old database: puts every saved PDF and task in its folder."""
    db = SessionLocal()
    try:
        records = db.query(models.TaskRecord).filter(models.TaskRecord.subject_id.is_(None)).all()
        for record in records:
            record.subject_id = subject_for_course(db, record.course_name)
        db.commit()
        return len(records)
    finally:
        db.close()


# ---------- Subjects ----------

def _counts(db, subject_id: Optional[int]) -> dict:
    tasks = db.query(models.TaskRecord).filter(models.TaskRecord.subject_id == subject_id).all() \
        if subject_id is not None else \
        db.query(models.TaskRecord).filter(models.TaskRecord.subject_id.is_(None)).all()
    notes = db.query(models.StudyNote).filter(
        models.StudyNote.subject_id == subject_id if subject_id is not None else models.StudyNote.subject_id.is_(None)
    ).count()
    lecture = sum(1 for t in tasks if t.document_type != "Assignment")
    return {"documents": lecture, "tasks": len(tasks) - lecture, "notes": notes}


def _subject_out(db, subject: models.Subject) -> SubjectOut:
    return SubjectOut(id=subject.id, code=subject.code or "", name=subject.name,
                      lecturer=subject.lecturer or "", **_counts(db, subject.id))


def list_subjects() -> List[SubjectOut]:
    """Every subject, sorted by code (then name)."""
    db = SessionLocal()
    try:
        subjects = db.query(models.Subject).all()
        subjects.sort(key=lambda s: ((s.code or "~").upper(), s.name.upper()))
        return [_subject_out(db, s) for s in subjects]
    finally:
        db.close()


def other_counts() -> dict:
    """What's in the "Other" folder (things with no subject), so the shelf only shows it when it has something."""
    db = SessionLocal()
    try:
        return _counts(db, None)
    finally:
        db.close()


def _get_subject(db, subject_id: int) -> models.Subject:
    subject = db.query(models.Subject).filter(models.Subject.id == subject_id).first()
    if not subject:
        raise HTTPException(status_code=404, detail="Subject not found")
    return subject


def create_subject(data: SubjectIn) -> SubjectOut:
    code = re.sub(r"\s+", "", data.code).upper()
    name = data.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Please give the subject a name.")
    db = SessionLocal()
    try:
        if code and db.query(models.Subject).filter(models.Subject.code == code).first():
            raise HTTPException(status_code=400, detail=f"You already have a {code} folder.")
        subject = models.Subject(code=code, name=name, lecturer=data.lecturer.strip())
        db.add(subject)
        db.commit()
        db.refresh(subject)
        return _subject_out(db, subject)
    finally:
        db.close()


def update_subject(subject_id: int, changes: SubjectUpdate) -> SubjectOut:
    db = SessionLocal()
    try:
        subject = _get_subject(db, subject_id)
        if changes.code is not None:
            subject.code = re.sub(r"\s+", "", changes.code).upper()
        if changes.name and changes.name.strip():
            subject.name = changes.name.strip()
        if changes.lecturer is not None:
            subject.lecturer = changes.lecturer.strip()
        db.commit()
        db.refresh(subject)
        return _subject_out(db, subject)
    finally:
        db.close()


def delete_subject(subject_id: int) -> dict:
    """Removes the folder only. Its PDFs, tasks and notes are kept and move to "Other"."""
    db = SessionLocal()
    try:
        subject = _get_subject(db, subject_id)
        db.query(models.TaskRecord).filter(models.TaskRecord.subject_id == subject_id).update({"subject_id": None})
        db.query(models.StudyNote).filter(models.StudyNote.subject_id == subject_id).update({"subject_id": None})
        db.delete(subject)
        db.commit()
        return {"message": "Subject removed. Its files and notes moved to Other."}
    finally:
        db.close()


def _page_count(raw_text: Optional[str]) -> Optional[int]:
    if not raw_text or "\f" not in raw_text:
        return None
    return raw_text.count("\f") + 1


def _brief(record: models.TaskRecord) -> DocumentBrief:
    return DocumentBrief(
        id=record.id, title=record.title or "Untitled", document_type=record.document_type or "",
        course_name=record.course_name or "", deadline=record.deadline, is_done=bool(record.is_done),
        has_text=bool(record.raw_text), has_summary=bool(record.summary), pages=_page_count(record.raw_text),
    )


def _plain(text: Optional[str]) -> str:
    """A note as one plain line for a preview: no ## headings, ** bold, - bullets or ` marks."""
    text = re.sub(r"^\s*(#+|[-*]|\d+\.)\s+", "", text or "", flags=re.MULTILINE)
    return " ".join(text.replace("**", "").replace("`", "").split())


def subject_detail(subject_id: Optional[int]) -> SubjectDetail:
    """Everything in one folder. subject_id None = the "Other" folder."""
    db = SessionLocal()
    try:
        if subject_id is None:
            subject = None
            records = db.query(models.TaskRecord).filter(models.TaskRecord.subject_id.is_(None)).all()
            notes = db.query(models.StudyNote).filter(models.StudyNote.subject_id.is_(None)).all()
        else:
            subject = _subject_out(db, _get_subject(db, subject_id))
            records = db.query(models.TaskRecord).filter(models.TaskRecord.subject_id == subject_id).all()
            notes = db.query(models.StudyNote).filter(models.StudyNote.subject_id == subject_id).all()

        lecture = sorted((r for r in records if r.document_type != "Assignment"), key=lambda r: r.id)
        assignments = sorted((r for r in records if r.document_type == "Assignment"),
                             key=lambda r: (bool(r.is_done), r.deadline is None, r.deadline or datetime.max))
        notes.sort(key=lambda n: n.updated_at or n.created_at, reverse=True)
        return SubjectDetail(
            subject=subject,
            documents=[_brief(r) for r in lecture],
            tasks=[_brief(r) for r in assignments],
            notes=[NoteBrief(id=n.id, title=n.title or "Untitled note", updated_at=n.updated_at or n.created_at,
                             preview=_plain(n.body)[:120]) for n in notes],
        )
    finally:
        db.close()


def move_document(document_id: int, subject_id: Optional[int]) -> DocumentBrief:
    """Moves a PDF or task to another folder (None = Other)."""
    db = SessionLocal()
    try:
        record = db.query(models.TaskRecord).filter(models.TaskRecord.id == document_id).first()
        if not record:
            raise HTTPException(status_code=404, detail="Document not found")
        if subject_id is not None:
            _get_subject(db, subject_id)
        record.subject_id = subject_id
        db.commit()
        db.refresh(record)
        return _brief(record)
    finally:
        db.close()


# ---------- Your own notes ----------

def _get_note(db, note_id: int) -> models.StudyNote:
    note = db.query(models.StudyNote).filter(models.StudyNote.id == note_id).first()
    if not note:
        raise HTTPException(status_code=404, detail="Note not found")
    return note


def create_note(data: NoteIn) -> models.StudyNote:
    db = SessionLocal()
    try:
        if data.subject_id is not None:
            _get_subject(db, data.subject_id)
        note = models.StudyNote(subject_id=data.subject_id, title=data.title.strip() or "Untitled note",
                                body=data.body)
        db.add(note)
        db.commit()
        db.refresh(note)
        return note
    finally:
        db.close()


def get_note(note_id: int) -> models.StudyNote:
    db = SessionLocal()
    try:
        return _get_note(db, note_id)
    finally:
        db.close()


def update_note(note_id: int, changes: NoteUpdate) -> models.StudyNote:
    db = SessionLocal()
    try:
        note = _get_note(db, note_id)
        sent = changes.model_fields_set   # so "subject_id": null really moves it to Other
        if "subject_id" in sent:
            if changes.subject_id is not None:
                _get_subject(db, changes.subject_id)
            note.subject_id = changes.subject_id
        if changes.title is not None:
            note.title = changes.title.strip() or "Untitled note"
        if changes.body is not None:
            note.body = changes.body
        db.commit()
        db.refresh(note)
        return note
    finally:
        db.close()


def delete_note(note_id: int) -> dict:
    db = SessionLocal()
    try:
        db.delete(_get_note(db, note_id))
        db.commit()
        return {"message": "Note deleted"}
    finally:
        db.close()


# ---------- Chapter summaries ----------

def _read_pages(pages: str, total: int):
    """'3-10' or '5' -> (3, 10). Pages count from 1."""
    match = re.fullmatch(r"\s*(\d+)\s*(?:-\s*(\d+))?\s*", pages or "")
    if not match:
        raise HTTPException(status_code=400, detail="Write the pages like 3-10, or just 5.")
    first = int(match.group(1))
    last = int(match.group(2) or first)
    if first < 1 or last < first or first > total:
        raise HTTPException(status_code=400, detail=f"This PDF has pages 1 to {total}.")
    return first, min(last, total)


def summarise_document(document_id: int, pages: Optional[str] = None, refresh: bool = False) -> SummaryOut:
    """
    A short revision summary of a lecture PDF (one chapter), or of some of its pages.
    The whole-PDF summary is saved, so asking again is instant and free; refresh=True writes a new one.
    """
    db = SessionLocal()
    try:
        record = db.query(models.TaskRecord).filter(models.TaskRecord.id == int(document_id)).first()
        if not record:
            raise HTTPException(status_code=404, detail="Document not found")
        if not record.raw_text:
            raise HTTPException(status_code=400, detail="This one has no PDF text to summarise.")
        if record.summary and not pages and not refresh:
            return SummaryOut(document_id=record.id, title=record.title, summary=record.summary, saved=True)

        # Label every page, so the summary can say where each point is
        parts = record.raw_text.split("\f")
        first, last = _read_pages(pages, len(parts)) if pages else (1, len(parts))
        labelled = len(parts) > 1
        text = "\n\n".join(
            (f"[Page {number}]\n" if labelled else "") + part.strip()
            for number, part in enumerate(parts[first - 1:last], start=first) if part.strip()
        )
        if not text.strip():
            raise HTTPException(status_code=400, detail="Those pages have no text (maybe they're pictures).")
        if len(text) > MAX_SUMMARY_CHARS:
            raise HTTPException(status_code=400, detail=(
                f"This PDF is very long ({len(parts)} pages). Summarise part of it, for example pages 1-30."))

        prompt = (
            "You help a university student revise. Summarise this lecture chapter so they can study from it.\n"
            "Use only what is in the text. Write in simple English, in Markdown, with these parts:\n"
            "## Big idea\n(2-3 sentences: what this chapter is about and why it matters)\n"
            "## Key points\n(6-10 short bullets, the most important facts and steps)\n"
            "## Key terms\n(bullets like **term**: meaning in a few words)\n"
            "## Example\n(one small worked example from the text, if it has one; otherwise leave this part out)\n"
            "## Likely exam questions\n(3 questions a lecturer could ask about this)\n"
            + ("After a point, add its page like (p.4) when you can.\n" if labelled else "")
            + "Write each ## heading exactly as shown (not in bold). "
            "Keep it under 450 words. Do not add anything that is not in the text.\n\n"
            f"Chapter: {record.title} ({record.course_name})\n\n{text}"
        )

        def read_text(answer: str) -> str:
            if not answer.strip():
                raise ValueError("empty answer")
            # Some models wrap a heading in bold, like "**## Key points**"
            return re.sub(r"^\*\*\s*(#+ .*?)\s*\*\*\s*$", r"\1", answer.strip(), flags=re.MULTILINE)

        summary = ai_service._ask_ai(prompt, read_text)
        page_range = f"{first}-{last}" if pages else None
        if not pages:
            record.summary = summary
            db.commit()
        return SummaryOut(document_id=record.id, title=record.title, summary=summary, pages=page_range)
    finally:
        db.close()
