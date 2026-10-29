document.addEventListener('DOMContentLoaded', () => {
    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('file-input');
    const browseBtn = document.getElementById('browse-btn');
    const cardsContainer = document.querySelector('.cards-layout');
    
    // UI Elements for loading state
    const dropZoneTitle = dropZone.querySelector('h3');
    const dropZoneIcon = dropZone.querySelector('.drop-icon i');
    const badge = document.querySelector('.badge');

    // Chat Modal Elements
    const chatModal = document.getElementById('chat-modal');
    const closeChatBtn = document.getElementById('close-chat');
    const chatMessages = document.getElementById('chat-messages');
    const chatInput = document.getElementById('chat-input');
    const sendChatBtn = document.getElementById('send-chat');
    let currentChatTaskId = null;

    // Toast Notification System
    const toast = document.createElement('div');
    toast.className = 'toast';
    document.body.appendChild(toast);

    let toastTimer = null;
    function showToast(message, seconds = 3) {
        // The <span> keeps the message as one block, so bold words don't break the line
        // (the little Ollie face in front comes from the CSS)
        toast.innerHTML = `<span>${message}</span>`;
        toast.classList.add('show');
        clearTimeout(toastTimer);  // a new toast gets its full time, even if an old one was still showing
        toastTimer = setTimeout(() => toast.classList.remove('show'), seconds * 1000);
    }

    const API = 'http://127.0.0.1:8000';
    let tasksById = {};  // the tasks on the board, so buttons can look up their task

    // Makes any text safe to put inside HTML (so AI text can't turn into tags)
    function escapeHtml(text) {
        return String(text ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    // Saves changes to a task (only the fields you pass), then refreshes the board
    async function updateTask(taskId, changes) {
        const response = await fetch(`${API}/api/tasks/${taskId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(changes)
        });
        if (!response.ok) throw new Error('Could not save the change.');
        await loadExistingTasks();
    }

    // Calendar download: the file itself comes from the backend
    document.getElementById('calendar-link').addEventListener('click', () => {
        showToast('Downloaded! Open the file to add your deadlines to Google Calendar or your phone.');
    });

    // Bell: what's due in the next 3 days
    const bellBtn = document.getElementById('bell-btn');
    const bellCount = document.getElementById('bell-count');
    const bellDropdown = document.getElementById('bell-dropdown');

    // Counts calendar days, so something due tomorrow night says "due tomorrow"
    function daysLeftText(deadline) {
        const due = new Date(deadline);
        const now = new Date();
        if (due < now) return 'overdue';
        const midnight = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
        const days = Math.round((midnight(due) - midnight(now)) / 86400000);
        if (days === 0) return 'due today';
        return days === 1 ? 'due tomorrow' : `${days} days left`;
    }

    function updateBell(tasks) {
        const now = new Date();
        const soon = new Date(now.getTime() + 3 * 86400000);
        const dueSoon = tasks.filter(t => !t.is_done && t.deadline
            && new Date(t.deadline) >= now && new Date(t.deadline) <= soon);

        bellCount.hidden = dueSoon.length === 0;
        bellCount.textContent = dueSoon.length;
        bellDropdown.innerHTML = '<h4>Due in the next 3 days</h4>' + (dueSoon.length
            ? dueSoon.map(t => `
                <div class="bell-item">
                    <strong>${escapeHtml(t.title)}</strong>
                    <span>${escapeHtml(t.course_name)} · ${daysLeftText(t.deadline)}</span>
                </div>`).join('')
            : '<p>Nothing due soon. Nice!</p>');
        updateGreeting(tasks, dueSoon);
    }

    // Small helpers for things the browser remembers (wrapped, because private mode can block storage)
    function readSetting(key, fallback) {
        try { return localStorage.getItem(key) || fallback; } catch (e) { return fallback; }
    }
    function saveSetting(key, value) {
        try { localStorage.setItem(key, value); } catch (e) {}
    }

    // ---------- The room: follows the time of day ----------
    const timeMode = document.getElementById('time-mode');
    const roomClock = document.getElementById('room-clock');

    function periodFor(hour) {
        if (hour >= 6 && hour < 11) return 'morning';
        if (hour >= 11 && hour < 17) return 'afternoon';
        if (hour >= 17 && hour < 20) return 'evening';
        return 'night';
    }

    function applyTimeOfDay() {
        const now = new Date();
        const mode = timeMode.value;
        document.body.dataset.time = mode === 'auto' ? periodFor(now.getHours()) : mode;
        roomClock.textContent = now.toLocaleTimeString('en-MY', { hour: 'numeric', minute: '2-digit' });
    }

    // If there's no night picture yet, the CSS darkens the sunset one instead
    const nightArt = new Image();
    nightArt.onload = () => { document.body.dataset.nightArt = 'ok'; };
    nightArt.onerror = () => { document.body.dataset.nightArt = 'missing'; };
    nightArt.src = 'assets/room/room-night.webp';

    timeMode.value = readSetting('roomTime', 'auto');
    timeMode.addEventListener('change', () => {
        saveSetting('roomTime', timeMode.value);
        applyTimeOfDay();
    });
    applyTimeOfDay();
    setInterval(applyTimeOfDay, 30 * 1000);

    // ---------- Ollie the cat ----------
    const ollie = document.getElementById('ollie');
    const ollieBtn = document.getElementById('ollie-btn');
    const ollieSays = document.getElementById('ollie-says');
    const speechQuestion = document.getElementById('speech-question');
    const speechExtras = document.getElementById('speech-extras');
    const ollieCorner = document.getElementById('ollie-corner');
    let ollieTimer = null;

    // A second Ollie sits on the desk in room mode: a copy of the same drawing
    const roomOllie = document.getElementById('room-ollie');
    roomOllie.innerHTML = ollie.innerHTML;
    const allOllies = [ollie, roomOllie];

    // state: idle, thinking, explain, happy, oops or sleepy. With seconds, it goes back to idle afterwards.
    // Both Ollies always show the same mood.
    function setOllie(state, seconds) {
        clearTimeout(ollieTimer);
        allOllies.forEach(o => { o.dataset.state = state; });
        if (seconds) ollieTimer = setTimeout(() => allOllies.forEach(o => { o.dataset.state = 'idle'; }), seconds * 1000);
    }

    // A small copy of Ollie's face in the top bar
    const brandOllie = ollie.querySelector('.ollie-svg').cloneNode(true);
    brandOllie.querySelectorAll('.ollie-paw, .ollie-sweat, .ollie-shadow').forEach(el => el.remove());
    document.getElementById('brand-ollie').appendChild(brandOllie);

    // Ollie's eyes follow your mouse (a little)
    let lookFrame = null;
    document.addEventListener('mousemove', (e) => {
        if (lookFrame) return;
        lookFrame = requestAnimationFrame(() => {
            lookFrame = null;
            allOllies.forEach(o => {
                const box = o.getBoundingClientRect();
                if (!box.width) return;  // this Ollie is hidden right now
                const dx = e.clientX - (box.left + box.width / 2);
                const dy = e.clientY - (box.top + box.height * 0.42);
                const distance = Math.hypot(dx, dy) || 1;
                const reach = Math.min(1, distance / 300) * 4;  // at most 4 units inside the glasses
                const move = `translate(${(dx / distance * reach).toFixed(1)}px, ${(dy / distance * reach).toFixed(1)}px)`;
                o.querySelectorAll('.ollie-look').forEach(g => { g.style.transform = move; });
            });
        });
    });

    // Pet Ollie: click it and it purrs
    function petOllie(whichOllie) {
        if (ollie.dataset.state === 'thinking') return;  // busy, don't interrupt
        setOllie('happy', 1.2);
        const purr = document.createElement('span');
        purr.className = 'ollie-purr';
        purr.textContent = 'prrr~';
        whichOllie.appendChild(purr);
        setTimeout(() => purr.remove(), 1300);
    }
    ollieBtn.addEventListener('click', () => {
        if (layout.classList.contains('is-expanded')) { setExpanded(false); return; }
        petOllie(ollie);
    });

    // At night, Ollie dozes off if you leave it alone for a while, and wakes up when you come back
    let lastActivity = Date.now();
    ['mousemove', 'keydown', 'click', 'touchstart'].forEach(type => {
        document.addEventListener(type, () => {
            lastActivity = Date.now();
            if (ollie.dataset.state === 'sleepy') setOllie('idle');
        }, { passive: true });
    });
    setInterval(() => {
        const quiet = Date.now() - lastActivity > 90 * 1000;
        if (document.body.dataset.time === 'night' && quiet && ollie.dataset.state === 'idle') setOllie('sleepy');
    }, 10 * 1000);

    // What Ollie says when you open the app, based on the time and your deadlines
    let greeting = '';
    function updateGreeting(tasks, dueSoon) {
        const hello = {
            morning: 'Good morning!',
            afternoon: 'Good afternoon!',
            evening: 'Good evening!',
            night: 'Hey, night owl!',
        }[periodFor(new Date().getHours())];
        const overdue = tasks.filter(t => !t.is_done && t.document_type === 'Assignment'
            && t.deadline && new Date(t.deadline) < new Date()).length;
        let line;
        if (dueSoon.length === 1) line = `"${dueSoon[0].title}" is ${daysLeftText(dueSoon[0].deadline)}.`;
        else if (dueSoon.length > 1) line = `You have ${dueSoon.length} deadlines in the next 3 days. Let's plan!`;
        else if (overdue) line = `Nothing due soon, but ${overdue} task${overdue > 1 ? 's are' : ' is'} overdue.`;
        else line = 'Nothing due soon. Want me to quiz you on your notes?';
        const firstTime = !greeting;
        greeting = `${hello} ${line}`;
        // Only replace the bubble while it's still showing the greeting (not an answer)
        if (firstTime || ollieSays.dataset.kind === 'greeting') {
            ollieSays.dataset.kind = 'greeting';
            ollieSays.textContent = greeting;
        }
    }

    // ---------- Pet mode / Chat mode, expand, notes drawer ----------
    const layout = document.getElementById('layout');
    const modeButtons = document.querySelectorAll('.mode-btn');

    function setMode(mode) {
        ollieCorner.dataset.mode = mode;
        modeButtons.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
        saveSetting('ollieMode', mode);
        if (mode === 'chat') agentMessages.scrollTop = agentMessages.scrollHeight;
    }
    modeButtons.forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)));

    const expandBtn = document.getElementById('expand-btn');
    function setExpanded(on) {
        layout.classList.toggle('is-expanded', on);
        expandBtn.setAttribute('aria-pressed', String(on));
        expandBtn.setAttribute('aria-label', on ? 'Show Ollie again' : 'Expand tasks');
        expandBtn.title = on ? 'Show Ollie again' : 'Expand tasks';
        expandBtn.querySelector('i').className = `fa-solid ${on ? 'fa-down-left-and-up-right-to-center' : 'fa-up-right-and-down-left-from-center'}`;
        ollieBtn.setAttribute('aria-label', on ? 'Show Ollie again' : 'Pet Ollie');
        saveSetting('tasksExpanded', on ? '1' : '0');
    }
    expandBtn.addEventListener('click', () => setExpanded(!layout.classList.contains('is-expanded')));

    const drawer = document.getElementById('notes-drawer');
    const drawerBackdrop = document.getElementById('drawer-backdrop');
    const notesBtn = document.getElementById('notes-btn');
    function setDrawer(open) {
        drawer.hidden = !open;
        drawerBackdrop.hidden = !open;
        notesBtn.setAttribute('aria-expanded', String(open));
        if (open) document.getElementById('close-drawer').focus();
        // in room mode the Notes button is hidden, so go back to the room's Drawer button
        else if (document.body.classList.contains('room-mode')) document.querySelector('.room-tool[data-object="drawer"]').focus();
        else notesBtn.focus();
    }
    notesBtn.addEventListener('click', () => setDrawer(true));
    document.getElementById('close-drawer').addEventListener('click', () => setDrawer(false));
    drawerBackdrop.addEventListener('click', () => setDrawer(false));
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        // close the top-most thing only
        if (!drawer.hidden) setDrawer(false);
        else if (noteModal.classList.contains('active')) closeNote();
        else if (document.body.classList.contains('room-mode')) setRoomMode(false);
    });

    // ---------- Ollie's note: the full version of a long answer ----------
    const noteModal = document.getElementById('note-modal');
    const noteBody = document.getElementById('note-body');
    let noteText = '';

    function openNote(question, answer, sources) {
        noteText = answer;
        document.getElementById('note-question').textContent = question ? `You asked: ${question}` : '';
        noteBody.innerHTML = formatChatText(answer);
        document.getElementById('note-sources').innerHTML = sources && sources.length ? sourcesHtml(sources) : '';
        noteModal.classList.add('active');
        document.getElementById('close-note').focus();
    }
    function closeNote() {
        noteModal.classList.remove('active');
        ollieBtn.focus();
    }
    document.getElementById('close-note').addEventListener('click', closeNote);
    noteModal.addEventListener('click', (e) => { if (e.target === noteModal) closeNote(); });
    document.getElementById('copy-note').addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText(noteText);
            showToast('Copied!');
        } catch (e) {
            showToast("Couldn't copy. Select the text and copy it yourself.");
        }
    });

    // ---------- Room mode: look around the room and click things ----------
    const roomObjects = document.getElementById('room-objects');
    const roomBtn = document.getElementById('room-btn');
    const roomSpeech = document.getElementById('room-speech');
    const roomOllieSpot = document.getElementById('room-ollie-spot');
    const ROOM_PICTURE = { width: 1672, height: 940, focusY: 0.4 };   // size of the room pictures; 0.4 matches "center 40%" in the CSS
    const OLLIE_ON_DESK = { x: 0.69, bottom: 0.735, height: 0.25 };   // where Ollie sits in the picture

    // The picture is shown with "cover", so it's scaled and cut off at the edges.
    // This finds where the picture really is on screen, so the clickable spots line up with the objects.
    function pictureBox() {
        const scale = Math.max(innerWidth / ROOM_PICTURE.width, innerHeight / ROOM_PICTURE.height);
        const width = ROOM_PICTURE.width * scale;
        const height = ROOM_PICTURE.height * scale;
        // On tall screens the CSS slides the picture to 66% so the desk is in view; match it here
        const focusX = innerWidth < innerHeight ? 0.66 : 0.5;
        return { left: (innerWidth - width) * focusX, top: (innerHeight - height) * ROOM_PICTURE.focusY, width, height };
    }

    function placeRoomObjects() {
        const pic = pictureBox();
        roomObjects.querySelectorAll('.room-hotspot').forEach(spot => {
            const [x1, y1, x2, y2] = spot.dataset.box.split(',').map(Number);
            Object.assign(spot.style, {
                left: `${pic.left + x1 * pic.width}px`,
                top: `${pic.top + y1 * pic.height}px`,
                width: `${(x2 - x1) * pic.width}px`,
                height: `${(y2 - y1) * pic.height}px`,
            });
        });
        const ollieHeight = OLLIE_ON_DESK.height * pic.height;
        const ollieWidth = ollieHeight * 200 / 210;   // the drawing is 200 x 210
        Object.assign(roomOllieSpot.style, {
            width: `${ollieWidth}px`,
            left: `${pic.left + OLLIE_ON_DESK.x * pic.width - ollieWidth / 2}px`,
            top: `${pic.top + OLLIE_ON_DESK.bottom * pic.height - ollieHeight}px`,
        });
    }

    function setRoomMode(on) {
        document.body.classList.toggle('room-mode', on);
        roomObjects.hidden = !on;
        roomBtn.setAttribute('aria-pressed', String(on));
        roomBtn.setAttribute('aria-label', on ? 'Back to work' : 'Look around the room');
        roomBtn.title = on ? 'Back to work' : 'Look around the room';
        if (on) {
            placeRoomObjects();
            roomSpeech.textContent = 'Welcome to my room! Click the clock, calendar, lamp or drawer.';
            roomObjects.querySelector('.room-tool').focus();
        } else {
            roomBtn.focus();
        }
    }

    roomBtn.addEventListener('click', () => setRoomMode(!document.body.classList.contains('room-mode')));
    document.getElementById('back-to-work').addEventListener('click', () => setRoomMode(false));
    window.addEventListener('resize', () => { if (!roomObjects.hidden) placeRoomObjects(); });

    // Unfinished assignments with a deadline, soonest first
    function openDeadlines() {
        return Object.values(tasksById)
            .filter(t => t.document_type === 'Assignment' && !t.is_done && t.deadline)
            .sort((a, b) => new Date(a.deadline) - new Date(b.deadline));
    }
    const shortDate = (d) => new Date(d).toLocaleDateString('en-MY', { weekday: 'short', day: 'numeric', month: 'short' });

    const ROOM_ACTIONS = {
        // Clock: what's due today and tomorrow
        clock() {
            const now = new Date();
            const dayKey = (d) => new Date(d).toDateString();
            const tomorrow = new Date(now.getTime() + 86400000);
            const deadlines = openDeadlines().filter(t => new Date(t.deadline) >= now);
            const today = deadlines.filter(t => dayKey(t.deadline) === now.toDateString());
            const next = deadlines.filter(t => dayKey(t.deadline) === tomorrow.toDateString());
            const time = now.toLocaleTimeString('en-MY', { hour: 'numeric', minute: '2-digit' });
            const list = (items) => items.map(t => escapeHtml(t.title)).join(', ');
            let html = `<strong>It's ${time}.</strong><br>`;
            if (!today.length && !next.length) html += 'Nothing due today or tomorrow. Nice!';
            if (today.length) html += `Due today: ${list(today)}.<br>`;
            if (next.length) html += `Due tomorrow: ${list(next)}.`;
            roomSpeech.innerHTML = html;
            setOllie(today.length ? 'explain' : 'happy', 1.6);
        },
        // Calendar: this month's deadlines, and the calendar download
        calendar() {
            const now = new Date();
            const thisMonth = openDeadlines().filter(t => {
                const d = new Date(t.deadline);
                return d >= now && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
            });
            const month = now.toLocaleDateString('en-MY', { month: 'long' });
            roomSpeech.innerHTML = (thisMonth.length
                ? `<strong>Deadlines left in ${month}:</strong><ul>${thisMonth.slice(0, 6).map(t =>
                    `<li><strong>${shortDate(t.deadline)}</strong> ${escapeHtml(t.title)}</li>`).join('')}</ul>`
                : `<strong>No more deadlines in ${month}.</strong>`)
                + `<a class="btn btn-primary" href="${API}/api/calendar.ics" download>
                       <i class="fa-regular fa-calendar-plus" aria-hidden="true"></i> Add to my phone calendar</a>`;
            setOllie('explain', 1.6);
        },
        // Lamp: switch between a day and a night look, or back to the real time
        lamp() {
            const dark = ['evening', 'night'].includes(document.body.dataset.time);
            if (timeMode.value !== 'auto') {
                timeMode.value = 'auto';
                roomSpeech.textContent = 'Back to the real time outside.';
            } else {
                timeMode.value = dark ? 'morning' : 'night';
                roomSpeech.textContent = dark ? 'Lights on! Good morning vibes.' : 'Lights off... cozy night mode.';
            }
            timeMode.dispatchEvent(new Event('change'));
            setOllie('happy', 1.2);
        },
        // Drawer: your lecture notes
        drawer() {
            roomSpeech.textContent = 'Here are the notes I have read.';
            setDrawer(true);
        },
    };

    roomObjects.addEventListener('click', (e) => {
        const target = e.target.closest('[data-object]');
        if (target) ROOM_ACTIONS[target.dataset.object]();
    });

    // Petting works on the desk Ollie too
    document.getElementById('room-ollie-btn').addEventListener('click', () => petOllie(roomOllie));

    // ---------- Ollie speaks: the answer appears in the speech bubble ----------
    const PREVIEW_CHARS = 260;
    let typingTimer = null;

    // Plain text for the bubble: no markdown symbols
    function plainText(text) {
        return text
            .replace(/```[\s\S]*?```/g, ' [code] ')
            .replace(/^\s*\|.*\|\s*$/gm, '')
            .replace(/\*\*|__|`/g, '')
            .replace(/(^|\s)\*(\S)/g, '$1$2')
            .replace(/^\s*[*-]\s+/gm, '• ')
            .replace(/\n{2,}/g, '\n')
            .trim();
    }

    // Long answers, tables and code don't fit in a bubble: show a short part and a "View note" button
    function needsNote(text) {
        return text.length > PREVIEW_CHARS || /```|^\s*\|.*\|\s*$/m.test(text);
    }

    function shortVersion(text) {
        const plain = plainText(text);
        if (plain.length <= PREVIEW_CHARS) return plain;
        const cut = plain.slice(0, PREVIEW_CHARS);
        const lastStop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('\n'));
        return (lastStop > 120 ? cut.slice(0, lastStop + 1) : cut).trim() + ' ...';
    }

    // Shows text in the bubble one letter at a time while Ollie "talks"
    function typeInto(element, text, onDone) {
        clearInterval(typingTimer);
        const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (reduceMotion) { element.textContent = text; onDone(); return; }
        element.textContent = '';
        let i = 0;
        const step = Math.max(1, Math.round(text.length / 120));  // long text types faster
        typingTimer = setInterval(() => {
            i = Math.min(text.length, i + step);
            element.textContent = text.slice(0, i);
            if (i >= text.length) { clearInterval(typingTimer); onDone(); }
        }, 16);
    }

    // mood after talking: 'idle', 'explain' (paw up, "um, actually"), 'happy' or 'oops'
    function ollieSay(question, answer, { sources = [], mood = 'idle' } = {}) {
        speechQuestion.hidden = !question;
        speechQuestion.textContent = question || '';
        ollieSays.dataset.kind = 'answer';
        if (mood === 'oops') setOllie('oops', 2);
        else setOllie(mood === 'explain' ? 'explain' : 'idle');   // talking
        typeInto(ollieSays, shortVersion(answer), () => {
            if (needsNote(answer)) {
                const btn = document.createElement('button');
                btn.className = 'view-note-btn';
                btn.innerHTML = '<i class="fa-solid fa-note-sticky" aria-hidden="true"></i> View note';
                btn.addEventListener('click', () => openNote(question, answer, sources));
                speechExtras.prepend(btn);
            }
            // hold the pose for a moment after talking, then relax
            if (mood === 'explain') setOllie('explain', 1.8);
            if (mood === 'happy') setOllie('happy', 1.6);
        });
    }

    function resetSpeech() {
        clearInterval(typingTimer);
        speechQuestion.hidden = true;
        speechExtras.innerHTML = '';
        ollieSays.dataset.kind = 'greeting';
        ollieSays.textContent = greeting || "Hi, I'm Ollie! Ask me about your notes or deadlines.";
    }

    bellBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        bellDropdown.hidden = !bellDropdown.hidden;
    });
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.bell-wrapper')) bellDropdown.hidden = true;
    });

    // Initial Load
    loadExistingTasks();

    // File Input Logic
    browseBtn.addEventListener('click', (e) => {
        e.preventDefault();
        fileInput.click();
    });

    document.getElementById('upload-btn').addEventListener('click', () => fileInput.click());

    function preventDefaults(e) {
        e.preventDefault();
        e.stopPropagation();
    }
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        document.body.addEventListener(eventName, preventDefaults, false);
    });

    // You can drop a PDF on the drawer's drop zone or straight onto the task list
    const tasksPanel = document.getElementById('tasks-panel');
    [dropZone, tasksPanel].forEach(target => {
        ['dragenter', 'dragover'].forEach(eventName => {
            target.addEventListener(eventName, () => target.classList.add('dragover'), false);
        });
        ['dragleave', 'drop'].forEach(eventName => {
            target.addEventListener(eventName, () => target.classList.remove('dragover'), false);
        });
        target.addEventListener('drop', (e) => handleFiles(e.dataTransfer.files));
    });
    fileInput.addEventListener('change', function() { handleFiles(this.files); });

    // Task and note actions (tick steps, done, edit, chat, delete), for the task list and the notes drawer
    [tasksPanel, document.getElementById('notes-drawer')].forEach(area => area.addEventListener('click', async (e) => {
        const card = e.target.closest('.extraction-col');
        const task = card && tasksById[card.dataset.id];

        // Tick or untick a step
        const step = e.target.closest('.step-item');
        if (step && task) {
            const index = Number(step.dataset.step);
            const ticked = new Set(task.completed_milestones);
            ticked.has(index) ? ticked.delete(index) : ticked.add(index);
            step.classList.toggle('completed');  // show it straight away, then save
            try {
                await updateTask(task.id, { completed_milestones: [...ticked] });
            } catch (error) {
                showToast(error.message);
                await loadExistingTasks();
            }
            return;
        }

        // Mark as done / not done
        if (e.target.closest('.done-btn') && task) {
            try {
                await updateTask(task.id, { is_done: !task.is_done });
                if (task.is_done) {
                    showToast('Moved back to your to-do list.');
                } else {
                    showToast('Nice work! Task done.');
                    setOllie('happy', 1.6);  // Ollie cheers
                }
            } catch (error) {
                showToast(error.message);
            }
            return;
        }

        // Open / close the edit form
        if ((e.target.closest('.edit-btn') || e.target.closest('.edit-cancel')) && task) {
            const form = card.querySelector('.edit-form');
            form.hidden = !form.hidden;
            return;
        }

        // Save the edit form
        if (e.target.closest('.edit-save') && task) {
            const form = card.querySelector('.edit-form');
            const value = (name) => form.querySelector(`[name="${name}"]`).value.trim();
            const changes = {};
            if (value('title')) changes.title = value('title');
            if (value('course_name')) changes.course_name = value('course_name');
            if (value('deadline')) changes.deadline = value('deadline') + ':00';
            if (value('estimated_hours')) changes.estimated_hours = parseInt(value('estimated_hours'));
            changes.details = value('details');
            try {
                await updateTask(task.id, changes);
                showToast('Task updated!');
            } catch (error) {
                showToast(error.message);
            }
            return;
        }

        // Delete Task
        const deleteBtn = e.target.closest('.delete-btn');
        if (deleteBtn) {
            const taskId = deleteBtn.getAttribute('data-id');
            if (!taskId) return;
            const col = deleteBtn.closest('.extraction-col, .note-item');
            col.style.opacity = '0.4';
            col.style.pointerEvents = 'none';
            try {
                if (!confirm(col.classList.contains('note-item') ? 'Delete this note? Ollie will forget it.' : 'Delete this task?')) {
                    col.style.opacity = '1';
                    col.style.pointerEvents = 'auto';
                    return;
                }
                const response = await fetch(`${API}/api/tasks/${taskId}`, { method: 'DELETE' });
                if (response.ok) {
                    showToast('Deleted.');
                    await loadExistingTasks();
                } else {
                    throw new Error("Failed to delete from database");
                }
            } catch(error) {
                console.error(error);
                col.style.opacity = '1';
                col.style.pointerEvents = 'auto';
                showToast('Failed to delete task.');
            }
            return;
        }

        // Open Chat Modal
        const chatBtn = e.target.closest('.chat-btn');
        if (chatBtn) {
            currentChatTaskId = chatBtn.getAttribute('data-id');
            chatModal.classList.add('active');
            chatMessages.innerHTML = `
                <div class="chat-message ai-message">
                    <div class="message-bubble">Hello! Ask me any questions about this document.</div>
                </div>
            `;
            chatInput.value = '';
            setTimeout(() => chatInput.focus(), 300);
        }
    }));

    // Chat Modal Logic
    closeChatBtn.addEventListener('click', () => {
        chatModal.classList.remove('active');
        currentChatTaskId = null;
    });

    // Turns chat text into safe HTML: escapes tags like <tr> so they show as text,
    // then renders the simple markdown the AI uses (**bold**, `code`, bullet lists)
    function formatChatText(text) {
        const escape = (t) => t
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
        // Code blocks (```html ... ```) keep their lines exactly as written;
        // splitting with a ( ) group puts the code at the odd positions of the list
        return text.split(/```[\w-]*\n?([\s\S]*?)```/g).map((part, i) => i % 2 === 1
            ? `<pre class="code-block"><code>${escape(part.replace(/\n$/, ''))}</code></pre>`
            : formatLines(escape(part))
        ).join('');
    }

    function formatInline(line) {
        return line
            .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
            // *italic*: no space right inside the stars, so a "* bullet" isn't mistaken for it
            .replace(/\*(?=\S)([^*\n]+?)(?<=\S)\*/g, '<em>$1</em>')
            .replace(/`([^`]+)`/g, '<code>$1</code>');
    }

    // Normal text line by line: bullets, and markdown tables like
    // | Feature | HTTP | HTTPS |
    // |---------|------|-------|
    function formatLines(text) {
        const lines = text.split('\n');
        const isRow = (line) => /^\s*\|.*\|\s*$/.test(line || '');
        const isDivider = (line) => /^\s*\|[\s:|-]+\|\s*$/.test(line || '');
        const cells = (line) => line.trim().slice(1, -1).split('|').map(c => formatInline(c.trim()));
        const pieces = [];  // { html, block } - block pieces (tables) don't need a <br> around them

        for (let i = 0; i < lines.length; i++) {
            if (isRow(lines[i]) && isDivider(lines[i + 1])) {
                const head = cells(lines[i]);
                const rows = [];
                i += 2;
                while (i < lines.length && isRow(lines[i])) rows.push(cells(lines[i++]));
                i--;
                pieces.push({ block: true, html: `
                    <div class="table-wrap"><table>
                        <thead><tr>${head.map(c => `<th>${c}</th>`).join('')}</tr></thead>
                        <tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody>
                    </table></div>` });
            } else {
                pieces.push({ block: false, html: formatInline(lines[i]).replace(/^\s*[*-]\s+/, '• ') });
            }
        }
        return pieces.map((p, i) => (i > 0 && !p.block && !pieces[i - 1].block ? '<br>' : '') + p.html).join('');
    }

    function appendChatMessage(text, isUser = false, isHtml = false) {
        const msgDiv = document.createElement('div');
        msgDiv.className = `chat-message ${isUser ? 'user-message' : 'ai-message'}`;
        msgDiv.innerHTML = `<div class="message-bubble">${isHtml ? text : formatChatText(text)}</div>`;
        chatMessages.appendChild(msgDiv);
        chatMessages.scrollTop = chatMessages.scrollHeight;
        return msgDiv;
    }

    async function sendChatMessage() {
        const text = chatInput.value.trim();
        if (!text || !currentChatTaskId) return;

        appendChatMessage(text, true);
        chatInput.value = '';

        const typingMsg = appendChatMessage('<i class="fa-solid fa-spinner fa-spin"></i> Analyzing document...', false, true);

        try {
            const response = await fetch(`${API}/api/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    task_id: parseInt(currentChatTaskId),
                    question: text
                })
            });

            typingMsg.remove();

            if (!response.ok) {
                let errorText = "Failed to get an answer.";
                try {
                    const errData = await response.json();
                    errorText = errData.detail || errorText;
                } catch(e) {}
                throw new Error(errorText);
            }

            const data = await response.json();
            appendChatMessage(data.answer, false);
        } catch (error) {
            console.error(error);
            typingMsg.remove();
            appendChatMessage(`Oops: ${error.message}`, false);
        }
    }

    sendChatBtn.addEventListener('click', sendChatMessage);
    chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendChatMessage();
    });

    // ---------- Talking to Ollie ----------
    // Every answer goes into the chat history (Chat mode) AND Ollie's speech bubble (Pet mode),
    // so you can switch between the two at any time.
    const agentMessages = document.getElementById('agent-messages');
    const agentInput = document.getElementById('agent-input');
    const agentSendBtn = document.getElementById('agent-send');
    const isPetMode = () => ollieCorner.dataset.mode === 'pet';

    function appendAgentMessage(html, isUser = false) {
        const msgDiv = document.createElement('div');
        msgDiv.className = `chat-message ${isUser ? 'user-message' : 'ai-message'}`;
        msgDiv.innerHTML = `<div class="message-bubble">${html}</div>`;
        agentMessages.appendChild(msgDiv);
        agentMessages.scrollTop = agentMessages.scrollHeight;
        return msgDiv;
    }

    // Small extras (tool badges, sources) show in the chat history and under Ollie's bubble
    function addExtra(element) {
        agentMessages.appendChild(element);
        agentMessages.scrollTop = agentMessages.scrollHeight;
        speechExtras.appendChild(element.cloneNode(true));
    }

    // RAG: which of your PDFs the answer came from, so you can open them and check
    function sourcesHtml(sources) {
        return '<span class="sources-label"><i class="fa-solid fa-book-open" aria-hidden="true"></i> From your notes:</span>'
            + sources.map(s => `<span class="source-chip" title="${escapeHtml(s.course)}">${escapeHtml(s.title)}${s.page ? `, p.${s.page}` : ''}</span>`).join('');
    }
    function appendSources(sources) {
        const box = document.createElement('div');
        box.className = 'sources-box';
        box.innerHTML = sourcesHtml(sources);
        addExtra(box);
    }

    // A small badge per tool the agent used, so you can see it "doing" things:
    // a friendly label, plus the real tool name in small code text
    const TOOL_LABELS = {
        get_deadlines: ['fa-calendar-days', () => 'Checked your deadlines'],
        search_notes: ['fa-magnifying-glass', (a) => a.query ? `Searched your notes for "${a.query}"` : 'Searched your notes'],
        add_task: ['fa-square-plus', (a) => `Prepared a new task${a.title ? `: ${a.title}` : ''}`],
        edit_task: ['fa-pen', () => 'Prepared a change to a task'],
        remember_preference: ['fa-brain', () => 'Remembered something about you'],
        forget_preference: ['fa-eraser', () => 'Forgot something'],
    };

    function appendToolBadge(tool) {
        const [icon, label] = TOOL_LABELS[tool.name] || ['fa-wrench', () => 'Used a tool'];
        const badge = document.createElement('div');
        badge.className = 'tool-badge';
        badge.innerHTML = `<i class="fa-solid ${icon}" aria-hidden="true"></i>
            <span>${escapeHtml(label(tool.args || {}))}</span>
            <code>${escapeHtml(tool.name)}</code>`;
        addExtra(badge);
    }

    function formatDeadline(deadline) {
        return new Date(deadline).toLocaleString('en-MY', {
            weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit'
        });
    }

    // The agent never saves by itself: it prepares a task, and YOU click Save or Cancel
    function appendPendingTaskCard(task) {
        const lines = [
            ['strong', task.title],
            ['span', task.course_name],
            ['span', `Due ${formatDeadline(task.deadline)}`],
        ];
        if (task.estimated_hours) lines.push(['span', `About ${task.estimated_hours} hours`]);
        appendConfirmCard(lines, 'Saved to your task board.', async () => {
            const response = await fetch(`${API}/api/agent/save-task`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(task)
            });
            if (!response.ok) throw new Error('Could not save the task.');
            showToast('Task added!');
        });
    }

    // Same idea for changing a task that's already on the board
    function appendPendingEditCard(edit) {
        const labels = { title: 'Title', course_name: 'Course', estimated_hours: 'Hours', details: 'Notes' };
        const lines = [['strong', `Change: ${edit.task_title}`]];
        Object.entries(edit.changes).forEach(([field, value]) => {
            if (field === 'deadline') lines.push(['span', `New deadline: ${formatDeadline(value)}`]);
            else if (field === 'is_done') lines.push(['span', value ? 'Mark as done' : 'Mark as not done']);
            else lines.push(['span', `${labels[field] || field}: ${value}`]);
        });
        appendConfirmCard(lines, 'Task updated.', async () => {
            await updateTask(edit.task_id, edit.changes);
            showToast('Task updated!');
        });
    }

    // A small card with Save / Cancel. onSave does the real saving.
    // It goes where you're looking (the bubble in Pet mode, the history in Chat mode),
    // and only there, so there's never a second Save button for the same thing.
    function appendConfirmCard(lines, savedText, onSave) {
        const card = document.createElement('div');
        card.className = 'pending-task-card';
        // textContent (not innerHTML) so whatever the AI wrote can't turn into HTML
        lines.forEach(([tag, text]) => {
            const el = document.createElement(tag);
            el.textContent = text;
            card.appendChild(el);
        });

        const buttons = document.createElement('div');
        buttons.className = 'pending-task-buttons';
        buttons.innerHTML = `
            <button class="save-task-btn"><i class="fa-solid fa-check" aria-hidden="true"></i> Save</button>
            <button class="cancel-task-btn">Cancel</button>
        `;
        card.appendChild(buttons);
        if (isPetMode()) {
            speechExtras.appendChild(card);
        } else {
            agentMessages.appendChild(card);
            agentMessages.scrollTop = agentMessages.scrollHeight;
        }

        buttons.querySelector('.cancel-task-btn').addEventListener('click', () => {
            buttons.textContent = 'Cancelled. Nothing was saved.';
        });
        buttons.querySelector('.save-task-btn').addEventListener('click', async () => {
            buttons.textContent = 'Saving...';
            try {
                await onSave();
                buttons.innerHTML = `<i class="fa-solid fa-circle-check" aria-hidden="true" style="color: var(--mint)"></i> ${escapeHtml(savedText)}`;
                setOllie('happy', 1.6);
                await loadExistingTasks();
            } catch (error) {
                console.error(error);
                buttons.innerHTML = `<i class="fa-solid fa-circle-exclamation" aria-hidden="true" style="color: var(--rose)"></i> ${escapeHtml(error.message)}`;
                setOllie('oops', 1.5);
            }
        });
    }

    async function askAgent() {
        const text = agentInput.value.trim();
        if (!text) return;

        appendAgentMessage(formatChatText(text), true);
        agentInput.value = '';
        const thinking = appendAgentMessage('<span class="typing">Ollie is thinking<span>.</span><span>.</span><span>.</span></span>');

        // Pet mode: Ollie shows your question and thinks
        clearInterval(typingTimer);
        speechExtras.innerHTML = '';
        speechQuestion.hidden = false;
        speechQuestion.textContent = text;
        ollieSays.dataset.kind = 'answer';
        ollieSays.innerHTML = '<span class="typing">Hmm, let me think<span>.</span><span>.</span><span>.</span></span>';
        setOllie('thinking');

        try {
            const response = await fetch(`${API}/api/agent`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: text, conversation_id: conversationId })
            });
            const data = await response.json().catch(() => ({}));
            thinking.remove();
            if (!response.ok) throw new Error(data.detail || 'Failed to get an answer.');

            data.tools_used.forEach(appendToolBadge);
            appendAgentMessage(formatChatText(data.answer));
            if (data.pending_task) appendPendingTaskCard(data.pending_task);
            if (data.pending_edit) appendPendingEditCard(data.pending_edit);
            if (data.sources && data.sources.length) appendSources(data.sources);
            if (data.tools_used.some(t => t.name.endsWith('_preference'))) loadMemory();

            // Ollie's mood: happy when it prepared something or learned about you,
            // "um, actually" when it explains something from your notes or a long answer
            const didSomething = data.pending_task || data.pending_edit
                || data.tools_used.some(t => t.name === 'remember_preference');
            const explained = data.tools_used.some(t => t.name === 'search_notes') || data.answer.length > 200;
            ollieSay(text, data.answer, {
                sources: data.sources || [],
                mood: didSomething ? 'happy' : explained ? 'explain' : 'idle',
            });
        } catch (error) {
            console.error(error);
            thinking.remove();
            appendAgentMessage(formatChatText(`Oops: ${error.message}`));
            ollieSay(text, `Oops: ${error.message}`, { mood: 'oops' });
        }
    }

    agentSendBtn.addEventListener('click', askAgent);
    agentInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') askAgent();
    });

    // Suggestion chips: click one to ask it straight away
    document.querySelectorAll('.suggestion').forEach(chip => {
        chip.addEventListener('click', () => {
            agentInput.value = chip.textContent.trim();
            askAgent();
        });
    });

    // ---------- Memory ----------
    // Short-term: each chat has an id, kept in this browser so a refresh doesn't lose the chat.
    // The messages themselves live in the backend database.
    function newConversationId() {
        return (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()));
    }
    function readSavedId() {
        try { return localStorage.getItem('copilotConversationId'); } catch (e) { return null; }
    }
    function saveId(id) {
        try { localStorage.setItem('copilotConversationId', id); } catch (e) {}
    }
    let conversationId = readSavedId() || newConversationId();
    saveId(conversationId);

    function showGreeting() {
        appendAgentMessage('Hi, I\'m Ollie! Ask me about your notes or deadlines, or tell me your study habits and I\'ll remember them. Try an idea below.');
    }

    async function loadConversation() {
        agentMessages.innerHTML = '';
        try {
            const response = await fetch(`${API}/api/agent/history/${conversationId}`);
            const history = response.ok ? await response.json() : [];
            if (history.length === 0) showGreeting();
            history.forEach(m => appendAgentMessage(formatChatText(m.content), m.role === 'user'));
        } catch (error) {
            showGreeting();
        }
    }

    document.getElementById('new-chat').addEventListener('click', async () => {
        try {
            await fetch(`${API}/api/agent/history/${conversationId}`, { method: 'DELETE' });
        } catch (e) {}
        conversationId = newConversationId();
        saveId(conversationId);
        agentMessages.innerHTML = '';
        showGreeting();
        resetSpeech();
        agentInput.focus();
    });

    // Long-term: preferences, shown so you can see (and delete) what Ollie remembers
    const memoryList = document.getElementById('memory-list');
    const memoryCount = document.getElementById('memory-count');

    async function loadMemory() {
        try {
            const response = await fetch(`${API}/api/preferences`);
            const prefs = response.ok ? await response.json() : [];
            memoryCount.textContent = prefs.length;
            memoryList.innerHTML = prefs.length
                ? prefs.map(p => `
                    <li>
                        <span>${escapeHtml(p.text)}</span>
                        <button class="forget-btn" data-id="${p.id}" title="Forget this"><i class="fa-solid fa-xmark"></i></button>
                    </li>`).join('')
                : '<li class="memory-empty">Nothing yet. Tell Ollie your study habits and it will remember them.</li>';
        } catch (error) {
            console.error('Could not load memory', error);
        }
    }

    memoryList.addEventListener('click', async (e) => {
        const btn = e.target.closest('.forget-btn');
        if (!btn) return;
        await fetch(`${API}/api/preferences/${btn.dataset.id}`, { method: 'DELETE' });
        // Ollie also reads this chat (short-term memory), so it may still know the thing you deleted
        const chatHasMessages = agentMessages.querySelector('.user-message') !== null;
        showToast(chatHasMessages
            ? 'Forgotten. Ollie can still see it in this chat, so click <strong>New chat</strong> to fully reset.'
            : 'Forgotten.', chatHasMessages ? 6 : 3);
        loadMemory();
    });

    loadConversation();
    loadMemory();

    // Come back to the view you used last time
    setMode(readSetting('ollieMode', 'pet') === 'chat' ? 'chat' : 'pet');
    if (readSetting('tasksExpanded', '0') === '1') setExpanded(true);

    // Fetch API Functions
    async function loadExistingTasks() {
        try {
            const response = await fetch(`${API}/api/tasks`);
            if (response.ok) {
                const data = await response.json();
                tasksById = Object.fromEntries(data.map(t => [t.id, t]));
                renderCards(data);
                updateBell(data);
            }
        } catch(error) {
            console.error("Could not load existing tasks", error);
            cardsContainer.innerHTML = `
                <div class="waiting-card" style="grid-column: 1 / -1;">
                    <i class="fa-solid fa-plug-circle-xmark waiting-icon"></i>
                    <h3>Can't reach the backend</h3>
                    <p>Start it with: python -m uvicorn main:app --reload</p>
                </div>`;
        }
    }

    async function handleFiles(files) {
        if (files.length === 0) return;
        const file = files[0];
        
        if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
            alert('Please upload a valid PDF document.');
            return;
        }

        const originalTitle = dropZoneTitle.textContent;
        const originalIconClass = dropZoneIcon.className;
        
        dropZoneTitle.textContent = 'Ollie is reading it...';
        dropZoneIcon.className = 'fa-solid fa-spinner fa-spin';
        dropZone.style.pointerEvents = 'none';
        dropZone.style.opacity = '0.7';
        setOllie('thinking');
        speechQuestion.hidden = true;
        speechExtras.innerHTML = '';
        ollieSays.dataset.kind = 'answer';
        ollieSays.innerHTML = '<span class="typing">Reading your PDF<span>.</span><span>.</span><span>.</span></span>';
        const oldError = document.getElementById('upload-error');
        if (oldError) oldError.remove();

        const formData = new FormData();
        formData.append('file', file);

        try {
            const response = await fetch(`${API}/api/parse-assignment`, {
                method: 'POST',
                body: formData
            });

            if (!response.ok) {
                let errorMessage = `Server error: ${response.status}`;
                try {
                    const errorData = await response.json();
                    errorMessage = errorData.detail || errorMessage;
                } catch(e) {}
                const err = new Error(errorMessage);
                err.busy = response.status === 503; // every AI provider was busy
                throw err;
            }
            
            showToast('Done! Ollie has read your PDF.');
            ollieSay('', `Done! I read "${file.name}". Ask me anything about it.`, { mood: 'happy' });
            await loadExistingTasks();

        } catch (error) {
            console.error("Upload error:", error);
            ollieSay('', `I couldn't read that PDF. ${error.busy ? 'The AI is busy, so try again in a minute.' : error.message}`, { mood: 'oops' });
            // Show the problem right under the drop zone, and keep your tasks on screen
            const box = document.createElement('div');
            box.id = 'upload-error';
            box.className = 'upload-error';
            box.setAttribute('role', 'alert');
            box.innerHTML = `
                <i class="fa-solid fa-circle-exclamation" aria-hidden="true"></i>
                <div>
                    <strong>Ollie couldn't read that PDF</strong>
                    <p>${escapeHtml(error.message)}</p>
                    <p>${error.busy
                        ? 'The AI is busy right now. Nothing was saved, so just upload it again in a minute.'
                        : 'Make sure the backend is running, then try again.'}</p>
                </div>`;
            dropZone.after(box);
        } finally {
            dropZoneTitle.textContent = originalTitle;
            dropZoneIcon.className = originalIconClass;
            dropZone.style.pointerEvents = 'auto';
            dropZone.style.opacity = '1';
            fileInput.value = '';
        }
    }

    // Assignments go to "Your tasks"; lecture notes go to the notes drawer
    const notesList = document.getElementById('notes-list');
    const taskCount = document.getElementById('task-count');
    const notesCount = document.getElementById('notes-count');

    function renderCards(items) {
        if (badge) badge.textContent = `${items.length} found`;
        const tasks = items.filter(t => t.document_type === 'Assignment');
        const notes = items.filter(t => t.document_type !== 'Assignment');

        const toDo = tasks.filter(t => !t.is_done).length;
        taskCount.textContent = tasks.length ? `${toDo} to do` : '';
        notesCount.textContent = notes.length || '';

        cardsContainer.innerHTML = tasks.length
            ? tasks.map(renderCard).join('')
            : `<div class="waiting-card">
                    <i class="fa-solid fa-wand-magic-sparkles waiting-icon" aria-hidden="true"></i>
                    <h3>No tasks yet</h3>
                    <p>Upload an assignment PDF, or tell Ollie: "Add my lab report for BACS2093, due next Friday".</p>
               </div>`;

        notesList.innerHTML = notes.length
            ? notes.map(renderNote).join('')
            : '<li class="notes-empty">No lecture notes yet. Drop one above and Ollie will read it.</li>';
    }

    // One lecture note in the notes drawer
    function renderNote(item) {
        const concepts = (item.key_concepts || []).length;
        const chatButton = item.raw_text
            ? `<button class="chat-btn" data-id="${item.id}" aria-label="Chat about ${escapeHtml(item.title)}"><i class="fa-regular fa-comment-dots" aria-hidden="true"></i> <span class="btn-label">Chat</span></button>`
            : '';
        return `
            <li class="note-item" data-id="${item.id}">
                <span class="note-icon"><i class="fa-regular fa-file-lines" aria-hidden="true"></i></span>
                <div class="note-text">
                    <strong>${escapeHtml(item.title || 'Untitled')}</strong>
                    <span>${escapeHtml(item.course_name)}${concepts ? ` · ${concepts} key concepts` : ''}</span>
                </div>
                <div class="card-actions">
                    ${chatButton}
                    <button class="delete-btn" data-id="${item.id}" aria-label="Delete ${escapeHtml(item.title)}"><i class="fa-regular fa-trash-can" aria-hidden="true"></i></button>
                </div>
            </li>`;
    }

    function renderCard(item) {
        const isAssignment = item.document_type === 'Assignment';
        const steps = item.milestones || [];
        const ticked = new Set(item.completed_milestones || []);
        const overdue = item.deadline && daysLeftText(item.deadline) === 'overdue';

        // Status shown at the top of the card
        let status = '<span class="dot blue"></span> TO DO';
        if (item.is_done) status = '<span class="dot done-dot"></span> DONE';
        else if (!isAssignment) status = '<span class="dot gray"></span> LECTURE NOTE';
        else if (overdue) status = '<span class="dot red-dot"></span> OVERDUE';

        let deadlineHtml = '';
        if (item.deadline) {
            const d = new Date(item.deadline);
            const dateStr = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
            const timeStr = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
            const left = item.is_done ? '' : ` <span class="${overdue ? 'red-text' : 'cyan-text'}">(${daysLeftText(item.deadline)})</span>`;
            deadlineHtml = `
                <div class="deadline-box">
                    <i class="fa-regular fa-calendar"></i>
                    <div class="deadline-text">
                        <span class="deadline-label">DEADLINE</span>
                        <span class="deadline-value">${dateStr} at ${timeStr}${left}</span>
                    </div>
                </div>`;
        }

        // Steps you can tick, with a progress bar
        let stepsHtml = '';
        if (isAssignment && steps.length > 0) {
            const percent = Math.round(ticked.size / steps.length * 100);
            const stepItems = steps.map((step, i) => `
                <li class="step-item ${ticked.has(i) ? 'completed' : ''}" data-step="${i}" title="Click to tick">
                    <i class="fa-${ticked.has(i) ? 'solid fa-circle-check' : 'regular fa-circle'}"></i> ${escapeHtml(step)}
                </li>`).join('');
            stepsHtml = `
                <div class="extracted-steps">
                    <h4>STEPS · ${ticked.size} OF ${steps.length} DONE</h4>
                    <div class="progress-bar"><div class="progress-fill" style="width: ${percent}%"></div></div>
                    <ul>${stepItems}</ul>
                </div>`;
        }

        let conceptsHtml = '';
        if (!isAssignment && item.key_concepts && item.key_concepts.length > 0) {
            const concepts = item.key_concepts.map(c => `<span class="tag gray" style="margin-bottom: 0.5rem; display: inline-block;">${escapeHtml(c)}</span>`).join(' ');
            conceptsHtml = `<div class="extracted-steps"><h4>KEY CONCEPTS TO REVIEW</h4><div>${concepts}</div></div>`;
        }

        // Urgency as a word and a colour (never colour alone). Overdue tasks already say OVERDUE,
        // and their score is out of date (it was worked out when the PDF was uploaded).
        let urgencyHtml = '';
        if (item.urgency_score && isAssignment && !item.is_done && !overdue) {
            const level = item.urgency_score > 7 ? ['urgency-high', 'HIGH']
                : item.urgency_score > 4 ? ['urgency-mid', 'MEDIUM'] : ['urgency-low', 'LOW'];
            urgencyHtml = `<span class="tag ${level[0]}">${level[1]} URGENCY · ${item.urgency_score}/10</span>`;
        }

        // Chat only works when we have the PDF's text (tasks added by chatting don't have one)
        const chatButton = item.raw_text
            ? `<button class="chat-btn" data-id="${item.id}" aria-label="Chat about this PDF"><i class="fa-regular fa-comment-dots" aria-hidden="true"></i> Chat</button>`
            : '';
        const cardActions = `
            <div class="card-actions">
                ${chatButton}
                <button class="edit-btn" aria-label="Edit task"><i class="fa-regular fa-pen-to-square" aria-hidden="true"></i></button>
                <button class="delete-btn" data-id="${item.id}" aria-label="Delete task"><i class="fa-regular fa-trash-can" aria-hidden="true"></i></button>
            </div>`;

        const editForm = `
            <div class="edit-form" hidden>
                <label>Title <input name="title" value="${escapeHtml(item.title)}"></label>
                <label>Course <input name="course_name" value="${escapeHtml(item.course_name)}"></label>
                <label>Deadline <input name="deadline" type="datetime-local" value="${item.deadline ? item.deadline.slice(0, 16) : ''}"></label>
                <label>Hours <input name="estimated_hours" type="number" min="0" value="${item.estimated_hours ?? ''}"></label>
                <label>Notes <textarea name="details" rows="3">${escapeHtml(item.details)}</textarea></label>
                <div class="edit-form-buttons">
                    <button class="edit-save"><i class="fa-solid fa-check"></i> Save</button>
                    <button class="edit-cancel">Cancel</button>
                </div>
            </div>`;

        const doneButton = !isAssignment ? '' : `
            <div class="card-footer">
                <button class="done-btn ${item.is_done ? 'is-done' : ''}">
                    <i class="fa-${item.is_done ? 'solid fa-rotate-left' : 'regular fa-square-check'}"></i>
                    ${item.is_done ? 'Not done yet' : 'Mark as done'}
                </button>
            </div>`;

        return `
            <div class="extraction-col ${item.is_done ? 'is-done' : ''}" data-id="${item.id}">
                <div class="col-header">
                    <span>${status}</span>
                    ${cardActions}
                </div>
                <div class="task-card">
                    <div class="card-tags">
                        <span class="tag gray">${escapeHtml((item.task_type || item.document_type || 'DOCUMENT').toUpperCase())}</span>
                        ${urgencyHtml}
                    </div>
                    <h3 class="card-title">${escapeHtml(item.title || 'Untitled')}</h3>
                    <p class="card-course">${escapeHtml(item.course_name)}</p>
                    <p class="card-desc">${escapeHtml(item.details || 'No details provided.')}</p>
                    ${editForm}
                    ${deadlineHtml}
                    ${stepsHtml}
                    ${conceptsHtml}
                    ${doneButton}
                </div>
            </div>`;
    }
});
