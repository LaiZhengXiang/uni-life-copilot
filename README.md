# Uni-Life Copilot

> 🚧 **Work in progress.** Core features work; more are on the way.

An AI-powered planner for university students. Drop in an assignment brief (PDF) and Uni-Life Copilot reads it, pulls out the tasks and deadlines, and lays them out on a task board. You can also chat with the document to ask questions about the assignment.

## Features

- **PDF assignment parser**: upload a PDF; the text is extracted with PyMuPDF and Google Gemini turns it into structured tasks with deadlines.
- **Task board**: extracted tasks are saved in a local SQLite database and shown as cards; delete the ones you've finished.
- **Chat with your document**: ask questions about an uploaded assignment and get answers based on its content.

## Built with

- **Backend:** Python, FastAPI, SQLAlchemy (SQLite), PyMuPDF, Google Gemini API
- **Frontend:** HTML, CSS, vanilla JavaScript

## Run it locally

1. **Backend**

   ```bash
   cd backend
   pip install -r requirements.txt
   ```

   Copy `.env.example` to `.env` and put in your own Gemini API key (get one free from Google AI Studio):

   ```
   GEMINI_API_KEY=your-gemini-api-key-here
   ```

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
