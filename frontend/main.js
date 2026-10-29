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
        toast.innerHTML = `<i class="fa-solid fa-rocket"></i> <span>${message}</span>`;
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
            : '<p>Nothing due soon. 🎉</p>');
    }

    bellBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        bellDropdown.hidden = !bellDropdown.hidden;
    });
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.bell-wrapper')) bellDropdown.hidden = true;
    });

    // View Toggles
    const gridBtn = document.querySelector('.view-toggles button:nth-child(1)');
    const listBtn = document.querySelector('.view-toggles button:nth-child(2)');
    gridBtn.addEventListener('click', () => {
        gridBtn.classList.add('active');
        listBtn.classList.remove('active');
        cardsContainer.classList.remove('list-view');
    });
    listBtn.addEventListener('click', () => {
        listBtn.classList.add('active');
        gridBtn.classList.remove('active');
        cardsContainer.classList.add('list-view');
    });

    // Initial Load
    loadExistingTasks();

    // File Input Logic
    browseBtn.addEventListener('click', (e) => {
        e.preventDefault();
        fileInput.click();
    });

    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, preventDefaults, false);
        document.body.addEventListener(eventName, preventDefaults, false);
    });

    function preventDefaults(e) {
        e.preventDefault();
        e.stopPropagation();
    }

    ['dragenter', 'dragover'].forEach(eventName => {
        dropZone.addEventListener(eventName, () => dropZone.classList.add('dragover'), false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, () => dropZone.classList.remove('dragover'), false);
    });

    dropZone.addEventListener('drop', (e) => handleFiles(e.dataTransfer.files));
    fileInput.addEventListener('change', function() { handleFiles(this.files); });

    // Task Card Actions (tick steps, done, edit, chat, delete)
    cardsContainer.addEventListener('click', async (e) => {
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
                showToast(task.is_done ? 'Moved back to your to-do list.' : 'Nice work! Task done. 🎉');
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
            const col = deleteBtn.closest('.extraction-col');
            col.style.opacity = '0.4';
            col.style.pointerEvents = 'none';
            try {
                if (!confirm('Delete this task?')) {
                    col.style.opacity = '1';
                    col.style.pointerEvents = 'auto';
                    return;
                }
                const response = await fetch(`${API}/api/tasks/${taskId}`, { method: 'DELETE' });
                if (response.ok) {
                    showToast('Task successfully deleted!');
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
    });

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
            appendChatMessage(`⚠️ Error: ${error.message}`, false);
        }
    }

    sendChatBtn.addEventListener('click', sendChatMessage);
    chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendChatMessage();
    });

    // Ask Copilot: the study-secretary agent
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

    // RAG: which of your PDFs the answer came from, so you can open them and check
    function appendSources(sources) {
        const box = document.createElement('div');
        box.className = 'sources-box';
        box.innerHTML = '<span class="sources-label"><i class="fa-solid fa-book-open"></i> From your notes:</span>'
            + sources.map(s => `<span class="source-chip" title="${escapeHtml(s.course)}">${escapeHtml(s.title)}${s.page ? `, p.${s.page}` : ''}</span>`).join('');
        agentMessages.appendChild(box);
        agentMessages.scrollTop = agentMessages.scrollHeight;
    }

    // A small badge per tool the agent used, so you can see it "doing" things
    function appendToolBadge(tool) {
        const args = Object.entries(tool.args).map(([k, v]) => `${k}=${v}`).join(', ');
        const badge = document.createElement('div');
        badge.className = 'tool-badge';
        badge.textContent = `🔧 used ${tool.name}(${args})`;
        agentMessages.appendChild(badge);
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
            else if (field === 'is_done') lines.push(['span', value ? 'Mark as done ✅' : 'Mark as not done']);
            else lines.push(['span', `${labels[field] || field}: ${value}`]);
        });
        appendConfirmCard(lines, 'Task updated.', async () => {
            await updateTask(edit.task_id, edit.changes);
            showToast('Task updated!');
        });
    }

    // A small card in the chat with Save / Cancel. onSave does the real saving.
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
            <button class="save-task-btn"><i class="fa-solid fa-check"></i> Save</button>
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
                buttons.textContent = `✅ ${savedText}`;
                await loadExistingTasks();
            } catch (error) {
                console.error(error);
                buttons.textContent = `⚠️ ${error.message}`;
            }
        });
    }

    async function askAgent() {
        const text = agentInput.value.trim();
        if (!text) return;

        appendAgentMessage(formatChatText(text), true);
        agentInput.value = '';
        const thinking = appendAgentMessage('<i class="fa-solid fa-spinner fa-spin"></i> Thinking...');

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
        } catch (error) {
            console.error(error);
            thinking.remove();
            appendAgentMessage(formatChatText(`⚠️ Error: ${error.message}`));
        }
    }

    agentSendBtn.addEventListener('click', askAgent);
    agentInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') askAgent();
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
        appendAgentMessage('Hi! I\'m your study buddy. Try: "Explain GET vs POST from my notes", "What\'s due this week?" or "Remember that I study best in the morning".');
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
        agentInput.focus();
    });

    // Long-term: preferences, shown so you can see (and delete) what Copilot remembers
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
                : '<li class="memory-empty">Nothing yet. Tell Copilot your study habits and it will remember them.</li>';
        } catch (error) {
            console.error('Could not load memory', error);
        }
    }

    memoryList.addEventListener('click', async (e) => {
        const btn = e.target.closest('.forget-btn');
        if (!btn) return;
        await fetch(`${API}/api/preferences/${btn.dataset.id}`, { method: 'DELETE' });
        // Copilot also reads this chat (short-term memory), so it may still know the thing you deleted
        const chatHasMessages = agentMessages.querySelector('.user-message') !== null;
        showToast(chatHasMessages
            ? 'Forgotten. Copilot can still see it in this chat, so click <strong>New chat</strong> to fully reset.'
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

    async function handleFiles(files) {
        if (files.length === 0) return;
        const file = files[0];
        
        if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
            alert('Please upload a valid PDF document.');
            return;
        }

        const originalTitle = dropZoneTitle.textContent;
        const originalIconClass = dropZoneIcon.className;
        
        dropZoneTitle.textContent = 'Parsing document...';
        dropZoneIcon.className = 'fa-solid fa-spinner fa-spin';
        dropZone.style.pointerEvents = 'none';
        dropZone.style.opacity = '0.7';

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
            
            showToast('Document parsed successfully!');
            await loadExistingTasks();

        } catch (error) {
            console.error("Upload error:", error);
            cardsContainer.innerHTML = `
                <div class="extraction-col" style="grid-column: 1 / -1;">
                    <div class="col-header">
                        <span class="dot red-dot"></span> SYSTEM ERROR
                    </div>
                    <div class="task-card" style="border-color: rgba(248, 113, 113, 0.4);">
                        <h3 class="card-title" style="color: var(--text-red);">Extraction Failed</h3>
                        <p class="card-desc">${error.message}</p>
                        <div class="deadline-box" style="margin-top: 15px; background: rgba(248, 113, 113, 0.1);">
                            <i class="fa-solid fa-triangle-exclamation" style="color: var(--text-red);"></i>
                            <div class="deadline-text">
                                <span class="deadline-label">TROUBLESHOOTING</span>
                                <span class="deadline-value">${error.busy
                                    ? 'The AI is overloaded. Nothing was saved, so just upload the PDF again in a minute.'
                                    : 'Ensure the FastAPI server is running and dependencies are installed.'}</span>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        } finally {
            dropZoneTitle.textContent = originalTitle;
            dropZoneIcon.className = originalIconClass;
            dropZone.style.pointerEvents = 'auto';
            dropZone.style.opacity = '1';
            fileInput.value = '';
        }
    }

    function renderCards(tasks) {
        if (badge) badge.textContent = `${tasks.length} found`;

        if (tasks.length === 0) {
            cardsContainer.innerHTML = `
                <div class="waiting-card" style="grid-column: 1 / -1;">
                    <i class="fa-solid fa-wand-magic-sparkles waiting-icon"></i>
                    <h3>No tasks yet</h3>
                    <p>Upload an assignment PDF, or tell Ask Copilot: "Add my lab report for BACS2093, due next Friday".</p>
                </div>`;
            return;
        }

        cardsContainer.innerHTML = tasks.map(renderCard).join('');
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

        let urgencyHtml = '';
        if (item.urgency_score && isAssignment && !item.is_done) {
            if (item.urgency_score > 7) {
                urgencyHtml = `<span class="tag red"><span class="dot red-dot"></span> URGENCY: ${item.urgency_score}/10</span>`;
            } else if (item.urgency_score > 4) {
                urgencyHtml = `<span class="tag gray" style="color: #fbbf24; border: 1px solid rgba(251, 191, 36, 0.3); background: rgba(251, 191, 36, 0.1);"><span class="dot" style="background-color: #fbbf24; display: inline-block; margin-right: 4px;"></span> URGENCY: ${item.urgency_score}/10</span>`;
            } else {
                urgencyHtml = `<span class="tag gray"><span class="dot blue"></span> URGENCY: ${item.urgency_score}/10</span>`;
            }
        }

        // Chat only works when we have the PDF's text (tasks added by chatting don't have one)
        const chatButton = item.raw_text
            ? `<button class="chat-btn" data-id="${item.id}" title="Ask questions about this PDF"><i class="fa-regular fa-comment-dots"></i> Chat</button>`
            : '';
        const cardActions = `
            <div class="card-actions">
                ${chatButton}
                <button class="edit-btn" title="Edit task"><i class="fa-regular fa-pen-to-square"></i></button>
                <button class="delete-btn" data-id="${item.id}" title="Delete task"><i class="fa-regular fa-trash-can"></i></button>
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
                <div class="col-header" style="display: flex; justify-content: space-between; align-items: center;">
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
