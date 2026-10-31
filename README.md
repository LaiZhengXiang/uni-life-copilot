# Uni-Life Copilot

> 🚧 **Work in progress.** Core features work; more are on the way.

A cozy AI study buddy for university students. Drop in an assignment brief or lecture notes (PDF) and **Ollie**, a nerdy cat with big glasses, reads them, turns assignments into tasks with deadlines, and answers questions from your own notes. It all lives in a painted study room that follows the time of day.

## Features

**Study agent (Ollie)**
- **Tools + agent loop**: Ollie can use several tools in a row (check deadlines, add or edit a task, search your notes) before answering.
- **Human in the loop**: Ollie never saves on its own; new tasks and changes show a Save card first.
- **Answers from your notes (RAG)**: PDFs are cut into pieces, embedded with Gemini, and searched, so answers cite which notes they came from.
- **Memory**: remembers the chat and your study habits (for example "I don't study after 11pm"), which you can see and delete.
- **Pet or Chat mode**: Ollie answers in a speech bubble (with "View note" for long answers) or in a normal chat.

**Tasks**
- **PDF parser**: an AI model turns an assignment brief into a task with a deadline, steps and key concepts.
- **Progress**: tick off steps, mark tasks done, edit them; lecture notes go in a separate notes drawer.
- **Reminders**: a due-soon bell, and a calendar file (.ics) for Google Calendar or your phone with 1-day reminders.

**Cozy room**
- A painted room background that changes with the real time (morning, afternoon, evening, night), with liquid-glass panels.
- **Room mode**: click the clock, calendar, lamp or drawer in the picture.
- **Chill dock**: lo-fi radio (any YouTube stream), rain / fireplace / wind sounds made with the Web Audio API, a 25/5 focus timer, and quick notes.

**Reliable AI**: tries Groq first, then a second Groq model, then Google Gemini, so a busy AI service doesn't stop the app.

## Built with

- **Backend:** Python, FastAPI, SQLAlchemy (SQLite), PyMuPDF, Groq API, Google Gemini API
- **Frontend:** HTML, CSS, vanilla JavaScript (SVG mascot, Web Audio API)

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

   Serve the folder with any static server, then open http://127.0.0.1:5600:

   ```bash
   cd frontend
   python -m http.server 5600
   ```

## Roadmap

- [x] Calendar file with deadline reminders
- [x] Agent loop, memory and answers from your notes (RAG)
- [ ] Ultra-wide room pictures, so the room fits wide screens
- [ ] Deploy the backend so it runs without a local setup
- [ ] Daily reminder message (for example on Telegram)

## Author

**Lai Zheng Xiang** · [GitHub](https://github.com/LaiZhengXiang)
