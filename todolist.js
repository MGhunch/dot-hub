// ===== TODO MODULE =====
// Owns the Todo view. Patterned on tracker.js.
// Depends on: $, $$, state, API_BASE, getLogoUrl, showToast
// Exposes: renderTodos, loadTodos

// ===== TODO STATE =====
let todos = [];
let todosLoaded = false;
let todosLoading = false;

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
            ${renderTodoColumn('CLIENTS', clientsTodos)}
            ${renderTodoColumn('OTHER', otherTodos)}
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
    const logoCode = todo.clientId ? (todo.clientName || '') : '';
    // For client logos we need a code, not a name. clientName is what we have.
    // Use Unknown.png as fallback when no client.
    const logoUrl = todo.clientId ? getTodoLogoUrl(todo.clientName) : 'images/logos/Unknown.png';

    const classes = ['todo-card'];
    if (todo.urgent) classes.push('urgent');
    if (todo.done) classes.push('done');

    return `
        <div class="${classes.join(' ')}" data-todo-id="${todo.id}">
            <div class="todo-tick" data-action="toggle" title="${todo.done ? 'Mark not done' : 'Mark done'}">
                ${todo.done ? ICON_TICK_DONE : ICON_TICK_EMPTY}
            </div>
            <div class="todo-logo">
                <img src="${logoUrl}" alt="" onerror="this.src='images/logos/Unknown.png'">
            </div>
            <div class="todo-main" data-action="toggle">
                <div class="todo-title">${escapeHtml(todo.title)}</div>
            </div>
            <button class="todo-delete" data-action="delete" title="Delete">${ICON_X}</button>
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

    if (action === 'delete') {
        e.stopPropagation();
        deleteTodo(todoId);
    } else if (action === 'toggle') {
        toggleTodoDone(todoId);
    }
});

// ===== EXPORTS =====
window.renderTodos = renderTodos;
window.loadTodos = loadTodos;
