"""
Timetable: the classes you have every week, and the free time between them.

You can add classes by hand, or upload your timetable (a picture or a PDF): the AI reads it and
gives back a list of classes for you to check. Nothing is saved until you press Save.

Free time is simple: the gaps between your classes, from DAY_START to DAY_END.
Both the website (main.py) and the agent (agent.py) use these functions.
"""
import json
import re
from typing import List, Optional

import pymupdf
from fastapi import HTTPException
from pydantic import BaseModel, field_validator, model_validator

import ai_service
import models
import subjects
from database import SessionLocal

DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
KINDS = ["Lecture", "Tutorial", "Practical", "Other"]
DAY_START = "08:00"     # free time is counted between these two times
DAY_END = "22:00"
MIN_FREE_MINUTES = 30   # shorter gaps are too short to count as free time
PICTURE_TYPES = {"image/png", "image/jpeg", "image/webp", "image/heic", "image/heif"}
MAX_UPLOAD_BYTES = 10 * 1024 * 1024


# ---------- Reading times and days the way people write them ----------

def to_clock(text) -> str:
    """'8am', '8:30 PM', '0830' or '14:00' -> '08:00' style. ValueError if it isn't a time."""
    raw = str(text).strip().lower().replace(".", ":")
    match = re.fullmatch(r"(\d{1,2})(?::?(\d{2}))?\s*(am|pm)?", raw)
    if not match:
        raise ValueError(f"'{text}' is not a time")
    hour, minute, half = int(match.group(1)), int(match.group(2) or 0), match.group(3)
    if half == "pm" and hour < 12:
        hour += 12
    if half == "am" and hour == 12:
        hour = 0
    if hour > 23 or minute > 59:
        raise ValueError(f"'{text}' is not a time")
    return f"{hour:02d}:{minute:02d}"


def to_day(value) -> int:
    """'Monday', 'mon', 'Thurs' or 0-6 -> 0-6 (Monday = 0)."""
    if isinstance(value, int) or str(value).strip().isdigit():
        day = int(value)
        if 0 <= day <= 6:
            return day
        raise ValueError(f"day {value} is not 0-6")
    wanted = str(value).strip().lower()[:3]
    for number, name in enumerate(DAYS):
        if name.lower().startswith(wanted) and len(wanted) == 3:
            return number
    raise ValueError(f"'{value}' is not a day")


def _minutes(clock: str) -> int:
    hour, minute = clock.split(":")
    return int(hour) * 60 + int(minute)


# ---------- What the website sends and gets back ----------

class SlotIn(BaseModel):
    subject_id: Optional[int] = None
    course: str = ""          # used to find (or make) the subject when there is no subject_id
    kind: str = "Lecture"
    day: int
    start: str
    end: str
    place: str = ""

    @field_validator("day", mode="before")
    @classmethod
    def read_day(cls, value):
        return to_day(value)

    @field_validator("start", "end", mode="before")
    @classmethod
    def read_time(cls, value):
        return to_clock(value)

    @field_validator("kind", mode="before")
    @classmethod
    def read_kind(cls, value):
        value = str(value or "").strip().title()
        if value in ("Lab", "Practical Class"):
            return "Practical"
        return value if value in KINDS else "Other"

    @model_validator(mode="after")
    def start_before_end(self):
        if _minutes(self.start) >= _minutes(self.end):
            raise ValueError("The class must end after it starts.")
        return self


class SlotOut(BaseModel):
    id: int
    subject_id: Optional[int] = None
    label: str             # "BMCS1113 Computer Organisation and Architecture"
    code: str = ""         # "BMCS1113", short enough for the grid
    kind: str
    day: int
    start: str
    end: str
    place: str = ""


class SaveMany(BaseModel):
    slots: List[SlotIn]
    replace: bool = False   # True: the new timetable replaces every class you had


class FreeGap(BaseModel):
    day: int
    start: str
    end: str
    minutes: int


class Week(BaseModel):
    slots: List[SlotOut]
    free: List[FreeGap]
    day_start: str = DAY_START
    day_end: str = DAY_END


class DraftSlot(BaseModel):
    """A class the AI read from an uploaded timetable, waiting for the student to check it."""
    course: str
    subject_id: Optional[int] = None   # an existing subject with the same code, if there is one
    kind: str
    day: int
    start: str
    end: str
    place: str = ""


# ---------- Saving classes ----------

def _slot_out(slot: models.ClassSlot, folders: dict) -> SlotOut:
    folder = folders.get(slot.subject_id)
    label = f"{folder.code} {folder.name}".strip() if folder else (slot.course or "Class")
    code = (folder.code or folder.name) if folder else (subjects.split_course(slot.course)[0] or slot.course)
    return SlotOut(id=slot.id, subject_id=slot.subject_id if folder else None, label=label, code=code,
                   kind=slot.kind, day=slot.day, start=slot.start, end=slot.end, place=slot.place or "")


def _folders(db) -> dict:
    return {s.id: s for s in db.query(models.Subject).all()}


def _fill(db, slot: models.ClassSlot, data: SlotIn):
    subject_id = data.subject_id
    if subject_id and not db.query(models.Subject).filter(models.Subject.id == subject_id).first():
        raise HTTPException(status_code=404, detail="Subject not found")
    if not subject_id and data.course.strip():
        subject_id = subjects.subject_for_course(db, data.course.strip())
    slot.subject_id = subject_id
    slot.course = data.course.strip()
    slot.kind = data.kind
    slot.day = data.day
    slot.start = data.start
    slot.end = data.end
    slot.place = data.place.strip()


def _sorted(slots):
    return sorted(slots, key=lambda s: (s.day, s.start))


def list_slots(day: Optional[int] = None) -> List[SlotOut]:
    db = SessionLocal()
    try:
        query = db.query(models.ClassSlot)
        if day is not None:
            query = query.filter(models.ClassSlot.day == day)
        folders = _folders(db)
        return [_slot_out(s, folders) for s in _sorted(query.all())]
    finally:
        db.close()


def create_slot(data: SlotIn) -> SlotOut:
    db = SessionLocal()
    try:
        slot = models.ClassSlot()
        _fill(db, slot, data)
        db.add(slot)
        db.commit()
        db.refresh(slot)
        return _slot_out(slot, _folders(db))
    finally:
        db.close()


def update_slot(slot_id: int, data: SlotIn) -> SlotOut:
    db = SessionLocal()
    try:
        slot = db.query(models.ClassSlot).filter(models.ClassSlot.id == slot_id).first()
        if not slot:
            raise HTTPException(status_code=404, detail="Class not found")
        _fill(db, slot, data)
        db.commit()
        db.refresh(slot)
        return _slot_out(slot, _folders(db))
    finally:
        db.close()


def delete_slot(slot_id: int) -> dict:
    db = SessionLocal()
    try:
        slot = db.query(models.ClassSlot).filter(models.ClassSlot.id == slot_id).first()
        if not slot:
            raise HTTPException(status_code=404, detail="Class not found")
        db.delete(slot)
        db.commit()
        return {"deleted": slot_id}
    finally:
        db.close()


def save_many(data: SaveMany) -> List[SlotOut]:
    """Saves the classes from an uploaded timetable (after the student checked them)."""
    db = SessionLocal()
    try:
        if data.replace:
            db.query(models.ClassSlot).delete()
        for item in data.slots:
            slot = models.ClassSlot()
            _fill(db, slot, item)
            db.add(slot)
        db.commit()
    finally:
        db.close()
    return list_slots()


# ---------- Free time ----------

def free_time(day: Optional[int] = None, min_minutes: int = MIN_FREE_MINUTES,
              day_start: str = DAY_START, day_end: str = DAY_END) -> List[FreeGap]:
    """The gaps between classes (one day, or the whole week), between day_start and day_end."""
    slots = list_slots(day)
    days = [day] if day is not None else range(7)
    first, last = _minutes(day_start), _minutes(day_end)
    gaps = []
    for d in days:
        cursor = first
        for slot in (s for s in slots if s.day == d):
            start, end = _minutes(slot.start), _minutes(slot.end)
            if start - cursor >= min_minutes:
                gaps.append((d, cursor, min(start, last)))
            cursor = max(cursor, end)
        if last - cursor >= min_minutes:
            gaps.append((d, cursor, last))
    clock = lambda m: f"{m // 60:02d}:{m % 60:02d}"
    return [FreeGap(day=d, start=clock(a), end=clock(b), minutes=b - a) for d, a, b in gaps if b - a >= min_minutes]


def week() -> Week:
    return Week(slots=list_slots(), free=free_time())


# ---------- Reading an uploaded timetable ----------

SLOT_FIELDS = {
    "course": {"type": "string", "description": "Course code and name as written, e.g. 'BMCS1113 Computer Organisation'"},
    "kind": {"type": "string", "description": "Lecture, Tutorial, Practical or Other"},
    "day": {"type": "string", "description": "Monday ... Sunday"},
    "start": {"type": "string", "description": "24-hour time, e.g. '08:00'"},
    "end": {"type": "string", "description": "24-hour time, e.g. '10:00'"},
    "place": {"type": "string", "description": "Room or venue, '' if none"},
}
GEMINI_SLOTS_SCHEMA = {
    "type": "object",
    "properties": {"classes": {"type": "array", "items": {
        "type": "object", "properties": SLOT_FIELDS, "required": ["course", "kind", "day", "start", "end"]}}},
    "required": ["classes"],
}
PROMPT = (
    "This is a university student's weekly class timetable. List every class in it. "
    "A class that happens on two days is two items. 'L' or 'Lec' means Lecture, 'T' or 'Tut' means Tutorial, "
    "'P', 'Prac' or 'Lab' means Practical. Write times in 24-hour form. Only list what is really there; "
    "never invent a class. "
    'Reply with JSON only, shaped like {"classes": [ ... ]}, where each item has these fields:\n'
    f"{json.dumps(SLOT_FIELDS)}\n"
)


def _read_slots(answer: str) -> List[DraftSlot]:
    parsed = json.loads(answer)
    items = parsed.get("classes", []) if isinstance(parsed, dict) else parsed
    if not isinstance(items, list):
        raise ValueError("no classes in the answer")
    db = SessionLocal()
    try:
        by_code = {s.code: s.id for s in db.query(models.Subject).all() if s.code}
    finally:
        db.close()
    drafts = []
    for item in items:
        try:
            slot = SlotIn(**{key: item.get(key) or "" for key in SLOT_FIELDS})
        except ValueError:
            continue   # one unreadable class shouldn't throw the rest away
        code = subjects.split_course(slot.course)[0]
        drafts.append(DraftSlot(course=slot.course, subject_id=by_code.get(code), kind=slot.kind,
                                day=slot.day, start=slot.start, end=slot.end, place=slot.place))
    return _sorted(drafts)


def read_timetable(file_bytes: bytes, content_type: str) -> List[DraftSlot]:
    """Reads a timetable picture or PDF. Returns the classes found; nothing is saved."""
    if len(file_bytes) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=400, detail="That file is too big (10 MB at most).")
    content_type = (content_type or "").lower()

    if content_type == "application/pdf":
        text = ai_service.extract_text_from_pdf(file_bytes)
        if len(text.strip()) > 80:
            drafts = ai_service._ask_ai(f"{PROMPT}\nTimetable text:\n{text[:30_000]}", _read_slots,
                                        gemini_schema=GEMINI_SLOTS_SCHEMA)
        else:
            # A scanned PDF has no text: look at its first page as a picture instead
            with pymupdf.open(stream=file_bytes, filetype="pdf") as doc:
                picture = doc[0].get_pixmap(dpi=150).tobytes("png")
            drafts = ai_service._ask_ai_about_image(PROMPT, (picture, "image/png"), _read_slots, GEMINI_SLOTS_SCHEMA)
    elif content_type in PICTURE_TYPES:
        drafts = ai_service._ask_ai_about_image(PROMPT, (file_bytes, content_type), _read_slots, GEMINI_SLOTS_SCHEMA)
    else:
        raise HTTPException(status_code=400, detail="Please upload a picture (PNG or JPG) or a PDF of your timetable.")

    if not drafts:
        raise HTTPException(status_code=422, detail="Ollie couldn't find any classes in that file.")
    return drafts
