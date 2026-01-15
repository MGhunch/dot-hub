/**
 * Dot Hub - Unified Interface
 * Claude-only version with HANDOFF support
 */

// ===== CONFIGURATION =====
const API_BASE = 'https://dot-remote-api.up.railway.app';
const PROXY_BASE = 'https://dot-proxy.up.railway.app';
const HANDOFF_EMAIL = 'michael@hunch.co.nz';

const KEY_CLIENTS = ['ONE', 'ONB', 'ONS', 'SKY', 'TOW'];

const CLIENT_DISPLAY_NAMES = {
    'ONE': 'One NZ (Marketing)',
    'ONB': 'One NZ (Business)',
    'ONS': 'One NZ (Simplification)'
};

const PINS = {
    '9871': { name: 'Michael', fullName: 'Michael Goldthorpe', client: 'ALL', clientName: 'Hunch', mode: 'hunch' },
    '1919': { name: 'Team', fullName: 'Hunch Team', client: 'ALL', clientName: 'Hunch', mode: 'hunch' }
};

const INACTIVITY_TIMEOUT = 15 * 60 * 1000; // 15 minutes

// ===== STATE =====
const state = {
    enteredPin: '',
    currentUser: null,
    currentView: 'home',
    allClients: [],
    allJobs: [],
    wipMode: 'todo',
    wipClient: 'all',
    trackerClient: null,
    trackerQuarter: 'Q4',
    trackerMode: 'spend',
    lastActivity: Date.now()
};

let inactivityTimer = null;

const $ = (id) => document.getElementById(id);
const $$ = (sel) => document.querySelectorAll(sel);

// ===== INITIALIZATION =====
document.addEventListener('DOMContentLoaded', init);

function init() {
    checkSession();
    setupEventListeners();
}

function setupEventListeners() {
    // PIN keypad
    $$('.pin-key[data-digit]').forEach(key => {
        key.addEventListener('click', () => enterPin(parseInt(key.dataset.digit)));
    });
    $('pin-delete')?.addEventListener('click', deletePin);

    // Phone navigation
    $('phone-hamburger')?.addEventListener('click', togglePhoneMenu);
    $('phone-overlay')?.addEventListener('click', closePhoneMenu);
    $('phone-home-btn')?.addEventListener('click', () => goHome());
    
    $$('#phone-dropdown .dropdown-item').forEach(item => {
        item.addEventListener('click', () => {
            closePhoneMenu();
            const view = item.dataset.view;
            const action = item.dataset.action;
            if (view) navigateTo(view);
            if (action === 'signout') signOut();
        });
    });

    // Desktop navigation
    $('desktop-home-btn')?.addEventListener('click', () => goHome());
    $$('.nav-tab').forEach(tab => {
        tab.addEventListener('click', () => navigateTo(tab.dataset.view));
    });

    // Home inputs
    $('phone-home-input')?.addEventListener('keypress', (e) => { if (e.key === 'Enter') startConversation('phone'); });
    $('phone-home-send')?.addEventListener('click', () => startConversation('phone'));
    $('desktop-home-input')?.addEventListener('keypress', (e) => { if (e.key === 'Enter') startConversation('desktop'); });
    $('desktop-home-send')?.addEventListener('click', () => startConversation('desktop'));

    // Chat inputs
    $('phone-chat-input')?.addEventListener('keypress', (e) => { if (e.key === 'Enter') continueConversation('phone'); });
    $('phone-chat-send')?.addEventListener('click', () => continueConversation('phone'));
    $('desktop-chat-input')?.addEventListener('keypress', (e) => { if (e.key === 'Enter') continueConversation('desktop'); });
    $('desktop-chat-send')?.addEventListener('click', () => continueConversation('desktop'));

    // Example buttons
    $$('.example-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const question = btn.dataset.question;
            const layout = isDesktop() ? 'desktop' : 'phone';
            const input = $(layout + '-home-input');
            if (input) input.value = question;
            startConversation(layout);
        });
    });

    // Check for stale session when tab becomes visible
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            checkIfStale();
        }
    });

    // Close dropdowns on outside click
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.custom-dropdown')) {
            $$('.custom-dropdown-menu.open').forEach(m => {
                m.classList.remove('open');
                m.previousElementSibling?.classList.remove('open');
            });
        }
    });
}

function isDesktop() { return window.innerWidth >= 900; }
function getActiveConversationArea() { return isDesktop() ? $('desktop-conversation-area') : $('phone-conversation-area'); }
function getClientDisplayName(client) { return CLIENT_DISPLAY_NAMES[client.code] || client.name; }

// ===== INACTIVITY TIMER =====
function resetInactivityTimer() {
    state.lastActivity = Date.now();
    
    if (inactivityTimer) clearTimeout(inactivityTimer);
    
    inactivityTimer = setTimeout(() => {
        clearSessionSilently();
    }, INACTIVITY_TIMEOUT);
}

function checkIfStale() {
    const now = Date.now();
    if (now - state.lastActivity > INACTIVITY_TIMEOUT) {
        clearSessionSilently();
    }
}

function clearSessionSilently() {
    // Clear backend context without showing anything
    if (state.currentUser) {
        fetch(`${API_BASE}/claude/clear`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId: state.currentUser.name })
        }).catch(() => {}); // Silently fail
    }
}

// ===== PIN HANDLING =====
function enterPin(digit) {
    if (state.enteredPin.length >= 4) return;
    state.enteredPin += digit;
    updatePinDots();
    $('pin-error')?.classList.remove('visible');
    if (state.enteredPin.length === 4) setTimeout(checkPin, 150);
}

function deletePin() {
    state.enteredPin = state.enteredPin.slice(0, -1);
    updatePinDots();
    $('pin-error')?.classList.remove('visible');
}

function updatePinDots() {
    for (let i = 0; i < 4; i++) {
        const dot = $('dot-' + i);
        if (dot) {
            dot.classList.remove('filled', 'error');
            if (i < state.enteredPin.length) dot.classList.add('filled');
        }
    }
}

function checkPin() {
    const user = PINS[state.enteredPin];
    if (user) {
        state.currentUser = { ...user, pin: state.enteredPin };
        sessionStorage.setItem('dotUser', JSON.stringify(state.currentUser));
        unlockApp();
    } else {
        $$('.pin-dot').forEach(d => d.classList.add('error'));
        $('pin-error')?.classList.add('visible');
        setTimeout(() => { state.enteredPin = ''; updatePinDots(); }, 500);
    }
}

function unlockApp() {
    $('pin-screen')?.classList.add('hidden');
    const placeholder = `What's cooking ${state.currentUser.name}?`;
    if ($('phone-home-input')) $('phone-home-input').placeholder = placeholder;
    if ($('desktop-home-input')) $('desktop-home-input').placeholder = placeholder;
    loadClients();
    loadJobs();
    resetInactivityTimer();
}

function checkSession() {
    const stored = sessionStorage.getItem('dotUser');
    if (stored) { state.currentUser = JSON.parse(stored); unlockApp(); }
}

function signOut() {
    sessionStorage.removeItem('dotUser');
    state.currentUser = null;
    state.enteredPin = '';
    updatePinDots();
    $('pin-screen')?.classList.remove('hidden');
    goHome();
}

// ===== NAVIGATION =====
function navigateTo(view) {
    state.currentView = view;
    $$('.nav-tab').forEach(tab => tab.classList.toggle('active', tab.dataset.view === view));
    $$('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + view));
    $('desktop-footer')?.classList.toggle('minimal', view !== 'home');
    
    if (!isDesktop()) {
        $('phone-home')?.classList.add('hidden');
        $('phone-conversation')?.classList.remove('visible');
        $('phone-wip-message')?.classList.remove('visible');
        $('phone-tracker-message')?.classList.remove('visible');
        if (view === 'home') $('phone-home')?.classList.remove('hidden');
        else if (view === 'wip') $('phone-wip-message')?.classList.add('visible');
        else if (view === 'tracker') $('phone-tracker-message')?.classList.add('visible');
    }
    
    if (view === 'wip') { setupWipDropdown(); renderWip(); }
    if (view === 'tracker') renderTracker();
}

function goHome() {
    $('phone-home')?.classList.remove('hidden');
    $('phone-conversation')?.classList.remove('visible');
    if ($('phone-home-input')) $('phone-home-input').value = '';
    if ($('phone-conversation-area')) $('phone-conversation-area').innerHTML = '';
    $('desktop-home-state')?.classList.remove('hidden');
    $('desktop-conversation-state')?.classList.remove('visible');
    $('desktop-footer')?.classList.remove('hidden');
    if ($('desktop-home-input')) $('desktop-home-input').value = '';
    if ($('desktop-conversation-area')) $('desktop-conversation-area').innerHTML = '';
    navigateTo('home');
}

function togglePhoneMenu() {
    $('phone-hamburger')?.classList.toggle('open');
    $('phone-dropdown')?.classList.toggle('open');
    $('phone-overlay')?.classList.toggle('open');
}

function closePhoneMenu() {
    $('phone-hamburger')?.classList.remove('open');
    $('phone-dropdown')?.classList.remove('open');
    $('phone-overlay')?.classList.remove('open');
}

// ===== DATA LOADING =====
async function loadClients() {
    try {
        const response = await fetch(`${API_BASE}/clients`);
        state.allClients = await response.json();
    } catch (e) { state.allClients = []; }
}

async function loadJobs() {
    try {
        const response = await fetch(`${API_BASE}/jobs/all`);
        state.allJobs = await response.json();
    } catch (e) { state.allJobs = []; }
}

// ===== CONVERSATION =====
function startConversation(layout) {
    const input = $(layout + '-home-input');
    const question = input?.value.trim() || 'Check a client';
    if (layout === 'phone') {
        $('phone-home')?.classList.add('hidden');
        $('phone-conversation')?.classList.add('visible');
    } else {
        $('desktop-home-state')?.classList.add('hidden');
        $('desktop-conversation-state')?.classList.add('visible');
        $('desktop-footer')?.classList.add('hidden');
    }
    addUserMessage(question);
    processQuestion(question);
}

function continueConversation(layout) {
    const input = $(layout + '-chat-input');
    const question = input?.value.trim();
    if (!question) return;
    addUserMessage(question);
    input.value = '';
    processQuestion(question);
}

function addUserMessage(text) {
    const area = getActiveConversationArea();
    const msg = document.createElement('div');
    msg.className = 'user-message fade-in';
    msg.textContent = text;
    area?.appendChild(msg);
    if (area) area.scrollTop = area.scrollHeight;
}

function addThinkingDots() {
    const area = getActiveConversationArea();
    const dots = document.createElement('div');
    dots.className = 'thinking-dots';
    dots.id = 'currentThinking';
    dots.innerHTML = '<div class="thinking-dot"></div><div class="thinking-dot"></div><div class="thinking-dot"></div>';
    area?.appendChild(dots);
    if (area) area.scrollTop = area.scrollHeight;
}

function removeThinkingDots() {
    $('currentThinking')?.remove();
}

// ===== QUERY PROCESSING (Claude-only) =====
async function processQuestion(question) {
    resetInactivityTimer();
    addThinkingDots();
    
    // Log for debugging
    console.log('Query:', question);
    
    // Send everything to Claude
    const parsed = await askClaude(question);
    
    removeThinkingDots();
    
    // Log Claude's response
    console.log('Claude returned:', parsed);
    
    if (!parsed) {
        // API error - show graceful fallback
        renderResponse({ 
            text: "Hmm, I'm having trouble thinking right now. Try again?", 
            nextPrompt: 'What can Dot do?' 
        });
        return;
    }
    
    // Use Claude's responseText if provided, otherwise fall back to defaults
    const responseText = parsed.responseText;
    
    // Handle CLARIFY - Dot needs more info
    if (parsed.coreRequest === 'CLARIFY') {
        renderResponse({ 
            text: responseText || "Remind me, which client?",
            nextPrompt: parsed.nextPrompt
        });
        return;
    }
    
    // Handle HANDOFF - needs a human
    if (parsed.coreRequest === 'HANDOFF') {
        const handoffQuestion = parsed.handoffQuestion || question;
        renderHandoff(responseText || "That's a question for a human...", handoffQuestion, parsed.nextPrompt);
        return;
    }
    
    // Handle UNKNOWN - outside Dot's scope
    if (parsed.understood === false || parsed.coreRequest === 'UNKNOWN') {
        renderResponse({ 
            text: responseText || "That's outside my wheelhouse. I just do Hunch stuff!",
            nextPrompt: parsed.nextPrompt
        });
        return;
    }
    
    // Execute the parsed request
    switch (parsed.coreRequest) {
        case 'DUE': executeDue(parsed); break;
        case 'FIND': executeFind(parsed); break;
        case 'UPDATE': executeUpdate(parsed); break;
        case 'TRACKER': executeTracker(parsed); break;
        case 'QUERY': executeQuery(parsed); break;
        case 'LOG': executeLog(parsed); break;
        case 'HELP': executeHelp(parsed); break;
        default: executeHelp(parsed);
    }
    
    const area = getActiveConversationArea();
    if (area) area.scrollTop = area.scrollHeight;
}

// ===== CLAUDE API =====
async function askClaude(question) {
    try {
        const sessionId = state.currentUser?.name || 'anonymous';
        
        const response = await fetch(`${API_BASE}/claude/parse`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                question,
                clients: state.allClients.map(c => ({ code: c.code, name: c.name })),
                sessionId
            })
        });
        
        if (!response.ok) return null;
        
        const result = await response.json();
        return result.parsed || null;
    } catch (e) {
        console.log('Claude API error:', e);
        return null;
    }
}

// ===== EXECUTORS =====
function executeDue(parsed) {
    const jobs = getFilteredJobs(parsed.modifiers);
    const client = parsed.modifiers.client ? state.allClients.find(c => c.code === parsed.modifiers.client) : null;
    const responseText = parsed.responseText;
    
    if (parsed.modifiers.dateRange === 'next') {
        if (jobs.length === 0) {
            renderResponse({ text: responseText || (client ? `No upcoming deadlines for ${client.name}.` : 'No upcoming deadlines.'), nextPrompt: parsed.nextPrompt });
        } else {
            const nextJob = jobs[0];
            renderResponse({ text: responseText || `Next up is <strong>${nextJob.jobNumber} | ${nextJob.jobName}</strong>, due ${formatDueDate(nextJob.updateDue)}.`, jobs: [nextJob], nextPrompt: parsed.nextPrompt });
        }
        return;
    }
    
    const dateLabels = { today: 'today', tomorrow: 'by tomorrow', week: 'this week' };
    const dateLabel = dateLabels[parsed.modifiers.dateRange] || 'coming up';
    
    if (jobs.length === 0) {
        renderResponse({ text: responseText || (client ? `Nothing due ${dateLabel} for ${client.name}! ðŸŽ‰` : `Nothing due ${dateLabel}! ðŸŽ‰`), nextPrompt: parsed.nextPrompt });
    } else {
        renderResponse({ text: responseText || (client ? `${jobs.length} job${jobs.length === 1 ? '' : 's'} due ${dateLabel} for ${client.name}:` : `${jobs.length} job${jobs.length === 1 ? '' : 's'} due ${dateLabel}:`), jobs: jobs, nextPrompt: parsed.nextPrompt });
    }
}

function executeFind(parsed) {
    const client = parsed.modifiers.client ? state.allClients.find(c => c.code === parsed.modifiers.client) : null;
    const responseText = parsed.responseText;
    
    // If we have search terms, search across jobs
    if (parsed.searchTerms && parsed.searchTerms.length > 0) {
        const jobs = searchJobs(parsed.modifiers, parsed.searchTerms);
        if (jobs.length === 0) {
            renderResponse({ text: responseText || (client ? `Couldn't find a ${client.name} job matching that.` : `Couldn't find a job matching that.`), nextPrompt: parsed.nextPrompt });
        } else if (jobs.length === 1) {
            renderResponse({ text: responseText || `Found it! <strong>${jobs[0].jobNumber} | ${jobs[0].jobName}</strong>`, jobs: [jobs[0]], nextPrompt: parsed.nextPrompt });
        } else {
            renderResponse({ text: responseText || `Found ${jobs.length} jobs that might match:`, jobs: jobs.slice(0, 5), nextPrompt: parsed.nextPrompt });
        }
        return;
    }
    
    // If we have a status or withClient filter
    if (parsed.modifiers.status === 'On Hold' || parsed.modifiers.status === 'Completed' || parsed.modifiers.withClient === true) {
        const jobs = getFilteredJobs(parsed.modifiers);
        const statusLabel = parsed.modifiers.withClient ? 'with client' : parsed.modifiers.status?.toLowerCase();
        if (jobs.length === 0) {
            renderResponse({ text: responseText || (client ? `No ${statusLabel} jobs for ${client.name}.` : `No jobs ${statusLabel} right now.`), nextPrompt: parsed.nextPrompt });
        } else {
            renderResponse({ text: responseText || (client ? `${jobs.length} ${statusLabel} job${jobs.length === 1 ? '' : 's'} for ${client.name}:` : `${jobs.length} job${jobs.length === 1 ? '' : 's'} ${statusLabel}:`), jobs: jobs, nextPrompt: parsed.nextPrompt });
        }
        return;
    }
    
    // If we have a client, show their jobs
    if (client) {
        const jobs = getFilteredJobs(parsed.modifiers);
        if (jobs.length === 0) {
            renderResponse({ text: responseText || `No active jobs for ${client.name}.`, nextPrompt: parsed.nextPrompt });
        } else {
            renderResponse({ text: responseText || `Here's what's on for ${client.name}:`, jobs: jobs, nextPrompt: parsed.nextPrompt });
        }
        return;
    }
    
    // No client, no filters - show client picker
    renderClientPicker();
}

function executeUpdate(parsed) {
    const responseText = parsed.responseText;
    if (parsed.modifiers.client) {
        const client = state.allClients.find(c => c.code === parsed.modifiers.client);
        renderResponse({ text: responseText || `Which ${client?.name} job do you want to update?`, nextPrompt: parsed.nextPrompt });
    } else {
        renderResponse({ text: responseText || "Which job do you want to update? Tell me the client and I'll help you find it.", nextPrompt: parsed.nextPrompt });
    }
}

async function executeTracker(parsed) {
    const client = parsed.modifiers?.client;
    const period = parsed.modifiers?.period || 'this_month';
    
    // If no client specified, just open the tracker
    if (!client) {
        renderResponse({ text: parsed.responseText || "Opening Tracker...", nextPrompt: null });
        setTimeout(() => navigateTo('tracker'), 500);
        return;
    }
    
    // Fetch the summary for inline display
    try {
        const response = await fetch(`${API_BASE}/tracker/summary?client=${client}&period=${period}`);
        
        if (!response.ok) {
            renderResponse({ text: "Hmm, couldn't pull those numbers. Try opening the tracker?", nextPrompt: "Open Tracker" });
            return;
        }
        
        const data = await response.json();
        
        // Format currency
        const formatMoney = (n) => {
            if (n >= 1000) return '$' + (n / 1000).toFixed(n % 1000 === 0 ? 0 : 1) + 'K';
            return '$' + n;
        };
        
        // Build the response
        const clientName = data.client;
        const spent = formatMoney(data.spent);
        const remaining = formatMoney(Math.abs(data.remaining));
        const percent = data.percentUsed;
        
        let statusText = '';
        if (data.status === 'over') {
            statusText = `${clientName}'s ${data.period}: ${spent} spent, ${remaining} over budget! ðŸ˜¬`;
        } else if (data.status === 'high') {
            statusText = `${clientName}'s ${data.period}: ${spent} spent, ${remaining} left (${percent}% used)`;
        } else {
            statusText = `${clientName}'s ${data.period}: ${spent} spent, ${remaining} still to play with ðŸ‘`;
        }
        
        renderResponse({ 
            text: statusText, 
            nextPrompt: parsed.nextPrompt || "Open full tracker?"
        });
        
    } catch (e) {
        console.log('Tracker fetch error:', e);
        renderResponse({ text: "Couldn't grab those numbers right now. Try the tracker directly?", nextPrompt: "Open Tracker" });
    }
}

function executeQuery(parsed) {
    // TODO: Wire up additional Airtable queries for contacts, details, etc.
    // For now, acknowledge and suggest this is coming
    renderResponse({ 
        text: parsed.responseText || "I can look that up! (This feature is coming soon)", 
        nextPrompt: parsed.nextPrompt 
    });
}

function executeHelp(parsed) {
    renderResponse({ 
        text: parsed.responseText || `I'm Dot, Hunch's admin-bot! I can help you:<br><br>â€¢ Check on jobs and client work<br>â€¢ See what's due or coming up<br>â€¢ Find contact info<br>â€¢ Look up budget and spend<br><br>Try asking about a client or what's due!`, 
        nextPrompt: parsed.nextPrompt || "What's most urgent?"
    });
}

async function executeLog(parsed) {
    // If we have a title, we're logging something
    if (parsed.logTitle) {
        try {
            const response = await fetch(`${API_BASE}/log`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    title: parsed.logTitle,
                    notes: parsed.logNotes || ''
                })
            });
            
            if (response.ok) {
                renderResponse({
                    text: parsed.responseText || `Noted! Added "${parsed.logTitle}" to the list.`,
                    nextPrompt: parsed.nextPrompt
                });
            } else {
                renderResponse({
                    text: "Hmm, couldn't save that. Try again?",
                    nextPrompt: parsed.nextPrompt
                });
            }
        } catch (e) {
            renderResponse({
                text: "Hmm, couldn't save that. Try again?",
                nextPrompt: parsed.nextPrompt
            });
        }
        return;
    }
    
    // Otherwise, we're reading the list
    try {
        const response = await fetch(`${API_BASE}/log`);
        const data = await response.json();
        const items = data.items || [];
        
        if (items.length === 0) {
            renderResponse({
                text: parsed.responseText || "Nothing on the list yet!",
                nextPrompt: parsed.nextPrompt || "Log a bug?"
            });
            return;
        }
        
        const done = items.filter(i => i.done).length;
        const todo = items.filter(i => !i.done);
        
        let listHtml = todo.map(i => `â€¢ ${i.title}`).join('<br>');
        if (done > 0) {
            listHtml += `<br><br><em>${done} item${done === 1 ? '' : 's'} done</em>`;
        }
        
        renderResponse({
            text: (parsed.responseText || `${items.length} thing${items.length === 1 ? '' : 's'} on the list:`) + `<br><br>${listHtml}`,
            nextPrompt: parsed.nextPrompt
        });
    } catch (e) {
        renderResponse({
            text: "Couldn't fetch the list right now.",
            nextPrompt: parsed.nextPrompt
        });
    }
}

// ===== JOB FILTERING =====
function getFilteredJobs(modifiers, options = {}) {
    let jobs = [...state.allJobs];
    if (modifiers.client) jobs = jobs.filter(j => j.clientCode === modifiers.client);
    if (!options.includeAllStatuses && modifiers.status) jobs = jobs.filter(j => j.status === modifiers.status);
    if (modifiers.withClient === true) jobs = jobs.filter(j => j.withClient === true);
    else if (modifiers.withClient === false) jobs = jobs.filter(j => !j.withClient);
    
    if (modifiers.dateRange) {
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
        jobs = jobs.filter(j => {
            if (!j.updateDue) return false;
            const dueDate = new Date(j.updateDue); dueDate.setHours(0, 0, 0, 0);
            switch (modifiers.dateRange) {
                case 'today': return dueDate <= today;
                case 'tomorrow': return dueDate <= tomorrow;
                case 'week': const weekFromNow = new Date(today); weekFromNow.setDate(weekFromNow.getDate() + 7); return dueDate <= weekFromNow;
                default: return true;
            }
        });
    }
    
    // Apply default status filter if not specified
    if (!modifiers.status && !options.includeAllStatuses) {
        jobs = jobs.filter(j => j.status === 'In Progress');
    }
    
    // Sorting
    const sortBy = modifiers.sortBy || 'dueDate';
    const sortOrder = modifiers.sortOrder || 'asc';
    
    jobs.sort((a, b) => {
        let aVal, bVal;
        switch (sortBy) {
            case 'updated':
                aVal = a.lastUpdated ? new Date(a.lastUpdated) : new Date(0);
                bVal = b.lastUpdated ? new Date(b.lastUpdated) : new Date(0);
                break;
            case 'jobNumber':
                aVal = a.jobNumber || '';
                bVal = b.jobNumber || '';
                break;
            case 'dueDate':
            default:
                aVal = a.updateDue ? new Date(a.updateDue) : new Date('9999-12-31');
                bVal = b.updateDue ? new Date(b.updateDue) : new Date('9999-12-31');
        }
        
        if (aVal < bVal) return sortOrder === 'asc' ? -1 : 1;
        if (aVal > bVal) return sortOrder === 'asc' ? 1 : -1;
        return 0;
    });
    
    return jobs;
}

function searchJobs(modifiers, searchTerms) {
    let jobs = getFilteredJobs({ client: modifiers.client }, { includeAllStatuses: true });
    if (!searchTerms || searchTerms.length === 0) return jobs;
    const scored = jobs.map(job => ({ job, score: scoreJobMatch(job, searchTerms) })).filter(item => item.score > 0).sort((a, b) => b.score - a.score);
    return scored.map(item => item.job);
}

function scoreJobMatch(job, searchTerms) {
    const jobNumber = (job.jobNumber || '').toLowerCase();
    const jobName = (job.jobName || '').toLowerCase();
    const jobDesc = (job.description || '').toLowerCase();
    const jobUpdate = (job.update || '').toLowerCase();
    let score = 0;
    for (const term of searchTerms) {
        const t = term.toLowerCase();
        if (jobNumber.includes(t)) score += 20;
        if (jobName.includes(t)) score += 10;
        if (jobDesc.includes(t)) score += 5;
        if (jobUpdate.includes(t)) score += 2;
    }
    return score;
}

// ===== RENDERERS =====
function renderResponse({ text, jobs = [], nextPrompt = null }) {
    const area = getActiveConversationArea();
    const response = document.createElement('div');
    response.className = 'dot-response fade-in';
    let html = `<p class="dot-text">${text}</p>`;
    
    if (jobs.length > 0) {
        html += '<div class="job-cards">';
        jobs.forEach((job, i) => { html += createConversationJobCard(job, i); });
        html += '</div>';
    }
    
    // Single contextual prompt from Claude (if provided)
    if (nextPrompt) {
        html += `<div class="smart-prompts"><button class="smart-prompt" data-question="${nextPrompt}"><img src="images/dot-sitting.png" class="prompt-dot">${nextPrompt}</button></div>`;
    }
    
    response.innerHTML = html;
    area?.appendChild(response);
    bindDynamicElements(response);
}

function renderHandoff(text, question, nextPrompt = null) {
    const area = getActiveConversationArea();
    const response = document.createElement('div');
    response.className = 'dot-response fade-in';
    
    const subject = encodeURIComponent('Question for a human');
    const body = encodeURIComponent(`Dot couldn't help with this one:\n\n"${question}"\n\nCan you take a look?`);
    const mailtoLink = `mailto:${HANDOFF_EMAIL}?subject=${subject}&body=${body}`;
    
    let html = `<p class="dot-text">${text}</p>`;
    html += `<div class="smart-prompts"><a href="${mailtoLink}" class="smart-prompt handoff-btn">Send an email</a></div>`;
    
    if (nextPrompt) {
        html += `<div class="smart-prompts" style="margin-top: 8px;"><button class="smart-prompt" data-question="${nextPrompt}"><img src="images/dot-sitting.png" class="prompt-dot">${nextPrompt}</button></div>`;
    }
    
    response.innerHTML = html;
    area?.appendChild(response);
    bindDynamicElements(response);
}

function renderClientPicker() {
    const area = getActiveConversationArea();
    const clientsWithCounts = getClientsWithJobCounts();
    const keyClients = clientsWithCounts.filter(c => KEY_CLIENTS.includes(c.code));
    const hasOther = clientsWithCounts.some(c => !KEY_CLIENTS.includes(c.code));
    
    const response = document.createElement('div');
    response.className = 'dot-response fade-in';
    response.innerHTML = `
        <p class="dot-text">Which client?</p>
        <div class="client-cards">
            ${keyClients.map(c => `<div class="client-card" data-client="${c.code}"><div><div class="client-name">${getClientDisplayName(c)}</div><div class="client-count">${c.jobCount} active job${c.jobCount === 1 ? '' : 's'}</div></div><span class="card-chevron">></span></div>`).join('')}
            ${hasOther ? `<div class="client-card other-clients-btn"><div><div class="client-name">Other clients</div></div><span class="card-chevron">></span></div>` : ''}
        </div>
    `;
    area?.appendChild(response);
    bindDynamicElements(response);
}

function getClientsWithJobCounts() {
    return state.allClients.map(c => ({ ...c, jobCount: state.allJobs.filter(j => j.clientCode === c.code && j.status === 'In Progress').length })).filter(c => c.jobCount > 0);
}

function createConversationJobCard(job, index) {
    const id = `job-${Date.now()}-${index}`;
    const dueDate = formatDueDate(job.updateDue);
    const daysAgo = getDaysSinceUpdate(job.lastUpdated);
    return `
        <div class="job-card" id="${id}">
            <div class="job-header" data-job-id="${id}">
                <div class="job-logo"><img src="${getLogoUrl(job.clientCode)}" alt="${job.clientCode}" onerror="this.src='images/logos/Unknown.png'"></div>
                <div class="job-main">
                    <div class="job-title-row"><span class="job-title">${job.jobNumber} | ${job.jobName}</span><span class="expand-icon">v</span></div>
                    <div class="job-update-preview">${job.update || 'No updates yet'}</div>
                    <div class="job-meta-compact">${ICON_CLOCK} ${dueDate}<span class="dot"> - </span>${ICON_REFRESH} <span class="${getDaysAgoClass(daysAgo)}">${daysAgo} days ago</span>${job.withClient ? `<span class="dot"> - </span>${ICON_EXCHANGE} With client` : ''}</div>
                </div>
            </div>
            <div class="job-expanded">
                <div class="section-label">The Project</div>
                <div class="job-description">${job.description || 'No description'}</div>
                <div class="section-label" style="margin-top:14px">Client Owner</div>
                <div class="job-owner">${job.projectOwner || 'TBC'}</div>
                <div class="job-footer">
                    ${job.channelUrl ? `<a href="${job.channelUrl}" target="_blank" class="teams-link" onclick="event.stopPropagation()">-> TEAMS</a>` : '<span></span>'}
                </div>
            </div>
        </div>
    `;
}

function bindDynamicElements(container) {
    container.querySelectorAll('.smart-prompt').forEach(btn => {
        if (!btn.classList.contains('handoff-btn')) {
            btn.addEventListener('click', () => { addUserMessage(btn.dataset.question); processQuestion(btn.dataset.question); });
        }
    });
    container.querySelectorAll('.client-card:not(.other-clients-btn)').forEach(card => {
        card.addEventListener('click', () => {
            const client = state.allClients.find(c => c.code === card.dataset.client);
            addUserMessage(client?.name || card.dataset.client);
            processQuestion(client?.name || card.dataset.client);
        });
    });
    container.querySelectorAll('.other-clients-btn').forEach(btn => {
        btn.addEventListener('click', () => { addUserMessage('Other clients'); showOtherClients(); });
    });
    container.querySelectorAll('.job-header[data-job-id]').forEach(header => {
        header.addEventListener('click', () => $(header.dataset.jobId)?.classList.toggle('expanded'));
    });
}

function showOtherClients() {
    const area = getActiveConversationArea();
    addThinkingDots();
    setTimeout(() => {
        removeThinkingDots();
        const otherClients = getClientsWithJobCounts().filter(c => !KEY_CLIENTS.includes(c.code));
        const response = document.createElement('div');
        response.className = 'dot-response fade-in';
        response.innerHTML = `
            <p class="dot-text">Other clients:</p>
            <div class="client-cards">${otherClients.map(c => `<div class="client-card" data-client="${c.code}"><div><div class="client-name">${getClientDisplayName(c)}</div><div class="client-count">${c.jobCount} active job${c.jobCount === 1 ? '' : 's'}</div></div><span class="card-chevron">></span></div>`).join('')}</div>
        `;
        area?.appendChild(response);
        bindDynamicElements(response);
        if (area) area.scrollTop = area.scrollHeight;
    }, 400);
}

// ===== SVG ICONS =====
const ICON_CLOCK = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#ED1C24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`;
const ICON_REFRESH = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#ED1C24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>`;
const ICON_EXCHANGE = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#ED1C24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9h12l-3-3M20 15H8l3 3"/></svg>`;

// ===== HELPERS =====
function formatDueDate(isoDate) {
    if (!isoDate) return 'TBC';
    const date = new Date(isoDate);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
    const dateOnly = new Date(date); dateOnly.setHours(0, 0, 0, 0);
    if (dateOnly.getTime() === today.getTime()) return 'Today';
    if (dateOnly.getTime() === tomorrow.getTime()) return 'Tomorrow';
    if (dateOnly < today) return 'Overdue';
    return date.toLocaleDateString('en-NZ', { weekday: 'short', day: 'numeric', month: 'short' });
}

function formatDateForInput(d) { if (!d) return ''; return new Date(d).toISOString().split('T')[0]; }
function getDaysUntilDue(d) { if (!d) return 999; return Math.ceil((new Date(d) - new Date()) / 86400000); }
function getDaysSinceUpdate(d) { if (!d) return 999; return Math.floor((new Date() - new Date(d)) / 86400000); }
function getDaysAgoClass(days) { return days > 7 ? 'days-ago stale' : 'days-ago'; }
function getLogoUrl(code) { const logoCode = (code === 'ONB' || code === 'ONS') ? 'ONE' : code; return `images/logos/${logoCode}.png`; }

function showToast(message, type) {
    const toast = $('toast');
    if (toast) { toast.textContent = message; toast.className = `toast ${type} visible`; setTimeout(() => toast.classList.remove('visible'), 2500); }
}

// ===== WIP VIEW =====
function setupWipDropdown() {
    const trigger = $('wip-client-trigger');
    const menu = $('wip-client-menu');
    if (!trigger || !menu) return;
    
    menu.innerHTML = '<div class="custom-dropdown-option selected" data-value="all">All Clients</div>';
    state.allClients.forEach(c => {
        const opt = document.createElement('div');
        opt.className = 'custom-dropdown-option';
        opt.dataset.value = c.code;
        opt.textContent = getClientDisplayName(c);
        menu.appendChild(opt);
    });
    
    trigger.onclick = (e) => { e.stopPropagation(); trigger.classList.toggle('open'); menu.classList.toggle('open'); };
    menu.onclick = (e) => {
        const opt = e.target.closest('.custom-dropdown-option');
        if (!opt) return;
        menu.querySelectorAll('.custom-dropdown-option').forEach(o => o.classList.remove('selected'));
        opt.classList.add('selected');
        trigger.querySelector('span').textContent = opt.textContent;
        trigger.classList.remove('open'); menu.classList.remove('open');
        state.wipClient = opt.dataset.value;
        renderWip();
    };
}

function setWipMode(mode) {
    state.wipMode = mode;
    $('wip-mode-switch').checked = (mode === 'wip');
    updateWipModeLabels();
    renderWip();
}

function toggleWipMode() {
    state.wipMode = $('wip-mode-switch').checked ? 'wip' : 'todo';
    updateWipModeLabels();
    renderWip();
}

function updateWipModeLabels() {
    $('mode-todo')?.classList.toggle('active', state.wipMode === 'todo');
    $('mode-wip')?.classList.toggle('active', state.wipMode === 'wip');
}

function getWipFilteredJobs() {
    let jobs = state.wipClient === 'all' ? state.allJobs.slice() : state.allJobs.filter(j => j.clientCode === state.wipClient);
    return jobs.filter(j => { const num = j.jobNumber.split(' ')[1]; return num !== '000' && num !== '999'; });
}

function groupByTodo(jobs) {
    const g = { doNow: [], doSoon: [], comingUp: [], withClient: [] };
    jobs.forEach(j => {
        if (j.status === 'On Hold' || j.status === 'Completed' || j.status === 'Archived') return;
        if (j.withClient) g.withClient.push(j);
        else if (j.status === 'Incoming') g.comingUp.push(j);
        else {
            const d = getDaysUntilDue(j.updateDue);
            if (d <= 1) g.doNow.push(j);
            else if (d <= 5) g.doSoon.push(j);
            else g.comingUp.push(j);
        }
    });
    const s = (a, b) => getDaysUntilDue(a.updateDue) - getDaysUntilDue(b.updateDue);
    Object.values(g).forEach(arr => arr.sort(s));
    return { leftTop: { title: 'DO IT NOW', jobs: g.doNow, compact: false }, leftBottom: { title: 'DO IT SOON', jobs: g.doSoon, compact: false }, rightTop: { title: 'COMING UP', jobs: g.comingUp, compact: true }, rightBottom: { title: 'WITH CLIENT', jobs: g.withClient, compact: true } };
}

function groupByWip(jobs) {
    const g = { withUs: [], withYou: [], incoming: [], onHold: [] };
    jobs.forEach(j => {
        if (j.status === 'Incoming') g.incoming.push(j);
        else if (j.status === 'On Hold') g.onHold.push(j);
        else if (j.status === 'Completed' || j.status === 'Archived') return;
        else if (j.withClient) g.withYou.push(j);
        else g.withUs.push(j);
    });
    const s = (a, b) => getDaysUntilDue(a.updateDue) - getDaysUntilDue(b.updateDue);
    Object.values(g).forEach(arr => arr.sort(s));
    return { leftTop: { title: 'JOBS WITH US', jobs: g.withUs, compact: false }, rightTop: { title: 'JOBS WITH YOU', jobs: g.withYou, compact: false }, leftBottom: { title: 'INCOMING', jobs: g.incoming, compact: true }, rightBottom: { title: 'ON HOLD', jobs: g.onHold, compact: true } };
}

function renderWip() {
    const jobs = getWipFilteredJobs();
    const sections = state.wipMode === 'wip' ? groupByWip(jobs) : groupByTodo(jobs);
    const content = $('wip-content');
    if (!content) return;
    
    content.innerHTML = `
        <div class="wip-column">
            ${renderWipSection(sections.leftTop)}
            ${renderWipSection(sections.leftBottom)}
        </div>
        <div class="wip-column">
            ${renderWipSection(sections.rightTop)}
            ${renderWipSection(sections.rightBottom)}
        </div>
    `;
    
    content.querySelectorAll('.job-card').forEach(card => {
        card.addEventListener('click', () => card.classList.toggle('expanded'));
    });
}

function renderWipSection(section) {
    let html = `<div class="section"><div class="section-title">${section.title}</div>`;
    if (section.jobs.length === 0) {
        html += `<div class="empty-section"><img src="images/dot-sitting.png" alt="Dot"><span>Nothing to see here</span></div>`;
    } else {
        section.jobs.forEach(job => { html += section.compact ? createWipCompactCard(job) : createWipCard(job); });
    }
    return html + '</div>';
}

function createWipCard(job) {
    const dueDate = formatDueDate(job.updateDue);
    const daysAgo = getDaysSinceUpdate(job.lastUpdated);
    return `
        <div class="job-card" data-job="${job.jobNumber}">
            <div class="job-header">
                <div class="job-logo"><img src="${getLogoUrl(job.clientCode)}" alt="${job.clientCode}" onerror="this.src='images/logos/Unknown.png'"></div>
                <div class="job-main">
                    <div class="job-title-row"><span class="job-title">${job.jobNumber} | ${job.jobName}</span><span class="expand-icon">v</span></div>
                    <div class="job-update-preview">${job.update || 'No updates yet'}</div>
                    <div class="job-meta-compact">${ICON_CLOCK} ${dueDate}<span class="dot"> - </span>${ICON_REFRESH} <span class="${getDaysAgoClass(daysAgo)}">${daysAgo} days ago</span>${job.withClient ? `<span class="dot"> - </span>${ICON_EXCHANGE} With client` : ''}</div>
                </div>
            </div>
            <div class="job-expanded">
                <div class="section-label">The Project</div>
                <div class="job-description">${job.description || 'No description'}</div>
                <div class="section-label" style="margin-top:14px">Client Owner</div>
                <div class="job-owner">${job.projectOwner || 'TBC'}</div>
                <div class="job-controls">
                    <div class="control-group"><span class="control-label">Stage</span><select class="control-select" onclick="event.stopPropagation()" data-field="stage"><option ${job.stage==='Clarify'?'selected':''}>Clarify</option><option ${job.stage==='Simplify'?'selected':''}>Simplify</option><option ${job.stage==='Craft'?'selected':''}>Craft</option><option ${job.stage==='Refine'?'selected':''}>Refine</option><option ${job.stage==='Deliver'?'selected':''}>Deliver</option></select></div>
                    <div class="control-group"><span class="control-label">Status</span><select class="control-select" onclick="event.stopPropagation()" data-field="status"><option ${job.status==='Incoming'?'selected':''}>Incoming</option><option ${job.status==='In Progress'?'selected':''}>In Progress</option><option ${job.status==='On Hold'?'selected':''}>On Hold</option><option ${job.status==='Completed'?'selected':''}>Completed</option></select></div>
                </div>
                <div class="job-dates">
                    <div class="date-group"><span class="control-label">Update Due</span><input type="date" class="date-input" value="${formatDateForInput(job.updateDue)}" onclick="event.stopPropagation()" data-field="updateDue"></div>
                    <div class="date-group"><span class="control-label">Live Date</span><input type="date" class="date-input" value="${formatDateForInput(job.liveDate)}" onclick="event.stopPropagation()" data-field="liveDate"></div>
                </div>
                <div class="section-label">New Update</div>
                <input type="text" class="update-input" placeholder="What's the latest?" onclick="event.stopPropagation()" data-field="message">
                <button class="pill-btn" onclick="event.stopPropagation();submitWipUpdate('${job.jobNumber}',this)" style="margin-top:8px">Update</button>
                <div class="job-footer">
                    ${job.channelUrl ? `<a href="${job.channelUrl}" class="teams-link" target="_blank" onclick="event.stopPropagation()">-> TEAMS</a>` : '<span></span>'}
                    <div class="with-client-toggle" onclick="event.stopPropagation()"><span class="with-client-label">With Client</span><label class="toggle"><input type="checkbox" ${job.withClient?'checked':''} onchange="toggleWipWithClient('${job.jobNumber}',this.checked)"><span class="toggle-slider"></span></label></div>
                </div>
            </div>
        </div>
    `;
}

function createWipCompactCard(job) {
    const dueDate = formatDueDate(job.updateDue);
    const daysAgo = getDaysSinceUpdate(job.lastUpdated);
    return `
        <div class="job-card compact" data-job="${job.jobNumber}">
            <div class="job-header">
                <div class="job-logo"><img src="${getLogoUrl(job.clientCode)}" alt="${job.clientCode}" onerror="this.src='images/logos/Unknown.png'"></div>
                <div class="job-main">
                    <div class="job-title-row"><span class="job-title">${job.jobNumber} | ${job.jobName}</span><span class="expand-icon">v</span></div>
                    <div class="job-meta-compact">${ICON_CLOCK} ${dueDate}<span class="dot"> - </span>${ICON_REFRESH} <span class="${getDaysAgoClass(daysAgo)}">${daysAgo}d</span>${job.withClient ? `<span class="dot"> - </span>${ICON_EXCHANGE} With client` : ''}</div>
                </div>
            </div>
            <div class="job-expanded">
                <div class="section-label">Update</div>
                <div class="job-description">${job.update || 'No updates yet'}</div>
                <div class="job-footer">
                    ${job.channelUrl ? `<a href="${job.channelUrl}" class="teams-link" target="_blank" onclick="event.stopPropagation()">-> TEAMS</a>` : '<span></span>'}
                    <span class="job-meta-compact">${job.projectOwner || 'TBC'}</span>
                </div>
            </div>
        </div>
    `;
}

async function submitWipUpdate(jobNumber, btn) {
    const card = btn.closest('.job-card');
    const stage = card.querySelector('[data-field="stage"]')?.value;
    const status = card.querySelector('[data-field="status"]')?.value;
    const updateDue = card.querySelector('[data-field="updateDue"]')?.value;
    const liveDate = card.querySelector('[data-field="liveDate"]')?.value;
    const message = card.querySelector('[data-field="message"]')?.value.trim();
    
    btn.disabled = true; btn.textContent = 'Saving...';
    
    const payload = { stage, status };
    if (updateDue) payload.updateDue = updateDue;
    if (liveDate) payload.liveDate = liveDate;
    
    try {
        const promises = [fetch(`${API_BASE}/job/${encodeURIComponent(jobNumber)}/update`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })];
        if (message) promises.push(fetch(`${PROXY_BASE}/proxy/update`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clientCode: jobNumber.split(' ')[0], jobNumber, message }) }));
        
        const responses = await Promise.all(promises);
        if (!responses.every(r => r.ok)) throw new Error('Update failed');
        
        const job = state.allJobs.find(j => j.jobNumber === jobNumber);
        if (job) { job.stage = stage; job.status = status; if (updateDue) job.updateDue = updateDue; if (liveDate) job.liveDate = liveDate; if (message) job.update = message; }
        
        btn.textContent = 'âœ“ Done'; btn.classList.add('success');
        showToast('On it.', 'success');
        setTimeout(() => { btn.textContent = 'Update'; btn.classList.remove('success'); btn.disabled = false; renderWip(); }, 1500);
    } catch (e) {
        btn.textContent = 'Error'; showToast("Doh, that didn't work.", 'error');
        setTimeout(() => { btn.textContent = 'Update'; btn.disabled = false; }, 2000);
    }
}

function toggleWipWithClient(jobNumber, isWithClient) {
    const job = state.allJobs.find(j => j.jobNumber === jobNumber);
    const oldValue = job?.withClient;
    if (job) { job.withClient = isWithClient; renderWip(); }
    
    fetch(`${API_BASE}/job/${encodeURIComponent(jobNumber)}/update`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ withClient: isWithClient }) })
        .then(res => { if (!res.ok) throw new Error(); showToast('On it.', 'success'); })
        .catch(() => { if (job) { job.withClient = oldValue; renderWip(); } showToast("Doh, that didn't work.", 'error'); });
}

// ===== TRACKER VIEW =====

// Tracker data storage
let trackerClients = {};
let trackerData = [];
let trackerCurrentMonth = 'January';
let trackerIsQuarterView = false;
let trackerCurrentEditData = null;

// Calendar quarters (fixed) - clients just label them differently
const calendarQuarters = {
    'Q1-cal': { months: ['January', 'February', 'March'], label: 'Jan > Mar' },
    'Q2-cal': { months: ['April', 'May', 'June'], label: 'Apr > Jun' },
    'Q3-cal': { months: ['July', 'August', 'September'], label: 'Jul > Sep' },
    'Q4-cal': { months: ['October', 'November', 'December'], label: 'Oct > Dec' }
};

// Current calendar quarter (Jan-Mar 2026)
const currentCalendarQuarter = 'Q1-cal';

// Map client's Q label to calendar quarter
const clientQuarterLabels = {
    'ONE': 'Q4', 'ONS': 'Q4', 'ONB': 'Q4',
    'SKY': 'Q3', 'TOW': 'Q2', 'FIS': 'Q4'
};

// Fallback data
const fallbackTrackerClients = [
    { code: 'ONS', name: 'One NZ - Simplification', committed: 25000, rollover: 0, rolloverUseIn: '', yearEnd: 'March', currentQuarter: 'Q4' },
    { code: 'ONE', name: 'One NZ - Marketing', committed: 12500, rollover: 2400, rolloverUseIn: 'JAN-MAR', yearEnd: 'March', currentQuarter: 'Q4' },
    { code: 'ONB', name: 'One NZ - Business', committed: 12500, rollover: 0, rolloverUseIn: '', yearEnd: 'March', currentQuarter: 'Q4' },
    { code: 'SKY', name: 'Sky', committed: 10000, rollover: 0, rolloverUseIn: '', yearEnd: 'June', currentQuarter: 'Q3' },
    { code: 'TOW', name: 'Tower', committed: 10000, rollover: 1500, rolloverUseIn: 'JAN-MAR', yearEnd: 'September', currentQuarter: 'Q2' },
    { code: 'FIS', name: 'Fisher Funds', committed: 4500, rollover: 500, rolloverUseIn: 'JAN-MAR', yearEnd: 'March', currentQuarter: 'Q4' }
];

function formatTrackerCurrency(amount) {
    if (Math.abs(amount) >= 1000) {
        return '$' + (amount / 1000).toFixed(Math.abs(amount) % 1000 === 0 ? 0 : 1) + 'K';
    }
    return '$' + Math.abs(amount).toLocaleString();
}

function getQuarterForMonth(month) {
    for (const key in calendarQuarters) {
        if (calendarQuarters[key].months.includes(month)) return key;
    }
    return currentCalendarQuarter;
}

function getQuarterInfoForMonth(clientCode, month) {
    const calQ = getQuarterForMonth(month);
    const quarter = calendarQuarters[calQ];
    const calQNum = parseInt(calQ.replace('Q', '').replace('-cal', ''));
    const clientCurrentCalQ = parseInt(currentCalendarQuarter.replace('Q', '').replace('-cal', ''));
    const clientCurrentLabel = parseInt(clientQuarterLabels[clientCode]?.replace('Q', '') || '1');
    let clientQNum = clientCurrentLabel + (calQNum - clientCurrentCalQ);
    if (clientQNum > 4) clientQNum -= 4;
    if (clientQNum < 1) clientQNum += 4;
    return { quarter: 'Q' + clientQNum, months: quarter.months, label: quarter.label };
}

function getCurrentQuarterInfo(clientCode) {
    const quarter = calendarQuarters[currentCalendarQuarter];
    const clientLabel = clientQuarterLabels[clientCode] || 'Q1';
    return { quarter: clientLabel, months: quarter.months, label: quarter.label };
}

function getPreviousQuarter(clientCode) {
    const quarter = calendarQuarters['Q4-cal'];
    const clientCurrentQ = parseInt((clientQuarterLabels[clientCode] || 'Q1').replace('Q', ''));
    const prevQ = clientCurrentQ === 1 ? 'Q4' : 'Q' + (clientCurrentQ - 1);
    return { quarter: prevQ, months: quarter.months, label: quarter.label };
}

function getTrackerMonthSpend(client, month) {
    // Only count Project budget for hero numbers (exclude Extra budget and Project on us)
    return trackerData.filter(d => d.client === client && d.month === month && d.spendType === 'Project budget').reduce((sum, d) => sum + d.spend, 0);
}

function getTrackerProjectsForMonth(client, month) {
    return trackerData.filter(d => d.client === client && d.month === month);
}

async function loadTrackerClients() {
    try {
        const response = await fetch(`${API_BASE}/tracker/clients`);
        if (!response.ok) throw new Error('API returned ' + response.status);
        const data = await response.json();
        populateTrackerClients(data);
        return true;
    } catch (e) {
        console.log('Using fallback tracker clients');
        populateTrackerClients(fallbackTrackerClients);
        return true;
    }
}

function populateTrackerClients(data) {
    trackerClients = {};
    data.forEach(c => {
        trackerClients[c.code] = {
            name: c.name,
            committed: c.committed,
            quarterlyCommitted: c.committed * 3,
            rollover: c.rollover || 0,
            rolloverUseIn: c.rolloverUseIn || '',
            yearEnd: c.yearEnd,
            currentQuarter: c.currentQuarter
        };
    });
    
    // Populate dropdown
    const menu = $('tracker-client-menu');
    const trigger = $('tracker-client-trigger');
    if (!menu || !trigger) return;
    
    menu.innerHTML = '';
    const lastClient = localStorage.getItem('trackerLastClient');
    let defaultClient = null;
    let defaultName = '';
    
    data.forEach((c, idx) => {
        const option = document.createElement('div');
        const isDefault = lastClient ? (c.code === lastClient) : (idx === 0);
        option.className = 'custom-dropdown-option' + (isDefault ? ' selected' : '');
        option.dataset.value = c.code;
        option.textContent = c.name;
        menu.appendChild(option);
        if (isDefault) { defaultClient = c.code; defaultName = c.name; }
    });
    
    if (defaultClient) {
        state.trackerClient = defaultClient;
        trigger.querySelector('span').textContent = defaultName;
    } else if (data.length > 0) {
        state.trackerClient = data[0].code;
        trigger.querySelector('span').textContent = data[0].name;
    }
}

async function loadTrackerData(clientCode) {
    try {
        const response = await fetch(`${API_BASE}/tracker/data?client=${clientCode}`);
        if (!response.ok) throw new Error('API returned ' + response.status);
        const data = await response.json();
        trackerData = data.map(d => ({
            id: d.id, client: d.client, jobNumber: d.jobNumber, projectName: d.projectName,
            owner: d.owner, description: d.description, spend: d.spend, month: d.month,
            spendType: d.spendType, ballpark: d.ballpark
        }));
        return true;
    } catch (e) {
        console.log('Using empty tracker data for:', clientCode);
        trackerData = [];
        return true;
    }
}

function setupTrackerDropdowns() {
    // Client dropdown
    setupTrackerDropdown('tracker-client-trigger', 'tracker-client-menu', async (value) => {
        state.trackerClient = value;
        localStorage.setItem('trackerLastClient', value);
        $('tracker-content').style.opacity = '0.5';
        await loadTrackerData(value);
        $('tracker-content').style.opacity = '1';
        renderTrackerContent();
    });
    
    // Month dropdown
    setupTrackerDropdown('tracker-month-trigger', 'tracker-month-menu', (value) => {
        trackerCurrentMonth = value;
        renderTrackerContent();
    });
    
    // Mode toggle (Month/Quarter)
    const toggle = $('tracker-mode-switch');
    const labelMonth = $('tracker-mode-spend');
    const labelQuarter = $('tracker-mode-pipeline');
    
    if (toggle) {
        toggle.addEventListener('change', function() {
            trackerIsQuarterView = this.checked;
            labelMonth?.classList.toggle('active', !trackerIsQuarterView);
            labelQuarter?.classList.toggle('active', trackerIsQuarterView);
            renderTrackerContent();
        });
    }
    
    labelMonth?.addEventListener('click', () => {
        if (toggle) toggle.checked = false;
        trackerIsQuarterView = false;
        labelMonth.classList.add('active');
        labelQuarter?.classList.remove('active');
        renderTrackerContent();
    });
    
    labelQuarter?.addEventListener('click', () => {
        if (toggle) toggle.checked = true;
        trackerIsQuarterView = true;
        labelMonth?.classList.remove('active');
        labelQuarter.classList.add('active');
        renderTrackerContent();
    });
}

function setupTrackerDropdown(triggerId, menuId, onChange) {
    const trigger = $(triggerId);
    const menu = $(menuId);
    if (!trigger || !menu) return;
    
    trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        $$('.custom-dropdown-menu.open').forEach(m => {
            if (m.id !== menuId) { m.classList.remove('open'); m.previousElementSibling?.classList.remove('open'); }
        });
        trigger.classList.toggle('open');
        menu.classList.toggle('open');
    });
    
    menu.querySelectorAll('.custom-dropdown-option').forEach(opt => {
        opt.addEventListener('click', function() {
            const value = this.dataset.value;
            menu.querySelectorAll('.custom-dropdown-option').forEach(o => o.classList.remove('selected'));
            this.classList.add('selected');
            trigger.querySelector('span').textContent = this.textContent;
            trigger.classList.remove('open');
            menu.classList.remove('open');
            if (onChange) onChange(value);
        });
    });
}

async function renderTracker() {
    const content = $('tracker-content');
    if (!content) return;
    
    // Show loading
    content.innerHTML = `<div class="loading"><div class="loading-spinner"></div><p>Loading tracker...</p></div>`;
    
    // Load clients if not already loaded
    if (Object.keys(trackerClients).length === 0) {
        await loadTrackerClients();
    }
    
    // Load data for current client
    if (state.trackerClient) {
        await loadTrackerData(state.trackerClient);
    }
    
    // Setup dropdowns
    setupTrackerDropdowns();
    
    // Render content
    renderTrackerContent();
}

function renderTrackerContent() {
    const content = $('tracker-content');
    if (!content || !state.trackerClient) return;
    
    const client = trackerClients[state.trackerClient];
    if (!client) {
        content.innerHTML = `<div class="empty-section"><img src="images/dot-sitting.png" alt="Dot"><span>Select a client to view tracker</span></div>`;
        return;
    }
    
    const committed = client.committed;
    const rollover = client.rollover || 0;
    const rolloverUseIn = client.rolloverUseIn || '';
    const qInfo = getQuarterInfoForMonth(state.trackerClient, trackerCurrentMonth);
    const prevQ = getPreviousQuarter(state.trackerClient);
    
    const labelMap = { 'Jan > Mar': 'JAN-MAR', 'Apr > Jun': 'APR-JUN', 'Jul > Sep': 'JUL-SEP', 'Oct > Dec': 'OCT-DEC' };
    const viewedQuarterKey = labelMap[qInfo.label] || '';
    
    // Calculate spend
    let toDate, projects, monthsInQuarter;
    if (trackerIsQuarterView) {
        toDate = qInfo.months.reduce((sum, m) => sum + getTrackerMonthSpend(state.trackerClient, m), 0);
        projects = trackerData.filter(d => d.client === state.trackerClient && qInfo.months.includes(d.month));
        monthsInQuarter = qInfo.months.length;
    } else {
        toDate = getTrackerMonthSpend(state.trackerClient, trackerCurrentMonth);
        projects = getTrackerProjectsForMonth(state.trackerClient, trackerCurrentMonth);
        monthsInQuarter = 1;
    }
    
    const totalBudget = committed * monthsInQuarter;
    const remaining = totalBudget - toDate;
    const progress = totalBudget > 0 ? Math.min((toDate / totalBudget) * 100, 100) : 0;
    const isOver = toDate > totalBudget;
    const showRollover = rollover > 0 && rolloverUseIn && viewedQuarterKey === rolloverUseIn;
    
    // Separate projects by type
    const mainProjects = projects.filter(p => p.spendType === 'Project budget');
    const otherProjects = projects.filter(p => p.spendType === 'Extra budget' || p.spendType === 'Project on us');
    
    // Group for quarter view
    const groupProjects = (arr) => {
        if (!trackerIsQuarterView) return arr;
        const grouped = {};
        arr.forEach(p => {
            const key = p.jobNumber + '|' + p.projectName;
            if (!grouped[key]) grouped[key] = { ...p, spend: 0, _isGrouped: true };
            grouped[key].spend += p.spend;
        });
        return Object.values(grouped);
    };
    
    const displayMainProjects = groupProjects(mainProjects).sort((a, b) => {
        // Put 000 (Always on) at the bottom
        const aNum = a.jobNumber.split(' ')[1] || '';
        const bNum = b.jobNumber.split(' ')[1] || '';
        if (aNum === '000') return 1;
        if (bNum === '000') return -1;
        return 0;
    });
    const displayOtherProjects = groupProjects(otherProjects);
    
    // Calculate spend to date for each job (only months BEFORE current month)
    const spendToDate = {};
    if (!trackerIsQuarterView) {
        const monthOrder = ['October', 'November', 'December', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September'];
        const currentMonthIndex = monthOrder.indexOf(trackerCurrentMonth);
        
        trackerData.forEach(d => {
            const dataMonthIndex = monthOrder.indexOf(d.month);
            // Only count if this month comes before the current viewed month
            if (dataMonthIndex !== -1 && currentMonthIndex !== -1 && dataMonthIndex < currentMonthIndex) {
                spendToDate[d.jobNumber] = (spendToDate[d.jobNumber] || 0) + d.spend;
            }
        });
    }
    
    const numbersTitle = trackerIsQuarterView ? `${qInfo.quarter} Numbers` : `${trackerCurrentMonth} Numbers`;
    const amountHeader = trackerIsQuarterView ? `${qInfo.quarter} Total` : trackerCurrentMonth;
    
    content.innerHTML = `
        <div class="tracker-inner">
            <!-- Numbers Section -->
            <div class="section-title"><span>${numbersTitle}</span> <span class="quarter-context">${qInfo.quarter} (${qInfo.label})</span></div>
            <div class="numbers-section">
                <div class="numbers-grid">
                    <div class="stat-box">
                        <div class="stat-value grey">${formatTrackerCurrency(committed * monthsInQuarter)}</div>
                        <div class="stat-label">Committed</div>
                    </div>
                    <div class="stat-box">
                        <div class="stat-value">${formatTrackerCurrency(toDate)}</div>
                        <div class="stat-label">To Date</div>
                    </div>
                    <div class="stat-box">
                        <div class="stat-value ${isOver ? 'orange' : 'red'}">${isOver ? '-' : ''}${formatTrackerCurrency(Math.abs(remaining))}</div>
                        <div class="stat-label">To Spend</div>
                    </div>
                </div>
                <div class="tracker-progress-bar">
                    <div class="tracker-progress-fill ${isOver ? 'over' : ''}" style="width: ${progress}%"></div>
                </div>
                ${showRollover ? `
                    <div class="rollover-credit">
                        <div class="rollover-label">Rollover</div>
                        <div class="rollover-amount"><strong>+${formatTrackerCurrency(rollover)}</strong> credit from ${prevQ.quarter}</div>
                    </div>
                ` : ''}
            </div>
            
            <!-- Projects Table -->
            <div class="section-title">The Work</div>
            <div class="projects-section">
                <table class="projects-table">
                    <thead>
                        <tr>
                            <th class="chevron-col"></th>
                            <th class="project-col">Project Name</th>
                            <th class="owner-col">Owner</th>
                            <th>Description</th>
                            ${!trackerIsQuarterView ? '<th class="amount-col">To Date</th>' : ''}
                            <th class="amount-col">${amountHeader}</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${displayMainProjects.length === 0 ? `
                            <tr><td colspan="${trackerIsQuarterView ? 5 : 6}" style="text-align:center;color:var(--grey-400);padding:24px;">No projects for ${trackerIsQuarterView ? qInfo.quarter : trackerCurrentMonth}</td></tr>
                        ` : displayMainProjects.map(p => {
                            const jobNum = p.jobNumber.split(' ')[1] || '';
                            const showToDateCol = !trackerIsQuarterView && jobNum !== '000' && jobNum !== '001' && (spendToDate[p.jobNumber] || 0) > 0;
                            const chevronDisabled = p._isGrouped ? 'style="color:var(--grey-200);cursor:default;"' : '';
                            return `
                                <tr>
                                    <td class="chevron-cell"><button class="chevron-btn" ${chevronDisabled} onclick="${p._isGrouped ? '' : `openTrackerEditModal('${p.jobNumber}', '${trackerCurrentMonth}')`}">></button></td>
                                    <td class="project-name">${p.jobNumber}  -  ${p.projectName}</td>
                                    <td>${p.owner || ''}</td>
                                    <td>${p.description || ''}</td>
                                    ${!trackerIsQuarterView ? `<td class="amount" style="color:var(--grey-400);font-weight:normal;">${showToDateCol ? '(' + formatTrackerCurrency(spendToDate[p.jobNumber]) + ')' : ''}</td>` : ''}
                                    <td class="amount ${p.ballpark ? 'ballpark' : ''}">${formatTrackerCurrency(p.spend)}</td>
                                </tr>
                            `;
                        }).join('')}
                    </tbody>
                </table>
            </div>
            
            ${displayOtherProjects.length > 0 ? `
                <!-- Other Work Table -->
                <div class="section-title">Other Stuff</div>
                <div class="projects-section">
                    <table class="projects-table">
                        <thead>
                            <tr>
                                <th class="chevron-col"></th>
                                <th class="project-col">Project Name</th>
                                <th class="owner-col">Owner</th>
                                <th>Description</th>
                                ${!trackerIsQuarterView ? '<th class="amount-col">To Date</th>' : ''}
                                <th class="amount-col">${amountHeader}</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${displayOtherProjects.map(p => {
                                const jobNum = p.jobNumber.split(' ')[1] || '';
                                const showToDateCol = !trackerIsQuarterView && jobNum !== '000' && jobNum !== '001' && (spendToDate[p.jobNumber] || 0) > 0;
                                const chevronDisabled = p._isGrouped ? 'style="color:var(--grey-200);cursor:default;"' : '';
                                return `
                                    <tr>
                                        <td class="chevron-cell"><button class="chevron-btn" ${chevronDisabled} onclick="${p._isGrouped ? '' : `openTrackerEditModal('${p.jobNumber}', '${trackerCurrentMonth}')`}">></button></td>
                                        <td class="project-name">${p.jobNumber}  -  ${p.projectName}</td>
                                        <td>${p.owner || ''}</td>
                                        <td>${p.description || ''}</td>
                                        ${!trackerIsQuarterView ? `<td class="amount" style="color:var(--grey-400);font-weight:normal;">${showToDateCol ? '(' + formatTrackerCurrency(spendToDate[p.jobNumber]) + ')' : ''}</td>` : ''}
                                        <td class="amount">${formatTrackerCurrency(p.spend)}</td>
                                    </tr>
                                `;
                            }).join('')}
                        </tbody>
                    </table>
                </div>
            ` : ''}
            
            <!-- Bottom Row: Chart + Notes -->
            <div class="tracker-bottom-row">
                <div>
                    <div class="section-title">Tracker</div>
                    <div class="chart-section">
                        <div class="chart-wrapper">
                            <div class="y-axis" id="tracker-y-axis"></div>
                            <div class="committed-line" id="tracker-committed-line"></div>
                            <div class="chart-container" id="tracker-chart-container"></div>
                        </div>
                        <div class="chart-legend">
                            <div class="legend-item"><div class="legend-swatch projects"></div><span>Projects</span></div>
                            <div class="legend-item"><div class="legend-swatch committed-swatch"></div><span>Committed</span></div>
                            <div class="legend-item"><div class="legend-swatch incoming-swatch"></div><span>Ballpark</span></div>
                        </div>
                    </div>
                </div>
                <div>
                    <div class="section-title">Notes</div>
                    <div class="notes-section">
                        <ul class="notes-list">
                            <li><strong>Ballparks</strong> - Red numbers are ballparks. Most jobs start as a $5K ballpark before we lock in scope.</li>
                            <li><strong>Rollover</strong> - You can use your rollover credit any time during the quarter. It's extra on top of committed spend.</li>
                        </ul>
                        <button class="pdf-btn" onclick="getTrackerPDF()">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                                <polyline points="14 2 14 8 20 8"></polyline>
                                <line x1="12" y1="18" x2="12" y2="12"></line>
                                <line x1="9" y1="15" x2="15" y2="15"></line>
                            </svg>
                            Get PDF
                        </button>
                    </div>
                </div>
            </div>
        </div>
        
        <!-- Edit Modal -->
        <div class="tracker-modal-overlay" id="tracker-edit-modal">
            <div class="tracker-modal">
                <div class="tracker-modal-header">
                    <span class="tracker-modal-title" id="tracker-modal-title">Update Project</span>
                    <div class="tracker-modal-header-right">
                        <div class="ballpark-toggle">
                            <span class="ballpark-label" id="tracker-ballpark-label">Ballpark</span>
                            <label class="toggle">
                                <input type="checkbox" id="tracker-edit-ballpark">
                                <span class="toggle-slider"></span>
                            </label>
                        </div>
                        <button class="tracker-modal-close" onclick="closeTrackerModal()">x</button>
                    </div>
                </div>
                <div class="tracker-modal-body">
                    <div class="tracker-form-group">
                        <label class="tracker-form-label">Project Name</label>
                        <input type="text" class="tracker-form-input" id="tracker-edit-name" readonly>
                    </div>
                    <div class="tracker-form-group">
                        <label class="tracker-form-label">Description</label>
                        <input type="text" class="tracker-form-input" id="tracker-edit-description">
                    </div>
                    <div class="tracker-form-row">
                        <div class="tracker-form-group">
                            <label class="tracker-form-label">Spend</label>
                            <input type="number" class="tracker-form-input" id="tracker-edit-spend">
                        </div>
                        <div class="tracker-form-group">
                            <label class="tracker-form-label">Month</label>
                            <select class="tracker-form-input" id="tracker-edit-month">
                                <option value="January">January</option>
                                <option value="February">February</option>
                                <option value="March">March</option>
                                <option value="October">October</option>
                                <option value="November">November</option>
                                <option value="December">December</option>
                            </select>
                        </div>
                    </div>
                    <div class="tracker-form-group">
                        <label class="tracker-form-label">Spend Type</label>
                        <select class="tracker-form-input" id="tracker-edit-spendtype">
                            <option value="Project budget">Project budget</option>
                            <option value="Extra budget">Extra budget</option>
                            <option value="Project on us">Project on us</option>
                        </select>
                    </div>
                </div>
                <div class="tracker-modal-footer">
                    <button class="tracker-btn tracker-btn-secondary" onclick="closeTrackerModal()">Cancel</button>
                    <button class="tracker-btn tracker-btn-primary" id="tracker-save-btn" onclick="saveTrackerProject()">Save Changes</button>
                </div>
            </div>
        </div>
    `;
    
    // Render chart after DOM is ready
    setTimeout(renderTrackerChart, 0);
    
    // Setup modal listeners
    setupTrackerModalListeners();
}

function renderTrackerChart() {
    const client = trackerClients[state.trackerClient];
    if (!client) return;
    
    const committed = client.committed;
    const qInfo = getCurrentQuarterInfo(state.trackerClient);
    const prevQ = getPreviousQuarter(state.trackerClient);
    const chartHeight = 160;
    const yMax = committed + 10000;
    
    // Previous quarter spends
    const prevSpends = prevQ.months.map(m => 
        trackerData.filter(d => d.client === state.trackerClient && d.month === m && d.spendType === 'Project budget')
            .reduce((sum, d) => sum + d.spend, 0)
    );
    
    // Current quarter spends - split by ballpark flag
    const currentConfirmed = [], currentBallpark = [];
    qInfo.months.forEach(m => {
        const monthProjects = trackerData.filter(d => d.client === state.trackerClient && d.month === m && d.spendType === 'Project budget');
        currentConfirmed.push(monthProjects.filter(d => !d.ballpark).reduce((sum, d) => sum + d.spend, 0));
        currentBallpark.push(monthProjects.filter(d => d.ballpark).reduce((sum, d) => sum + d.spend, 0));
    });
    
    // Y axis
    const yAxis = $('tracker-y-axis');
    if (yAxis) {
        yAxis.innerHTML = '';
        for (let i = 5; i >= 0; i--) {
            const label = document.createElement('span');
            label.className = 'y-label';
            label.textContent = '$' + Math.round(yMax * i / 5 / 1000) + 'k';
            yAxis.appendChild(label);
        }
    }
    
    // Committed line
    const greyBarHeight = chartHeight - (10000 / yMax * chartHeight);
    const committedLine = $('tracker-committed-line');
    if (committedLine) {
        committedLine.style.bottom = (greyBarHeight + 20) + 'px';
        committedLine.style.top = 'auto';
    }
    
    // Chart bars
    const container = $('tracker-chart-container');
    if (!container) return;
    container.innerHTML = '';
    
    const prevMonthLabels = prevQ.months.map(m => m.substring(0, 3));
    const currMonthLabels = qInfo.months.map(m => m.substring(0, 3));
    const today = new Date();
    const currentMonthName = today.toLocaleString('en-US', { month: 'long' });
    const currentMonthIndex = qInfo.months.indexOf(currentMonthName);
    
    // Previous quarter bars
    prevMonthLabels.forEach((label, i) => {
        const group = document.createElement('div');
        group.className = 'bar-group';
        const barStack = document.createElement('div');
        barStack.className = 'bar-stack';
        barStack.style.height = greyBarHeight + 'px';
        
        const greyBar = document.createElement('div');
        greyBar.className = 'bar-committed';
        greyBar.style.height = '100%';
        greyBar.title = 'Committed: ' + formatTrackerCurrency(committed);
        barStack.appendChild(greyBar);
        
        const redBar = document.createElement('div');
        redBar.className = 'bar-spend';
        redBar.style.height = (prevSpends[i] / committed * 100) + '%';
        redBar.title = 'Actual: ' + formatTrackerCurrency(prevSpends[i]);
        barStack.appendChild(redBar);
        
        const labelEl = document.createElement('span');
        labelEl.className = 'bar-label';
        labelEl.textContent = label;
        
        group.appendChild(barStack);
        group.appendChild(labelEl);
        container.appendChild(group);
    });
    
    // Current quarter bars
    currMonthLabels.forEach((label, i) => {
        const group = document.createElement('div');
        group.className = 'bar-group';
        const barStack = document.createElement('div');
        barStack.className = 'bar-stack';
        barStack.style.height = greyBarHeight + 'px';
        
        const isFuture = currentMonthIndex !== -1 && i > currentMonthIndex;
        
        const greyBar = document.createElement('div');
        greyBar.className = isFuture ? 'bar-committed future' : 'bar-committed';
        greyBar.style.height = '100%';
        greyBar.title = 'Committed: ' + formatTrackerCurrency(committed);
        barStack.appendChild(greyBar);
        
        const confirmedSpend = currentConfirmed[i] || 0;
        if (!isFuture && confirmedSpend > 0) {
            const redBar = document.createElement('div');
            redBar.className = 'bar-spend';
            redBar.style.height = (confirmedSpend / committed * 100) + '%';
            redBar.title = 'Actual: ' + formatTrackerCurrency(confirmedSpend);
            barStack.appendChild(redBar);
        }
        
        const ballparkSpend = currentBallpark[i] || 0;
        if (ballparkSpend > 0) {
            const dashedBar = document.createElement('div');
            dashedBar.className = 'bar-ballpark';
            dashedBar.style.height = (ballparkSpend / committed * 100) + '%';
            dashedBar.style.bottom = (!isFuture && confirmedSpend > 0) ? (confirmedSpend / committed * 100) + '%' : '0';
            dashedBar.title = 'Ballpark: ' + formatTrackerCurrency(ballparkSpend);
            barStack.appendChild(dashedBar);
        }
        
        const labelEl = document.createElement('span');
        labelEl.className = 'bar-label';
        labelEl.textContent = label;
        
        group.appendChild(barStack);
        group.appendChild(labelEl);
        container.appendChild(group);
    });
}

function setupTrackerModalListeners() {
    const modal = $('tracker-edit-modal');
    const ballparkToggle = $('tracker-edit-ballpark');
    
    if (modal) {
        modal.addEventListener('click', (e) => { if (e.target === modal) closeTrackerModal(); });
    }
    
    if (ballparkToggle) {
        ballparkToggle.addEventListener('change', function() {
            updateTrackerBallparkUI(this.checked);
        });
    }
}

function updateTrackerBallparkUI(isBallpark) {
    const modal = document.querySelector('.tracker-modal');
    const label = $('tracker-ballpark-label');
    if (isBallpark) {
        modal?.classList.add('ballpark-active');
        label?.classList.add('active');
    } else {
        modal?.classList.remove('ballpark-active');
        label?.classList.remove('active');
    }
}

function openTrackerEditModal(jobNumber, month) {
    const project = trackerData.find(p => p.jobNumber === jobNumber && p.month === month) ||
                    trackerData.find(p => p.jobNumber === jobNumber);
    if (!project) return;
    
    trackerCurrentEditData = project;
    
    $('tracker-modal-title').textContent = 'Update ' + jobNumber;
    $('tracker-edit-name').value = project.projectName;
    $('tracker-edit-description').value = project.description || '';
    $('tracker-edit-spend').value = project.spend;
    $('tracker-edit-month').value = project.month;
    $('tracker-edit-spendtype').value = project.spendType;
    
    const isBallpark = project.ballpark || false;
    $('tracker-edit-ballpark').checked = isBallpark;
    updateTrackerBallparkUI(isBallpark);
    
    $('tracker-edit-modal')?.classList.add('visible');
}

function closeTrackerModal() {
    $('tracker-edit-modal')?.classList.remove('visible');
    document.querySelector('.tracker-modal')?.classList.remove('ballpark-active');
    const saveBtn = $('tracker-save-btn');
    if (saveBtn) { saveBtn.textContent = 'Save Changes'; saveBtn.disabled = false; }
    trackerCurrentEditData = null;
}

async function saveTrackerProject() {
    if (!trackerCurrentEditData) return;
    
    const updates = {
        id: trackerCurrentEditData.id,
        description: $('tracker-edit-description').value,
        spend: parseFloat($('tracker-edit-spend').value) || 0,
        month: $('tracker-edit-month').value,
        spendType: $('tracker-edit-spendtype').value,
        ballpark: $('tracker-edit-ballpark').checked
    };
    
    const saveBtn = $('tracker-save-btn');
    if (saveBtn) { saveBtn.textContent = 'Saving...'; saveBtn.disabled = true; }
    
    try {
        const response = await fetch(`${API_BASE}/tracker/update`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updates)
        });
        
        if (!response.ok) throw new Error('Failed to save');
        
        // Update local data
        Object.assign(trackerCurrentEditData, updates);
        closeTrackerModal();
        
        // Reload and re-render
        await loadTrackerData(state.trackerClient);
        renderTrackerContent();
        showToast('On it.', 'success');
        
    } catch (e) {
        console.error('Save failed:', e);
        showToast("Doh, that didn't work.", 'error');
        if (saveBtn) { saveBtn.textContent = 'Save Changes'; saveBtn.disabled = false; }
    }
}

function getTrackerPDF() {
    const url = `https://dot-tracker-pdf.up.railway.app/pdf?client=${state.trackerClient}&month=${trackerCurrentMonth}${trackerIsQuarterView ? '&quarter=true' : ''}`;
    window.open(url, '_blank');
}

// Make functions available globally for onclick handlers
window.openTrackerEditModal = openTrackerEditModal;
window.closeTrackerModal = closeTrackerModal;
window.saveTrackerProject = saveTrackerProject;
window.getTrackerPDF = getTrackerPDF;
