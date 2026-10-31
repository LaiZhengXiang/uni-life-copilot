import base64
import os
import time
import pymupdf  # Replaced fitz with modern pymupdf
import json
import requests
from fastapi import HTTPException
from pydantic import BaseModel, Field
from datetime import datetime
from dotenv import load_dotenv
from typing import Callable, List, Optional

# Load environment variables from .env file
load_dotenv()

# AI providers, tried in this order. Groq's free limit (8,000 tokens a minute) is counted
# per model, so a second Groq model is a fresh quota with the same key.
# Check which models your key can use: GET https://api.groq.com/openai/v1/models
GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"
GROQ_MODELS = [
    # (model, extra settings) - both settings keep the model's "thinking" short and out of the answer
    ("openai/gpt-oss-120b", {"reasoning_effort": "low"}),
    ("qwen/qwen3.8-27b", {"reasoning_format": "hidden"}),
]
GEMINI_MODEL = "gemini-3.5-flash"

# Development switch: put USE_FAKE_AI=true in backend/.env to get instant sample answers
# with zero API calls (no rate limits while you work on the UI). Restart the backend after changing it.
USE_FAKE_AI = os.environ.get("USE_FAKE_AI", "").lower() == "true"

# Errors that usually mean "busy, try again soon", so they are worth a retry.
# 429 is not here: it means our per-minute quota is used up, so waiting 2 seconds won't help.
# We skip straight to the next model instead.
RETRYABLE_STATUS = {500, 502, 503, 504}
ATTEMPTS_PER_PROVIDER = 2   # first try + one retry
BACKOFF_SECONDS = 2         # wait before the retry
TIMEOUT_SECONDS = 60

BUSY_MESSAGE = "Copilot is busy right now. Please try again in a minute."


class ProviderError(Exception):
    """One AI provider failed (busy, timed out, bad key or unreadable answer)."""

class ParsedDocument(BaseModel):
    model_config = {"from_attributes": True} # Enable SQLAlchemy ORM mapping
    id: Optional[int] = Field(default=None, description="Database ID")
    document_type: str = Field(description="Must be either 'Assignment' or 'Lecture Note'")
    course_name: str
    title: str = Field(description="Assignment title or Lecture topic")
    deadline: Optional[datetime] = Field(default=None, description="Deadline if applicable")
    details: str
    task_type: Optional[str] = Field(default=None, description="Type of task, e.g., 'Presentation', 'Coding', 'Report', 'Essay', 'Reading'")
    estimated_hours: Optional[int] = Field(default=None, description="Estimated number of hours required")
    key_concepts: List[str] = Field(description="Array of 3-5 crucial keywords or concepts to study/review")
    milestones: List[str] = Field(description="Array of 3 actionable steps if it's an assignment, empty if lecture note")
    urgency_score: int = Field(description="Integer from 1-10 based on deadline proximity and estimated hours")
    raw_text: Optional[str] = Field(default=None, description="Full extracted text of the document")

class ChatRequest(BaseModel):
    task_id: int
    question: str

class ChatResponse(BaseModel):
    answer: str

def extract_text_from_pdf(pdf_bytes: bytes) -> str:
    """Extracts text from a PDF file provided as bytes."""
    # Open the PDF from memory using the new pymupdf import.
    # Pages are joined with "\f" (a page-break character) so the notes search can tell you the page number.
    with pymupdf.open(stream=pdf_bytes, filetype="pdf") as doc:
        return "\f".join(page.get_text() for page in doc)



# ---------- Talking to the AI providers ----------

def _post_with_retry(name: str, url: str, payload: dict, headers: dict) -> dict:
    """POSTs to one provider. Retries once if it is busy or slow, then gives up with ProviderError."""
    for attempt in range(1, ATTEMPTS_PER_PROVIDER + 1):
        try:
            response = requests.post(url, json=payload, headers=headers, timeout=TIMEOUT_SECONDS)
        except (requests.Timeout, requests.ConnectionError):
            reason = "timed out or could not connect"
        else:
            if response.status_code == 200:
                return response.json()
            if response.status_code == 429:
                raise ProviderError(f"{name} rate limit reached (429), trying the next model")
            if response.status_code not in RETRYABLE_STATUS:
                # e.g. 401 bad key or 413 document too long: retrying won't help
                raise ProviderError(f"{name} returned {response.status_code}: {response.text[:200]}")
            reason = f"returned {response.status_code}"

        print(f"[AI] {name} {reason} (attempt {attempt}/{ATTEMPTS_PER_PROVIDER})")
        if attempt < ATTEMPTS_PER_PROVIDER:
            time.sleep(BACKOFF_SECONDS * attempt)

    raise ProviderError(f"{name} is busy")


def _ask_groq(prompt: str, want_json: bool, model: str, extra: dict) -> str:
    api_key = os.environ.get("GROQ_API_KEY")
    if not api_key:
        raise ProviderError("GROQ_API_KEY is not set")

    payload = {
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.1,
        **extra,
    }
    if want_json:
        payload["response_format"] = {"type": "json_object"}

    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    data = _post_with_retry(f"Groq {model}", GROQ_URL, payload, headers)
    try:
        return data["choices"][0]["message"]["content"]
    except (KeyError, IndexError) as e:
        raise ProviderError(f"Groq answer had an unexpected shape: {e}")


def _ask_gemini(prompt: str, json_schema: Optional[dict], image: Optional[tuple] = None) -> str:
    """image: (picture bytes, type like "image/png"), for questions about a picture."""
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise ProviderError("GEMINI_API_KEY is not set")

    parts = [{"text": prompt}]
    if image:
        parts.insert(0, {"inline_data": {"mime_type": image[1], "data": base64.b64encode(image[0]).decode()}})
    payload = {"contents": [{"parts": parts}]}
    if json_schema:
        payload["generationConfig"] = {
            "responseMimeType": "application/json",
            "responseSchema": json_schema,
            "temperature": 0.1,
        }

    # The key goes in a header, not the URL, so it never shows up in error messages or logs
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent"
    headers = {"x-goog-api-key": api_key, "Content-Type": "application/json"}
    data = _post_with_retry("Gemini", url, payload, headers)
    try:
        return data["candidates"][0]["content"]["parts"][0]["text"]
    except (KeyError, IndexError) as e:
        raise ProviderError(f"Gemini answer had an unexpected shape: {e}")


def _ask_ai(prompt: str, read_answer: Callable[[str], object], gemini_schema: Optional[dict] = None):
    """
    Asks each Groq model, then Gemini. read_answer turns the raw text into what we need;
    if it fails (for example broken JSON), we also move on to the next provider.
    If every provider fails, the user gets a friendly "busy" message and nothing is saved.
    """
    want_json = gemini_schema is not None
    if USE_FAKE_AI:
        print("[AI] Fake AI mode: no API call made")
        return read_answer(FAKE_DOCUMENTS_JSON if want_json else FAKE_CHAT_ANSWER)

    providers = [
        # model=model, extra=extra freezes this loop's values inside each lambda
        (f"Groq {model}", lambda model=model, extra=extra: _ask_groq(prompt, want_json, model, extra))
        for model, extra in GROQ_MODELS
    ]
    providers.append(("Gemini", lambda: _ask_gemini(prompt, gemini_schema)))

    for name, ask in providers:
        try:
            result = read_answer(ask())
            print(f"[AI] Answered by {name}")
            return result
        except ProviderError as e:
            print(f"[AI] {name} failed: {e}")
        except (ValueError, TypeError) as e:  # json.JSONDecodeError and pydantic errors are ValueErrors
            print(f"[AI] {name} gave an answer we could not read: {e}")

    raise HTTPException(status_code=503, detail=BUSY_MESSAGE)


def _ask_ai_about_image(prompt: str, image: tuple, read_answer: Callable[[str], object],
                        gemini_schema: Optional[dict] = None):
    """Like _ask_ai, for a picture. Only Gemini can see pictures here, so there is no fallback."""
    if USE_FAKE_AI:
        raise HTTPException(status_code=400, detail="Fake AI mode can't read pictures. Add your classes by hand.")
    try:
        result = read_answer(_ask_gemini(prompt, gemini_schema, image))
        print("[AI] Picture read by Gemini")
        return result
    except ProviderError as e:
        print(f"[AI] Gemini failed on a picture: {e}")
    except (ValueError, TypeError) as e:
        print(f"[AI] Gemini gave a picture answer we could not read: {e}")
    raise HTTPException(status_code=503, detail=BUSY_MESSAGE)


# Sample answers for Fake AI mode. The [FAKE AI] label makes them easy to spot and delete.
FAKE_DOCUMENTS_JSON = json.dumps({"documents": [{
    "document_type": "Assignment",
    "course_name": "[FAKE AI] Sample Course",
    "title": "[FAKE AI] Sample assignment - delete me",
    "deadline": None,
    "details": "Fake AI mode is on (USE_FAKE_AI=true in backend/.env), so no AI read this PDF.",
    "task_type": "Report",
    "estimated_hours": 3,
    "key_concepts": ["Fake AI mode", "UI testing"],
    "milestones": ["Check the card looks right", "Turn Fake AI mode off", "Upload again for a real answer"],
    "urgency_score": 5,
}]})
FAKE_CHAT_ANSWER = "**[FAKE AI]** This is a sample answer. Fake AI mode is on, so no AI read your question."


# ---------- What the app uses ----------

DOCUMENT_FIELDS = {
    "document_type": {"type": "string", "enum": ["Assignment", "Lecture Note"]},
    "course_name": {"type": "string"},
    "title": {"type": "string"},
    "deadline": {"type": "string", "description": "ISO 8601 formatted datetime string"},
    "details": {"type": "string"},
    "task_type": {"type": "string"},
    "estimated_hours": {"type": "integer"},
    "key_concepts": {"type": "array", "items": {"type": "string"}},
    "milestones": {"type": "array", "items": {"type": "string"}},
    "urgency_score": {"type": "integer"},
}
REQUIRED_FIELDS = ["document_type", "course_name", "title", "details", "key_concepts", "milestones", "urgency_score"]

GEMINI_DOCUMENTS_SCHEMA = {
    "type": "array",
    "items": {"type": "object", "properties": DOCUMENT_FIELDS, "required": REQUIRED_FIELDS},
}


def parse_assignment(pdf_bytes: bytes) -> List[ParsedDocument]:
    """Extracts text from the PDF and asks the AI to turn it into structured tasks."""
    pdf_text = extract_text_from_pdf(pdf_bytes)

    if not pdf_text.strip():
        raise HTTPException(status_code=400, detail="No text could be extracted from the PDF.")

    prompt = (
        "You are an expert academic assistant. "
        "Read the following university document and extract structured information. "
        "1. Determine if the document is an 'Assignment' or a 'Lecture Note'.\n"
        "2. Extract course name, title, and a brief summary of details.\n"
        "3. If it's an Assignment, extract the deadline, task type, estimate hours, and break it into 3 actionable milestones.\n"
        "4. If it's a Lecture Note, leave milestones empty and focus on summarizing key concepts.\n"
        "5. Provide an urgency_score from 1-10 based on the deadline and estimated hours.\n"
        "6. Provide 3-5 crucial key concepts to study.\n"
        "If there are multiple assignments or distinct topics, return them as a list. Otherwise, return a list with one item.\n"
        "Only give a deadline if a due date is actually written in the document. Never guess one.\n"
        "If deadline, task_type or estimated_hours do not apply, use null. Always give urgency_score as a number.\n"
        'Reply with JSON only, shaped like {"documents": [ ... ]}, where each item has these fields '
        f"(required: {', '.join(REQUIRED_FIELDS)}):\n{json.dumps(DOCUMENT_FIELDS)}\n\n"
        f"Text to analyze:\n\n{pdf_text}"
    )

    def read_documents(answer: str) -> List[ParsedDocument]:
        parsed = json.loads(answer)
        if isinstance(parsed, dict):  # Groq wraps the list: {"documents": [...]}
            parsed = parsed.get("documents", [])
        if not isinstance(parsed, list) or not parsed:
            raise ValueError("no documents in the answer")

        docs = []
        for item in parsed:
            # Some models write "" instead of null for "no deadline"; treat both as empty
            for field in ("deadline", "task_type", "estimated_hours"):
                if item.get(field) == "":
                    item[field] = None
            # A lecture note is something to study, not something to hand in,
            # so drop any deadline or task the AI invented for it
            if item.get("document_type") == "Lecture Note":
                item.update(deadline=None, task_type=None, estimated_hours=None, milestones=[])
            if item.get("urgency_score") is None:
                item["urgency_score"] = 1
            doc = ParsedDocument(**item)
            doc.raw_text = pdf_text
            docs.append(doc)
        return docs

    return _ask_ai(prompt, read_documents, gemini_schema=GEMINI_DOCUMENTS_SCHEMA)


def chat_with_document(raw_text: str, question: str) -> str:
    """Sends the raw document text and a user question to the AI."""
    prompt = (
        f"Based on the following document text, please answer the user's question.\n\n"
        f"Document:\n{raw_text}\n\n"
        f"Question:\n{question}"
    )

    def read_text(answer: str) -> str:
        if not answer.strip():
            raise ValueError("empty answer")
        return answer

    return _ask_ai(prompt, read_text)
