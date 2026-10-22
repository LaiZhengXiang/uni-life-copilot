import os
import pymupdf  # Replaced fitz with modern pymupdf
import json
import requests
from fastapi import HTTPException
from pydantic import BaseModel, Field
from datetime import datetime, timedelta
from dotenv import load_dotenv
from typing import List, Optional

# Load environment variables from .env file
load_dotenv()

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
    text = ""
    # Open the PDF from memory using the new pymupdf import
    with pymupdf.open(stream=pdf_bytes, filetype="pdf") as doc:
        for page in doc:
            text += page.get_text() + "\n"
    return text

def parse_assignment_with_gemini(pdf_bytes: bytes) -> List[ParsedDocument]:
    """
    Extracts text from the PDF and uses Gemini to parse it into structured data via direct REST API call.
    Gracefully handles API errors and injects mock data on 503s.
    """
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
        f"Text to analyze:\n\n{pdf_text}"
    )

    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="GEMINI_API_KEY environment variable is not set.")

    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key={api_key}"

    payload = {
        "contents": [
            {
                "parts": [
                    {"text": prompt}
                ]
            }
        ],
        "generationConfig": {
            "responseMimeType": "application/json",
            "responseSchema": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "document_type": {"type": "string", "enum": ["Assignment", "Lecture Note"]},
                        "course_name": {"type": "string"},
                        "title": {"type": "string"},
                        "deadline": {"type": "string", "description": "ISO 8601 formatted datetime string"},
                        "details": {"type": "string"},
                        "task_type": {"type": "string"},
                        "estimated_hours": {"type": "integer"},
                        "key_concepts": {
                            "type": "array",
                            "items": {"type": "string"}
                        },
                        "milestones": {
                            "type": "array",
                            "items": {"type": "string"}
                        },
                        "urgency_score": {"type": "integer"}
                    },
                    "required": ["document_type", "course_name", "title", "details", "key_concepts", "milestones", "urgency_score"]
                }
            },
            "temperature": 0.1
        }
    }

    headers = {
        "Content-Type": "application/json"
    }

    response = requests.post(url, json=payload, headers=headers)
    
    # 1. Handle 503 High Demand Error with Mock Data
    if response.status_code == 503:
        print("Gemini API returned 503. Injecting fallback mock data for UI testing.")
        return [
            ParsedDocument(
                document_type="Assignment",
                course_name="System Architecture 401",
                title="Mock Data: API Integration Assignment",
                deadline=datetime.now() + timedelta(days=2),
                details="This is mock data dynamically injected because the Gemini API returned a 503 High Demand error. The actual PDF was not parsed.",
                task_type="Coding",
                estimated_hours=6,
                key_concepts=["Error Handling", "REST APIs", "Graceful Degradation"],
                milestones=[
                    "Implement a fallback mock response for 503 errors.",
                    "Verify the frontend UI renders the mock data correctly.",
                    "Test again when the Gemini API is back online."
                ],
                urgency_score=9,
                raw_text=pdf_text
            )
        ]
        
    # 2. Handle any other non-200 Errors gracefully using FastAPI HTTPException
    if response.status_code != 200:
        raise HTTPException(
            status_code=502, 
            detail=f"Gemini API upstream error ({response.status_code}): {response.text}"
        )

    try:
        data = response.json()
        response_text = data['candidates'][0]['content']['parts'][0]['text']
        parsed_json = json.loads(response_text)
    except (KeyError, IndexError, json.JSONDecodeError) as e:
        raise HTTPException(
            status_code=502, 
            detail=f"Failed to parse response from Gemini: {str(e)}"
        )

    # Return a list of Pydantic ParsedDocument objects, attaching the raw_text to each
    docs = []
    for item in parsed_json:
        doc = ParsedDocument(**item)
        doc.raw_text = pdf_text
        docs.append(doc)
        
    return docs

def chat_with_document(raw_text: str, question: str) -> str:
    """Sends the raw document text and a user question to Gemini."""
    prompt = (
        f"Based on the following document text, please answer the user's question.\n\n"
        f"Document:\n{raw_text}\n\n"
        f"Question:\n{question}"
    )

    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="GEMINI_API_KEY is not set.")

    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key={api_key}"

    payload = {
        "contents": [{"parts": [{"text": prompt}]}]
    }
    
    headers = {"Content-Type": "application/json"}
    
    response = requests.post(url, json=payload, headers=headers)
    
    if response.status_code == 503:
        return "The AI is currently experiencing high demand. This is a mock answer: The document discusses key foundational topics related to your question, but I cannot process the exact answer right now."
        
    if response.status_code != 200:
        raise HTTPException(status_code=502, detail=f"Gemini API Error: {response.text}")
        
    try:
        data = response.json()
        return data['candidates'][0]['content']['parts'][0]['text']
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Failed to parse AI response: {str(e)}")
