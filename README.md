# Uni-Life Copilot

> 🚧 **Work in progress.** Core features work; more are on the way.

An AI-powered planner for university students. Drop in an assignment brief (PDF) and Uni-Life Copilot reads it, pulls out the tasks and deadlines, and lays them out on a task board. You can also chat with the document to ask questions about the assignment.

## Features

- **PDF assignment parser**: upload a PDF; the text is extracted with PyMuPDF and an AI model turns it into structured tasks with deadlines.
- **Task board**: extracted tasks are saved in a local SQLite database and shown as cards; delete the ones you've finished.
- **Chat with your document**: ask questions about an uploaded assignment and get answers based on its content.
- **Ask Copilot (AI agent)**: ask "What's due this week?" and the agent uses a `get_deadlines` tool to look up your real tasks before answering.
- **AI backups**: tries Groq first, then a second Groq model, then Google Gemini, so a busy AI service doesn't stop the app.

## Built with

- **Backend:** Python, FastAPI, SQLAlchemy (SQLite), PyMuPDF, Groq API, Google Gemini API
- **Frontend:** HTML, CSS, vanilla JavaScript

## Run it locally

1. **Backend**

   ```bash
   cd backend
   pip install -r requirements.txt
   ```

   Copy `.env.example` to `.env` and put in your own API keys (both have a free tier: Groq from console.groq.com, Gemini from Google AI Studio):

   ```
   GROQ_API_KEY=your-groq-api-key-here
   GEMINI_API_KEY=your-gemini-api-key-here
   ```

   Set `USE_FAKE_AI=true` to try the app with sample answers and no API calls.

   Start the API:

   ```bash
   uvicorn main:app --reload
   ```

   It runs at `http://127.0.0.1:8000` (interactive docs at `/docs`).

2. **Frontend**

   Open `frontend/index.html` in your browser (or serve the folder with any static server, e.g. VS Code Live Server).

## Roadmap

- [ ] Calendar view of upcoming deadlines
- [ ] Reminders before due dates
- [ ] Deploy the backend so it runs without a local setup

## Author

**Lai Zheng Xiang** · [GitHub](https://github.com/LaiZhengXiang)
