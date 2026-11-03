# Uni-Life Copilot

> 🚧 **Work in progress.** Core features work; more are on the way.

A cozy AI study buddy for university students. Drop in an assignment brief or lecture notes (PDF) and **Ollie**, the study buddy who lives in your room, reads them, turns assignments into tasks with deadlines, sorts everything into subject folders, summarises chapters and answers questions from your own notes. It also knows your timetable and your free time. It all lives in a painted study room that follows the time of day.

## Features

**Study agent (Ollie)**
- **Tools + agent loop**: Ollie can use several tools in a row (check deadlines, add or edit a task, search your notes, read your subjects and timetable, find free time) before answering.
- **Human in the loop**: Ollie never saves on its own; new tasks, changes and notes show a Save card first.
- **Answers from your notes (RAG)**: PDFs are cut into pieces, embedded with Gemini, and searched, so answers cite which notes and pages they came from.
- **Memory**: remembers the chat and your study habits (for example "I don't study after 11pm"), which you can see and delete.
- **Chat panel**: Ollie sits in the room beside the chat; long answers open as a full note.

**Subjects and notes (the bookshelf)**
- **One folder per subject**: PDFs and tasks go into the folder of their course code (like BMCS1113) by themselves; you can move them.
- **Chapter summaries**: the big idea, key points, key terms, an example and likely exam questions, with page numbers. Save one to your notes in one click.
- **Your own notes**: write as many notes as you like in each subject; they save as you type.

**Timetable and free time (the calendar)**
- **Weekly grid**: your classes by day, with the free gaps between them and this week's deadlines.
- **Upload your timetable**: a picture or PDF; the AI reads the classes and you check them before saving. Or add classes by hand.

**Tasks**
- **PDF parser**: an AI model turns an assignment brief into a task with a deadline, steps and key concepts.
- **Progress**: tick off steps, mark tasks done, edit them.
- **Reminders**: a due-soon bell, and a calendar file (.ics) for Google Calendar or your phone with 1-day reminders.

**Cozy room**
- A painted room background that changes with the real time (morning, afternoon, evening, night), with liquid-glass panels.
- **Click the room**: the clock (today's plan and next class), the calendar (timetable), the bookshelf (subjects), the lamp and the drawer. Every one also has a normal button, for phones and keyboards.
- **Chill dock**: lo-fi radio (any YouTube stream), rain / fireplace / wind sounds made with the Web Audio API, a 25/5 focus timer, and quick notes.

**Reliable AI**: tries Groq first, then a second Groq model, then Google Gemini, so a busy AI service doesn't stop the app.

## Built with

- **Backend:** Python, FastAPI, SQLAlchemy (SQLite), PyMuPDF, Groq API, Google Gemini API
- **Frontend:** HTML, CSS, vanilla JavaScript (Web Audio API)

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
- [x] Subject folders, chapter summaries and your own notes
- [x] Timetable and free time
- [ ] Exam dates, past-year papers and a revision plan
- [ ] Ultra-wide room pictures, so the room fits wide screens
- [ ] Deploy the backend so it runs without a local setup
- [ ] Daily reminder message (for example on Telegram)

## Author

**Lai Zheng Xiang** · [GitHub](https://github.com/LaiZhengXiang)
