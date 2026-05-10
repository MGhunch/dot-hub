// ===== TODO MODULE =====
// Owns the Todo view. Patterned on tracker.js.
// Depends on: $, $$, state, API_BASE, getLogoUrl, showToast
// Exposes: renderTodos, loadTodos

// ===== TODO STATE =====
let todos = [];
let todosLoaded = false;
let todosLoading = false;

// Modal state
let editingTodoId = null; // null = add mode, string = edit mode
let todoModalState = { clientCode: null, clientName: null, bucket: 'OTHER', urgent: false };
let cachedClients = null; // /api/clients result, loaded once per session

// ===== ICONS =====
const ICON_TICK_EMPTY = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/></svg>';
const ICON_TICK_DONE = '<svg width="22" height="22" viewBox="0 0 24 24" fill="#ED1C24" stroke="#ED1C24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="8 12 11 15 16 9" stroke="white" fill="none"/></svg>';
const ICON_X = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';

// ===== ENTRY POINT =====
async function renderTodos() {
    // Render shells immediately so loader shows
    renderTodoShell();
    if (!todosLoaded || todos.length === 0) {
        await loadTodos();
    }
    renderTodoContent();
}

function renderTodoShell() {
    document.querySelectorAll('.todo-content').forEach(el => {
        el.innerHTML = '<div class="loading"><div class="loading-spinner"></div><p>Loading todos...</p></div>';
    });
}

// ===== LOAD =====
async function loadTodos() {
    if (todosLoading) return;
    todosLoading = true;
    try {
        const response = await fetch(`${API_BASE}/todos?_t=${Date.now()}`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        todos = await response.json();
        todosLoaded = true;
    } catch (err) {
        console.error('[Todo] Failed to load todos', err);
        todos = [];
        document.querySelectorAll('.todo-content').forEach(el => {
            el.innerHTML = '<div class="todo-error">Couldn\'t load todos. Try again in a moment.</div>';
        });
    } finally {
        todosLoading = false;
    }
}

// ===== RENDER =====
function renderTodoContent() {
    const clientsTodos = todos.filter(t => t.bucket === 'CLIENTS');
    const otherTodos = todos.filter(t => t.bucket === 'OTHER');

    const html = `
        <div class="todo-columns">
            ${renderTodoColumn('Client Work', clientsTodos)}
            ${renderTodoColumn('Other', otherTodos)}
        </div>
    `;

    document.querySelectorAll('.todo-content').forEach(el => {
        el.innerHTML = html;
    });
}

function renderTodoColumn(label, items) {
    // Sort: urgent live → live → done (newest first within each)
    // API already returns newest first, so we just split by status.
    const liveUrgent = items.filter(t => !t.done && t.urgent);
    const liveNormal = items.filter(t => !t.done && !t.urgent);
    const done = items.filter(t => t.done);

    const liveCards = [...liveUrgent, ...liveNormal].map(renderTodoCard).join('');
    const doneCards = done.map(renderTodoCard).join('');

    let body = '';
    if (liveCards) body += liveCards;
    if (!liveCards && !doneCards) {
        body = `<div class="todo-empty">Nothing in ${label.toLowerCase()} yet</div>`;
    }
    if (doneCards) body += `<div class="todo-done-divider"></div>${doneCards}`;

    return `
        <div class="todo-column">
            <div class="section-title">${label}</div>
            <div class="todo-list">${body}</div>
        </div>
    `;
}

function renderTodoCard(todo) {
    const logoUrl = todo.clientId ? getTodoLogoUrl(todo.clientName) : 'images/logos/Unknown.png';

    const classes = ['todo-card'];
    if (todo.urgent) classes.push('urgent');
    if (todo.done) classes.push('done');

    return `
        <div class="${classes.join(' ')}" data-todo-id="${todo.id}">
            <div class="todo-logo">
                <img src="${logoUrl}" alt="" onerror="this.src='images/logos/Unknown.png'">
            </div>
            <div class="todo-main" data-action="edit">
                <div class="todo-title">${escapeHtml(todo.title)}</div>
            </div>
            <div class="todo-tick" data-action="toggle" title="${todo.done ? 'Mark not done' : 'Mark done'}">
                ${todo.done ? ICON_TICK_DONE : ICON_TICK_EMPTY}
            </div>
        </div>
    `;
}

// ===== HELPERS =====
function escapeHtml(s) {
    if (!s) return '';
    return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// Try to map clientName back to a logo. Falls back to Unknown.
// We don't have clientCode in the todo payload — only the friendly name from the lookup.
// The frontend already has CLIENT_DISPLAY_NAMES (code -> name); reverse-map for logo lookup.
function getTodoLogoUrl(clientName) {
    if (!clientName) return 'images/logos/Unknown.png';
    // Try direct: if clientName matches a known client logo by code, use it
    // Otherwise try reverse-lookup against CLIENT_DISPLAY_NAMES
    const reverseMap = window.CLIENT_DISPLAY_NAMES_REVERSE || buildClientReverseMap();
    const code = reverseMap[clientName] || guessCodeFromName(clientName);
    return getLogoUrl(code);
}

function buildClientReverseMap() {
    // Build once, cache on window
    const map = {};
    if (typeof CLIENT_DISPLAY_NAMES !== 'undefined') {
        Object.entries(CLIENT_DISPLAY_NAMES).forEach(([code, name]) => {
            map[name] = code;
        });
    }
    window.CLIENT_DISPLAY_NAMES_REVERSE = map;
    return map;
}

function guessCodeFromName(name) {
    // Last-resort guesses for clients not in CLIENT_DISPLAY_NAMES
    const lower = name.toLowerCase();
    if (lower === 'sky') return 'SKY';
    if (lower === 'tower') return 'TOW';
    if (lower === 'fisher funds') return 'FIS';
    if (lower === 'hunch') return 'HUN';
    if (lower.startsWith('one nz')) {
        if (lower.includes('business')) return 'ONB';
        if (lower.includes('simplification')) return 'ONS';
        return 'ONE';
    }
    return name.slice(0, 3).toUpperCase();
}

// ===== ACTIONS =====
async function toggleTodoDone(todoId) {
    const todo = todos.find(t => t.id === todoId);
    if (!todo) return;
    const newDone = !todo.done;

    // Optimistic update
    todo.done = newDone;
    renderTodoContent();

    try {
        const response = await fetch(`${API_BASE}/todos/${todoId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ done: newDone }),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
    } catch (err) {
        console.error('[Todo] Toggle failed', err);
        // Revert
        todo.done = !newDone;
        renderTodoContent();
        if (typeof showToast === 'function') showToast('Couldn\'t update todo');
    }
}

async function deleteTodo(todoId) {
    const idx = todos.findIndex(t => t.id === todoId);
    if (idx === -1) return;
    const removed = todos[idx];

    // Optimistic remove
    todos.splice(idx, 1);
    renderTodoContent();

    try {
        const response = await fetch(`${API_BASE}/todos/${todoId}`, { method: 'DELETE' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
    } catch (err) {
        console.error('[Todo] Delete failed', err);
        // Revert
        todos.splice(idx, 0, removed);
        renderTodoContent();
        if (typeof showToast === 'function') showToast('Couldn\'t delete todo');
    }
}

// ===== EVENT DELEGATION =====
document.addEventListener('click', (e) => {
    const card = e.target.closest('.todo-card');
    if (!card) return;
    const todoId = card.dataset.todoId;
    if (!todoId) return;

    const actionEl = e.target.closest('[data-action]');
    if (!actionEl) return;
    const action = actionEl.dataset.action;

    if (action === 'toggle') {
        toggleTodoDone(todoId);
    } else if (action === 'edit') {
        openTodoModal(todoId);
    }
});

// ===== MODAL: OPEN / CLOSE =====
async function openTodoModal(todoId) {
    const modal = document.getElementById('todo-edit-modal');
    if (!modal) return;

    // Determine mode
    editingTodoId = todoId || null;
    const isEdit = !!editingTodoId;
    const todo = isEdit ? todos.find(t => t.id === editingTodoId) : null;
    if (isEdit && !todo) {
        console.warn('[Todo] openTodoModal: todo not found', todoId);
        return;
    }

    // Reset modal state
    todoModalState = {
        clientCode: null,
        clientName: null,
        bucket: todo ? (todo.bucket || 'OTHER') : 'OTHER',
        urgent: todo ? !!todo.urgent : false,
    };

    // Title text + button label
    document.getElementById('todo-modal-title').textContent = isEdit ? 'Edit Todo' : 'Add Todo';
    const saveBtn = document.getElementById('todo-modal-save-btn');
    if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save';
    }

    // Title input
    const titleInput = document.getElementById('todo-modal-title-input');
    titleInput.value = todo ? (todo.title || '') : '';

    // Urgent toggle
    document.getElementById('todo-modal-urgent').checked = todoModalState.urgent;

    // Bucket dropdown — set initial display + selected option
    setTodoModalDropdown('bucket', todoModalState.bucket, todoModalState.bucket === 'CLIENTS' ? 'Client Work' : 'Other');

    // Client dropdown — placeholder "None" until clients load
    const clientTrigger = document.getElementById('todo-modal-client-trigger');
    clientTrigger.querySelector('span').textContent = 'Loading...';
    document.getElementById('todo-modal-client-menu').innerHTML = '';

    // Modal logo defaults to robot/unknown
    const modalLogo = document.getElementById('todo-modal-logo');
    modalLogo.src = todo && todo.clientName ? getTodoLogoUrl(todo.clientName) : 'images/logos/Unknown.png';
    modalLogo.onerror = function() { this.src = 'images/logos/Unknown.png'; };

    // Show/hide Delete button
    const deleteBtn = document.getElementById('todo-modal-delete-btn');
    deleteBtn.style.display = isEdit ? '' : 'none';

    // Show modal
    modal.classList.add('visible');

    // Focus title input (after transition)
    setTimeout(() => titleInput.focus(), 50);

    // Load clients (cached after first load)
    await loadTodoModalClients();

    // Now set the client selection if editing
    if (isEdit && todo && todo.clientName) {
        // Try to match by name to find the code
        const match = (cachedClients || []).find(c => c.name === todo.clientName);
        if (match) {
            todoModalState.clientCode = match.code;
            todoModalState.clientName = match.name;
            clientTrigger.querySelector('span').textContent = match.name;
            // Mark selected option
            document.querySelectorAll('#todo-modal-client-menu .custom-dropdown-option').forEach(opt => {
                opt.classList.toggle('selected', opt.dataset.value === match.code);
            });
        } else {
            // Couldn't match — show name as-is, no code
            clientTrigger.querySelector('span').textContent = todo.clientName;
        }
    } else {
        clientTrigger.querySelector('span').textContent = 'None';
    }
}

function closeTodoModal() {
    const modal = document.getElementById('todo-edit-modal');
    if (!modal) return;
    modal.classList.remove('visible');
    editingTodoId = null;
    todoModalState = { clientCode: null, clientName: null, bucket: 'OTHER', urgent: false };
    // Close any open dropdowns inside the modal
    document.querySelectorAll('.todo-modal .custom-dropdown-menu.open').forEach(m => {
        m.classList.remove('open');
        m.previousElementSibling?.classList.remove('open');
    });
}

// ===== MODAL: CLIENTS DROPDOWN =====
async function loadTodoModalClients() {
    const menu = document.getElementById('todo-modal-client-menu');
    if (!menu) return;

    // If we already have clients cached, just render
    if (cachedClients) {
        menu.innerHTML = renderTodoClientOptions(cachedClients);
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/clients`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        cachedClients = await response.json();
        menu.innerHTML = renderTodoClientOptions(cachedClients);
    } catch (err) {
        console.error('[Todo] Failed to load clients', err);
        menu.innerHTML = '<div class="custom-dropdown-option" style="color: var(--red)">Failed to load</div>';
    }
}

function renderTodoClientOptions(clients) {
    const topCodes = ['ONE', 'ONS', 'ONB', 'SKY', 'TOW', 'FIS', 'HUN'];
    const top = [];
    const other = [];
    clients.forEach(c => {
        if (topCodes.includes(c.code)) top.push(c);
        else other.push(c);
    });
    top.sort((a, b) => topCodes.indexOf(a.code) - topCodes.indexOf(b.code));

    let html = '';
    // None option at top
    html += `<div class="custom-dropdown-option" data-value="" onclick="selectTodoModalOption('client', '', 'None')"><img src="images/logos/Unknown.png" alt="" style="width: 24px; height: 24px; border-radius: 50%; margin-right: 10px; vertical-align: middle;">None</div>`;

    top.forEach(c => {
        const safeName = c.name.replace(/'/g, "\\'");
        html += `<div class="custom-dropdown-option" data-value="${c.code}" onclick="selectTodoModalOption('client', '${c.code}', '${safeName}')"><img src="${getLogoUrl(c.code)}" alt="${c.code}" style="width: 24px; height: 24px; border-radius: 50%; margin-right: 10px; vertical-align: middle;" onerror="this.src='images/logos/Unknown.png'">${c.name}</div>`;
    });

    if (other.length > 0) {
        html += '<div class="custom-dropdown-option section-header">Other</div>';
        other.forEach(c => {
            const safeName = c.name.replace(/'/g, "\\'");
            html += `<div class="custom-dropdown-option" data-value="${c.code}" onclick="selectTodoModalOption('client', '${c.code}', '${safeName}')"><img src="${getLogoUrl(c.code)}" alt="${c.code}" style="width: 24px; height: 24px; border-radius: 50%; margin-right: 10px; vertical-align: middle;" onerror="this.src='images/logos/Unknown.png'">${c.name}</div>`;
        });
    }
    return html;
}

// ===== MODAL: DROPDOWN HELPERS =====
function toggleTodoModalDropdown(id) {
    const trigger = document.getElementById(`todo-modal-${id}-trigger`);
    const menu = document.getElementById(`todo-modal-${id}-menu`);
    if (!trigger || !menu) return;

    const isOpen = menu.classList.contains('open');

    // Close all other dropdowns inside the todo modal first
    document.querySelectorAll('.todo-modal .custom-dropdown-menu.open').forEach(m => {
        m.classList.remove('open');
        m.previousElementSibling?.classList.remove('open');
    });

    if (!isOpen) {
        trigger.classList.add('open');
        menu.classList.add('open');
    }
}

function selectTodoModalOption(id, value, label) {
    const trigger = document.getElementById(`todo-modal-${id}-trigger`);
    const menu = document.getElementById(`todo-modal-${id}-menu`);
    if (!trigger || !menu) return;

    // Update selected state
    menu.querySelectorAll('.custom-dropdown-option').forEach(opt => {
        opt.classList.toggle('selected', opt.dataset.value === value);
    });

    // Update trigger text
    trigger.querySelector('span').textContent = label;

    // Close dropdown
    trigger.classList.remove('open');
    menu.classList.remove('open');

    // Update state
    if (id === 'client') {
        todoModalState.clientCode = value || null;
        todoModalState.clientName = value ? label : null;
        // Update modal logo to match
        const modalLogo = document.getElementById('todo-modal-logo');
        modalLogo.src = value ? getLogoUrl(value) : 'images/logos/Unknown.png';
    } else if (id === 'bucket') {
        todoModalState.bucket = value;
    }
}

function setTodoModalDropdown(id, value, label) {
    const trigger = document.getElementById(`todo-modal-${id}-trigger`);
    const menu = document.getElementById(`todo-modal-${id}-menu`);
    if (!trigger || !menu) return;
    trigger.querySelector('span').textContent = label;
    menu.querySelectorAll('.custom-dropdown-option').forEach(opt => {
        opt.classList.toggle('selected', opt.dataset.value === value);
    });
}

// ===== MODAL: SAVE / DELETE =====
async function saveTodoFromModal() {
    const titleInput = document.getElementById('todo-modal-title-input');
    const title = (titleInput.value || '').trim();
    if (!title) {
        titleInput.focus();
        if (typeof showToast === 'function') showToast('Title required');
        return;
    }

    const urgent = document.getElementById('todo-modal-urgent').checked;
    todoModalState.urgent = urgent;

    const payload = {
        title,
        bucket: todoModalState.bucket || 'OTHER',
        urgent,
        client: todoModalState.clientCode || '',
    };

    const saveBtn = document.getElementById('todo-modal-save-btn');
    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving...';
    }

    try {
        const isEdit = !!editingTodoId;
        const url = isEdit ? `${API_BASE}/todos/${editingTodoId}` : `${API_BASE}/todos`;
        const method = isEdit ? 'PATCH' : 'POST';
        const response = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const updated = await response.json();

        if (isEdit) {
            const idx = todos.findIndex(t => t.id === editingTodoId);
            if (idx !== -1) todos[idx] = updated;
        } else {
            // Add to top of list (matches API ordering: newest first)
            todos.unshift(updated);
        }

        renderTodoContent();
        closeTodoModal();
    } catch (err) {
        console.error('[Todo] Save failed', err);
        if (typeof showToast === 'function') showToast('Couldn\'t save todo');
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.textContent = 'Save';
        }
    }
}

function deleteTodoFromModal() {
    if (!editingTodoId) return;
    const id = editingTodoId;
    closeTodoModal();
    deleteTodo(id);
}

// ===== MODAL: EVENT HANDLERS (scoped) =====
// Close modal on overlay click
document.addEventListener('click', (e) => {
    if (e.target.id === 'todo-edit-modal') {
        closeTodoModal();
    }
});

// Close dropdowns when clicking outside (scoped to .todo-modal)
document.addEventListener('click', (e) => {
    if (!e.target.closest('.todo-modal .custom-dropdown')) {
        document.querySelectorAll('.todo-modal .custom-dropdown-menu.open').forEach(m => {
            m.classList.remove('open');
            m.previousElementSibling?.classList.remove('open');
        });
    }
});

// ===== EXPORTS =====
window.renderTodos = renderTodos;
window.loadTodos = loadTodos;
window.openTodoModal = openTodoModal;
window.closeTodoModal = closeTodoModal;
window.toggleTodoModalDropdown = toggleTodoModalDropdown;
window.selectTodoModalOption = selectTodoModalOption;
window.saveTodoFromModal = saveTodoFromModal;
window.deleteTodoFromModal = deleteTodoFromModal;
