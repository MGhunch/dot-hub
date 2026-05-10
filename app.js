/** 
 * Dot Hub - Unified Interface
 * Simplified: Claude responds naturally, frontend renders
 */

// ===== CONFIGURATION =====
const API_BASE = '/api';
const PROXY_BASE = 'https://dot-proxy.up.railway.app';
const BRAIN_BASE = 'https://dot-brain.up.railway.app';

const KEY_CLIENTS = ['ONE', 'ONB', 'ONS', 'SKY', 'TOW'];

// Clients to hide from WIP dropdown (cleanup later)
const HIDDEN_CLIENTS = ['DEM', 'FIR', 'EON', 'N4L', 'WHA'];

const CLIENT_DISPLAY_NAMES = {
    'ONE': 'One NZ (Marketing)',
    'ONB': 'One NZ (Business)',
    'ONS': 'One NZ (Simplification)'
};

const INACTIVITY_TIMEOUT = 15 * 60 * 1000; // 15 minutes

// ===== STATE =====
const state = {
    currentUser: null,
    currentView: 'home',
    allClients: [],
    allJobs: [],
    jobsLoaded: false,
    wipMode: 'desktop',
    wipClient: 'all',
    trackerClient: null,
    trackerQuarter: (() => { const m = new Date().getMonth(); return m <= 2 ? 'Q1' : m <= 5 ? 'Q2' : m <= 8 ? 'Q3' : 'Q4'; })(),
    trackerMode: 'spend',
    lastActivity: Date.now(),
    conversationHistory: []
};

let inactivityTimer = null;

const $ = (id) => document.getElementById(id);
const $$ = (sel) => document.querySelectorAll(sel);

// ===== INITIALIZATION =====
document.addEventListener('DOMContentLoaded', init);

function init() {
    handleDeepLink();    // First - capture URL params
    checkSession();      // Then - check session (auto-login if deep link)
    setupEventListeners();
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
    if (view && ['wip', 'tracker', 'todo', 'settings'].includes(view)) {
        navigateTo(view);
    }
    
    // Open job modal if job param provided (after navigation and data load)
    if (job) {
        // Format job number: "ONS078" -> "ONS 078"
        const formattedJob = job.replace(/([A-Z]+)(\d+)/, '$1 $2');
        // Wait for jobs to load, then open modal
        const waitForJobs = setInterval(() => {
            if (state.jobsLoaded) {
                clearInterval(waitForJobs);
                openJobDetail(formattedJob);
            }
        }, 100);
        // Timeout after 10 seconds
        setTimeout(() => clearInterval(waitForJobs), 10000);
    }
}

function setupEventListeners() {
    // Auth overlay (Phase D)
    $('auth-signin-form')?.addEventListener('submit', (e) => { e.preventDefault(); requestLogin(); });
    $('auth-expired-form')?.addEventListener('submit', (e) => { e.preventDefault(); requestLogin('expired'); });
    $('auth-try-again')?.addEventListener('click', (e) => { e.preventDefault(); resetLoginForm(); });

    // Phone navigation
    $('phone-view-trigger')?.addEventListener('click', togglePhoneMenu);
    $('phone-overlay')?.addEventListener('click', closePhoneMenu);
    $('phone-home-btn')?.addEventListener('click', () => goHome());
    
    // User dropdown
    $('user-dropdown-trigger')?.addEventListener('click', toggleUserDropdown);
    document.querySelector('.user-dropdown-item[data-action="signout"]')?.addEventListener('click', signOut);
    document.querySelector('.user-dropdown-item[data-view="settings"]')?.addEventListener('click', () => {
        document.querySelector('.user-dropdown')?.classList.remove('open');
        navigateTo('settings');
    });
    
    $$('#phone-dropdown .dropdown-item').forEach(item => {
        item.addEventListener('click', () => {
            closePhoneMenu();
            if (item.dataset.view) navigateTo(item.dataset.view);
        });
    });

    // Desktop navigation
    $('desktop-home-btn')?.addEventListener('click', () => goHome());
    $$('.nav-tab').forEach(tab => {
        tab.addEventListener('click', () => navigateTo(tab.dataset.view));
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
        // Close user dropdown on outside click
        if (!e.target.closest('.user-dropdown')) {
            document.querySelector('.user-dropdown')?.classList.remove('open');
        }
    });
}

function isDesktop() { return window.innerWidth >= 900; }
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
        fetch(`${BRAIN_BASE}/traffic/clear`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId: state.currentUser.name })
        }).catch(() => {});
    }
}

// ===== AUTH HANDLING =====
async function checkSession() {
    const params = new URLSearchParams(window.location.search);

    // Check for existing session first - valid cookie always wins
    try {
        const response = await fetch('/api/check-session');
        const data = await response.json();
        
        if (data.authenticated && data.user) {
            state.currentUser = {
                name: data.user.firstName,
                fullName: data.user.firstName,
                email: data.user.email,
                client: data.user.clientCode,
                accessLevel: data.user.accessLevel
            };
            unlockApp();

            // If we just arrived from a magic-link verify, open the Welcome
            // modal over the destination view. The modal sits while initial
            // data loads; loadJobs() calls markWelcomeReady() when it lands.
            if (params.get('welcome') === '1') {
                if (typeof window.openWelcomeModal === 'function') {
                    window.openWelcomeModal(state.currentUser.name);
                }
            }
            return;
        }
    } catch (e) {
        console.error('Session check failed:', e);
    }
    
    // No valid session - check for URL error params from magic link
    const error = params.get('error');
    
    if (error) {
        // Strip the error param so a refresh doesn't keep showing it
        const cleanParams = new URLSearchParams(window.location.search);
        cleanParams.delete('error');
        const newUrl = window.location.pathname + (cleanParams.toString() ? '?' + cleanParams.toString() : '');
        window.history.replaceState({}, document.title, newUrl);

        // Both 'expired' and 'invalid' surface as the OOPS face
        showAuthFace('expired');
    }
    
    // Auth check complete - show login
    document.body.classList.remove('loading');
}

// ----- Auth overlay face helpers (Phase D) -----

function showAuthFace(faceName) {
    const faces = document.querySelectorAll('.auth-face');
    for (let i = 0; i < faces.length; i++) {
        faces[i].hidden = (faces[i].dataset.face !== faceName);
    }
}

function showAuthError(faceName, message) {
    const errorId = (faceName === 'expired') ? 'auth-error-expired' : 'auth-error';
    const errorEl = $(errorId);
    if (errorEl) errorEl.textContent = message || '';
}

function clearAuthErrors() {
    const e1 = $('auth-error');
    const e2 = $('auth-error-expired');
    if (e1) e1.textContent = '';
    if (e2) e2.textContent = '';
}

// ----- Magic link request -----

async function requestLogin(fromFace = 'signin') {
    // Both signin and expired faces have an email input + submit button.
    const emailInput = (fromFace === 'expired') ? $('auth-email-expired') : $('auth-email');
    const btn = emailInput?.closest('form')?.querySelector('.auth-button');

    const email = emailInput?.value.trim().toLowerCase();

    if (!email) {
        showAuthError(fromFace, 'Pop in your email address');
        return;
    }
    if (!email.includes('@') || !email.includes('.')) {
        showAuthError(fromFace, "That doesn't look like an email");
        return;
    }

    if (btn) {
        btn.disabled = true;
        btn.textContent = 'Sending...';
    }
    clearAuthErrors();

    try {
        const response = await fetch('/api/request-login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email })
        });

        const data = await response.json();

        if (data.success) {
            showAuthFace('sent');
        } else {
            showAuthError(fromFace, data.message || "Something went wrong. Try again?");
            if (btn) {
                btn.disabled = false;
                btn.textContent = 'Get a link';
            }
        }
    } catch (e) {
        console.error('Login request failed:', e);
        showAuthError(fromFace, "Couldn't connect. Try again?");
        if (btn) {
            btn.disabled = false;
            btn.textContent = 'Get a link';
        }
    }
}

function resetLoginForm() {
    showAuthFace('signin');

    // Clear inputs and errors
    const e1 = $('auth-email');
    const e2 = $('auth-email-expired');
    if (e1) e1.value = '';
    if (e2) e2.value = '';
    clearAuthErrors();

    // Re-enable buttons + restore label
    document.querySelectorAll('.auth-button').forEach(btn => {
        btn.disabled = false;
        btn.textContent = 'Get a link';
    });
}

function unlockApp() {
    // Remove logged-out and loading states
    document.body.classList.remove('logged-out');
    document.body.classList.remove('loading');
    
    // Set user display name in header dropdown
    const displayName = state.currentUser?.name || 'User';
    const userNameEl = $('user-display-name');
    if (userNameEl) userNameEl.textContent = displayName;
    
    // Apply access level filtering
    applyAccessLevel();
    
    loadClients();
    loadJobs();
    resetInactivityTimer();
    
    // Apply deep link if present — otherwise route to default landing for this user
    if (state.deepLink) {
        applyDeepLink();
    } else {
        navigateTo(defaultViewForUser());
    }
}

// Default view a user lands on at unlock / when clicking the logo.
// Hunch (Full) → TODO. Clients (WIP / Tracker) → WIP.
function defaultViewForUser() {
    return state.currentUser?.accessLevel === 'Full' ? 'todo' : 'wip';
}

function applyAccessLevel() {
    const level = state.currentUser?.accessLevel || 'Client WIP';
    const client = state.currentUser?.client;
    
    // Get nav elements
    const trackerNavPhone = document.querySelector('#phone-dropdown .dropdown-item[data-view="tracker"]');
    const trackerNavDesktop = document.querySelector('.nav-tab[data-view="tracker"]');
    
    if (level === 'Client WIP') {
        // Hide Tracker nav entirely
        trackerNavPhone?.classList.add('hidden');
        trackerNavDesktop?.classList.add('hidden');
    } else {
        // Show Tracker nav
        trackerNavPhone?.classList.remove('hidden');
        trackerNavDesktop?.classList.remove('hidden');
    }
    
    // Hide whole Plus dock + phone bar for non-Full users (read-only tiers see no create actions)
    const plusDock = document.getElementById('plus-dock');
    const plusBar = document.getElementById('plus-bar');
    const plusBackdrop = document.getElementById('plus-backdrop');
    if (level !== 'Full') {
        plusDock?.classList.add('hidden');
        plusBar?.classList.add('hidden');
        plusBackdrop?.classList.add('hidden');
    } else {
        plusDock?.classList.remove('hidden');
        plusBar?.classList.remove('hidden');
        plusBackdrop?.classList.remove('hidden');
    }
    
    // Hide New Job pill from plus dock for non-Full users
    const newJobPills = document.querySelectorAll('.plus-pill[data-action="new-job"]');
    if (level !== 'Full') {
        newJobPills.forEach(pill => pill.classList.add('hidden'));
    } else {
        newJobPills.forEach(pill => pill.classList.remove('hidden'));
    }
    
    // Store client filter for WIP/Tracker views
    if (level !== 'Full' && client && client !== 'ALL') {
        state.clientFilter = client;
    } else {
        state.clientFilter = null;
    }
    
    // Hunch-only items (e.g. Settings entry) — show for Full access, hide otherwise
    const hunchOnlyItems = document.querySelectorAll('.hunch-only');
    if (level === 'Full') {
        hunchOnlyItems.forEach(item => item.classList.remove('hidden'));
    } else {
        hunchOnlyItems.forEach(item => item.classList.add('hidden'));
    }
}

async function signOut() {
    try {
        await fetch('/api/logout', { method: 'POST' });
    } catch (e) {
        console.error('Logout failed:', e);
    }
    
    sessionStorage.removeItem('dotUser');
    state.currentUser = null;
    state.clientFilter = null;
    state.currentView = null;
    
    // Reset login screen and show it (auth-overlay takes over via .logged-out)
    resetLoginForm();
    document.body.classList.add('logged-out');
}

// ===== NAVIGATION =====
function navigateTo(view) {
    state.currentView = view;
    $$('.nav-tab').forEach(tab => tab.classList.toggle('active', tab.dataset.view === view));
    $$('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + view));
    
    // Hide desktop footer on every view (it was Ask Dot's home — orphaned post-Ship-2, kept for now)
    $('desktop-footer')?.classList.add('hidden');
    
    if (!isDesktop()) {
        $('phone-wip')?.classList.remove('visible');
        $('phone-tracker')?.classList.remove('visible');
        $('phone-todo')?.classList.remove('visible');
        $('phone-settings-message')?.classList.remove('visible');

        // View label in header
        const viewLabel = $('phone-view-label');
        const triggerLabel = $('phone-view-trigger-label');
        const contextBar = $('phone-context-bar');
        const labels = { wip: 'WIP', tracker: 'Tracker', todo: 'Todo', settings: 'Settings' };
        const triggerLabels = { wip: 'WIP', tracker: 'TRACKER', todo: 'TO DO' };
        if (viewLabel) viewLabel.textContent = labels[view] || '';
        if (triggerLabel) triggerLabel.textContent = triggerLabels[view] || '';

        // Mark active item in the phone dropdown
        $$('#phone-dropdown .dropdown-item').forEach(item => {
            item.classList.toggle('active', item.dataset.view === view);
        });

        // Context bar — show on WIP/Tracker (holds shared client picker), hide on Todo/Settings
        if (contextBar) {
            if (view === 'wip' || view === 'tracker') {
                contextBar.classList.remove('hidden');
                setupPhoneSharedPicker();
            } else {
                contextBar.classList.add('hidden');
            }
        }

        if (view === 'wip') {
            $('phone-wip')?.classList.add('visible');
            renderPhoneWip();
        }
        else if (view === 'tracker') {
            $('phone-tracker')?.classList.add('visible');
            loadAndRenderPhoneTracker();
        }
        else if (view === 'todo') $('phone-todo')?.classList.add('visible');
        else if (view === 'settings') $('phone-settings-message')?.classList.add('visible');
    }
    
    if (view === 'wip' && isDesktop()) { setupWipDropdown(); renderWip(); }
    if (view === 'tracker' && isDesktop()) renderTracker();
    if (view === 'todo') renderTodos();
}

// Logo click — route to user's default landing.
function goHome() {
    navigateTo(defaultViewForUser());
}

function togglePhoneMenu() {
    $('phone-view-trigger')?.classList.toggle('open');
    $('phone-dropdown')?.classList.toggle('open');
    $('phone-overlay')?.classList.toggle('open');
}

function closePhoneMenu() {
    $('phone-view-trigger')?.classList.remove('open');
    $('phone-dropdown')?.classList.remove('open');
    $('phone-overlay')?.classList.remove('open');
}

function toggleUserDropdown(e) {
    e.stopPropagation();
    document.querySelector('.user-dropdown')?.classList.toggle('open');
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

    // Welcome modal — flip its button to ready when initial data lands
    if (typeof window.markWelcomeReady === 'function') {
        window.markWelcomeReady();
    }
}

// ===== REFRESH AFTER MUTATION =====
// Single dispatcher for "something changed, update the visible page".
// Used by updateModal, newJobModal, and askDotModal so the page reflects
// changes without a manual refresh. Each type only does work when it's
// relevant (e.g. tracker only refreshes if currently on the tracker view).
//
//   types: array of strings — any of 'jobs', 'tracker', 'todo'
//
// Safe to over-pass — passing 'tracker' when not on tracker view is a no-op.
window.refreshAfterMutation = async function(types) {
    if (!Array.isArray(types) || !types.length) return;

    if (types.includes('jobs')) {
        await loadJobs();  // already auto-renders WIP if on it
    }

    if (types.includes('tracker') &&
        state.currentView === 'tracker' &&
        state.trackerClient) {
        if (typeof loadTrackerData === 'function') {
            await loadTrackerData(state.trackerClient, true);
            if (typeof renderTrackerContent === 'function') {
                renderTrackerContent();
            }
        }
    }

    if (types.includes('todo')) {
        if (typeof loadTodos === 'function') {
            await loadTodos();
            if (typeof renderTodoContent === 'function') {
                renderTodoContent();
            }
        }
    }
};

// ===== UNIVERSAL JOB CARD =====
function createUniversalCard(job, id) {
    const dueDate = formatDueDate(job.updateDue, job.withClient);
    const daysSinceUpdate = job.daysSinceUpdate || '-';
    
    // Check if stale (contains ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â°ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¦ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¸ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¾ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¤)
    const isStale = daysSinceUpdate.includes('ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â°ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¦ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¸ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¾ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¤');
    
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
                        <span class="bag-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg></span>
                    </div>
                    <div class="job-update-preview">${job.update || 'No updates yet'}</div>
                    <div class="job-meta-compact">
                        ${ICON_CLOCK} ${dueDate}
                    </div>
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

function autoResizeTextarea(textarea) {
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
}

// Helper: open Update modal for a given job
function openJobDetail(jobNumber) {
    openUpdateModal(jobNumber);
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
}

// ===== SVG ICONS =====
const ICON_CLOCK = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#ED1C24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`;
const ICON_REFRESH = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#ED1C24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>`;
const ICON_EXCHANGE = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#ED1C24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9h12l-3-3M20 15H8l3 3"/></svg>`;
const ICON_CHEVRON = `<svg class="chevron-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#ED1C24" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`;
const ICON_CHEVRON_RIGHT = `<svg class="chevron-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 15 12 9 18"/></svg>`;


// ===== HELPERS =====
function formatDueDate(isoDate, withClient = false) {
    if (!isoDate) return 'TBC';
    const date = new Date(isoDate);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
    const dateOnly = new Date(date); dateOnly.setHours(0, 0, 0, 0);
    if (dateOnly.getTime() === today.getTime()) return 'Today';
    if (dateOnly.getTime() === tomorrow.getTime()) return 'Tomorrow';
    if (dateOnly < today) return withClient ? 'TBC' : 'Overdue';
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
async function setupWipDropdown() {
    const trigger = $('wip-client-trigger');
    const menu = $('wip-client-menu');
    if (!trigger || !menu) return;
    
    // Wait for clients to load if not already
    if (state.allClients.length === 0) {
        await loadClients();
    }
    
    // If user has client filter (non-Full access), lock to their client
    if (state.clientFilter) {
        const client = state.allClients.find(c => c.code === state.clientFilter);
        const displayName = client ? getClientDisplayName(client) : state.clientFilter;
        trigger.querySelector('span').textContent = displayName;
        trigger.style.pointerEvents = 'none'; // Disable dropdown
        trigger.querySelector('svg')?.classList.add('hidden'); // Hide chevron
        state.wipClient = state.clientFilter;
        return;
    }
    
    // Full access - show all options
    const presetClient = state.wipClient || 'all';
    
    menu.innerHTML = '';
    
    // Add "All Clients" option
    const allOpt = document.createElement('div');
    allOpt.className = 'custom-dropdown-option' + (presetClient === 'all' ? ' selected' : '');
    allOpt.dataset.value = 'all';
    allOpt.textContent = 'All Clients';
    menu.appendChild(allOpt);
    
    // Add client options (excluding hidden)
    let selectedText = 'All Clients';
    state.allClients.filter(c => !HIDDEN_CLIENTS.includes(c.code)).forEach(c => {
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
    $('wip-mode-switch').checked = (mode === 'desktop');
    updateWipModeLabels();
    renderWip();
}

function toggleWipMode() {
    state.wipMode = $('wip-mode-switch').checked ? 'desktop' : 'mobile';
    updateWipModeLabels();
    renderWip();
}

function openWipPdf() {
    if (state.wipClient === 'all') {
        showToast('Select a client first');
        return;
    }
    window.open(`https://dot-tracker-pdf.up.railway.app/wip?client=${state.wipClient}`, '_blank');
}

function updateWipModeLabels() {
    $('mode-mobile')?.classList.toggle('active', state.wipMode === 'mobile');
    $('mode-desktop')?.classList.toggle('active', state.wipMode === 'desktop');
}

function getAccessFilteredJobs() {
    // For chat: return only jobs the user has access to
    if (state.clientFilter) {
        return state.allJobs.filter(j => j.clientCode === state.clientFilter);
    }
    return state.allJobs;
}

function getWipFilteredJobs() {
    let jobs = state.allJobs.slice();
    
    // Apply access level filter first (restricts to client's jobs)
    if (state.clientFilter) {
        jobs = jobs.filter(j => j.clientCode === state.clientFilter);
    }
    
    // Then apply user's view filter (if they're allowed to see all)
    if (state.wipClient !== 'all' && !state.clientFilter) {
        jobs = jobs.filter(j => j.clientCode === state.wipClient);
    }
    
    return jobs.filter(j => { const num = j.jobNumber.split(' ')[1]; return num !== '000' && num !== '999'; });
}

function getWipSectionLabels() {
    // Dynamic labels based on selected client
    if (state.wipClient === 'all') {
        return { withUs: 'WITH US', withClient: 'WITH CLIENT' };
    }
    
    // Find client name for the filtered client
    const client = state.allClients.find(c => c.code === state.wipClient);
    const clientName = client ? client.name.toUpperCase() : state.wipClient;
    
    return { withUs: 'WITH HUNCH', withClient: `WITH ${clientName}` };
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
    
    const labels = getWipSectionLabels();
    return { 
        leftTop: { title: labels.withUs, jobs: g.withUs }, 
        rightTop: { title: labels.withClient, jobs: g.withYou }, 
        leftBottom: { title: 'INCOMING', jobs: g.incoming }, 
        rightBottom: { title: 'ON HOLD', jobs: g.onHold } 
    };
}

function renderWip() {
    const content = $('wip-content');
    if (!content) return;
    
    // Show loading modal if jobs haven't loaded yet
    if (!state.jobsLoaded) {
        content.innerHTML = '';
        showLoadingModal();
        return;
    }
    
    // Hide loading modal once data is ready
    hideLoadingModal();
    
    const jobs = getWipFilteredJobs();
    const sections = groupByWip(jobs);
    const isMobileMode = state.wipMode === 'mobile';
    
    if (isMobileMode) {
        // Single column list view - all sections stacked
        content.innerHTML = `
            <div class="wip-list-single">
                ${renderWipSection(sections.leftTop, true)}
                ${renderWipSection(sections.rightTop, true)}
                ${renderWipSection(sections.leftBottom, true)}
                ${renderWipSection(sections.rightBottom, true)}
            </div>
        `;
    } else {
        // Two column cards view
        content.innerHTML = `
            <div class="wip-column">
                ${renderWipSection(sections.leftTop, false)}
                ${renderWipSection(sections.leftBottom, false)}
            </div>
            <div class="wip-column">
                ${renderWipSection(sections.rightTop, false)}
                ${renderWipSection(sections.rightBottom, false)}
            </div>
        `;
    }
    
    // Add click handlers
    if (isMobileMode) {
        content.querySelectorAll('.list-row').forEach(row => {
            row.addEventListener('click', () => {
                const jobNumber = row.dataset.jobNumber;
                if (jobNumber) openJobDetail(jobNumber);
            });
        });
    } else {
        content.querySelectorAll('.job-card').forEach(card => {
            card.addEventListener('click', () => openJobDetail(card.dataset.job));
        });
    }
}

// ===== PHONE WIP (Mobile List View) =====
async function setupPhoneSharedPicker() {
    const trigger = $('phone-shared-client-trigger');
    const menu = $('phone-shared-client-menu');
    const logoEl = $('phone-picker-logo');
    if (!trigger || !menu) return;

    if (state.allClients.length === 0) {
        await loadClients();
    }

    // Picker logo: always pull an image. HUN.png for "all", otherwise the client's logo.
    function setPickerLogo(code) {
        if (!logoEl) return;
        const logoCode = code === 'all' ? 'HUN' : code;
        logoEl.innerHTML = `<img src="${getLogoUrl(logoCode)}" alt="${code}" onerror="this.style.display='none'">`;
    }
    function setPickerName(text) {
        const nameEl = trigger.querySelector('.phone-picker-name');
        if (nameEl) nameEl.textContent = text;
    }

    // Determine current selection — use existing state.wipClient as the phone-wide picker
    let current = state.wipClient || 'all';

    // If user has client filter (non-Full access), lock to their client
    if (state.clientFilter) {
        const client = state.allClients.find(c => c.code === state.clientFilter);
        const displayName = client ? getClientDisplayName(client) : state.clientFilter;
        setPickerName(displayName);
        setPickerLogo(state.clientFilter);
        trigger.style.pointerEvents = 'none';
        trigger.querySelector('svg')?.classList.add('hidden');
        state.wipClient = state.clientFilter;
        state.trackerClient = state.clientFilter;
        return;
    }

    trigger.style.pointerEvents = '';
    trigger.querySelector('svg')?.classList.remove('hidden');

    // Build options — All Clients first, then visible main clients
    menu.innerHTML = '';
    const allOpt = document.createElement('div');
    allOpt.className = 'custom-dropdown-option' + (current === 'all' ? ' selected' : '');
    allOpt.dataset.value = 'all';
    allOpt.textContent = 'All clients';
    menu.appendChild(allOpt);

    state.allClients.filter(c => !HIDDEN_CLIENTS.includes(c.code)).forEach(c => {
        const opt = document.createElement('div');
        opt.className = 'custom-dropdown-option' + (c.code === current ? ' selected' : '');
        opt.dataset.value = c.code;
        opt.textContent = getClientDisplayName(c);
        menu.appendChild(opt);
    });

    // Set current label + logo
    if (current === 'all') {
        setPickerName('All clients');
        setPickerLogo('all');
    } else {
        const selectedClient = state.allClients.find(c => c.code === current);
        setPickerName(selectedClient ? getClientDisplayName(selectedClient) : 'All clients');
        setPickerLogo(current);
    }

    trigger.onclick = (e) => {
        e.stopPropagation();
        trigger.classList.toggle('open');
        menu.classList.toggle('open');
    };

    menu.onclick = async (e) => {
        const opt = e.target.closest('.custom-dropdown-option');
        if (!opt) return;
        menu.querySelectorAll('.custom-dropdown-option').forEach(o => o.classList.remove('selected'));
        opt.classList.add('selected');
        const newClient = opt.dataset.value;
        setPickerName(opt.textContent);
        setPickerLogo(newClient);
        trigger.classList.remove('open');
        menu.classList.remove('open');
        state.wipClient = newClient;
        if (newClient !== 'all') {
            state.trackerClient = newClient;
        }
        // Re-render whichever phone view is active
        if ($('phone-wip')?.classList.contains('visible')) {
            renderPhoneWip();
        } else if ($('phone-tracker')?.classList.contains('visible')) {
            // Load fresh tracker data for new client, then render
            const content = $('phone-tracker-content');
            if (content && newClient !== 'all') {
                content.innerHTML = '<div class="loading"><div class="loading-spinner"></div><p>Loading numbers...</p></div>';
                await loadTrackerData(newClient);
            }
            renderPhoneTracker();
        }
    };
}

function renderPhoneWip() {
    const content = $('phone-wip-content');
    if (!content) return;
    
    if (!state.jobsLoaded) {
        content.innerHTML = '';
        showLoadingModal();
        return;
    }
    
    // Hide loading modal once data is ready
    hideLoadingModal();
    
    const jobs = getWipFilteredJobs();
    const sections = groupByWip(jobs);
    
    // Always use list view on phone
    content.innerHTML = `
        <div class="wip-list-single">
            ${renderWipSection(sections.leftTop, true)}
            ${renderWipSection(sections.rightTop, true)}
            ${renderWipSection(sections.leftBottom, true)}
            ${renderWipSection(sections.rightBottom, true)}
        </div>
    `;
    
    // Add click handlers
    content.querySelectorAll('.list-row').forEach(row => {
        row.addEventListener('click', () => {
            const jobNumber = row.dataset.jobNumber;
            if (jobNumber) openJobDetail(jobNumber);
        });
    });
}

// ===== PHONE TRACKER =====

function renderPhoneTracker() {
    const content = $('phone-tracker-content');
    if (!content) return;

    if (!trackerClients || Object.keys(trackerClients).length === 0) {
        content.innerHTML = '<div class="loading"><div class="loading-spinner"></div><p>Loading numbers...</p></div>';
        return;
    }

    // "All clients" — show Coming Soon (the cross-client tracker is its own future phase)
    if (state.wipClient === 'all' && !state.clientFilter) {
        content.innerHTML = `
            <div class="pt-empty">
                <p style="font-size: 16px; font-weight: 500; margin-bottom: 6px; color: var(--black);">All-clients tracker — coming soon</p>
                <p style="font-size: 13px; color: var(--grey-400);">Pick a client above to see numbers.</p>
            </div>
        `;
        return;
    }

    const clientCode = state.trackerClient || state.wipClient;
    const client = trackerClients[clientCode];
    if (!client) {
        content.innerHTML = '<div class="pt-empty">No tracker data.</div>';
        return;
    }

    // Always Quarter view on mobile
    const qInfo = getCurrentQuarterInfo(clientCode);
    const months = qInfo.months;
    const eyebrow = qInfo.label.toUpperCase();

    // Numbers (mirrors desktop renderTracker math)
    const committed = months.reduce((sum, m) => {
        const year = getYearForMonth(client, m);
        return sum + getCommittedFor(client, year, m);
    }, 0);
    const toDate = months.reduce((sum, m) => sum + getTrackerMonthSpend(clientCode, m), 0);
    const toSpend = committed - toDate;
    const pct = committed > 0 ? Math.min(100, Math.max(0, (toDate / committed) * 100)) : 0;
    const isOver = toDate > committed;

    // Rollover headline — prefer last-quarter remaining, fall back to next-quarter banking
    const rolloverObj = client.rolloverObject;
    let rolloverAmount = 0;
    if (rolloverObj?.lastQuarter?.remaining > 0) {
        rolloverAmount = rolloverObj.lastQuarter.remaining;
    } else if (rolloverObj?.nextQuarter?.banking > 0) {
        rolloverAmount = rolloverObj.nextQuarter.banking;
    }
    const showRollover = rolloverAmount > 0;

    // Work list — Project budget entries, grouped across the quarter
    const projects = months.flatMap(m => getTrackerProjectsForMonth(clientCode, m))
        .filter(p => p.spendType === 'Project budget');
    const grouped = {};
    projects.forEach(p => {
        const key = (p.jobNumber || '') + '|' + (p.projectName || '');
        if (!grouped[key]) grouped[key] = { jobNumber: p.jobNumber || '', name: p.projectName || '', spend: 0 };
        grouped[key].spend += p.spend;
    });
    const projectList = Object.values(grouped)
        .filter(p => p.spend !== 0)
        .sort((a, b) => b.spend - a.spend);

    content.innerHTML = `
        <div class="pt-eyebrow">${eyebrow}</div>
        <div class="pt-card pt-stat">
            <div class="pt-stat-num">${formatTrackerCurrency(committed)}</div>
            <div class="pt-stat-label">COMMITTED</div>
        </div>
        <div class="pt-card pt-stat">
            <div class="pt-stat-num">${formatTrackerCurrency(toDate)}</div>
            <div class="pt-stat-label">TO DATE</div>
        </div>
        <div class="pt-card pt-stat">
            <div class="pt-stat-num ${toSpend > 0 ? 'pt-stat-num-red' : ''}">${formatTrackerCurrency(toSpend)}</div>
            <div class="pt-stat-label">TO SPEND</div>
        </div>
        ${showRollover ? `
        <div class="pt-card pt-stat">
            <div class="pt-stat-num pt-stat-num-red">${formatTrackerCurrency(rolloverAmount)}</div>
            <div class="pt-stat-label">ROLLOVER</div>
        </div>` : ''}
        <div class="pt-progress">
            <div class="pt-progress-bar ${isOver ? 'pt-progress-over' : ''}" style="width: ${pct}%"></div>
        </div>
        <div class="pt-eyebrow pt-work-heading">THE WORK</div>
        <div class="pt-card pt-work-list">
            ${projectList.length === 0
                ? '<div class="pt-work-empty">No spend recorded.</div>'
                : projectList.map(p => `
                    <div class="pt-work-row" data-job="${escapeHtml(p.jobNumber)}">
                        <div class="pt-work-name">${escapeHtml(p.name)}</div>
                        <div class="pt-work-spend">${formatTrackerCurrency(p.spend)}</div>
                    </div>`).join('')
            }
        </div>
    `;

    // Wire row taps → Update Modal (hot connect, mirrors desktop tracker behaviour)
    content.querySelectorAll('.pt-work-row').forEach(row => {
        row.onclick = () => {
            const job = row.dataset.job;
            if (job) openJobDetail(job);
        };
    });
}

async function loadAndRenderPhoneTracker() {
    if (!trackerClients || Object.keys(trackerClients).length === 0) {
        await loadTrackerClients();
    }
    // If a real client is selected (not 'all'), make sure its tracker data is loaded
    const clientCode = state.trackerClient || (state.wipClient !== 'all' ? state.wipClient : null);
    if (clientCode) {
        state.trackerClient = clientCode;
        await loadTrackerData(clientCode);
    }
    renderPhoneTracker();
}

function renderWipSection(section, isListMode = false) {
    // In list mode, hide empty sections entirely
    if (isListMode && section.jobs.length === 0) {
        return '';
    }
    
    if (isListMode) {
        // List mode: title outside the white box
        let html = `<div class="section">`;
        html += `<div class="section-title">${section.title}</div>`;
        html += '<div class="section-card"><div class="list-view">';
        section.jobs.forEach(job => {
            html += createListRow(job);
        });
        html += '</div></div></div>';
        return html;
    } else {
        // Cards mode: title inside the section
        let html = `<div class="section"><div class="section-title">${section.title}</div>`;
        if (section.jobs.length === 0) {
            html += `<div class="job-card empty-section"><img src="images/dot-sitting.png" alt="Dot"><span>Nothing to see here</span></div>`;
        } else {
            section.jobs.forEach((job, i) => {
                html += createUniversalCard(job, `wip-${section.title.replace(/\s+/g, '-')}-${i}`);
            });
        }
        return html + '</div>';
    }
}

function createListRow(job) {
    const dueDate = formatDueDate(job.updateDue, job.withClient);
    const isOverdue = dueDate === 'Overdue' || dueDate === 'Today';
    
    // Truncate job name to 25 characters
    const jobName = job.jobName.length > 25 ? job.jobName.substring(0, 25) + '...' : job.jobName;
    
    // Truncate description to 50 characters
    const description = job.description 
        ? (job.description.length > 50 ? job.description.substring(0, 50) + '...' : job.description)
        : '';
    
    return `
        <div class="list-row" data-job-number="${job.jobNumber}">
            <div class="list-logo">
                <img src="${getLogoUrl(job.clientCode)}" alt="${job.clientCode}" onerror="this.src='images/logos/Unknown.png'">
            </div>
            <div class="list-main">
                <div class="list-title-row">
                    <span class="list-job-num">${job.jobNumber}</span>
                    <span class="list-job-name">${jobName}</span>
                </div>
                ${description ? `<div class="list-description">${description}</div>` : ''}
            </div>
            <div class="list-meta">
                <span class="list-due ${isOverdue ? 'overdue' : ''}">
                    ${ICON_CLOCK}
                    ${dueDate}
                </span>
            </div>
            <svg class="list-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ED1C24" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 15 12 9 18"/></svg>
        </div>
    `;
}

// Old submitWipUpdate - redirects to modal
async function submitWipUpdate(jobNumber, btn) {
    openJobDetail(jobNumber);
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
// Moved to tracker.js

// ===== NEW JOB MODAL =====
// Moved to newJobModal.js

// ===== COMING SOON MODAL =====
function showComingSoonModal(action) {
    const modal = $('coming-soon-modal');
    const text = $('coming-soon-text');
    if (!modal || !text) return;
    
    if (action === 'upload') {
        text.textContent = 'Uploads coming soon';
    } else if (action === 'edit-job') {
        text.textContent = 'Pick a job from WIP to edit for now.';
    } else if (action === 'tracker') {
        text.textContent = 'Pick a job from Tracker to edit for now.';
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

// ===== LOADING STATES =====

/**
 * Returns HTML for inline loading dots
 * @param {string} size - 'default' or 'small'
 * @returns {string} HTML string
 */
function loadingDots(size = 'default') {
    const sizeClass = size === 'small' ? ' loading-dots--small' : '';
    return `<div class="loading-dots${sizeClass}">
        <div class="loading-dots__dot"></div>
        <div class="loading-dots__dot"></div>
        <div class="loading-dots__dot"></div>
    </div>`;
}

/**
 * Shows the loading modal with Dot + heart animation
 */
function showLoadingModal() {
    let overlay = $('loading-modal');
    
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'loading-modal';
        overlay.className = 'loading-modal-overlay';
        overlay.innerHTML = `
            <div class="loading-modal">
                <div class="dot-thinking">
                    <img src="images/Robot_01.svg" alt="Dot" class="dot-robot">
                    <img src="images/Heart_01.svg" alt="" class="dot-heart-svg">
                </div>
                <div class="loading-modal-text">Just a sec</div>
            </div>
        `;
        document.body.appendChild(overlay);
    }
    
    overlay.classList.add('visible');
}

function hideLoadingModal() {
    $('loading-modal')?.classList.remove('visible');
}

// Make functions available globally
window.showComingSoonModal = showComingSoonModal;
window.closeComingSoonModal = closeComingSoonModal;

// === WIP EMAIL MODAL ===

let wipEmailState = { clientCode: null, recipients: [] };

async function openWipEmailModal() {
    const modal = $('wip-email-modal');
    if (!modal) return;
    
    // Reset state
    wipEmailState = { clientCode: null, recipients: [] };
    
    // Reset UI
    $('wip-email-modal-logo').src = 'images/logos/Unknown.png';
    $('wip-email-client-trigger').querySelector('span').textContent = 'Select client...';
    $('wip-email-people-group').style.display = 'none';
    $('wip-email-people-list').innerHTML = '';
    $('wip-email-intro-group').style.display = 'none';
    $('wip-email-intro').value = "Here's what's new, what's due and what needs a nudge.";
    $('wip-email-footer').style.display = 'none';
    
    // Wait for clients to load if not already
    if (state.allClients.length === 0) {
        await loadClients();
    }
    
    // Populate clients dropdown (same pattern as Files modal)
    const topClientCodes = ['ONE', 'ONS', 'ONB', 'SKY', 'TOW', 'FIS', 'HUN'];
    const topClients = [];
    const otherClients = [];
    
    state.allClients.forEach(c => {
        if (topClientCodes.includes(c.code)) {
            topClients.push(c);
        } else {
            otherClients.push(c);
        }
    });
    
    topClients.sort((a, b) => topClientCodes.indexOf(a.code) - topClientCodes.indexOf(b.code));
    
    let html = '';
    topClients.forEach(c => {
        html += `<div class="custom-dropdown-option" data-value="${c.code}" onclick="selectWipEmailClient('${c.code}', '${c.name.replace(/'/g, "\\'")}')"><img src="${getLogoUrl(c.code)}" alt="${c.code}" style="width: 24px; height: 24px; border-radius: 50%; margin-right: 10px; vertical-align: middle;" onerror="this.src='images/logos/Unknown.png'">${c.name}</div>`;
    });
    
    if (otherClients.length > 0) {
        html += '<div class="custom-dropdown-option section-header">Other</div>';
        otherClients.forEach(c => {
            html += `<div class="custom-dropdown-option" data-value="${c.code}" onclick="selectWipEmailClient('${c.code}', '${c.name.replace(/'/g, "\\'")}')"><img src="${getLogoUrl(c.code)}" alt="${c.code}" style="width: 24px; height: 24px; border-radius: 50%; margin-right: 10px; vertical-align: middle;" onerror="this.src='images/logos/Unknown.png'">${c.name}</div>`;
        });
    }
    
    $('wip-email-client-menu').innerHTML = html;
    modal.classList.add('visible');
}

function closeWipEmailModal() {
    $('wip-email-modal')?.classList.remove('visible');
    wipEmailState = { clientCode: null, recipients: [] };
}

function toggleWipEmailDropdown() {
    const trigger = $('wip-email-client-trigger');
    const menu = $('wip-email-client-menu');
    if (!trigger || !menu) return;
    
    const isOpen = menu.classList.contains('open');
    menu.classList.toggle('open');
    trigger.classList.toggle('open');
}

async function selectWipEmailClient(code, name) {
    wipEmailState.clientCode = code;
    // Pre-add Michael as default recipient
    wipEmailState.recipients = [{ email: 'michael@hunch.co.nz', firstName: 'Michael', accessLevel: 'Full' }];
    
    // Update UI
    $('wip-email-client-trigger').querySelector('span').textContent = name;
    $('wip-email-client-trigger').classList.remove('open');
    $('wip-email-client-menu').classList.remove('open');
    
    // Update logo
    const logo = $('wip-email-modal-logo');
    logo.src = getLogoUrl(code);
    logo.onerror = function() { this.src = 'images/logos/Unknown.png'; };
    
    // Fetch people for this client
    $('wip-email-people-list').innerHTML = loadingDots('small');
    $('wip-email-people-group').style.display = 'flex';
    
    try {
        const response = await fetch(`${API_BASE}/people/${code}`);
        const people = await response.json();
        
        // Filter to people with email addresses
        const withEmail = people.filter(p => p.email);
        
        // Build people list - Michael first (pre-checked), then client contacts
        let peopleHtml = `<label style="display: flex; align-items: center; padding: 10px 0; border-bottom: 1px solid #f0f0f0; cursor: pointer;">
            <input type="checkbox" checked style="margin-right: 12px; width: 18px; height: 18px; accent-color: #ED1C24;" onchange="toggleWipEmailRecipient('michael@hunch.co.nz', 'Michael', 'Full')">
            <div>
                <div style="font-size: 15px; font-weight: 500; color: #333;">Michael</div>
                <div style="font-size: 13px; color: #999;">michael@hunch.co.nz</div>
            </div>
        </label>`;
        
        withEmail.forEach(p => {
            const escapedEmail = p.email.replace(/'/g, "\\'");
            const escapedName = (p.firstName || p.name).replace(/'/g, "\\'");
            const escapedAccess = (p.accessLevel || 'Client WIP').replace(/'/g, "\\'");
            peopleHtml += `<label style="display: flex; align-items: center; padding: 10px 0; border-bottom: 1px solid #f0f0f0; cursor: pointer;">
                <input type="checkbox" style="margin-right: 12px; width: 18px; height: 18px; accent-color: #ED1C24;" onchange="toggleWipEmailRecipient('${escapedEmail}', '${escapedName}', '${escapedAccess}')">
                <div>
                    <div style="font-size: 15px; font-weight: 500; color: #333;">${p.name}</div>
                    <div style="font-size: 13px; color: #999;">${p.email}</div>
                </div>
            </label>`;
        });
        
        $('wip-email-people-list').innerHTML = peopleHtml;
        // Show intro field and send button since Michael is pre-checked
        $('wip-email-intro-group').style.display = 'flex';
        $('wip-email-footer').style.display = 'flex';
        
    } catch (e) {
        console.error('Failed to load people:', e);
        $('wip-email-people-list').innerHTML = '<div style="color: #999; font-size: 14px;">Failed to load contacts</div>';
    }
}

function toggleWipEmailRecipient(email, firstName, accessLevel) {
    const idx = wipEmailState.recipients.findIndex(r => r.email === email);
    if (idx >= 0) {
        wipEmailState.recipients.splice(idx, 1);
    } else {
        wipEmailState.recipients.push({ email, firstName, accessLevel });
    }
    
    // Show/hide send button
    $('wip-email-footer').style.display = wipEmailState.recipients.length > 0 ? 'flex' : 'none';
}

async function sendWipEmail() {
    if (wipEmailState.recipients.length === 0) return;
    
    const sendBtn = $('wip-email-send-btn');
    if (sendBtn.disabled) return;
    sendBtn.disabled = true;
    sendBtn.textContent = 'SENDING...';
    
    const intro = $('wip-email-intro')?.value?.trim() || null;
    
    const payload = {
        clientCode: wipEmailState.clientCode,
        recipients: wipEmailState.recipients,
        intro: intro,
        senderEmail: state.currentUser?.email
    };
    
    try {
        const response = await fetch('https://dot-workers.up.railway.app/wip/email', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        
        const result = await response.json();
        
        if (result.success) {
            const count = wipEmailState.recipients.length;
            showToast(`WIP sent to ${count} ${count === 1 ? 'person' : 'people'}`, 'success');
            closeWipEmailModal();
        } else {
            showToast(result.error || 'Failed to send', 'error');
        }
    } catch (e) {
        console.error('Failed to send WIP email:', e);
        showToast('Failed to send WIP email', 'error');
    } finally {
        sendBtn.disabled = false;
        sendBtn.textContent = 'SEND WIP';
    }
}

// Close WIP email modal on overlay click
document.addEventListener('click', (e) => {
    if (e.target.id === 'wip-email-modal') {
        closeWipEmailModal();
    }
});

// Close WIP email dropdown on outside click
document.addEventListener('click', (e) => {
    if (!e.target.closest('#wip-email-client-dropdown')) {
        $('wip-email-client-menu')?.classList.remove('open');
        $('wip-email-client-trigger')?.classList.remove('open');
    }
});

// Make WIP email functions globally available
window.openWipEmailModal = openWipEmailModal;
window.closeWipEmailModal = closeWipEmailModal;
window.toggleWipEmailDropdown = toggleWipEmailDropdown;
window.selectWipEmailClient = selectWipEmailClient;
window.toggleWipEmailRecipient = toggleWipEmailRecipient;
window.sendWipEmail = sendWipEmail;

// Shared utilities for tracker.js (and other future modules)
window.$ = $;
window.$$ = $$;
window.API_BASE = API_BASE;
window.state = state;
window.showLoadingModal = showLoadingModal;
window.hideLoadingModal = hideLoadingModal;
window.showToast = showToast;
window.getLogoUrl = getLogoUrl;
window.ICON_CHEVRON_RIGHT = ICON_CHEVRON_RIGHT;
// Make functions available globally
window.navigateTo = navigateTo;
window.setWipMode = setWipMode;
window.toggleWipMode = toggleWipMode;
window.openWipPdf = openWipPdf;
window.submitWipUpdate = submitWipUpdate;
window.toggleWipWithClient = toggleWipWithClient;
