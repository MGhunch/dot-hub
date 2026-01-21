/** 
 * Dot Hub - Unified Interface
 * Simplified: Claude responds naturally, frontend renders
 */

// ===== CONFIGURATION =====
const API_BASE = '/api';
const PROXY_BASE = 'https://dot-proxy.up.railway.app';
const TRAFFIC_BASE = 'https://dot-traffic-2.up.railway.app';

const KEY_CLIENTS = ['ONE', 'ONB', 'ONS', 'SKY', 'TOW'];

const CLIENT_DISPLAY_NAMES = {
    'ONE': 'One NZ (Marketing)',
    'ONB': 'One NZ (Business)',
    'ONS': 'One NZ (Simplification)'
};

const PINS = {
    '9871': { name: 'Michael', fullName: 'Michael Goldthorpe', client: 'ALL', clientName: 'Hunch', mode: 'hunch' },
    '9262': { name: 'Emma', fullName: 'Emma Moore', client: 'ALL', clientName: 'Hunch', mode: 'hunch' },
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
    jobsLoaded: false,
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
    handleDeepLink();
}

// ===== DEEP LINK HANDLING =====
function handleDeepLink() {
    const params = new URLSearchParams(window.location.search);
    const view = params.get('view');       // wip, tracker, home
    const client = params.get('client');   // SKY, TOW, etc.
    const job = params.get('job');         // TOW066
    const month = params.get('month');     // January, February, etc. or 'current'
    const quarter = params.get('quarter'); // 'true' for quarter view
    
    // Store for after login/data load
    if (view || client || job || month || quarter) {
        state.deepLink = { view, client, job, month, quarter };
    }
}

function applyDeepLink() {
    if (!state.deepLink) return;
    
    const { view, client, job, month, quarter } = state.deepLink;
    
    // Clear deep link first to prevent re-application
    state.deepLink = null;
    
    // Clear URL params without reload (do this early)
    if (window.history.replaceState) {
        window.history.replaceState({}, document.title, window.location.pathname);
    }
    
    // Set state BEFORE navigating so render functions use our values
    
    if (view === 'wip' && client) {
        state.wipClient = client;
    }
    
    if (view === 'tracker') {
        if (client) {
            state.trackerClient = client;
            // Don't set localStorage - deep links shouldn't affect future visits
        }
        
        if (month) {
            let targetMonth = month;
            if (month === 'current') {
                const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 
                                  'July', 'August', 'September', 'October', 'November', 'December'];
                targetMonth = monthNames[new Date().getMonth()];
            }
            trackerCurrentMonth = targetMonth;
        }
        
        if (quarter === 'true') {
            trackerIsQuarterView = true;
        }
    }
    
    // Now navigate - render functions will use our pre-set values
    if (view && ['wip', 'tracker', 'home'].includes(view)) {
        navigateTo(view);
    }
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
        // Close plus menus on outside click
        if (!e.target.closest('.input-plus') && !e.target.closest('.plus-menu')) {
            $$('.plus-menu.open').forEach(m => m.classList.remove('open'));
        }
    });

    // Plus button click handlers
    $$('.input-plus').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const menu = btn.nextElementSibling;
            // Close other plus menus first
            $$('.plus-menu.open').forEach(m => {
                if (m !== menu) m.classList.remove('open');
            });
            menu?.classList.toggle('open');
        });
    });

    // Plus menu item click handlers
    $$('.plus-menu-item').forEach(item => {
        item.addEventListener('click', (e) => {
            e.stopPropagation();
            const action = item.dataset.action;
            // Close the menu
            item.closest('.plus-menu')?.classList.remove('open');
            // Show coming soon modal
            showComingSoonModal(action);
        });
    });
}

function isDesktop() { return window.innerWidth >= 900; }
function getActiveConversationArea() { return isDesktop() ? $('desktop-conversation-area') : $('phone-conversation-area'); }
function getClientDisplayName(client) { return CLIENT_DISPLAY_NAMES[client.code] || client.name; }

// ===== INACTIVITY TIMER =====
function resetInactivityTimer() {
    state.lastActivity = Date.now();
    if (inactivityTimer) clearTimeout(inactivityTimer);
    inactivityTimer = setTimeout(() => clearSessionSilently(), INACTIVITY_TIMEOUT);
}

function checkIfStale() {
    if (Date.now() - state.lastActivity > INACTIVITY_TIMEOUT) {
        clearSessionSilently();
    }
}

function clearSessionSilently() {
    if (state.currentUser) {
        // Clear session via Traffic (the brain)
        fetch(`${TRAFFIC_BASE}/traffic/clear`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId: state.currentUser.name })
        }).catch(() => {});
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
    
    // Apply deep link immediately after unlock
    applyDeepLink();
}

function checkSession() {
    const stored = sessionStorage.getItem('dotUser');
    if (stored) { state.currentUser = JSON.parse(stored); unlockApp(); }
}

function signOut() {
    clearDotSession();  // Clear conversation memory on Traffic
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
    
    // Footer: only show on home view when NOT in conversation
    const footer = $('desktop-footer');
    
    if (!isDesktop()) {
        $('phone-home')?.classList.add('hidden');
        $('phone-conversation')?.classList.remove('visible');
        $('phone-wip-message')?.classList.remove('visible');
        $('phone-tracker-message')?.classList.remove('visible');
        if (view === 'home') {
            // Check if there's an active conversation
            const hasConversation = $('phone-conversation-area')?.children.length > 0;
            if (hasConversation) {
                $('phone-conversation')?.classList.add('visible');
            } else {
                $('phone-home')?.classList.remove('hidden');
            }
        }
        else if (view === 'wip') $('phone-wip-message')?.classList.add('visible');
        else if (view === 'tracker') $('phone-tracker-message')?.classList.add('visible');
    } else {
        // Desktop: restore conversation state if exists
        if (view === 'home') {
            const hasConversation = $('desktop-conversation-area')?.children.length > 0;
            if (hasConversation) {
                $('desktop-home-state')?.classList.add('hidden');
                $('desktop-conversation-state')?.classList.add('visible');
                footer?.classList.add('hidden');
            } else {
                $('desktop-home-state')?.classList.remove('hidden');
                $('desktop-conversation-state')?.classList.remove('visible');
                footer?.classList.remove('hidden');
            }
        } else {
            // Non-home views: hide footer
            footer?.classList.add('hidden');
        }
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
    state.jobsLoaded = true;
    
    // Re-render WIP if we're on that view
    if (state.currentView === 'wip') {
        renderWip();
    }
}

// ===== CONVERSATION =====
function startConversation(layout) {
    const input = $(layout + '-home-input');
    const question = input?.value.trim() || 'What can Dot do?';
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

// Thinking helper messages
const thinkingMessages = {
    stage1: ["Let's have a look...", "Gimme a sec...", "Hunting that down..."],
    stage2: ["Digging the data...", "Joining the dots...", "Piecing bits together..."],
    stage3: ["Lining it all up...", "Checking for tickety boo...", "Quick lick of polish..."],
    stage4: ["Dotting my eyes...", "One more thing...", "Nearly there..."],
    countdown: ["five...", "four...", "three...", "two...", "one..."]
};

let thinkingTimeouts = [];

function addThinkingDots() {
    const area = getActiveConversationArea();
    const dots = document.createElement('div');
    dots.className = 'thinking-dots';
    dots.id = 'currentThinking';
    
    // Pick random message from each stage
    const msg1 = thinkingMessages.stage1[Math.floor(Math.random() * thinkingMessages.stage1.length)];
    const msg2 = thinkingMessages.stage2[Math.floor(Math.random() * thinkingMessages.stage2.length)];
    const msg3 = thinkingMessages.stage3[Math.floor(Math.random() * thinkingMessages.stage3.length)];
    const msg4 = thinkingMessages.stage4[Math.floor(Math.random() * thinkingMessages.stage4.length)];
    
    // Start with just Dot, no text
    dots.innerHTML = `
        <div class="dot-thinking">
            <img src="images/Robot_01.svg" alt="Dot" class="dot-robot">
            <img src="images/Heart_01.svg" alt="" class="dot-heart-svg">
        </div>
        <span class="thinking-helper"></span>
    `;
    
    area?.appendChild(dots);
    if (area) area.scrollTop = area.scrollHeight;
    
    const helper = dots.querySelector('.thinking-helper');
    
    // Helper to fade in new text
    const fadeToText = (text) => {
        helper.classList.remove('visible');
        setTimeout(() => {
            helper.textContent = text;
            helper.classList.add('visible');
        }, 200); // Brief pause during fade out before new text
    };
    
    // Stage timings: 800ms start, then 1600ms between stages
    thinkingTimeouts.push(setTimeout(() => {
        helper.textContent = msg1;
        helper.classList.add('visible');
    }, 800));
    
    thinkingTimeouts.push(setTimeout(() => fadeToText(msg2), 2400));
    thinkingTimeouts.push(setTimeout(() => fadeToText(msg3), 4000));
    thinkingTimeouts.push(setTimeout(() => fadeToText(msg4), 5600));
    
    // Countdown: 500ms apart starting at 7200ms
    thinkingMessages.countdown.forEach((word, i) => {
        thinkingTimeouts.push(setTimeout(() => fadeToText(word), 7200 + (i * 500)));
    });
}

function removeThinkingDots() {
    thinkingTimeouts.forEach(t => clearTimeout(t));
    thinkingTimeouts = [];
    $('currentThinking')?.remove();
}

// ===== QUERY PROCESSING (Unified - routes through Traffic) =====
async function processQuestion(question) {
    resetInactivityTimer();
    addThinkingDots();
    
    console.log('Query:', question);
    
    const response = await askDot(question);
    
    removeThinkingDots();
    
    console.log('Dot response:', response);
    
    if (!response) {
        const failMessages = [
            "Hmm, I'm having trouble thinking right now. Try again?",
            "Sorry, my brain just glitched. Give it another go?",
            "Oops, something went sideways. Mind trying that again?",
            "My wires got crossed for a sec. One more time?",
            "That one got away from me. Try again?"
        ];
        renderResponse({ 
            message: failMessages[Math.floor(Math.random() * failMessages.length)],
            nextPrompt: "What can Dot do?"
        });
        return;
    }
    
    // Handle different response types
    switch (response.type) {
        case 'answer':
            // Simple answer, maybe with job cards
            renderResponse({
                message: response.message,
                jobs: response.jobs || [],
                nextPrompt: response.nextPrompt
            });
            break;
            
        case 'action':
            // Worker was called (or will be called)
            renderResponse({
                message: response.message,
                jobs: [],
                nextPrompt: response.nextPrompt
            });
            break;
            
        case 'confirm':
            // Need user to pick a job
            renderResponse({
                message: response.message,
                jobs: response.jobs || [],
                nextPrompt: null
            });
            break;
            
        case 'clarify':
            // Need more info from user
            renderResponse({
                message: response.message,
                jobs: [],
                nextPrompt: null
            });
            break;
            
        case 'redirect':
            // Redirect to WIP or Tracker
            renderResponse({
                message: response.message,
                jobs: [],
                nextPrompt: null
            });
            // Navigate to the view
            if (response.redirectTo) {
                setTimeout(() => {
                    navigateTo(response.redirectTo);
                    // Apply filters if provided
                    if (response.redirectParams?.client) {
                        if (response.redirectTo === 'wip') {
                            state.wipClient = response.redirectParams.client;
                            renderWip();
                        } else if (response.redirectTo === 'tracker') {
                            state.trackerClient = response.redirectParams.client;
                            renderTracker();
                        }
                    }
                }, 1500);  // Short delay so user sees the message
            }
            break;
            
        case 'error':
            // Something went wrong
            renderResponse({
                message: response.message || "Sorry, I got in a muddle over that one.",
                jobs: [],
                nextPrompt: "What can Dot do?"
            });
            break;
            
        default:
            // Fallback - treat as answer
            renderResponse({
                message: response.message || "I'm not sure what happened there.",
                jobs: response.jobs || [],
                nextPrompt: response.nextPrompt
            });
    }
}

// ===== DOT API (Unified Traffic) =====
async function askDot(question) {
    try {
        const sessionId = state.currentUser?.name || 'anonymous';
        
        const response = await fetch(`${TRAFFIC_BASE}/traffic`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                source: 'hub',
                content: question,
                senderEmail: state.currentUser?.email || 'hub@hunch.co.nz',
                senderName: state.currentUser?.name || 'Hub User',
                sessionId: sessionId
            })
        });
        
        if (!response.ok) {
            console.log('Traffic API error:', response.status);
            return null;
        }
        
        return await response.json();
    } catch (e) {
        console.log('Traffic API error:', e);
        return null;
    }
}

async function clearDotSession() {
    try {
        const sessionId = state.currentUser?.name || 'anonymous';
        await fetch(`${TRAFFIC_BASE}/traffic/clear`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId })
        });
    } catch (e) {
        console.log('Failed to clear session:', e);
    }
}

// ===== JOB FILTERING (DEPRECATED - backend now returns jobs directly) =====
// Keeping for reference in case we need local filtering again
/*
function getFilteredJobsFromResponse(jobFilter) {
    if (!jobFilter) return [];
    
    let jobs = [...state.allJobs];
    
    // Filter by client
    if (jobFilter.client) {
        jobs = jobs.filter(j => j.clientCode === jobFilter.client);
    }
    
    // Filter by status
    if (jobFilter.status) {
        jobs = jobs.filter(j => j.status === jobFilter.status);
    } else {
        // Default to active jobs only
        jobs = jobs.filter(j => j.status === 'In Progress');
    }
    
    // Filter by with client
    if (jobFilter.withClient === true) {
        jobs = jobs.filter(j => j.withClient === true);
    } else if (jobFilter.withClient === false) {
        jobs = jobs.filter(j => !j.withClient);
    }
    
    // Filter by date range
    if (jobFilter.dateRange) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        jobs = jobs.filter(j => {
            if (!j.updateDue) return false;
            const due = new Date(j.updateDue);
            due.setHours(0, 0, 0, 0);
            
            switch (jobFilter.dateRange) {
                case 'today':
                    return due <= today;
                case 'tomorrow':
                    const tomorrow = new Date(today);
                    tomorrow.setDate(tomorrow.getDate() + 1);
                    return due <= tomorrow;
                case 'week':
                    const week = new Date(today);
                    week.setDate(week.getDate() + 7);
                    return due <= week;
                default:
                    return true;
            }
        });
    }
    
    // Search filter
    if (jobFilter.search?.length) {
        jobs = jobs.filter(job => {
            const searchable = `${job.jobNumber} ${job.jobName} ${job.description || ''} ${job.update || ''}`.toLowerCase();
            return jobFilter.search.some(term => searchable.includes(term.toLowerCase()));
        });
    }
    
    // Sort by due date
    jobs.sort((a, b) => {
        const aDate = a.updateDue ? new Date(a.updateDue) : new Date('9999-12-31');
        const bDate = b.updateDue ? new Date(b.updateDue) : new Date('9999-12-31');
        return aDate - bDate;
    });
    
    // Exclude 000 and 999 jobs
    jobs = jobs.filter(j => {
        const num = j.jobNumber.split(' ')[1];
        return num !== '000' && num !== '999';
    });
    
    return jobs;
}
*/

// ===== RENDERING =====
function renderResponse({ message, jobs = [], nextPrompt = null }) {
    const area = getActiveConversationArea();
    const response = document.createElement('div');
    response.className = 'dot-response fade-in';
    
    // Format message - handle bullets and line breaks
    let formattedMessage = formatMessage(message);
    
    let html = `<div class="dot-text">${formattedMessage}</div>`;
    
    if (jobs.length > 0) {
        html += '<div class="job-cards">';
        jobs.forEach((job, i) => {
            html += createJobCard(job, i);
        });
        html += '</div>';
    }
    
    if (nextPrompt) {
        html += `<p class="next-prompt" data-question="${nextPrompt}">${nextPrompt}</p>`;
    }
    
    response.innerHTML = html;
    area?.appendChild(response);
    
    // Bind click handlers
    response.querySelectorAll('.next-prompt').forEach(el => {
        el.addEventListener('click', () => {
            addUserMessage(el.dataset.question);
            processQuestion(el.dataset.question);
        });
    });
    
    response.querySelectorAll('.job-header[data-job-id]').forEach(header => {
        header.addEventListener('click', () => {
            document.getElementById(header.dataset.jobId)?.classList.toggle('expanded');
        });
    });
    
    if (area) area.scrollTop = area.scrollHeight;
}

function createJobCard(job, index) {
    // Use universal card for Ask Dot results
    return createUniversalCard(job, `job-${Date.now()}-${index}`);
}

// ===== UNIVERSAL JOB CARD =====
function createUniversalCard(job, id) {
    const dueDate = formatDueDate(job.updateDue);
    const daysAgo = getDaysSinceUpdate(job.lastUpdated);
    
    // Build summary line: Stage - Live Date - With client
    let summaryParts = [];
    if (job.stage) summaryParts.push(job.stage);
    if (job.liveDate) summaryParts.push(`Live ${formatDueDate(job.liveDate)}`);
    if (job.withClient) summaryParts.push('With client');
    const summaryLine = summaryParts.join(' - ') || '';
    
    // Build recent activity HTML
    const recentActivity = formatRecentActivity(job.updateHistory);
    
    return `
        <div class="job-card" id="${id}" data-job="${job.jobNumber}">
            <div class="job-header" data-job-id="${id}">
                <div class="job-logo">
                    <img src="${getLogoUrl(job.clientCode)}" alt="${job.clientCode}" onerror="this.src='images/logos/Unknown.png'">
                </div>
                <div class="job-main">
                    <div class="job-title-row">
                        <span class="job-title">${job.jobNumber} | ${job.jobName}</span>
                        <span class="expand-icon">${ICON_CHEVRON}</span>
                    </div>
                    <div class="job-update-preview">${job.update || 'No updates yet'}</div>
                    <div class="job-meta-compact">
                        ${ICON_CLOCK} ${dueDate}
                        <span class="dot"> - </span>
                        ${ICON_REFRESH} <span class="${getDaysAgoClass(daysAgo)}">${daysAgo} days ago</span>
                    </div>
                </div>
            </div>
            <div class="job-expanded">
                ${summaryLine ? `<div class="job-summary-line">${summaryLine}</div>` : ''}
                <div class="section-label">The Project</div>
                <div class="job-description">${job.description || 'No description'}</div>
                <div class="section-label" style="margin-top:14px">Recent Activity</div>
                ${recentActivity}
                <div class="job-expanded-footer">
                    <button class="pill-btn update-btn" onclick="event.stopPropagation(); openJobModal('${job.jobNumber}')">Update</button>
                </div>
            </div>
        </div>
    `;
}

function formatRecentActivity(updateHistory) {
    if (!updateHistory || updateHistory.length === 0) {
        return '<div class="no-activity">No recent activity</div>';
    }
    
    // Reverse to get newest first, then take up to 3
    const recent = [...updateHistory].reverse().slice(0, 3);
    
    let html = '<div class="recent-activity">';
    recent.forEach((update, i) => {
        // Handle different formats - could be "12 Jan | Update text" or just text
        const isFirst = i === 0;
        html += `<div class="activity-item ${isFirst ? 'latest' : ''}">${update}</div>`;
    });
    html += '</div>';
    
    return html;
}

// ===== JOB EDIT MODAL =====
let currentEditJob = null;

async function openJobModal(jobNumber) {
    const job = state.allJobs.find(j => j.jobNumber === jobNumber);
    if (!job) return;
    
    currentEditJob = job;
    
    // Populate modal fields
    const modal = $('job-edit-modal');
    if (!modal) return;
    
    $('job-modal-title').textContent = `${jobNumber} | ${job.jobName || 'Untitled'}`;
    $('job-modal-logo').src = getLogoUrl(job.clientCode);
    $('job-modal-logo').onerror = function() { this.src = 'images/logos/Unknown.png'; };
    $('job-modal-logo').alt = job.clientCode;
    $('job-edit-name').value = job.jobName || '';
    $('job-edit-description').value = job.description || "What's this job all about?";
    $('job-edit-stage').value = job.stage || 'Clarify';
    $('job-edit-status').value = job.status || 'Incoming';
    $('job-edit-update-due').value = formatDateForInput(job.updateDue);
    $('job-edit-live-date').value = formatDateForInput(job.liveDate);
    $('job-edit-message').value = job.update || '';
    $('job-edit-with-client').checked = job.withClient || false;
    
    // Set Teams link
    const teamsLink = $('job-modal-teams-link');
    if (job.channelUrl) {
        teamsLink.href = job.channelUrl;
        teamsLink.style.display = 'inline';
    } else {
        teamsLink.style.display = 'none';
    }
    
    // Set Tracker link (opens tracker filtered to this client and current month)
    const trackerLink = $('job-modal-tracker-link');
    trackerLink.onclick = (e) => {
        e.preventDefault();
        closeJobModal();
        
        // Use current month
        const month = new Date().toLocaleString('en-US', { month: 'long' });
        
        // Navigate using URL params
        window.location.href = `?view=tracker&client=${job.clientCode}&month=${month}`;
    };
    
    // Populate client owner dropdown
    const ownerSelect = $('job-edit-owner');
    ownerSelect.innerHTML = '<option value="">Loading...</option>';
    
    // Show modal immediately
    modal.classList.add('visible');
    
    // Fetch people for this client
    try {
        const clientCode = job.clientCode;
        const response = await fetch(`${API_BASE}/people/${clientCode}`);
        if (response.ok) {
            const people = await response.json();
            console.log(`Loaded ${people.length} people for ${clientCode}`);
            
            ownerSelect.innerHTML = '<option value="">Select...</option>';
            
            // Check if current owner is in the list
            const currentOwner = job.projectOwner || '';
            let ownerFound = false;
            
            people.forEach(person => {
                const option = document.createElement('option');
                option.value = person.name;
                option.textContent = person.name;
                if (person.name === currentOwner) {
                    option.selected = true;
                    ownerFound = true;
                }
                ownerSelect.appendChild(option);
            });
            
            // If current owner not in list but exists, add them at top
            if (currentOwner && !ownerFound) {
                const option = document.createElement('option');
                option.value = currentOwner;
                option.textContent = currentOwner;
                option.selected = true;
                ownerSelect.insertBefore(option, ownerSelect.options[1]);
            }
        } else {
            // Fallback to current owner only
            console.log('People API failed:', response.status);
            ownerSelect.innerHTML = `<option value="${job.projectOwner || ''}">${job.projectOwner || 'Select...'}</option>`;
        }
    } catch (e) {
        console.log('Failed to load people:', e);
        ownerSelect.innerHTML = `<option value="${job.projectOwner || ''}">${job.projectOwner || 'Select...'}</option>`;
    }
}

function closeJobModal() {
    $('job-edit-modal')?.classList.remove('visible');
    currentEditJob = null;
}

async function saveJobUpdate() {
    if (!currentEditJob) return;
    
    const jobNumber = currentEditJob.jobNumber;
    const btn = $('job-save-btn');
    
    const stage = $('job-edit-stage').value;
    const status = $('job-edit-status').value;
    const updateDue = $('job-edit-update-due').value;
    const liveDate = $('job-edit-live-date').value;
    const message = $('job-edit-message').value.trim();
    const withClient = $('job-edit-with-client').checked;
    const description = $('job-edit-description').value.trim();
    const projectOwner = $('job-edit-owner').value;
    const projectName = $('job-edit-name').value.trim();
    
    // Validation: if posting an update, must set next update due date
    const originalDue = formatDateForInput(currentEditJob.updateDue);
    if (message && updateDue === originalDue) {
        showToast("Hang on, when's that update due?", 'error');
        $('job-edit-update-due').focus();
        return;
    }
    
    btn.disabled = true;
    btn.textContent = 'Updating...';
    
    const payload = { jobNumber, stage, status, withClient, message };
    if (updateDue) payload.updateDue = updateDue;
    if (liveDate) payload.liveDate = liveDate;
    if (description !== currentEditJob.description) payload.description = description;
    if (projectOwner !== currentEditJob.projectOwner) payload.projectOwner = projectOwner;
    if (projectName !== currentEditJob.jobName) payload.projectName = projectName;
    
    try {
        const promises = [
            fetch(`https://dot-traffic-2.up.railway.app/card-update`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            })
        ];
        
        if (message) {
            promises.push(
                fetch(`${PROXY_BASE}/proxy/update`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        clientCode: jobNumber.split(' ')[0],
                        jobNumber,
                        message
                    })
                })
            );
        }
        
        const responses = await Promise.all(promises);
        if (!responses.every(r => r.ok)) throw new Error('Update failed');
        
        // Update local state
        const job = state.allJobs.find(j => j.jobNumber === jobNumber);
        if (job) {
            job.stage = stage;
            job.status = status;
            job.withClient = withClient;
            if (updateDue) job.updateDue = updateDue;
            if (liveDate) job.liveDate = liveDate;
            if (message) job.update = message;
            if (description) job.description = description;
            if (projectOwner) job.projectOwner = projectOwner;
            if (projectName) job.jobName = projectName;
        }
        
        showToast('On it.', 'success');
        btn.textContent = 'Update';
        btn.disabled = false;
        closeJobModal();
        
        // Refresh WIP if visible
        if (state.currentView === 'wip') {
            renderWip();
        }
        
    } catch (e) {
        console.error('Save failed:', e);
        showToast("Doh, that didn't work.", 'error');
        btn.textContent = 'Update';
        btn.disabled = false;
    }
}

// Make modal functions global
window.openJobModal = openJobModal;
window.closeJobModal = closeJobModal;
window.saveJobUpdate = saveJobUpdate;

// ===== SVG ICONS =====
const ICON_CLOCK = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#ED1C24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`;
const ICON_REFRESH = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#ED1C24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>`;
const ICON_EXCHANGE = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#ED1C24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9h12l-3-3M20 15H8l3 3"/></svg>`;
const ICON_CHEVRON = `<svg class="chevron-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#ED1C24" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`;
const ICON_CHEVRON_RIGHT = `<svg class="chevron-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 15 12 9 18"/></svg>`;

// ===== MESSAGE FORMATTING =====
function formatMessage(message) {
    if (!message) return '';
    
    // Split into lines
    const lines = message.split('\n').map(l => l.trim()).filter(l => l);
    
    // Check if we have bullet points
    const hasBullets = lines.some(l => /^[\u2022\-\*]\s/.test(l));
    
    if (!hasBullets) {
        return lines.map(l => `<p>${l}</p>`).join('');
    }
    
    // Process bullets into proper lists
    let html = '';
    let inList = false;
    
    lines.forEach(line => {
        const isBullet = /^[\u2022\-\*]\s/.test(line);
        
        if (isBullet) {
            if (!inList) {
                html += '<ul class="dot-list">';
                inList = true;
            }
            html += `<li>${line.replace(/^[\u2022\-\*]\s*/, '')}</li>`;
        } else {
            if (inList) {
                html += '</ul>';
                inList = false;
            }
            html += `<p>${line}</p>`;
        }
    });
    
    if (inList) html += '</ul>';
    
    return html;
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
    if (toast) { 
        toast.textContent = message; 
        toast.className = `toast ${type} visible`; 
        setTimeout(() => toast.classList.remove('visible'), 2500); 
    }
}

// ===== WIP VIEW =====
function setupWipDropdown() {
    const trigger = $('wip-client-trigger');
    const menu = $('wip-client-menu');
    if (!trigger || !menu) return;
    
    // Check if we have a pre-set client from deep link
    const presetClient = state.wipClient || 'all';
    
    menu.innerHTML = '';
    
    // Add "All Clients" option
    const allOpt = document.createElement('div');
    allOpt.className = 'custom-dropdown-option' + (presetClient === 'all' ? ' selected' : '');
    allOpt.dataset.value = 'all';
    allOpt.textContent = 'All Clients';
    menu.appendChild(allOpt);
    
    // Add client options
    let selectedText = 'All Clients';
    state.allClients.forEach(c => {
        const opt = document.createElement('div');
        const isSelected = (c.code === presetClient);
        opt.className = 'custom-dropdown-option' + (isSelected ? ' selected' : '');
        opt.dataset.value = c.code;
        opt.textContent = getClientDisplayName(c);
        menu.appendChild(opt);
        if (isSelected) selectedText = opt.textContent;
    });
    
    // Update trigger text to match selection
    trigger.querySelector('span').textContent = selectedText;
    
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
    const content = $('wip-content');
    if (!content) return;
    
    // Show loading if jobs haven't loaded yet
    if (!state.jobsLoaded) {
        content.innerHTML = `
            <div class="loading-card">
                <div class="dot-thinking">
                    <img src="images/Robot_01.svg" alt="Dot" class="dot-robot">
                    <img src="images/Heart_01.svg" alt="" class="dot-heart-svg">
                </div>
                <p>Grabbing all your jobs...</p>
            </div>
        `;
        return;
    }
    
    const jobs = getWipFilteredJobs();
    const sections = state.wipMode === 'wip' ? groupByWip(jobs) : groupByTodo(jobs);
    
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
        section.jobs.forEach((job, i) => {
            html += createUniversalCard(job, `wip-${section.title.replace(/\s+/g, '-')}-${i}`);
        });
    }
    return html + '</div>';
}

// Old submitWipUpdate - redirects to modal
async function submitWipUpdate(jobNumber, btn) {
    openJobModal(jobNumber);
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
// (Keeping tracker code as-is since it's separate from Ask Dot)

let trackerClients = {};
let trackerData = [];
let trackerCurrentMonth = 'January';
let trackerIsQuarterView = false;
let trackerCurrentEditData = null;

const calendarQuarters = {
    'Q1-cal': { months: ['January', 'February', 'March'], label: 'Jan > Mar' },
    'Q2-cal': { months: ['April', 'May', 'June'], label: 'Apr > Jun' },
    'Q3-cal': { months: ['July', 'August', 'September'], label: 'Jul > Sep' },
    'Q4-cal': { months: ['October', 'November', 'December'], label: 'Oct > Dec' }
};

const currentCalendarQuarter = 'Q1-cal';

const clientQuarterLabels = {
    'ONE': 'Q4', 'ONS': 'Q4', 'ONB': 'Q4',
    'SKY': 'Q3', 'TOW': 'Q2', 'FIS': 'Q4'
};

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
    
    const menu = $('tracker-client-menu');
    const trigger = $('tracker-client-trigger');
    if (!menu || !trigger) return;
    
    menu.innerHTML = '';
    
    // Check if we already have a client set (from deep link)
    const presetClient = state.trackerClient;
    const lastClient = presetClient || localStorage.getItem('trackerLastClient');
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
    setupTrackerDropdown('tracker-client-trigger', 'tracker-client-menu', async (value) => {
        state.trackerClient = value;
        localStorage.setItem('trackerLastClient', value);
        $('tracker-content').style.opacity = '0.5';
        await loadTrackerData(value);
        $('tracker-content').style.opacity = '1';
        renderTrackerContent();
    });
    
    setupTrackerDropdown('tracker-month-trigger', 'tracker-month-menu', (value) => {
        trackerCurrentMonth = value;
        renderTrackerContent();
    });
    
    // Sync month dropdown display with current value (for deep links)
    const monthTrigger = $('tracker-month-trigger');
    const monthMenu = $('tracker-month-menu');
    if (monthTrigger && monthMenu && trackerCurrentMonth) {
        const opt = monthMenu.querySelector(`[data-value="${trackerCurrentMonth}"]`);
        if (opt) {
            monthMenu.querySelectorAll('.custom-dropdown-option').forEach(o => o.classList.remove('selected'));
            opt.classList.add('selected');
            monthTrigger.querySelector('span').textContent = opt.textContent;
        }
    }
    
    const toggle = $('tracker-mode-switch');
    const labelMonth = $('tracker-mode-spend');
    const labelQuarter = $('tracker-mode-pipeline');
    
    // Sync quarter toggle with current value (for deep links)
    if (toggle) {
        toggle.checked = trackerIsQuarterView;
        labelMonth?.classList.toggle('active', !trackerIsQuarterView);
        labelQuarter?.classList.toggle('active', trackerIsQuarterView);
    }
    
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
    
    content.innerHTML = `
        <div class="loading-card">
            <div class="dot-thinking">
                <img src="images/Robot_01.svg" alt="Dot" class="dot-robot">
                <img src="images/Heart_01.svg" alt="" class="dot-heart-svg">
            </div>
            <p>Digging for the numbers...</p>
        </div>
    `;
    
    if (Object.keys(trackerClients).length === 0) {
        await loadTrackerClients();
    }
    
    if (state.trackerClient) {
        await loadTrackerData(state.trackerClient);
    }
    
    setupTrackerDropdowns();
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
    
    const mainProjects = projects.filter(p => p.spendType === 'Project budget');
    const otherProjects = projects.filter(p => p.spendType === 'Extra budget' || p.spendType === 'Project on us');
    
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
        const aNum = a.jobNumber.split(' ')[1] || '';
        const bNum = b.jobNumber.split(' ')[1] || '';
        if (aNum === '000') return 1;
        if (bNum === '000') return -1;
        return 0;
    });
    const displayOtherProjects = groupProjects(otherProjects);
    
    const spendToDate = {};
    if (!trackerIsQuarterView) {
        const monthOrder = ['October', 'November', 'December', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September'];
        const currentMonthIndex = monthOrder.indexOf(trackerCurrentMonth);
        
        trackerData.forEach(d => {
            const dataMonthIndex = monthOrder.indexOf(d.month);
            if (dataMonthIndex !== -1 && currentMonthIndex !== -1 && dataMonthIndex < currentMonthIndex) {
                spendToDate[d.jobNumber] = (spendToDate[d.jobNumber] || 0) + d.spend;
            }
        });
    }
    
    const numbersTitle = trackerIsQuarterView ? `${qInfo.quarter} Numbers` : `${trackerCurrentMonth} Numbers`;
    const amountHeader = trackerIsQuarterView ? `${qInfo.quarter} Total` : trackerCurrentMonth;
    
    content.innerHTML = `
        <div class="tracker-inner">
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
                                    <td class="chevron-cell"><button class="chevron-btn" ${chevronDisabled} onclick="${p._isGrouped ? '' : `openTrackerEditModal('${p.jobNumber}', '${trackerCurrentMonth}')`}">${ICON_CHEVRON_RIGHT}</button></td>
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
                                        <td class="chevron-cell"><button class="chevron-btn" ${chevronDisabled} onclick="${p._isGrouped ? '' : `openTrackerEditModal('${p.jobNumber}', '${trackerCurrentMonth}')`}">${ICON_CHEVRON_RIGHT}</button></td>
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
    
    setTimeout(renderTrackerChart, 0);
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
    
    const prevSpends = prevQ.months.map(m => 
        trackerData.filter(d => d.client === state.trackerClient && d.month === m && d.spendType === 'Project budget')
            .reduce((sum, d) => sum + d.spend, 0)
    );
    
    const currentConfirmed = [], currentBallpark = [];
    qInfo.months.forEach(m => {
        const monthProjects = trackerData.filter(d => d.client === state.trackerClient && d.month === m && d.spendType === 'Project budget');
        currentConfirmed.push(monthProjects.filter(d => !d.ballpark).reduce((sum, d) => sum + d.spend, 0));
        currentBallpark.push(monthProjects.filter(d => d.ballpark).reduce((sum, d) => sum + d.spend, 0));
    });
    
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
    
    const greyBarHeight = chartHeight - (10000 / yMax * chartHeight);
    const committedLine = $('tracker-committed-line');
    if (committedLine) {
        committedLine.style.bottom = (greyBarHeight + 20) + 'px';
        committedLine.style.top = 'auto';
    }
    
    const container = $('tracker-chart-container');
    if (!container) return;
    container.innerHTML = '';
    
    const prevMonthLabels = prevQ.months.map(m => m.substring(0, 3));
    const currMonthLabels = qInfo.months.map(m => m.substring(0, 3));
    const today = new Date();
    const currentMonthName = today.toLocaleString('en-US', { month: 'long' });
    const currentMonthIndex = qInfo.months.indexOf(currentMonthName);
    
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
        
        Object.assign(trackerCurrentEditData, updates);
        closeTrackerModal();
        
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

// ===== COMING SOON MODAL =====
function showComingSoonModal(action) {
    const modal = $('coming-soon-modal');
    const text = $('coming-soon-text');
    if (!modal || !text) return;
    
    if (action === 'new-job') {
        text.textContent = 'New jobs coming soon';
    } else if (action === 'upload') {
        text.textContent = 'Uploads coming soon';
    } else {
        text.textContent = 'Coming soon';
    }
    
    modal.classList.add('visible');
}

function closeComingSoonModal() {
    $('coming-soon-modal')?.classList.remove('visible');
}

// Close modal on overlay click
document.addEventListener('click', (e) => {
    if (e.target.id === 'coming-soon-modal') {
        closeComingSoonModal();
    }
});

// Make functions available globally
window.showComingSoonModal = showComingSoonModal;
window.closeComingSoonModal = closeComingSoonModal;

// Make functions available globally
window.openTrackerEditModal = openTrackerEditModal;
window.closeTrackerModal = closeTrackerModal;
window.saveTrackerProject = saveTrackerProject;
window.getTrackerPDF = getTrackerPDF;
window.navigateTo = navigateTo;
window.setWipMode = setWipMode;
window.toggleWipMode = toggleWipMode;
window.submitWipUpdate = submitWipUpdate;
window.toggleWipWithClient = toggleWipWithClient;
