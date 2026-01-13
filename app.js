/**
 * Dot Hub - Unified Interface
 * Combines Ask Dot, What's What (WIP), and Tracker
 */

// ===== CONFIGURATION =====
const API_BASE = 'https://dot-remote-api.up.railway.app';
const PROXY_BASE = 'https://dot-proxy.up.railway.app';

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

const KEYWORDS = {
    DUE: ['due', 'overdue', 'deadline', "what's next", 'next', 'urgent'],
    FIND: ["what's on", 'show', 'check', 'find', 'jobs'],
    UPDATE: ['update'],
    TRACKER: ['tracker', 'spend', 'budget'],
    HELP: ['help', 'what can dot do', 'about dot']
};

const STOP_WORDS = ['the', 'a', 'an', 'job', 'project', 'about', 'for', 'with', 'that', 'one', 
    'whats', "what's", 'where', 'is', 'are', 'can', 'you', 'find', 'show', 'me', 'i', 'need', 
    'looking', 'check', 'on', 'how', 'hows', "how's", 'going', 'doing'];

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
    trackerMode: 'spend'
};

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
    $('desktop-footer')?.classList.toggle('hidden', view !== 'home');
    
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

// ===== QUERY PROCESSING =====
function processQuestion(question) {
    addThinkingDots();
    setTimeout(() => {
        removeThinkingDots();
        let parsed = parseQuery(question);
        parsed = applyDefaults(parsed);
        
        switch (parsed.coreRequest) {
            case 'DUE': executeDue(parsed); break;
            case 'FIND': executeFind(parsed); break;
            case 'UPDATE': executeUpdate(parsed); break;
            case 'TRACKER': executeTracker(parsed); break;
            case 'HELP': executeHelp(); break;
            default: executeHelp();
        }
        
        const area = getActiveConversationArea();
        if (area) area.scrollTop = area.scrollHeight;
    }, 600);
}

function parseQuery(query) {
    const q = query.toLowerCase().trim();
    const result = {
        coreRequest: null,
        modifiers: { client: null, status: null, withClient: null, dateRange: null },
        searchTerms: [],
        raw: query
    };
    
    const clientMatch = state.allClients.find(c => q.includes(c.name.toLowerCase()) || q.includes(c.code.toLowerCase()));
    if (clientMatch) result.modifiers.client = clientMatch.code;
    
    if (matchesKeywords(q, KEYWORDS.HELP)) result.coreRequest = 'HELP';
    else if (matchesKeywords(q, KEYWORDS.TRACKER)) result.coreRequest = 'TRACKER';
    else if (matchesKeywords(q, KEYWORDS.UPDATE)) result.coreRequest = 'UPDATE';
    else if (matchesKeywords(q, KEYWORDS.DUE)) {
        result.coreRequest = 'DUE';
        if (q.includes('today') || q.includes('now')) result.modifiers.dateRange = 'today';
        else if (q.includes('this week') || q.includes('week')) result.modifiers.dateRange = 'week';
        else if (q.includes('next')) result.modifiers.dateRange = 'next';
        else result.modifiers.dateRange = 'today';
    } else if (matchesKeywords(q, KEYWORDS.FIND) || clientMatch) {
        result.coreRequest = 'FIND';
        if (clientMatch) result.searchTerms = extractSearchTerms(q, clientMatch);
    }
    
    if (q.includes('on hold') || q.includes('hold')) result.modifiers.status = 'On Hold';
    else if (q.includes('incoming') || q.includes('new')) result.modifiers.status = 'Incoming';
    else if (q.includes('completed') || q.includes('done')) result.modifiers.status = 'Completed';
    
    if (q.includes('with client') || q.includes('with them') || q.includes('waiting')) result.modifiers.withClient = true;
    
    if (!result.coreRequest && q.length > 2) {
        result.coreRequest = 'FIND';
        result.searchTerms = extractSearchTermsRaw(q);
    }
    
    return result;
}

function matchesKeywords(query, keywords) { return keywords.some(kw => query.includes(kw)); }

function extractSearchTerms(query, clientMatch) {
    let q = query.toLowerCase();
    q = q.replace(clientMatch.name.toLowerCase(), '').replace(clientMatch.code.toLowerCase(), '');
    return extractSearchTermsRaw(q);
}

function extractSearchTermsRaw(query) {
    return query.split(/\s+/).filter(word => word.length > 2 && !STOP_WORDS.includes(word));
}

function applyDefaults(parsed) {
    if (!parsed.modifiers.status) parsed.modifiers.status = 'In Progress';
    if (parsed.modifiers.withClient === null) parsed.modifiers.withClient = false;
    if (parsed.coreRequest === 'DUE' && !parsed.modifiers.dateRange) parsed.modifiers.dateRange = 'today';
    return parsed;
}

// ===== EXECUTORS =====
function executeDue(parsed) {
    const jobs = getFilteredJobs(parsed.modifiers);
    const client = parsed.modifiers.client ? state.allClients.find(c => c.code === parsed.modifiers.client) : null;
    
    if (parsed.modifiers.dateRange === 'next') {
        if (jobs.length === 0) {
            renderResponse({ text: client ? `No upcoming deadlines for ${client.name}.` : 'No upcoming deadlines.', prompts: ['Check a client', "What's due today?"] });
        } else {
            const nextJob = jobs[0];
            renderResponse({ text: `Next up is <strong>${nextJob.jobNumber} | ${nextJob.jobName}</strong>, due ${formatDueDate(nextJob.updateDue)}.`, jobs: [nextJob], prompts: client ? ['Due today', `More ${client.name} jobs`] : ['Due today', 'Check a client'] });
        }
        return;
    }
    
    const dateLabel = parsed.modifiers.dateRange === 'week' ? 'this week' : 'today';
    if (jobs.length === 0) {
        renderResponse({ text: client ? `Nothing due ${dateLabel} for ${client.name}! 🎉` : `Nothing due ${dateLabel}! 🎉`, prompts: ['Due this week', 'On hold?', 'With client?'] });
    } else {
        renderResponse({ text: client ? `${jobs.length} job${jobs.length === 1 ? '' : 's'} due ${dateLabel} for ${client.name}:` : `${jobs.length} job${jobs.length === 1 ? '' : 's'} due ${dateLabel}:`, jobs: jobs, prompts: ['Due this week', 'On hold?', 'With client?'] });
    }
}

function executeFind(parsed) {
    if (!parsed.modifiers.client) { renderClientPicker(); return; }
    const client = state.allClients.find(c => c.code === parsed.modifiers.client);
    
    if (parsed.searchTerms.length > 0) {
        const jobs = searchJobs(parsed.modifiers, parsed.searchTerms);
        if (jobs.length === 0) renderResponse({ text: `Couldn't find a ${client?.name || parsed.modifiers.client} job matching that.`, prompts: [`All ${client?.name} jobs`, 'Check another client'] });
        else if (jobs.length === 1) renderResponse({ text: `I think you mean <strong>${jobs[0].jobNumber} | ${jobs[0].jobName}</strong>?`, jobs: [jobs[0]], prompts: [`All ${client?.name} jobs`, 'Check another client'] });
        else renderResponse({ text: `Found ${jobs.length} ${client?.name} jobs that might match:`, jobs: jobs.slice(0, 3), prompts: [`All ${client?.name} jobs`, 'Check another client'] });
        return;
    }
    
    const jobs = getFilteredJobs(parsed.modifiers);
    if (jobs.length === 0) renderResponse({ text: `No active jobs for ${client?.name || parsed.modifiers.client}.`, prompts: ['On hold?', 'With client?', 'Check another client'] });
    else renderResponse({ text: `Here's what's on for ${client?.name || parsed.modifiers.client}:`, jobs: jobs, prompts: ['On hold?', 'With client?', 'Check another client'] });
}

function executeUpdate(parsed) {
    if (parsed.modifiers.client) {
        const client = state.allClients.find(c => c.code === parsed.modifiers.client);
        renderResponse({ text: `Which ${client?.name} job do you want to update?`, prompts: [`Show ${client?.name} jobs`, 'Check another client'] });
    } else {
        renderResponse({ text: "Which job do you want to update? Tell me the client and I'll help you find it.", prompts: ['Check a client'] });
    }
}

function executeTracker(parsed) {
    renderResponse({ text: "Opening Tracker...", prompts: ['Check a client', "What's due?"] });
    setTimeout(() => navigateTo('tracker'), 500);
}

function executeHelp() {
    renderResponse({ text: `I'm Dot, here to help you:<br><br>• Check on jobs and client work<br>• See what's due or coming up<br>• Find info on any job<br><br>Try asking about a client or what's due!`, prompts: ['Check a client', "What's due?"] });
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
        jobs = jobs.filter(j => {
            if (!j.updateDue) return false;
            const dueDate = new Date(j.updateDue); dueDate.setHours(0, 0, 0, 0);
            switch (modifiers.dateRange) {
                case 'today': return dueDate <= today;
                case 'week': const weekFromNow = new Date(today); weekFromNow.setDate(weekFromNow.getDate() + 7); return dueDate <= weekFromNow;
                default: return true;
            }
        });
    }
    
    jobs.sort((a, b) => { if (!a.updateDue) return 1; if (!b.updateDue) return -1; return new Date(a.updateDue) - new Date(b.updateDue); });
    return jobs;
}

function searchJobs(modifiers, searchTerms) {
    let jobs = getFilteredJobs({ client: modifiers.client }, { includeAllStatuses: true });
    if (searchTerms.length === 0) return jobs;
    const scored = jobs.map(job => ({ job, score: scoreJobMatch(job, searchTerms) })).filter(item => item.score > 0).sort((a, b) => b.score - a.score);
    return scored.map(item => item.job);
}

function scoreJobMatch(job, searchTerms) {
    const jobName = (job.jobName || '').toLowerCase();
    const jobDesc = (job.description || '').toLowerCase();
    const jobUpdate = (job.update || '').toLowerCase();
    let score = 0;
    for (const term of searchTerms) {
        if (jobName.includes(term)) score += 10;
        if (jobDesc.includes(term)) score += 5;
        if (jobUpdate.includes(term)) score += 2;
    }
    return score;
}

// ===== RENDERERS =====
function renderResponse({ text, jobs = [], prompts = [] }) {
    const area = getActiveConversationArea();
    const response = document.createElement('div');
    response.className = 'dot-response fade-in';
    let html = `<p class="dot-text">${text}</p>`;
    
    if (jobs.length > 0) {
        html += '<div class="job-cards">';
        jobs.forEach((job, i) => { html += createConversationJobCard(job, i); });
        html += '</div>';
    }
    
    if (prompts.length > 0) {
        html += '<div class="smart-prompts">';
        prompts.forEach(p => { html += `<button class="smart-prompt" data-question="${p}">${p}</button>`; });
        html += '</div>';
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
            ${keyClients.map(c => `<div class="client-card" data-client="${c.code}"><div><div class="client-name">${getClientDisplayName(c)}</div><div class="client-count">${c.jobCount} active job${c.jobCount === 1 ? '' : 's'}</div></div><span class="card-chevron">›</span></div>`).join('')}
            ${hasOther ? `<div class="client-card other-clients-btn"><div><div class="client-name">Other clients</div></div><span class="card-chevron">›</span></div>` : ''}
        </div>
        <div class="smart-prompts"><button class="smart-prompt" data-question="What's due today?">What's due?</button></div>
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
    return `
        <div class="job-card" id="${id}">
            <div class="job-card-header" data-job-id="${id}">
                <div class="job-info">
                    <div class="job-title">${job.jobNumber} | ${job.jobName}</div>
                    <div class="job-meta-compact">🕐 ${dueDate}${job.withClient ? ' · With Client' : ''}</div>
                </div>
                <span class="card-chevron">›</span>
            </div>
            <div class="job-expanded">
                <div class="section-label">Update</div>
                <div class="job-description">${job.update || 'No update yet'}</div>
                <div class="job-footer">
                    ${job.channelUrl ? `<a href="${job.channelUrl}" target="_blank" class="teams-link">Teams →</a>` : '<span></span>'}
                    <span class="job-meta-compact">${job.projectOwner || 'TBC'}</span>
                </div>
            </div>
        </div>
    `;
}

function bindDynamicElements(container) {
    container.querySelectorAll('.smart-prompt').forEach(btn => {
        btn.addEventListener('click', () => { addUserMessage(btn.dataset.question); processQuestion(btn.dataset.question); });
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
    container.querySelectorAll('.job-card-header').forEach(header => {
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
            <div class="client-cards">${otherClients.map(c => `<div class="client-card" data-client="${c.code}"><div><div class="client-name">${getClientDisplayName(c)}</div><div class="client-count">${c.jobCount} active job${c.jobCount === 1 ? '' : 's'}</div></div><span class="card-chevron">›</span></div>`).join('')}</div>
            <div class="smart-prompts"><button class="smart-prompt" data-question="Check a client">Back to main clients</button></div>
        `;
        area?.appendChild(response);
        bindDynamicElements(response);
        if (area) area.scrollTop = area.scrollHeight;
    }, 400);
}

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
    return { leftTop: { title: "WE'RE ON IT", jobs: g.withUs, compact: false }, rightTop: { title: 'WITH YOU', jobs: g.withYou, compact: false }, leftBottom: { title: 'INCOMING', jobs: g.incoming, compact: true }, rightBottom: { title: 'ON HOLD', jobs: g.onHold, compact: true } };
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
    
    // Bind card events
    content.querySelectorAll('.job-card').forEach(card => {
        card.addEventListener('click', () => card.classList.toggle('expanded'));
    });
}

function renderWipSection(section) {
    let html = `<div class="section"><div class="section-title">${section.title}</div>`;
    if (section.jobs.length === 0) {
        html += `<div class="empty-section"><img src="images/dot-sitting.png" alt="Dot"><span>Nothing here</span></div>`;
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
                    <div class="job-title-row"><span class="job-title">${job.jobNumber} | ${job.jobName}</span><span class="expand-icon">⌄</span></div>
                    <div class="job-update-preview">${job.update || 'No updates yet'}</div>
                    <div class="job-meta-compact">🕐 ${dueDate}<span class="dot">·</span><span class="stage-tag">${job.stage}</span><span class="dot">·</span><span class="${getDaysAgoClass(daysAgo)}">${daysAgo} days ago</span></div>
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
                    ${job.channelUrl ? `<a href="${job.channelUrl}" class="teams-link" target="_blank" onclick="event.stopPropagation()">↗ TEAMS</a>` : '<span></span>'}
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
                    <div class="job-title-row"><span class="job-title">${job.jobNumber} | ${job.jobName}</span><span class="expand-icon">⌄</span></div>
                    <div class="job-meta-compact">🕐 ${dueDate}<span class="dot">·</span><span class="${getDaysAgoClass(daysAgo)}">${daysAgo}d</span></div>
                </div>
            </div>
            <div class="job-expanded">
                <div class="section-label">Update</div>
                <div class="job-description">${job.update || 'No updates yet'}</div>
                <div class="job-footer">
                    ${job.channelUrl ? `<a href="${job.channelUrl}" class="teams-link" target="_blank" onclick="event.stopPropagation()">↗ TEAMS</a>` : '<span></span>'}
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
        
        btn.textContent = '✓ Done'; btn.classList.add('success');
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
function renderTracker() {
    const content = $('tracker-content');
    if (!content) return;
    content.innerHTML = `<div class="empty-section"><img src="images/dot-sitting.png" alt="Dot"><span>Tracker coming soon</span></div>`;
}
