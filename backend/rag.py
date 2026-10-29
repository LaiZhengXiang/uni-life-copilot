"""
Week 4 of the study buddy: RAG (Retrieval-Augmented Generation) = "find the right pages first, then answer".

Like an open-book exam: the AI can't read all your notes for every question (too many tokens),
so we find the few pieces that match the question and give it only those.

Preparation, once per PDF (index_task):
  1. CHUNK:  cut the PDF text into small pieces (about one slide or paragraph each)
  2. EMBED:  turn each piece into 768 numbers that capture its MEANING (Gemini does this)
  3. STORE:  save the pieces and their numbers in the note_chunks table

Every question (search_notes):
  4. SEARCH: turn the question into numbers too, and find the pieces whose numbers are closest
  5. ANSWER: the agent gets those pieces and answers from them, saying where each fact came from
"""
import math
import os
import time
from typing import List, Optional

import requests

import ai_service
import models
from database import SessionLocal

EMBED_MODEL = "gemini-embedding-001"
EMBED_URL = f"https://generativelanguage.googleapis.com/v1beta/models/{EMBED_MODEL}:batchEmbedContents"
DIMENSIONS = 768        # fewer numbers per piece = smaller database, still good enough for a few hundred PDFs
CHUNK_CHARS = 700       # about one slide or a short paragraph
OVERLAP_LINES = 2       # the last lines of one piece also start the next, so no idea is cut in half
BATCH_SIZE = 50         # pieces sent to Gemini in one request
TOP_K = 4               # how many pieces the agent gets per search (more = more tokens = more 429s)
MIN_SIMILARITY = 0.5    # below this, a piece is probably not about the question


class RagError(Exception):
    """Embedding failed (no key, rate limit...). The agent gets a friendly message instead of crashing."""


# ---------- 1. Chunk ----------

def _clean_lines(page_text: str) -> List[str]:
    lines = []
    for line in page_text.splitlines():
        line = line.strip()
        # Skip slide-template junk and page numbers, like "XP" or "12"
        if len(line) <= 2 or line.isdigit():
            continue
        lines.append(line)
    return lines


def chunk_text(raw_text: str) -> List[dict]:
    """
    Cuts a document into pieces of about CHUNK_CHARS characters, remembering the page of each piece.
    PDFs uploaded after Week 4 have a page-break character (\\f) between pages; older ones don't,
    so their pieces have page None.
    """
    pages = raw_text.split("\f") if "\f" in raw_text else [raw_text]
    has_pages = len(pages) > 1
    chunks = []

    for page_number, page_text in enumerate(pages, start=1):
        current: List[str] = []
        for line in _clean_lines(page_text):
            current.append(line)
            if sum(len(l) for l in current) >= CHUNK_CHARS:
                chunks.append({"page": page_number if has_pages else None, "text": "\n".join(current)})
                current = current[-OVERLAP_LINES:]
        # Whatever is left on this page becomes its own small piece (unless it's only the overlap)
        if current and (not chunks or "\n".join(current) not in chunks[-1]["text"]):
            chunks.append({"page": page_number if has_pages else None, "text": "\n".join(current)})

    return chunks


# ---------- 2. Embed ----------

def embed_texts(texts: List[str], task_type: str, waits: int = 3) -> List[List[float]]:
    """
    Turns texts into lists of numbers ("embeddings") with Gemini's free embedding model.
    task_type: "RETRIEVAL_DOCUMENT" for note pieces, "RETRIEVAL_QUERY" for questions.
    waits: how many times to wait and retry if we hit the per-minute limit.
    """
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise RagError("GEMINI_API_KEY is not set, so I can't search your notes.")
    headers = {"x-goog-api-key": api_key, "Content-Type": "application/json"}

    vectors = []
    for start in range(0, len(texts), BATCH_SIZE):
        batch = texts[start:start + BATCH_SIZE]
        payload = {"requests": [
            {"model": f"models/{EMBED_MODEL}", "content": {"parts": [{"text": t}]},
             "taskType": task_type, "outputDimensionality": DIMENSIONS}
            for t in batch
        ]}
        vectors += _embed_batch(payload, headers, waits)
    return vectors


RATE_LIMIT_WAIT_SECONDS = 20  # the free tier allows about 100 pieces a minute, so big PDFs may need to wait


def _embed_batch(payload: dict, headers: dict, waits: int) -> List[List[float]]:
    """Sends one batch. If we hit the per-minute limit (429), wait a bit and try again."""
    for attempt in range(waits + 1):
        try:
            response = requests.post(EMBED_URL, json=payload, headers=headers, timeout=ai_service.TIMEOUT_SECONDS)
        except (requests.Timeout, requests.ConnectionError):
            raise RagError("Couldn't reach the notes search. Check your internet and try again.")
        if response.status_code == 200:
            return [e["values"] for e in response.json()["embeddings"]]
        if response.status_code == 429 and attempt < waits:
            print(f"[RAG] Embedding limit reached, waiting {RATE_LIMIT_WAIT_SECONDS}s...")
            time.sleep(RATE_LIMIT_WAIT_SECONDS)
            continue
        print(f"[RAG] Gemini embeddings returned {response.status_code}: {response.text[:200]}")
        raise RagError("The notes search is busy right now. Please try again in a minute.")
    raise RagError("The notes search is busy right now. Please try again in a minute.")


# ---------- 3. Store ----------

def index_task(task_id: int, waits: int = 3) -> int:
    """Chunks and embeds one document's text, replacing any old pieces. Returns how many pieces."""
    db = SessionLocal()
    try:
        task = db.query(models.TaskRecord).filter(models.TaskRecord.id == task_id).first()
        if not task or not task.raw_text:
            return 0
        chunks = chunk_text(task.raw_text)
        if not chunks:
            return 0
        # Adding the title and course helps the search: "my HTML notes" matches the HTML lecture
        vectors = embed_texts(
            [f"{task.title} ({task.course_name})\n{c['text']}" for c in chunks], "RETRIEVAL_DOCUMENT", waits
        )
        db.query(models.NoteChunk).filter(models.NoteChunk.task_id == task_id).delete()
        for index, (chunk, vector) in enumerate(zip(chunks, vectors)):
            db.add(models.NoteChunk(task_id=task_id, chunk_index=index, page=chunk["page"],
                                    text=chunk["text"], embedding=vector))
        db.commit()
        print(f"[RAG] Indexed '{task.title}': {len(chunks)} pieces")
        return len(chunks)
    finally:
        db.close()


def ensure_indexed() -> None:
    """Indexes any document that has text but no pieces yet (e.g. PDFs uploaded before Week 4)."""
    db = SessionLocal()
    try:
        indexed = {row[0] for row in db.query(models.NoteChunk.task_id).distinct()}
        missing = [t.id for t in db.query(models.TaskRecord.id, models.TaskRecord.raw_text)
                   if t.raw_text and t.id not in indexed]
    finally:
        db.close()
    for task_id in missing:
        try:
            index_task(task_id, waits=0)  # never make a question wait for old PDFs
        except RagError as e:
            # Search what's already indexed instead of failing; the rest gets indexed next time
            print(f"[RAG] Stopped indexing for now: {e}")
            return


def delete_task_chunks(task_id: int) -> None:
    db = SessionLocal()
    try:
        db.query(models.NoteChunk).filter(models.NoteChunk.task_id == task_id).delete()
        db.commit()
    finally:
        db.close()


# ---------- 4. Search ----------

def _cosine_similarity(a: List[float], b: List[float]) -> float:
    """How close two meanings are: 1.0 = same direction, 0 = unrelated."""
    dot = sum(x * y for x, y in zip(a, b))
    return dot / (math.sqrt(sum(x * x for x in a)) * math.sqrt(sum(y * y for y in b)))


def search_notes(query: str, course: Optional[str] = None) -> dict:
    """Agent tool: finds the pieces of the student's notes that best match the question."""
    ensure_indexed()
    try:
        query_vector = embed_texts([query], "RETRIEVAL_QUERY", waits=1)[0]
    except RagError as e:
        return {"error": str(e)}

    db = SessionLocal()
    try:
        rows = db.query(models.NoteChunk, models.TaskRecord).join(
            models.TaskRecord, models.NoteChunk.task_id == models.TaskRecord.id
        )
        if course:
            rows = rows.filter(models.TaskRecord.course_name.ilike(f"%{course}%"))
        scored = [(_cosine_similarity(query_vector, chunk.embedding), chunk, task) for chunk, task in rows.all()]
    finally:
        db.close()

    scored.sort(key=lambda item: item[0], reverse=True)
    results, seen_texts = [], set()
    for score, chunk, task in scored:
        if score < MIN_SIMILARITY or len(results) == TOP_K:
            break
        if chunk.text in seen_texts:
            continue  # the same PDF uploaded twice: don't waste a slot on the same text
        seen_texts.add(chunk.text)
        results.append({
            "source": task.title,
            "course": task.course_name,
            "page": chunk.page,
            "similarity": round(score, 2),
            "text": chunk.text,
        })
    if not results:
        return {"results": [], "note": "Nothing in the student's notes matches this question."}
    return {"results": results}
