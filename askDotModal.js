// ===== ASK DOT MODAL MODULE =====
// Chat with Dot — modal accessed from the FAB.
// Talks to Brain /hub endpoint. Renders responses by type
// (answer / clarify / redirect / horoscope) per prompt_hub.txt.
//
// History persists across open/close until logout via state.conversationHistory
// (already declared in app.js state). A parallel state.askDotTurns mirror keeps
// the rendered turn objects (with type, jobs, redirect targets, etc.) so
// re-opens repaint the conversation exactly as it was.
//
// Depends on (globals from app.js): state, BRAIN_BASE, openJobDetail,
// navigateTo, escapeHtml, getAccessFilteredJobs.
//
// Exposes (window): openAskDotModal, closeAskDotModal.

const $ad = (id) => document.getElementById(id);

const askDotState = {
    open: false,
    sending: false,
};

(function setupAskDotModal() {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', wireAskDotModal);
    } else {
        wireAskDotModal();
    }
})();

function wireAskDotModal() {
    const overlay = $ad('askdot-modal-overlay');
    if (!overlay) {
        console.warn('[askdot] overlay element missing');
        return;
    }

    // Click-outside (overlay backdrop) closes
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeAskDotModal();
    });

    // Escape closes
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && askDotState.open) closeAskDotModal();
    });

    $ad('askdot-modal-close')?.addEventListener('click', closeAskDotModal);
    $ad('askdot-modal-newchat')?.addEventListener('click', clearAskDotChat);
    $ad('askdot-modal-send')?.addEventListener('click', handleSend);

    const input = $ad('askdot-modal-input');
    if (input) {
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
            }
        });
        // Auto-resize textarea up to a max
        input.addEventListener('input', () => {
            input.style.height = 'auto';
            input.style.height = Math.min(input.scrollHeight, 120) + 'px';
        });
    }
}


// ===== OPEN / CLOSE =====

function openAskDotModal() {
    const overlay = $ad('askdot-modal-overlay');
    if (!overlay) {
        console.warn('[askdot] cannot open — overlay missing');
        return;
    }

    // Init the parallel turn mirror if not yet on state
    if (!state.askDotTurns) state.askDotTurns = [];

    overlay.classList.add('visible');
    askDotState.open = true;
    document.body.style.overflow = 'hidden';

    renderAskDotMessages();

    // Focus input + scroll after the visible transition starts
    setTimeout(() => {
        $ad('askdot-modal-input')?.focus();
        scrollMessagesToBottom();
    }, 100);
}

function closeAskDotModal() {
    const overlay = $ad('askdot-modal-overlay');
    overlay?.classList.remove('visible');
    askDotState.open = false;
    document.body.style.overflow = '';
}

function clearAskDotChat() {
    state.conversationHistory = [];
    state.askDotTurns = [];
    renderAskDotMessages();
}


// ===== SEND =====

async function handleSend() {
    const input = $ad('askdot-modal-input');
    if (!input || askDotState.sending) return;
    const text = input.value.trim();
    if (!text) return;

    // Push user turn into both arrays
    state.conversationHistory.push({ role: 'user', content: text });
    state.askDotTurns.push({ role: 'user', content: text });

    // Clear input + reset its height
    input.value = '';
    input.style.height = 'auto';

    renderAskDotMessages();
    showThinking();

    askDotState.sending = true;
    setSendDisabled(true);

    try {
        const accessibleJobs = (typeof getAccessFilteredJobs === 'function')
            ? getAccessFilteredJobs()
            : (state.allJobs || []);

        const response = await fetch(`${BRAIN_BASE}/hub`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                content: text,
                jobs: accessibleJobs,
                senderName: state.currentUser?.name || 'there',
                accessLevel: state.currentUser?.accessLevel || 'Client WIP',
                // History excludes the just-pushed user turn — Brain reads `content` for that
                history: state.conversationHistory.slice(0, -1),
            }),
        });

        const data = await response.json();

        // History only stores the assistant's text (keeps tokens down on next call)
        state.conversationHistory.push({
            role: 'assistant',
            content: data.message || '',
        });

        // Turns mirror stores the full response shape for re-rendering
        state.askDotTurns.push({
            role: 'assistant',
            content: data.message || '',
            type: data.type || 'answer',
            jobs: data.jobs || null,
            redirectTo: data.redirectTo || null,
            redirectParams: data.redirectParams || null,
            nextPrompt: data.nextPrompt || null,
            sign: data.sign || null,
        });
    } catch (e) {
        console.error('[askdot] send error', e);
        state.askDotTurns.push({
            role: 'assistant',
            content: "Sorry, I got in a muddle over that one.",
            type: 'answer',
        });
    } finally {
        hideThinking();
        renderAskDotMessages();
        askDotState.sending = false;
        setSendDisabled(false);
        $ad('askdot-modal-input')?.focus();
    }
}

function setSendDisabled(disabled) {
    const btn = $ad('askdot-modal-send');
    if (btn) btn.disabled = disabled;
}


// ===== RENDER =====

function renderAskDotMessages() {
    const container = $ad('askdot-modal-messages');
    if (!container) return;

    if (!state.askDotTurns || state.askDotTurns.length === 0) {
        container.innerHTML = renderEmptyState();
        return;
    }

    container.innerHTML = state.askDotTurns.map(renderTurn).join('');

    // Wire job-card clicks (close modal then open Update modal for the job)
    container.querySelectorAll('[data-askdot-job]').forEach((el) => {
        el.addEventListener('click', () => {
            const jobNumber = el.dataset.askdotJob;
            closeAskDotModal();
            // Defer so close transition can begin before next modal opens
            setTimeout(() => {
                if (typeof openJobDetail === 'function') openJobDetail(jobNumber);
            }, 200);
        });
    });

    // Wire redirect-button clicks
    container.querySelectorAll('[data-askdot-redirect]').forEach((el) => {
        el.addEventListener('click', () => {
            const view = el.dataset.askdotRedirect;
            let params = {};
            if (el.dataset.askdotRedirectParams) {
                try { params = JSON.parse(el.dataset.askdotRedirectParams); }
                catch (_) { params = {}; }
            }
            closeAskDotModal();
            setTimeout(() => applyRedirect(view, params), 200);
        });
    });

    scrollMessagesToBottom();
}

function renderEmptyState() {
    const name = state.currentUser?.name || 'there';
    return `
        <div class="askdot-empty">
            <div class="askdot-empty-greeting">Hey ${escapeHtml(name)}!<br>What can I dig up for you?</div>
        </div>
    `;
}

function renderTurn(turn) {
    if (turn.role === 'user') {
        return `
            <div class="askdot-turn askdot-turn-user">
                <div class="askdot-bubble askdot-bubble-user">${escapeHtml(turn.content)}</div>
            </div>
        `;
    }

    // Assistant turn
    const messageHtml = turn.content
        ? `<div class="askdot-bubble askdot-bubble-dot">${escapeHtml(turn.content).replace(/\n/g, '<br>')}</div>`
        : '';

    let extrasHtml = '';

    // Job cards (used by `answer` w/ jobs + `clarify`)
    if (Array.isArray(turn.jobs) && turn.jobs.length > 0) {
        extrasHtml += '<div class="askdot-jobs">';
        turn.jobs.forEach((jobNumber) => {
            const job = (state.allJobs || []).find((j) => j.jobNumber === jobNumber);
            extrasHtml += renderJobCard(jobNumber, job);
        });
        extrasHtml += '</div>';
    }

    // Redirect button (used by `redirect`)
    if (turn.type === 'redirect' && turn.redirectTo) {
        const label = labelForRedirect(turn.redirectTo);
        const paramsAttr = turn.redirectParams
            ? `data-askdot-redirect-params='${escapeHtml(JSON.stringify(turn.redirectParams))}'`
            : '';
        extrasHtml += `
            <div class="askdot-redirect">
                <button class="askdot-redirect-btn" data-askdot-redirect="${escapeHtml(turn.redirectTo)}" ${paramsAttr}>
                    ${escapeHtml(label)}
                </button>
            </div>
        `;
    }

    // Next prompt — subtle italic hint, not interactive
    const promptHtml = turn.nextPrompt
        ? `<div class="askdot-prompt">${escapeHtml(turn.nextPrompt)}</div>`
        : '';

    return `
        <div class="askdot-turn askdot-turn-dot">
            ${messageHtml}
            ${extrasHtml}
            ${promptHtml}
        </div>
    `;
}

function renderJobCard(jobNumber, job) {
    if (!job) {
        // Job number returned but not in state.allJobs — render minimal fallback
        return `
            <button class="askdot-job-card" data-askdot-job="${escapeHtml(jobNumber)}">
                <div class="askdot-job-card-kicker">${escapeHtml(jobNumber)}</div>
                <div class="askdot-job-card-name">Open</div>
            </button>
        `;
    }
    return `
        <button class="askdot-job-card" data-askdot-job="${escapeHtml(jobNumber)}">
            <div class="askdot-job-card-kicker">${escapeHtml(jobNumber)}</div>
            <div class="askdot-job-card-name">${escapeHtml(job.jobName || 'Untitled')}</div>
        </button>
    `;
}

function labelForRedirect(view) {
    const map = {
        wip: 'Take me to WIP',
        tracker: 'Take me to Tracker',
        todo: 'Take me to To Do',
        settings: 'Take me to Settings',
    };
    return map[view] || `Take me to ${view}`;
}

function applyRedirect(view, params) {
    // Apply known param shapes before navigating
    if (params?.client) {
        if (view === 'wip') state.wipClient = params.client;
        if (view === 'tracker') state.trackerClient = params.client;
    }
    if (typeof navigateTo === 'function') navigateTo(view);
}


// ===== THINKING DOTS =====

function showThinking() {
    const indicator = $ad('askdot-modal-thinking');
    if (indicator) indicator.classList.add('visible');
    scrollMessagesToBottom();
}

function hideThinking() {
    const indicator = $ad('askdot-modal-thinking');
    if (indicator) indicator.classList.remove('visible');
}


// ===== UTILITIES =====

function scrollMessagesToBottom() {
    const scroll = $ad('askdot-modal-scroll');
    if (scroll) scroll.scrollTop = scroll.scrollHeight;
}


// ===== EXPOSE TO WINDOW =====
window.openAskDotModal = openAskDotModal;
window.closeAskDotModal = closeAskDotModal;
