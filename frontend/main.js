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
        showMascotPicture(state);
        if (seconds) ollieTimer = setTimeout(() => {
            allOllies.forEach(o => { o.dataset.state = 'idle'; });
            showMascotPicture('idle');
        }, seconds * 1000);
    }

    // ---------- Picture mascot ----------
    // If assets/mascot/mascot.json exists (made by tools/remove_bg.py), your own pictures replace the drawn cat.
    // It lists the groups: main (the normal pose, also the logo and chat picture), idle (little moves it does
    // now and then), pressed (when you press it) and answer (while it answers you).
    const MASCOT_GROUP = { thinking: 'answer', explain: 'answer', happy: 'pressed' };  // other moods use idle
    let mascotGroups = null;
    let mascotGroup = '';
    let mascotShape = 1;      // width / height of the box the pictures sit in
    let mascotHeld = false;   // true while you hold the mouse or finger on it
    let idleSwapTimer = null;
    const IDLE_MOVE_SECONDS = 3;   // how long an idle move shows before it goes back to the main pose

    function randomFrom(list, not) {
        const choices = list.length > 1 ? list.filter(name => name !== not) : list;
        return choices[Math.floor(Math.random() * choices.length)];
    }
    function setMascotPicture(name) {
        document.querySelectorAll('.mascot-img').forEach(img => { img.src = `assets/mascot/${name}`; });
    }
    function currentMascotPicture() {
        const src = document.querySelector('.mascot-img').getAttribute('src') || '';
        return src.split('/').pop();
    }
    // Shows a random picture from the mood's group (only when the group changes, or when forced).
    // Resting moods show the main pose.
    function showMascotPicture(state, force) {
        if (!mascotGroups) return;
        let group = MASCOT_GROUP[state] || 'main';
        if (!mascotGroups[group]?.length) group = 'main';
        if (group === mascotGroup && !force) return;
        mascotGroup = group;
        setMascotPicture(randomFrom(mascotGroups[group], currentMascotPicture()));
    }
    // While nobody touches it, every 6 to 14 seconds it does a random idle move for 3 seconds,
    // then goes back to the main pose
    function queueIdleSwap() {
        clearTimeout(idleSwapTimer);
        idleSwapTimer = setTimeout(() => {
            if (!mascotHeld && mascotGroup === 'main' && mascotGroups.idle?.length) {
                mascotGroup = 'idle';
                setMascotPicture(randomFrom(mascotGroups.idle));
                idleSwapTimer = setTimeout(() => {
                    if (mascotGroup === 'idle') showMascotPicture('idle');
                    queueIdleSwap();
                }, IDLE_MOVE_SECONDS * 1000);
            } else {
                queueIdleSwap();
            }
        }, 6000 + Math.random() * 8000);
    }

    // Press and hold: it squishes down and shows a "pressed" picture; let go and it bounces back
    function pressMascot(button) {
        if (!mascotGroups || ollie.dataset.state === 'thinking') return;
        mascotHeld = true;
        clearTimeout(ollieTimer);
        allOllies.forEach(o => { o.dataset.state = 'happy'; });
        showMascotPicture('happy', true);
        button.classList.remove('is-bouncing');
        button.classList.add('is-squished');
    }
    function releaseMascot(button) {
        if (!button.classList.contains('is-squished')) return;
        mascotHeld = false;
        button.classList.remove('is-squished');
        void button.offsetWidth;  // restart the bounce animation
        button.classList.add('is-bouncing');
        setOllie('happy', 1.2);   // keep the pressed picture a moment, then back to idle
    }
    ['ollie-btn', 'room-ollie-btn'].forEach(id => {
        const button = document.getElementById(id);
        button.addEventListener('pointerdown', () => pressMascot(button));
        ['pointerup', 'pointerleave', 'pointercancel'].forEach(type =>
            button.addEventListener(type, () => releaseMascot(button)));
        button.addEventListener('animationend', (e) => {
            if (e.animationName === 'pic-boing') button.classList.remove('is-bouncing');
        });
    });

    fetch('assets/mascot/mascot.json', { cache: 'no-cache' })
        .then(response => response.ok ? response.json() : null)
        .then(groups => {
            // the main pose; older lists without one use the first idle picture
            if (!groups?.main?.length) groups = { ...groups, main: groups?.idle?.slice(0, 1) || [] };
            if (!groups.main.length) return;
            const first = new Image();
            first.onload = () => {
                mascotGroups = groups;
                mascotShape = first.naturalWidth / first.naturalHeight;
                document.body.classList.add('picture-mascot');
                document.body.style.setProperty('--mascot-shape', mascotShape);
                document.body.style.setProperty('--ollie-face', `url("${first.src}")`);
                document.querySelectorAll('.mascot-img').forEach(img => { img.hidden = false; });
                showMascotPicture(ollie.dataset.state, true);
                queueIdleSwap();
                // the little logo uses the picture too
                document.getElementById('brand-ollie').innerHTML = `<img class="brand-mascot" src="${first.src}" alt="">`;
                if (!roomObjects.hidden) placeRoomObjects();
            };
            first.src = `assets/mascot/${groups.main[0]}`;
        })
        .catch(() => {});  // no pictures: keep the drawn cat

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
    ollieBtn.addEventListener('click', () => petOllie(ollie));

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

    // ---------- The chat panel (right) and the tasks drawer (left) ----------
    // The room is the home screen; these slide out when you need them, like taking something out of a drawer.
    const layout = document.getElementById('layout');
    const chatBtn = document.getElementById('chat-btn');
    const roomOllieBtn = document.getElementById('room-ollie-btn');
    const tasksPanel = document.getElementById('tasks-panel');
    const tasksBackdrop = document.getElementById('tasks-backdrop');
    const openTasksBtn = document.getElementById('open-tasks');
    const isChatOpen = () => !ollieCorner.hidden;
    const isTasksOpen = () => !tasksPanel.hidden;

    function setChat(open) {
        ollieCorner.hidden = !open;
        document.body.classList.toggle('chat-open', open);
        [chatBtn, roomOllieBtn].forEach(b => b.setAttribute('aria-expanded', String(open)));
        roomOllieBtn.setAttribute('aria-label', open ? 'Pet Ollie' : 'Talk to Ollie');
        if (open) {
            if (isTasksOpen()) setTasks(false, { quiet: true });
            if (isShelfOpen()) setShelf(false, { quiet: true });
            agentMessages.scrollTop = agentMessages.scrollHeight;
            agentInput.focus();
        } else {
            resetSpeech();   // back in the room, Ollie shows the greeting again
            roomOllieBtn.focus();
        }
        placeRoomObjects();   // Ollie moves aside so the chat doesn't cover it
    }
    chatBtn.addEventListener('click', () => setChat(!isChatOpen()));
    document.getElementById('close-chat-panel').addEventListener('click', () => setChat(false));

    // focusTask: the id of a task to scroll to and highlight
    function setTasks(open, { focusTask = null, quiet = false } = {}) {
        tasksPanel.hidden = !open;
        tasksBackdrop.hidden = !open;
        openTasksBtn.setAttribute('aria-expanded', String(open));
        if (open) {
            if (isChatOpen()) setChat(false);
            if (isShelfOpen()) setShelf(false, { quiet: true });
            const card = focusTask && cardsContainer.querySelector(`.extraction-col[data-id="${focusTask}"]`);
            if (card) {
                card.scrollIntoView({ block: 'center' });
                card.classList.remove('is-spotlit');
                void card.offsetWidth;   // restart the highlight
                card.classList.add('is-spotlit');
            }
            document.getElementById('close-tasks').focus();
        } else if (!quiet) {
            openTasksBtn.focus();
        }
    }
    openTasksBtn.addEventListener('click', () => setTasks(true));
    document.getElementById('close-tasks').addEventListener('click', () => setTasks(false));
    tasksBackdrop.addEventListener('click', () => setTasks(false));
    document.getElementById('peek-upload').addEventListener('click', () => { uploadSubjectId = null; fileInput.click(); });

    // The small task list in the room: open tasks, overdue and soonest first
    const peekList = document.getElementById('peek-list');
    const peekCount = document.getElementById('peek-count');
    function renderPeek(tasks) {
        const open = tasks.filter(t => !t.is_done)
            .sort((a, b) => (a.deadline ? new Date(a.deadline) : Infinity) - (b.deadline ? new Date(b.deadline) : Infinity));
        peekCount.textContent = open.length || '';
        if (!open.length) {
            peekList.innerHTML = `<li class="peek-empty">${tasks.length
                ? 'All done. Nice work!' : 'No tasks yet. Upload a brief or ask Ollie to add one.'}</li>`;
            return;
        }
        const MAX = 5;
        peekList.innerHTML = open.slice(0, MAX).map(t => {
            const left = t.deadline ? daysLeftText(t.deadline) : 'no deadline';
            const level = left === 'overdue' ? 'is-overdue'
                : /today|tomorrow|^[23] days/.test(left) ? 'is-soon' : 'is-later';
            return `<li>
                <button class="peek-item" data-id="${t.id}">
                    <span class="peek-dot ${level}" aria-hidden="true"></span>
                    <span class="peek-text">
                        <strong>${escapeHtml(t.title || 'Untitled')}</strong>
                        <span>${escapeHtml(left)}</span>
                    </span>
                </button>
            </li>`;
        }).join('') + (open.length > MAX ? `<li class="peek-more">+${open.length - MAX} more</li>` : '');
    }
    peekList.addEventListener('click', (e) => {
        const item = e.target.closest('.peek-item');
        if (item) setTasks(true, { focusTask: item.dataset.id });
    });

    const drawer = document.getElementById('notes-drawer');
    const drawerBackdrop = document.getElementById('drawer-backdrop');
    const notesBtn = document.getElementById('notes-btn');
    let drawerOpener = null;   // the button that opened the drawer gets the focus back
    function setDrawer(open) {
        drawer.hidden = !open;
        drawerBackdrop.hidden = !open;
        notesBtn.setAttribute('aria-expanded', String(open));
        if (open) {
            drawerOpener = document.activeElement;
            document.getElementById('close-drawer').focus();
        } else if (drawerOpener && drawerOpener.isConnected) {
            drawerOpener.focus();
        }
    }
    notesBtn.addEventListener('click', () => setDrawer(true));
    document.getElementById('close-drawer').addEventListener('click', () => setDrawer(false));
    drawerBackdrop.addEventListener('click', () => setDrawer(false));
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        // close the top-most thing only
        if (!drawer.hidden) setDrawer(false);
        else if (noteModal.classList.contains('active')) closeNote();
        else if (openPop) {
            const name = openPop;
            setPop(name);   // closes it
            document.querySelector(`.dock-btn[data-pop="${name}"]`).focus();
        }
        else if (isShelfOpen()) setShelf(false);
        else if (isTasksOpen()) setTasks(false);
        else if (isChatOpen()) setChat(false);
    });

    // ---------- Ollie's note: the full version of a long answer ----------
    const noteModal = document.getElementById('note-modal');
    const noteBody = document.getElementById('note-body');
    let noteText = '';

    // heading: a line instead of "You asked..."; saveTo: { subjectId, title } shows "Save to my notes"
    let noteSaveTarget = null;
    const saveSummaryBtn = document.getElementById('save-summary-note');
    function openNote(question, answer, sources, { heading = '', saveTo = null } = {}) {
        noteText = answer;
        noteSaveTarget = saveTo;
        saveSummaryBtn.hidden = !saveTo;
        saveSummaryBtn.disabled = false;
        document.getElementById('note-question').textContent = heading || (question ? `You asked: ${question}` : '');
        noteBody.innerHTML = formatChatText(answer);
        document.getElementById('note-sources').innerHTML = sources && sources.length ? sourcesHtml(sources) : '';
        noteModal.classList.add('active');
        document.getElementById('close-note').focus();
    }
    function closeNote() {
        noteModal.classList.remove('active');
        (isChatOpen() ? agentInput : isShelfOpen() ? shelfBody.querySelector('.summary-btn') || shelfBody : roomOllieBtn).focus();
    }
    document.getElementById('close-note').addEventListener('click', closeNote);
    saveSummaryBtn.addEventListener('click', async () => {
        if (!noteSaveTarget) return;
        saveSummaryBtn.disabled = true;
        try {
            const response = await fetch(`${API}/api/notes`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ subject_id: noteSaveTarget.subjectId, title: noteSaveTarget.title, body: noteText }),
            });
            if (!response.ok) throw new Error();
            saveSummaryBtn.hidden = true;
            showToast('Saved to your notes!');
            if (isShelfOpen() && shelfView.view === 'subject') openSubject(shelfView.subjectId);
        } catch (e) {
            saveSummaryBtn.disabled = false;
            showToast("Couldn't save the note. Is the backend running?");
        }
    });
    noteModal.addEventListener('click', (e) => { if (e.target === noteModal) closeNote(); });
    document.getElementById('copy-note').addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText(noteText);
            showToast('Copied!');
        } catch (e) {
            showToast("Couldn't copy. Select the text and copy it yourself.");
        }
    });

    // ---------- The room: the home screen, with things you can click ----------
    const roomObjects = document.getElementById('room-objects');
    const roomOllieSpot = document.getElementById('room-ollie-spot');
    const ROOM_PICTURE = { width: 1672, height: 940 };   // updated below with the picture's real size
    const OLLIE_ON_DESK = { x: 0.69, bottom: 0.735, height: 0.25 };   // where Ollie sits in the picture

    // Ollie says something short in the room (the clock, the calendar...)
    function roomSay(html) {
        clearInterval(typingTimer);
        speechQuestion.hidden = true;
        speechExtras.innerHTML = '';
        ollieSays.dataset.kind = 'room';
        ollieSays.innerHTML = html;
    }

    // Finds where the picture really is on screen, so the clickable spots line up with the objects.
    // The picture always fills the screen ("cover"): wide screens anchor it at 50% / 20% (clock in view),
    // tall screens (phones) slide it to 66% / 40% so the desk is in view. These match the CSS for .room-art.
    function pictureBox() {
        const tall = innerWidth < innerHeight;
        const scale = Math.max(innerWidth / ROOM_PICTURE.width, innerHeight / ROOM_PICTURE.height);
        const width = ROOM_PICTURE.width * scale;
        const height = ROOM_PICTURE.height * scale;
        return {
            left: (innerWidth - width) * (tall ? 0.66 : 0.5),
            top: (innerHeight - height) * (tall ? 0.4 : 0.2),
            width,
            height,
        };
    }

    // Read the room picture's real size, so a new picture (for example an ultra-wide one) just works
    const sizeCheck = new Image();
    sizeCheck.onload = () => {
        ROOM_PICTURE.width = sizeCheck.naturalWidth;
        ROOM_PICTURE.height = sizeCheck.naturalHeight;
        placeRoomObjects();
    };
    sizeCheck.src = 'assets/room/room-morning.webp';

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
        // the drawn cat is 260 x 252; a picture mascot uses its own shape
        const shape = mascotGroups ? mascotShape : 260 / 252;
        const ollieWidth = ollieHeight * shape;
        let left = pic.left + OLLIE_ON_DESK.x * pic.width - ollieWidth / 2;
        // With the chat open, Ollie scoots left so it sits beside the chat, not under it
        if (isChatOpen() && innerWidth >= 768) left = Math.min(left, ollieCorner.offsetLeft - ollieWidth - 24);
        left = Math.max(8, Math.min(left, innerWidth - ollieWidth - 8));   // always fully on screen
        Object.assign(roomOllieSpot.style, {
            width: `${ollieWidth}px`,
            left: `${left}px`,
            top: `${pic.top + OLLIE_ON_DESK.bottom * pic.height - ollieHeight}px`,
        });
    }

    roomObjects.hidden = false;
    placeRoomObjects();
    window.addEventListener('resize', placeRoomObjects);

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
            roomSay(html);
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
            roomSay((thisMonth.length
                ? `<strong>Deadlines left in ${month}:</strong><ul>${thisMonth.slice(0, 6).map(t =>
                    `<li><strong>${shortDate(t.deadline)}</strong> ${escapeHtml(t.title)}</li>`).join('')}</ul>`
                : `<strong>No more deadlines in ${month}.</strong>`)
                + `<a class="btn btn-primary" href="${API}/api/calendar.ics" download>
                       <i class="fa-regular fa-calendar-plus" aria-hidden="true"></i> Add to my phone calendar</a>`);
            setOllie('explain', 1.6);
        },
        // Lamp: switch between a day and a night look, or back to the real time
        lamp() {
            const dark = ['evening', 'night'].includes(document.body.dataset.time);
            if (timeMode.value !== 'auto') {
                timeMode.value = 'auto';
                roomSay('Back to the real time outside.');
            } else {
                timeMode.value = dark ? 'morning' : 'night';
                roomSay(dark ? 'Lights on! Good morning vibes.' : 'Lights off... cozy night mode.');
            }
            timeMode.dispatchEvent(new Event('change'));
            setOllie('happy', 1.2);
        },
        // Bookshelf: your subject folders
        bookshelf() {
            setShelf(true);
        },
        // Drawer: your lecture notes
        drawer() {
            roomSay('Here are the notes I have read.');
            setDrawer(true);
        },
    };

    roomObjects.addEventListener('click', (e) => {
        const target = e.target.closest('[data-object]');
        if (!target) return;
        if (isChatOpen()) setChat(false);
        ROOM_ACTIONS[target.dataset.object]();
    });

    // Click Ollie to talk (it squishes too); with the chat already open, a click just pets it
    roomOllieBtn.addEventListener('click', () => {
        if (isChatOpen()) petOllie(roomOllie);
        else setChat(true);
    });

    // ---------- Bookshelf: one folder per subject ----------
    // Shelf (all subjects) -> one subject (its lecture PDFs, assignments, your notes) -> one note (editor)
    const shelfPanel = document.getElementById('shelf-panel');
    const shelfBackdrop = document.getElementById('shelf-backdrop');
    const shelfBody = document.getElementById('shelf-body');
    const shelfTitle = document.getElementById('shelf-title');
    const shelfHint = document.getElementById('shelf-hint');
    const shelfBack = document.getElementById('shelf-back');
    const shelfBtn = document.getElementById('shelf-btn');
    const isShelfOpen = () => !shelfPanel.hidden;
    let shelfView = { view: 'shelf', subjectId: null, noteId: null };
    let shelfOpener = null;
    let subjectList = [];   // for the "Move to" menus
    let uploadSubjectId = null;   // the folder a PDF upload goes into (null = by its course code)

    function setShelf(open, { quiet = false } = {}) {
        if (!open) flushNoteSave();
        shelfPanel.hidden = !open;
        shelfBackdrop.hidden = !open;
        shelfBtn.setAttribute('aria-expanded', String(open));
        if (open) {
            if (isChatOpen()) setChat(false);
            if (isTasksOpen()) setTasks(false, { quiet: true });
            shelfOpener = document.activeElement;
            showShelf();
            document.getElementById('close-shelf').focus();
        } else if (!quiet) {
            (shelfOpener && shelfOpener.isConnected ? shelfOpener : shelfBtn).focus();
        }
    }
    shelfBtn.addEventListener('click', () => setShelf(!isShelfOpen()));
    document.getElementById('close-shelf').addEventListener('click', () => setShelf(false));
    shelfBackdrop.addEventListener('click', () => setShelf(false));
    shelfBack.addEventListener('click', () => {
        if (shelfView.view === 'note') openSubject(shelfView.subjectId);
        else showShelf();
    });

    async function api(path, options = {}) {
        const response = await fetch(`${API}${path}`, {
            ...options,
            headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.detail || `Something went wrong (${response.status}).`);
        return data;
    }

    function setShelfHead(title, hint, canGoBack) {
        shelfTitle.textContent = title;
        shelfHint.textContent = hint;
        shelfBack.hidden = !canGoBack;
    }

    const subjectLabel = (s) => s ? [s.code, s.name].filter(Boolean).join(' ') : 'Other';
    // Each subject gets its own colour, worked out from its name so it never changes
    function subjectHue(text) {
        let hash = 0;
        for (const ch of text) hash = (hash * 31 + ch.charCodeAt(0)) % 360;
        return hash;
    }
    const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
    const countsText = (c) => [plural(c.documents, 'PDF'), plural(c.tasks, 'task'), plural(c.notes, 'note')].join(' · ');

    // 1. The shelf: every subject folder
    async function showShelf() {
        await flushNoteSave();
        shelfView = { view: 'shelf', subjectId: null, noteId: null };
        setShelfHead('Bookshelf', 'One folder per subject: lecture notes, assignments and your own notes.', false);
        shelfBody.innerHTML = '<p class="shelf-loading">Loading your subjects...</p>';
        try {
            const [list, other] = await Promise.all([api('/api/subjects'), api('/api/subjects/other')]);
            subjectList = list;
            const otherHasThings = other.documents + other.tasks + other.notes > 0;
            shelfBody.innerHTML = `
                <div class="shelf-grid">
                    ${list.map(s => `
                        <button class="subject-card" data-subject="${s.id}" style="--hue: ${subjectHue(subjectLabel(s))}">
                            <span class="subject-code">${escapeHtml(s.code || 'No code')}</span>
                            <strong>${escapeHtml(s.name)}</strong>
                            <span class="subject-counts">${countsText(s)}</span>
                        </button>`).join('')}
                    ${otherHasThings ? `
                        <button class="subject-card is-other" data-subject="other" style="--hue: 220">
                            <span class="subject-code">Other</span>
                            <strong>Not in a subject</strong>
                            <span class="subject-counts">${countsText(other)}</span>
                        </button>` : ''}
                    <button class="subject-card is-new" id="new-subject-btn">
                        <i class="fa-solid fa-plus" aria-hidden="true"></i>
                        <strong>New subject</strong>
                    </button>
                </div>
                ${list.length ? '' : '<p class="shelf-empty">No subjects yet. Upload a PDF and its course gets a folder by itself, or add one here.</p>'}`;
        } catch (error) {
            shelfBody.innerHTML = `<p class="shelf-empty">Couldn't load your subjects. Is the backend running? (${escapeHtml(error.message)})</p>`;
        }
    }

    // The add / edit subject form
    function subjectForm(subject) {
        return `
            <form class="subject-form" id="subject-form">
                <div class="form-row">
                    <label>Course code <input name="code" placeholder="BMCS1113" maxlength="12" value="${escapeHtml(subject?.code || '')}"></label>
                    <label class="grow">Name <input name="name" placeholder="Computer Organisation and Architecture" required value="${escapeHtml(subject?.name || '')}"></label>
                </div>
                <label>Lecturer <span class="optional">(optional)</span> <input name="lecturer" placeholder="Dr. Tan" value="${escapeHtml(subject?.lecturer || '')}"></label>
                <p class="form-error" id="subject-form-error" role="alert" hidden></p>
                <div class="form-buttons">
                    <button type="submit" class="btn btn-primary">${subject ? 'Save' : 'Add subject'}</button>
                    <button type="button" class="btn btn-soft" id="cancel-subject-form">Cancel</button>
                </div>
            </form>`;
    }
    function showSubjectForm(subject) {
        const holder = document.createElement('div');
        holder.innerHTML = subjectForm(subject);
        const form = holder.firstElementChild;
        shelfBody.prepend(form);
        form.querySelector(subject ? 'input[name="name"]' : 'input[name="code"]').focus();
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const data = Object.fromEntries(new FormData(form));
            try {
                const saved = await api(subject ? `/api/subjects/${subject.id}` : '/api/subjects',
                    { method: subject ? 'PATCH' : 'POST', body: JSON.stringify(data) });
                showToast(subject ? 'Subject updated.' : 'Subject added!');
                openSubject(saved.id);
            } catch (error) {
                const box = form.querySelector('#subject-form-error');
                box.textContent = error.message;
                box.hidden = false;
            }
        });
        form.querySelector('#cancel-subject-form').addEventListener('click', () => form.remove());
    }

    // 2. One subject: its lecture PDFs, assignments and notes
    let openSubjectData = null;
    async function openSubject(subjectId) {
        await flushNoteSave();
        shelfView = { view: 'subject', subjectId, noteId: null };
        shelfBody.innerHTML = '<p class="shelf-loading">Opening the folder...</p>';
        try {
            const [data] = await Promise.all([
                api(`/api/subjects/${subjectId}/contents`),
                subjectList.length ? null : api('/api/subjects').then(list => { subjectList = list; }),
            ]);
            openSubjectData = data;
            const s = data.subject;
            setShelfHead(s ? (s.code || s.name) : 'Other', s ? `${s.name}${s.lecturer ? ` · ${s.lecturer}` : ''}` : 'Things that are not in a subject yet', true);
            shelfBody.innerHTML = `
                <div class="subject-actions">
                    <button class="btn btn-primary" id="subject-upload"><i class="fa-solid fa-file-arrow-up" aria-hidden="true"></i> Upload PDF</button>
                    <button class="btn btn-soft" id="subject-new-note"><i class="fa-solid fa-pen" aria-hidden="true"></i> New note</button>
                    ${s ? `
                        <button class="icon-btn" id="subject-edit" aria-label="Edit this subject" title="Edit subject"><i class="fa-regular fa-pen-to-square" aria-hidden="true"></i></button>
                        <button class="icon-btn" id="subject-delete" aria-label="Remove this subject" title="Remove subject"><i class="fa-regular fa-trash-can" aria-hidden="true"></i></button>` : ''}
                </div>

                <section class="shelf-section" aria-labelledby="sec-lectures">
                    <h3 id="sec-lectures"><i class="fa-regular fa-file-lines" aria-hidden="true"></i> Lecture notes <span class="count-pill">${data.documents.length || ''}</span></h3>
                    ${data.documents.length ? `<ul class="shelf-list">${data.documents.map(docRow).join('')}</ul>`
                        : '<p class="shelf-empty">No lecture PDFs yet. Upload one and Ollie can summarise it and answer questions about it.</p>'}
                </section>

                <section class="shelf-section" aria-labelledby="sec-notes">
                    <h3 id="sec-notes"><i class="fa-regular fa-note-sticky" aria-hidden="true"></i> My notes <span class="count-pill">${data.notes.length || ''}</span></h3>
                    ${data.notes.length ? `<ul class="shelf-list">${data.notes.map(noteRow).join('')}</ul>`
                        : '<p class="shelf-empty">No notes yet. Write your own, or save a chapter summary here.</p>'}
                </section>

                <section class="shelf-section" aria-labelledby="sec-tasks">
                    <h3 id="sec-tasks"><i class="fa-solid fa-list-check" aria-hidden="true"></i> Assignments <span class="count-pill">${data.tasks.length || ''}</span></h3>
                    ${data.tasks.length ? `<ul class="shelf-list">${data.tasks.map(taskRow).join('')}</ul>`
                        : '<p class="shelf-empty">No assignments for this subject.</p>'}
                </section>`;
            if (s) {
                document.getElementById('subject-edit').addEventListener('click', () => showSubjectForm(s));
                document.getElementById('subject-delete').addEventListener('click', async () => {
                    if (!confirm(`Remove the ${subjectLabel(s)} folder? Its PDFs, tasks and notes are kept and move to "Other".`)) return;
                    try {
                        await api(`/api/subjects/${s.id}`, { method: 'DELETE' });
                        subjectList = [];
                        showToast('Folder removed. Its things moved to Other.');
                        showShelf();
                    } catch (error) { showToast(error.message); }
                });
            }
            document.getElementById('subject-upload').addEventListener('click', () => {
                uploadSubjectId = s ? s.id : null;
                fileInput.click();
            });
            document.getElementById('subject-new-note').addEventListener('click', () => newNote(s ? s.id : null));
        } catch (error) {
            shelfBody.innerHTML = `<p class="shelf-empty">Couldn't open this folder. (${escapeHtml(error.message)})</p>`;
        }
    }

    function moveMenu(doc) {
        const current = shelfView.subjectId === 'other' ? '' : String(shelfView.subjectId);
        const options = subjectList.map(s =>
            `<option value="${s.id}" ${String(s.id) === current ? 'selected' : ''}>${escapeHtml(subjectLabel(s))}</option>`).join('');
        return `<label class="visually-hidden" for="move-${doc.id}">Move ${escapeHtml(doc.title)} to</label>
            <select class="move-select" id="move-${doc.id}" data-doc="${doc.id}" title="Move to another subject">
                <option value="" ${current ? '' : 'selected'}>Other</option>${options}
            </select>`;
    }
    function docRow(doc) {
        return `<li class="shelf-row">
            <span class="row-icon"><i class="fa-regular fa-file-pdf" aria-hidden="true"></i></span>
            <div class="row-text">
                <strong>${escapeHtml(doc.title)}</strong>
                <span>${doc.pages ? `${doc.pages} pages` : 'PDF'}${doc.has_summary ? ' · summary saved' : ''}</span>
            </div>
            <div class="row-actions">
                ${doc.has_text ? `
                    <button class="btn btn-soft summary-btn" data-doc="${doc.id}" data-title="${escapeHtml(doc.title)}" data-pages="${doc.pages || ''}">
                        <i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i> ${doc.has_summary ? 'Summary' : 'Summarise'}
                    </button>
                    <button class="icon-btn doc-chat-btn" data-doc="${doc.id}" aria-label="Chat about ${escapeHtml(doc.title)}" title="Ask about this PDF"><i class="fa-regular fa-comment-dots" aria-hidden="true"></i></button>` : ''}
                ${moveMenu(doc)}
            </div>
        </li>`;
    }
    function noteRow(note) {
        const when = new Date(note.updated_at).toLocaleDateString('en-MY', { day: 'numeric', month: 'short' });
        return `<li>
            <button class="shelf-row note-row" data-note="${note.id}">
                <span class="row-icon"><i class="fa-regular fa-note-sticky" aria-hidden="true"></i></span>
                <span class="row-text">
                    <strong>${escapeHtml(note.title)}</strong>
                    <span>${escapeHtml(note.preview || 'Empty note')}</span>
                </span>
                <span class="row-date">${when}</span>
            </button>
        </li>`;
    }
    function taskRow(task) {
        const due = task.is_done ? 'done' : task.deadline ? daysLeftText(task.deadline) : 'no deadline';
        return `<li>
            <button class="shelf-row task-row" data-task="${task.id}">
                <span class="row-icon"><i class="fa-${task.is_done ? 'solid fa-circle-check' : 'regular fa-circle'}" aria-hidden="true"></i></span>
                <span class="row-text">
                    <strong>${escapeHtml(task.title)}</strong>
                    <span class="${due === 'overdue' ? 'red-text' : ''}">${escapeHtml(due)}</span>
                </span>
                <i class="fa-solid fa-chevron-right row-go" aria-hidden="true"></i>
            </button>
        </li>`;
    }

    // Clicks inside the bookshelf
    shelfBody.addEventListener('click', (e) => {
        const card = e.target.closest('.subject-card');
        if (card) {
            if (card.id === 'new-subject-btn') showSubjectForm(null);
            else openSubject(card.dataset.subject);
            return;
        }
        const summaryBtn = e.target.closest('.summary-btn');
        if (summaryBtn) { summarise(summaryBtn); return; }
        const chatButton = e.target.closest('.doc-chat-btn');
        if (chatButton) { openDocChat(chatButton.dataset.doc); return; }
        const noteButton = e.target.closest('.note-row');
        if (noteButton) { openNoteEditor(Number(noteButton.dataset.note)); return; }
        const taskButton = e.target.closest('.task-row');
        if (taskButton) { setTasks(true, { focusTask: taskButton.dataset.task }); return; }
    });
    shelfBody.addEventListener('change', async (e) => {
        const select = e.target.closest('.move-select');
        if (!select) return;
        try {
            await api(`/api/documents/${select.dataset.doc}/subject`, {
                method: 'PUT', body: JSON.stringify({ subject_id: select.value ? Number(select.value) : null }),
            });
            showToast('Moved.');
            openSubject(shelfView.subjectId);
        } catch (error) { showToast(error.message); }
    });

    // Chapter summary: shown in Ollie's note, with a button to keep it in your notes
    async function summarise(button) {
        const { doc, title } = button.dataset;
        const pages = Number(button.dataset.pages) || 0;
        let range = null;
        // Very long PDFs (more than one chapter) are summarised a part at a time
        if (pages > 60) {
            range = prompt(`"${title}" has ${pages} pages. Which pages should Ollie summarise? (for example 1-20)`, '1-20');
            if (!range) return;
        }
        const original = button.innerHTML;
        button.disabled = true;
        button.innerHTML = '<i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i> Reading...';
        setOllie('thinking');
        try {
            const result = await api(`/api/documents/${doc}/summary${range ? `?pages=${encodeURIComponent(range)}` : ''}`, { method: 'POST' });
            setOllie('happy', 1.6);
            const heading = `Summary of "${result.title}"${result.pages ? `, pages ${result.pages}` : ''}`;
            openNote('', result.summary, [], {
                heading,
                saveTo: { subjectId: shelfView.subjectId === 'other' ? null : Number(shelfView.subjectId), title: `Summary: ${result.title}${result.pages ? ` (p.${result.pages})` : ''}` },
            });
            if (!result.pages && !result.saved) openSubject(shelfView.subjectId);   // shows "summary saved"
        } catch (error) {
            setOllie('oops', 1.5);
            showToast(error.message, 5);
        } finally {
            button.disabled = false;
            button.innerHTML = original;
        }
    }

    // 3. One note: write and it saves by itself
    let noteSaveTimer = null;
    let pendingNoteSave = null;   // the save waiting to happen, so leaving the editor never loses text

    async function newNote(subjectId) {
        try {
            const note = await api('/api/notes', { method: 'POST', body: JSON.stringify({ subject_id: subjectId, title: 'Untitled note', body: '' }) });
            openNoteEditor(note.id, { fresh: true });
        } catch (error) { showToast(error.message); }
    }

    async function openNoteEditor(noteId, { fresh = false } = {}) {
        await flushNoteSave();
        let note;
        try {
            note = await api(`/api/notes/${noteId}`);
        } catch (error) { showToast(error.message); return; }
        const subjectId = note.subject_id ?? 'other';
        shelfView = { view: 'note', subjectId, noteId };
        const subject = subjectList.find(s => s.id === note.subject_id);
        setShelfHead('My note', subject ? subjectLabel(subject) : 'Other', true);
        shelfBody.innerHTML = `
            <div class="note-editor">
                <label class="visually-hidden" for="note-title-input">Title</label>
                <input class="note-title-input" id="note-title-input" value="${escapeHtml(note.title)}" placeholder="Title">
                <div class="note-toolbar">
                    <div class="mode-switch" role="group" aria-label="Write or read">
                        <button class="mode-btn" data-note-mode="write" aria-pressed="true"><i class="fa-solid fa-pen" aria-hidden="true"></i> Write</button>
                        <button class="mode-btn" data-note-mode="read" aria-pressed="false"><i class="fa-regular fa-eye" aria-hidden="true"></i> Read</button>
                    </div>
                    <span class="note-status" id="note-status" aria-live="polite">Saved</span>
                    <button class="icon-btn" id="delete-note" aria-label="Delete this note" title="Delete note"><i class="fa-regular fa-trash-can" aria-hidden="true"></i></button>
                </div>
                <label class="visually-hidden" for="note-body-input">Note</label>
                <textarea class="note-body-input" id="note-body-input" placeholder="Write anything... **bold**, - bullet points and \`code\` work too. It saves by itself.">${escapeHtml(note.body)}</textarea>
                <div class="note-read message-bubble" id="note-read" hidden></div>
            </div>`;
        const titleInput = document.getElementById('note-title-input');
        const bodyInput = document.getElementById('note-body-input');
        const status = document.getElementById('note-status');
        const read = document.getElementById('note-read');

        const queueSave = () => {
            status.textContent = 'Saving...';
            clearTimeout(noteSaveTimer);
            pendingNoteSave = { noteId, title: titleInput.value, body: bodyInput.value, status };
            noteSaveTimer = setTimeout(() => flushNoteSave({ leaving: false }), 700);
        };
        titleInput.addEventListener('input', queueSave);
        bodyInput.addEventListener('input', queueSave);

        shelfBody.querySelectorAll('[data-note-mode]').forEach(btn => btn.addEventListener('click', () => {
            const reading = btn.dataset.noteMode === 'read';
            shelfBody.querySelectorAll('[data-note-mode]').forEach(b => b.setAttribute('aria-pressed', String(b === btn)));
            read.innerHTML = bodyInput.value.trim() ? formatChatText(bodyInput.value) : '<p class="shelf-empty">Nothing written yet.</p>';
            read.hidden = !reading;
            bodyInput.hidden = reading;
        }));
        document.getElementById('delete-note').addEventListener('click', async () => {
            if (!confirm(`Delete "${titleInput.value || 'this note'}"? This can't be undone.`)) return;
            clearTimeout(noteSaveTimer);
            pendingNoteSave = null;
            try {
                await api(`/api/notes/${noteId}`, { method: 'DELETE' });
                showToast('Note deleted.');
                openSubject(subjectId);
            } catch (error) { showToast(error.message); }
        });
        // A note that was just made starts with its title selected, ready to type over
        if (fresh) { titleInput.focus(); titleInput.select(); } else { bodyInput.focus(); }
    }

    // Saves what's waiting. When you leave a note you left empty, it's removed, so no blank notes pile up.
    async function flushNoteSave({ leaving = true } = {}) {
        clearTimeout(noteSaveTimer);
        const job = pendingNoteSave;
        pendingNoteSave = null;
        const editorOpen = shelfView.view === 'note';
        if (job) {
            try {
                await api(`/api/notes/${job.noteId}`, { method: 'PATCH', body: JSON.stringify({ title: job.title, body: job.body }) });
                if (job.status.isConnected) job.status.textContent = 'Saved';
            } catch (error) {
                if (job.status.isConnected) job.status.textContent = "Couldn't save. Check the backend.";
                return;
            }
        }
        if (leaving && editorOpen) {
            const title = document.getElementById('note-title-input');
            const body = document.getElementById('note-body-input');
            if (title && body && !body.value.trim() && ['', 'Untitled note'].includes(title.value.trim())) {
                await api(`/api/notes/${shelfView.noteId}`, { method: 'DELETE' }).catch(() => {});
            }
        }
    }

    // Upload finished: refresh the open folder so the new PDF shows up
    document.addEventListener('pdf-uploaded', () => {
        if (isShelfOpen() && shelfView.view === 'subject') openSubject(shelfView.subjectId);
    });

    // ---------- Chill dock: lo-fi radio, cozy sounds, focus timer, quick notes ----------
    const dockButtons = document.querySelectorAll('.dock-btn');
    const appBox = document.getElementById('app-box');
    const POPS = ['music', 'sounds', 'notes'];
    const popEl = (name) => document.getElementById(`pop-${name}`);
    const isPopOpen = (name) => !popEl(name).hidden;
    const radioIsMini = () => popEl('music').classList.contains('is-mini');
    const radioIsPlaying = () => document.querySelector('.dock-btn[data-pop="music"]').classList.contains('is-playing');
    const isPanelOpen = (name) => isPopOpen(name) && !(name === 'music' && radioIsMini());   // the mini player isn't a panel
    let openPop = null;   // the panel opened last (Esc closes this one first)

    function closePop(name) {
        popEl(name).hidden = true;
        if (name === 'music') {
            popEl('music').classList.remove('is-mini');
            stopRadio();
        }
    }

    // The radio can't just disappear while it plays (YouTube's player must stay visible),
    // so "closing" it shrinks it into a small mini player that keeps playing
    function setRadioMini(on) {
        popEl('music').classList.toggle('is-mini', on);
        syncDock();
    }

    function syncDock() {
        appBox.classList.toggle('music-open', isPanelOpen('music'));
        appBox.classList.toggle('music-mini', isPopOpen('music') && radioIsMini());
        dockButtons.forEach(b => b.setAttribute('aria-expanded', String(isPanelOpen(b.dataset.pop))));
    }

    function focusPanel(name) {
        (popEl(name).querySelector('.station, #radio-url, textarea, .sound-toggle') || popEl(name).querySelector('button')).focus();
    }

    // Opens a panel, or closes it if it's already open. On big screens the radio stays open
    // next to the other panel, so you can have lo-fi and rain together; on phones the radio shrinks instead.
    function setPop(name) {
        if (name === 'music') {
            if (!isPopOpen('music') || radioIsMini()) {        // open it (or grow the mini player back)
                popEl('music').hidden = false;
                popEl('music').classList.remove('is-mini');
                focusPanel('music');
            } else if (radioIsPlaying()) {
                setRadioMini(true);                           // keep the music going
            } else {
                closePop('music');
            }
        } else if (isPopOpen(name)) {
            closePop(name);
        } else {
            POPS.forEach(other => { if (other !== name && other !== 'music' && isPopOpen(other)) closePop(other); });
            if (isPanelOpen('music') && innerWidth < 1024) {
                if (radioIsPlaying()) setRadioMini(true); else closePop('music');
            }
            popEl(name).hidden = false;
            focusPanel(name);
        }
        openPop = isPanelOpen(name) ? name : (POPS.find(isPanelOpen) || null);
        syncDock();
    }

    dockButtons.forEach(b => b.addEventListener('click', () => setPop(b.dataset.pop)));
    document.querySelectorAll('.pop-close').forEach(b => b.addEventListener('click', () => {
        const name = b.closest('.dock-pop').id.replace('pop-', '');
        setPop(name);
        document.querySelector(`.dock-btn[data-pop="${name}"]`).focus();
    }));
    document.getElementById('radio-expand').addEventListener('click', () => setPop('music'));
    document.getElementById('radio-stop').addEventListener('click', () => {
        closePop('music');
        openPop = POPS.find(isPanelOpen) || null;
        syncDock();
        document.querySelector('.dock-btn[data-pop="music"]').focus();
    });

    // Lo-fi radio: a YouTube live stream in a small visible player
    const radioPlayer = document.getElementById('radio-player');
    const musicBtn = document.querySelector('.dock-btn[data-pop="music"]');

    function playRadio(videoId) {
        radioPlayer.innerHTML = '';
        const frame = document.createElement('iframe');
        frame.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}?autoplay=1&rel=0`;
        frame.title = 'Lo-fi radio';
        frame.allow = 'autoplay; encrypted-media; picture-in-picture';
        radioPlayer.appendChild(frame);
        document.querySelectorAll('.station').forEach(s => s.setAttribute('aria-pressed', String(s.dataset.video === videoId)));
        musicBtn.classList.add('is-playing');
    }
    const radioEmptyHtml = radioPlayer.innerHTML;
    function stopRadio() {
        radioPlayer.innerHTML = radioEmptyHtml;
        document.querySelectorAll('.station').forEach(s => s.setAttribute('aria-pressed', 'false'));
        musicBtn.classList.remove('is-playing');
    }

    // Your stations: links you pasted, saved in this browser (live streams change, so you pick your own)
    const stationsBox = document.getElementById('stations');
    const MAX_STATIONS = 4;
    let stations = [];
    try { stations = JSON.parse(readSetting('radioStations', '[]')); } catch (e) { stations = []; }

    function renderStations() {
        stationsBox.innerHTML = stations.map((id, i) => `
            <span class="station-chip">
                <button class="station" data-video="${escapeHtml(id)}" aria-pressed="false">Station ${i + 1}</button>
                <button class="station-remove" data-video="${escapeHtml(id)}" aria-label="Remove station ${i + 1}">
                    <i class="fa-solid fa-xmark" aria-hidden="true"></i>
                </button>
            </span>`).join('');
    }
    stationsBox.addEventListener('click', (e) => {
        const remove = e.target.closest('.station-remove');
        const play = e.target.closest('.station');
        if (remove) {
            stations = stations.filter(id => id !== remove.dataset.video);
            saveSetting('radioStations', JSON.stringify(stations));
            renderStations();
        } else if (play) {
            playRadio(play.dataset.video);
        }
    });
    renderStations();

    // Paste any YouTube link: youtube.com/watch?v=ID, youtu.be/ID, youtube.com/live/ID
    document.getElementById('radio-link').addEventListener('submit', (e) => {
        e.preventDefault();
        const input = document.getElementById('radio-url');
        const match = input.value.match(/(?:v=|youtu\.be\/|\/live\/|\/embed\/)([\w-]{11})/);
        if (!match) { showToast("That doesn't look like a YouTube video link."); return; }
        const id = match[1];
        stations = [id, ...stations.filter(s => s !== id)].slice(0, MAX_STATIONS);
        saveSetting('radioStations', JSON.stringify(stations));
        renderStations();
        playRadio(id);
        input.value = '';
    });

    // Cozy sounds, made live with the Web Audio API (no sound files needed)
    let audio = null;   // created on the first click: browsers only allow sound after you interact
    const sounds = {};
    const soundsBtn = document.querySelector('.dock-btn[data-pop="sounds"]');

    // 3 seconds of noise, made once per kind and reused (drops and crackles use it many times a second)
    const noiseCache = {};
    function noiseBuffer(kind) {
        if (noiseCache[kind]) return noiseCache[kind];
        const ctx = audio;
        const buffer = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        let last = 0;
        let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
        for (let i = 0; i < data.length; i++) {
            const white = Math.random() * 2 - 1;
            if (kind === 'brown') {          // deep rumble: each sample drifts from the last one
                last = (last + 0.02 * white) / 1.02;
                data[i] = last * 3.5;
            } else if (kind === 'pink') {    // softer than white noise, like steady rain (Paul Kellet's recipe)
                b0 = 0.99886 * b0 + white * 0.0555179;
                b1 = 0.99332 * b1 + white * 0.0750759;
                b2 = 0.96900 * b2 + white * 0.1538520;
                b3 = 0.86650 * b3 + white * 0.3104856;
                b4 = 0.55000 * b4 + white * 0.5329522;
                b5 = -0.7616 * b5 - white * 0.0168980;
                data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
                b6 = white * 0.115926;
            } else {
                data[i] = white;
            }
        }
        noiseCache[kind] = buffer;
        return buffer;
    }

    // Small helpers for building sounds
    function loopNoise(kind) {
        const src = audio.createBufferSource();
        src.buffer = noiseBuffer(kind);
        src.loop = true;
        return src;
    }
    function filter(type, frequency, q = 0.7) {
        const f = audio.createBiquadFilter();
        f.type = type;
        f.frequency.value = frequency;
        f.Q.value = q;
        return f;
    }
    function gainNode(value) {
        const g = audio.createGain();
        g.gain.value = value;
        return g;
    }

    // Each sound is noise shaped by filters: rain = soft downpour + patter + drops,
    // fire = rumble + crackles, wind = swelling whoosh
    const SOUND_RECIPES = {
        rain(out) {
            // 1. the steady downpour: pink noise (softer than white), with the harsh top cut off
            const bed = loopNoise('pink');
            const bedLevel = gainNode(0.5);
            bed.connect(filter('highpass', 150)).connect(filter('lowpass', 1600)).connect(bedLevel).connect(out);
            // the downpour gets a little heavier and lighter, slowly, like real rain
            const swell = audio.createOscillator();
            swell.frequency.value = 0.06;
            swell.connect(gainNode(0.12)).connect(bedLevel.gain);
            // 2. the patter: a quiet, brighter layer on top
            const patter = loopNoise('pink');
            patter.connect(filter('bandpass', 3200, 0.6)).connect(gainNode(0.08)).connect(out);
            bed.start();
            patter.start(0, 1.3);   // start at a different spot so the two layers don't line up
            swell.start();
            // 3. single drops tapping the window now and then
            let timer = null;
            const drop = () => {
                const tap = audio.createBufferSource();
                tap.buffer = noiseBuffer('white');
                const env = audio.createGain();
                const now = audio.currentTime;
                env.gain.setValueAtTime(0.03 + Math.random() * 0.07, now);
                env.gain.exponentialRampToValueAtTime(0.0005, now + 0.02 + Math.random() * 0.03);
                tap.connect(filter('bandpass', 2200 + Math.random() * 3500, 4)).connect(env).connect(out);
                tap.start(now, Math.random() * 2, 0.06);
                timer = setTimeout(drop, 40 + Math.random() * 180);
            };
            drop();
            return () => { bed.stop(); patter.stop(); swell.stop(); clearTimeout(timer); };
        },
        fire(out) {
            const src = audio.createBufferSource();
            src.buffer = noiseBuffer('brown');
            src.loop = true;
            const low = audio.createBiquadFilter();
            low.type = 'lowpass';
            low.frequency.value = 500;
            src.connect(low).connect(out);
            src.start();
            // little random crackles
            let timer = null;
            const crackle = () => {
                const pop = audio.createBufferSource();
                pop.buffer = noiseBuffer('white');
                const band = audio.createBiquadFilter();
                band.type = 'bandpass';
                band.frequency.value = 1500 + Math.random() * 2500;
                const env = audio.createGain();
                const now = audio.currentTime;
                env.gain.setValueAtTime(0.25 + Math.random() * 0.35, now);
                env.gain.exponentialRampToValueAtTime(0.001, now + 0.03 + Math.random() * 0.05);
                pop.connect(band).connect(env).connect(out);
                pop.start(now, Math.random() * 2, 0.1);
                timer = setTimeout(crackle, 60 + Math.random() * 450);
            };
            crackle();
            return () => { src.stop(); clearTimeout(timer); };
        },
        wind(out) {
            const src = audio.createBufferSource();
            src.buffer = noiseBuffer('brown');
            src.loop = true;
            const band = audio.createBiquadFilter();
            band.type = 'bandpass';
            band.frequency.value = 500;
            band.Q.value = 0.8;
            // a slow wobble moves the filter, so the wind swells and fades
            const wobble = audio.createOscillator();
            wobble.frequency.value = 0.12;
            const depth = audio.createGain();
            depth.gain.value = 300;
            wobble.connect(depth).connect(band.frequency);
            const level = audio.createGain();
            level.gain.value = 1.6;
            src.connect(band).connect(level).connect(out);
            src.start();
            wobble.start();
            return () => { src.stop(); wobble.stop(); };
        },
    };

    function toggleSound(name, button) {
        audio = audio || new (window.AudioContext || window.webkitAudioContext)();
        if (sounds[name]) {
            sounds[name].stop();
            delete sounds[name];
        } else {
            const out = audio.createGain();
            out.gain.value = Number(document.querySelector(`.sound-volume[data-sound="${name}"]`).value);
            out.connect(audio.destination);
            sounds[name] = { out, stop: SOUND_RECIPES[name](out) };
        }
        button.setAttribute('aria-pressed', String(Boolean(sounds[name])));
        soundsBtn.classList.toggle('is-playing', Object.keys(sounds).length > 0);
    }
    document.querySelectorAll('.sound-toggle').forEach(b => b.addEventListener('click', () => toggleSound(b.dataset.sound, b)));
    document.querySelectorAll('.sound-volume').forEach(slider => slider.addEventListener('input', () => {
        const playing = sounds[slider.dataset.sound];
        if (playing) playing.out.gain.setTargetAtTime(Number(slider.value), audio.currentTime, 0.05);
    }));

    // Focus timer: 25 minutes focus, then 5 minutes break (15 after every 4th focus)
    const TIMER = { focus: 25 * 60, break: 5 * 60, longBreak: 15 * 60 };
    const timerBox = document.getElementById('timer');
    const timerTime = document.getElementById('timer-time');
    const timerMode = document.getElementById('timer-mode');
    const timerToggle = document.getElementById('timer-toggle');
    const timerCountNum = document.getElementById('timer-count-num');
    let timerPhase = 'focus';
    let timerLeft = TIMER.focus;
    let timerEnd = null;     // when the running timer finishes (a timestamp, so it never drifts)
    let timerTick = null;
    const todayKey = () => `focusCount-${new Date().toDateString()}`;
    let focusCount = Number(readSetting(todayKey(), '0'));
    timerCountNum.textContent = focusCount;

    function showTimer() {
        const m = Math.floor(timerLeft / 60), s = timerLeft % 60;
        const text = `${m}:${String(s).padStart(2, '0')}`;
        timerTime.textContent = text;
        timerMode.textContent = timerPhase === 'focus' ? 'Focus' : 'Break';
        timerBox.classList.toggle('is-break', timerPhase !== 'focus');
        document.title = timerEnd ? `(${text}) UniLife Copilot` : 'UniLife Copilot';
    }

    function setTimerRunning(on) {
        clearInterval(timerTick);
        timerEnd = on ? Date.now() + timerLeft * 1000 : null;
        if (on) timerTick = setInterval(tickTimer, 250);
        timerToggle.innerHTML = `<i class="fa-solid ${on ? 'fa-pause' : 'fa-play'}" aria-hidden="true"></i>`;
        timerToggle.setAttribute('aria-label', on ? 'Pause the timer' : `Start the ${timerPhase === 'focus' ? 'focus' : 'break'} timer`);
        showTimer();
    }

    function chime() {
        audio = audio || new (window.AudioContext || window.webkitAudioContext)();
        [660, 880].forEach((freq, i) => {
            const tone = audio.createOscillator();
            const env = audio.createGain();
            const start = audio.currentTime + i * 0.22;
            tone.frequency.value = freq;
            env.gain.setValueAtTime(0.0001, start);
            env.gain.exponentialRampToValueAtTime(0.25, start + 0.02);
            env.gain.exponentialRampToValueAtTime(0.0001, start + 0.6);
            tone.connect(env).connect(audio.destination);
            tone.start(start);
            tone.stop(start + 0.65);
        });
    }

    function tickTimer() {
        timerLeft = Math.max(0, Math.round((timerEnd - Date.now()) / 1000));
        showTimer();
        if (timerLeft > 0) return;
        chime();
        if (timerPhase === 'focus') {
            focusCount += 1;
            saveSetting(todayKey(), String(focusCount));
            timerCountNum.textContent = focusCount;
            const long = focusCount % 4 === 0;
            timerPhase = 'break';
            timerLeft = long ? TIMER.longBreak : TIMER.break;
            ollieSay('', `Focus session done! That's ${focusCount} today. Take a ${long ? 15 : 5} minute break.`, { mood: 'happy' });
        } else {
            timerPhase = 'focus';
            timerLeft = TIMER.focus;
            ollieSay('', "Break's over. Ready for another focus session? Press play when you are.", { mood: 'explain' });
        }
        setTimerRunning(false);
    }

    timerToggle.addEventListener('click', () => setTimerRunning(!timerEnd));
    document.getElementById('timer-reset').addEventListener('click', () => {
        timerPhase = 'focus';
        timerLeft = TIMER.focus;
        setTimerRunning(false);
    });
    showTimer();

    // Quick notes: saved in this browser as you type
    const quickNotes = document.getElementById('quick-notes');
    const notesStatus = document.getElementById('notes-status');
    let notesTimer = null;
    quickNotes.value = readSetting('quickNotes', '');
    quickNotes.addEventListener('input', () => {
        notesStatus.textContent = 'Saving...';
        clearTimeout(notesTimer);
        notesTimer = setTimeout(() => {
            saveSetting('quickNotes', quickNotes.value);
            notesStatus.textContent = 'Saved on this device.';
        }, 400);
    });
    document.getElementById('clear-notes').addEventListener('click', () => {
        if (!quickNotes.value || !confirm('Clear all your quick notes?')) return;
        quickNotes.value = '';
        saveSetting('quickNotes', '');
        quickNotes.focus();
    });

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
        uploadSubjectId = null;
        fileInput.click();
    });

    document.getElementById('upload-btn').addEventListener('click', () => { uploadSubjectId = null; fileInput.click(); });

    function preventDefaults(e) {
        e.preventDefault();
        e.stopPropagation();
    }
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        document.body.addEventListener(eventName, preventDefaults, false);
    });

    // You can drop a PDF on the drawer's drop zone or straight onto the task list
    [dropZone, tasksPanel].forEach(target => {
        ['dragenter', 'dragover'].forEach(eventName => {
            target.addEventListener(eventName, () => target.classList.add('dragover'), false);
        });
        ['dragleave', 'drop'].forEach(eventName => {
            target.addEventListener(eventName, () => target.classList.remove('dragover'), false);
        });
        target.addEventListener('drop', (e) => handleFiles(e.dataTransfer.files));
    });
    fileInput.addEventListener('change', function() {
        handleFiles(this.files, uploadSubjectId);
        uploadSubjectId = null;
    });

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
        if (chatBtn) openDocChat(chatBtn.getAttribute('data-id'));
    }));

    function openDocChat(taskId) {
        currentChatTaskId = taskId;
        chatModal.classList.add('active');
        chatMessages.innerHTML = `
            <div class="chat-message ai-message">
                <div class="message-bubble">Hello! Ask me any questions about this document.</div>
            </div>
        `;
        chatInput.value = '';
        setTimeout(() => chatInput.focus(), 300);
    }

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
            } else if (/^\s*(\*\*)?\s*#{1,4}\s/.test(lines[i])) {
                // A heading like "## Key points" (sometimes the AI also makes it bold)
                const text = lines[i].replace(/^\s*(\*\*)?\s*#{1,4}\s+/, '').replace(/\s*(\*\*)?\s*$/, '');
                pieces.push({ block: true, html: `<span class="md-heading">${formatInline(text)}</span>` });
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

    function appendAgentMessage(html, isUser = false) {
        const msgDiv = document.createElement('div');
        msgDiv.className = `chat-message ${isUser ? 'user-message' : 'ai-message'}`;
        msgDiv.innerHTML = `<div class="message-bubble">${html}</div>`;
        agentMessages.appendChild(msgDiv);
        agentMessages.scrollTop = agentMessages.scrollHeight;
        return msgDiv;
    }

    // Small extras (tool badges, sources) under an answer in the chat
    function addExtra(element) {
        agentMessages.appendChild(element);
        agentMessages.scrollTop = agentMessages.scrollHeight;
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
        list_subjects: ['fa-book', () => 'Looked through your subjects'],
        summarise_document: ['fa-wand-magic-sparkles', () => 'Summarised a chapter'],
        read_my_notes: ['fa-note-sticky', () => 'Read your notes'],
        save_note: ['fa-floppy-disk', (a) => `Prepared a note${a.title ? `: ${a.title}` : ''}`],
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

    // Same idea for a note in a subject folder
    function appendPendingNoteCard(note) {
        const preview = note.body.length > 160 ? `${note.body.slice(0, 160)}...` : note.body;
        appendConfirmCard([['strong', note.title], ['span', `In: ${note.subject_label}`], ['span', preview]],
            'Saved to your notes.', async () => {
                const response = await fetch(`${API}/api/agent/save-note`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(note),
                });
                if (!response.ok) throw new Error('Could not save the note.');
                showToast('Note saved!');
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
        agentMessages.appendChild(card);
        agentMessages.scrollTop = agentMessages.scrollHeight;

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
            if (data.pending_note) appendPendingNoteCard(data.pending_note);
            if (data.sources && data.sources.length) appendSources(data.sources);
            if (data.tools_used.some(t => t.name.endsWith('_preference'))) loadMemory();

            // Ollie's mood: happy when it prepared something or learned about you,
            // "um, actually" when it explains something from your notes or a long answer
            const didSomething = data.pending_task || data.pending_edit || data.pending_note
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

    // subjectId: the folder to put it in; without one, it goes in the folder of its course code
    async function handleFiles(files, subjectId = null) {
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
        if (subjectId) formData.append('subject_id', subjectId);
        if (isShelfOpen()) showToast('Ollie is reading your PDF...', 4);

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
            document.dispatchEvent(new Event('pdf-uploaded'));

        } catch (error) {
            if (isShelfOpen()) showToast(`Ollie couldn't read that PDF. ${error.message}`, 6);
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
        renderPeek(tasks);

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
