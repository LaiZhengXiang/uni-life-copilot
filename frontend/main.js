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

    function showToast(message) {
        toast.innerHTML = `<i class="fa-solid fa-rocket"></i> ${message}`;
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 3000);
    }

    // Nav Links
    document.querySelectorAll('.nav-links a:not(.active)').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            showToast('Feature coming soon!');
        });
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

    // Task Card Actions (Chat & Delete)
    cardsContainer.addEventListener('click', async (e) => {
        // Delete Task
        const deleteBtn = e.target.closest('.delete-btn');
        if (deleteBtn) {
            const taskId = deleteBtn.getAttribute('data-id');
            if (!taskId) return;
            const col = deleteBtn.closest('.extraction-col');
            col.style.opacity = '0.4';
            col.style.pointerEvents = 'none';
            try {
                const response = await fetch(`http://127.0.0.1:8000/api/tasks/${taskId}`, { method: 'DELETE' });
                if (response.ok) {
                    col.remove();
                    showToast('Task successfully deleted!');
                    if (cardsContainer.querySelectorAll('.extraction-col').length === 0) renderCards([]);
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
        const escaped = text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
        return escaped
            .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
            .replace(/`([^`]+)`/g, '<code>$1</code>')
            .replace(/^\s*[*-]\s+/gm, '• ')
            .replace(/\n/g, '<br>');
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
            const response = await fetch('http://127.0.0.1:8000/api/chat', {
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

    // Fetch API Functions
    async function loadExistingTasks() {
        try {
            const response = await fetch('http://127.0.0.1:8000/api/tasks');
            if (response.ok) {
                const data = await response.json();
                renderCards(data, null);
            }
        } catch(error) {
            console.error("Could not load existing tasks", error);
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
            const response = await fetch('http://127.0.0.1:8000/api/parse-assignment', {
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

    function renderCards(parsedDocuments, filename) {
        cardsContainer.innerHTML = ''; 
        if (badge) badge.textContent = `${parsedDocuments ? parsedDocuments.length : 0} found`;

        if (!parsedDocuments || parsedDocuments.length === 0) {
            cardsContainer.innerHTML = `
                <div class="extraction-col" style="grid-column: 1 / -1;">
                    <div class="task-card" style="text-align: center; padding: 3rem;">
                        <i class="fa-solid fa-ghost" style="font-size: 2rem; opacity: 0.5; margin-bottom: 1rem;"></i>
                        <p class="card-desc">No tasks or recognizable information saved in the database yet.</p>
                    </div>
                </div>
            `;
            return;
        }

        parsedDocuments.forEach((item, index) => {
            let deadlineHtml = '';
            if (item.deadline) {
                const d = new Date(item.deadline);
                const dateStr = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
                const timeStr = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
                deadlineHtml = `
                    <div class="deadline-box">
                        <i class="fa-regular fa-calendar"></i>
                        <div class="deadline-text">
                            <span class="deadline-label">DEADLINE DATE</span>
                            <span class="deadline-value">${dateStr} at ${timeStr}</span>
                        </div>
                    </div>
                `;
            }

            let stepsHtml = '';
            if (item.milestones && item.milestones.length > 0) {
                const steps = item.milestones.map((step, i) => `
                    <li class="${i===0 ? 'completed' : ''}">
                        <i class="fa-${i===0 ? 'solid fa-circle-check' : 'regular fa-circle'}"></i> ${step}
                    </li>
                `).join('');
                stepsHtml = `<div class="extracted-steps"><h4>AUTOMATICALLY EXTRACTED STEPS</h4><ul>${steps}</ul></div>`;
            }

            let conceptsHtml = '';
            if (item.key_concepts && item.key_concepts.length > 0) {
                const concepts = item.key_concepts.map(c => `<span class="tag gray" style="margin-bottom: 0.5rem; display: inline-block;">${c}</span>`).join(' ');
                conceptsHtml = `<div class="extracted-steps"><h4>KEY CONCEPTS TO REVIEW</h4><div>${concepts}</div></div>`;
            }

            let urgencyHtml = '';
            if (item.urgency_score) {
                if (item.urgency_score > 7) {
                     urgencyHtml = `<span class="tag red"><span class="dot red-dot"></span> URGENCY: ${item.urgency_score}/10</span>`;
                } else if (item.urgency_score > 4) {
                     urgencyHtml = `<span class="tag gray" style="color: #fbbf24; border: 1px solid rgba(251, 191, 36, 0.3); background: rgba(251, 191, 36, 0.1);"><span class="dot" style="background-color: #fbbf24; display: inline-block; margin-right: 4px;"></span> URGENCY: ${item.urgency_score}/10</span>`;
                } else {
                     urgencyHtml = `<span class="tag gray"><span class="dot blue"></span> URGENCY: ${item.urgency_score}/10</span>`;
                }
            }

            const cardActions = `
                <div class="card-actions">
                    ${item.id ? `<button class="chat-btn" data-id="${item.id}" title="Chat with Document"><i class="fa-regular fa-comment-dots"></i> Chat</button>` : ''}
                    ${item.id ? `<button class="delete-btn" data-id="${item.id}" title="Delete Task"><i class="fa-regular fa-trash-can"></i></button>` : ''}
                </div>
            `;

            const cardHtml = `
                <div class="extraction-col">
                    <div class="col-header" style="display: flex; justify-content: space-between; align-items: center;">
                        <span><span class="dot blue"></span> SAVED TASK</span>
                        ${cardActions}
                    </div>
                    <div class="task-card">
                        <div class="card-tags">
                            <span class="tag gray">${(item.task_type || item.document_type || 'DOCUMENT').toUpperCase()}</span>
                            ${urgencyHtml}
                        </div>
                        
                        <h3 class="card-title">${item.title || item.course_name || 'Untitled Analysis'}</h3>
                        <p class="card-desc">${item.details || 'No details provided.'}</p>
                        
                        ${deadlineHtml}
                        
                        ${item.document_type === 'Assignment' ? stepsHtml : conceptsHtml}

                        <div class="card-footer">
                            <div class="source-file"><i class="fa-solid fa-database"></i> Database Record</div>
                            <a href="#" class="launch-link">Launch Copilot Workspace <i class="fa-solid fa-chevron-right"></i></a>
                        </div>
                    </div>
                </div>
            `;
            cardsContainer.innerHTML += cardHtml;
        });
    }
});
