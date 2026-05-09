// ===== ASK DOT MODAL MODULE =====
// Chat with Dot — modal accessed from the FAB.
// Talks to Brain /hub endpoint. Renders responses by type
// (answer / clarify / redirect / horoscope) per prompt_hub.txt.
//
// History resets when the modal closes — each open is a fresh chat.
// state.conversationHistory + state.askDotTurns wiped in closeAskDotModal.
// Within a session, state.askDotTurns mirrors the rendered turn shape (with
// type, jobs, redirect targets, etc.) so renderTurn() can repaint as it goes.
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

    // Inject Dot identity (robot + ASK DOT wordmark) into the header bar.
    // Done from JS so this module owns the markup. Sits at the front of the
    // flex header, left of the close button.
    const header = overlay.querySelector('.askdot-modal-header');
    if (header && !header.querySelector('.askdot-modal-identity')) {
        const identity = document.createElement('div');
        identity.className = 'askdot-modal-identity';
        identity.innerHTML = `
            <img src="images/Robot.png" alt="" class="askdot-modal-avatar" />
            <span class="askdot-modal-name">ASK DOT</span>
        `;
        header.insertBefore(identity, header.firstChild);
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
    // Chat resets between sessions — wipe so the next open starts fresh.
    state.conversationHistory = [];
    state.askDotTurns = [];
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
            attachment: data.attachment || null,  // YTD chart, etc.
        });

        // If Brain mutated underlying data (e.g. captured/corrected a todo),
        // refresh the relevant view in the background so it reflects the change
        // without a manual reload. Fire-and-forget.
        if (data.mutated && typeof window.refreshAfterMutation === 'function') {
            window.refreshAfterMutation(data.mutated).catch(err => {
                console.warn('[askdot] post-response refresh failed:', err);
            });
        }
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

    // Wire chart download buttons — pulls the data: URL straight off the rendered <img>
    container.querySelectorAll('.askdot-chart-download').forEach((btn) => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const card = btn.closest('.askdot-chart');
            const img = card?.querySelector('img');
            if (!img) return;
            const a = document.createElement('a');
            a.href = img.src;
            a.download = btn.dataset.askdotDownload || 'chart.png';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        });
    });

    scrollMessagesToBottom();
}

function renderEmptyState() {
    // Render Dot's opener as a real assistant turn — same DOT eyebrow + shadow
    // bubble as any other reply, so the modal feels alive on open instead of
    // shouting a static greeting.
    const name = state.currentUser?.name || 'there';
    return `
        <div class="askdot-turn askdot-turn-dot">
            <div class="askdot-turn-label">DOT</div>
            <div class="askdot-bubble askdot-bubble-dot">Hey ${escapeHtml(name)}, what's cooking?</div>
        </div>
    `;
}

// Lightweight inline-markdown for Claude's replies. Operates on already-escaped
// text (after escapeHtml) and turns **bold** into <strong>. Backticks left
// literal for now — extend here if Claude starts emitting `code` or *italic*.
function renderInlineMarkdown(text) {
    return text.replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>');
}

// Find unique [CCC ###] patterns in text that match real jobs the current user
// can see. Preserves first-seen order. Used to auto-render clickable cards
// for jobs that Dot mentioned in prose without an explicit jobs[] payload.
function extractJobNumbersFromText(text) {
    if (!text) return [];
    const matches = text.match(/\b[A-Z]{3}\s\d{3}\b/g) || [];
    const accessible = (typeof getAccessFilteredJobs === 'function')
        ? getAccessFilteredJobs()
        : (state.allJobs || []);
    const known = new Set(accessible.map((j) => j.jobNumber));
    const seen = new Set();
    const result = [];
    for (const m of matches) {
        if (!seen.has(m) && known.has(m)) {
            seen.add(m);
            result.push(m);
        }
    }
    return result;
}

function renderTurn(turn) {
    if (turn.role === 'user') {
        return `
            <div class="askdot-turn askdot-turn-user">
                <div class="askdot-bubble askdot-bubble-user">${escapeHtml(turn.content)}</div>
            </div>
        `;
    }

    // Assistant turn — leads with a small Bebas DOT eyebrow above the bubble.
    const labelHtml = `<div class="askdot-turn-label">DOT</div>`;
    const messageHtml = turn.content
        ? `<div class="askdot-bubble askdot-bubble-dot">${renderInlineMarkdown(escapeHtml(turn.content).replace(/\n/g, '<br>'))}</div>`
        : '';

    let extrasHtml = '';

    // Job cards — union of explicit Brain payload and any mentioned in the
    // prose. De-duplicated, order-preserving (Brain's first, then extracted).
    let jobNumbers = Array.isArray(turn.jobs) ? [...turn.jobs] : [];
    const extracted = extractJobNumbersFromText(turn.content);
    for (const jn of extracted) {
        if (!jobNumbers.includes(jn)) jobNumbers.push(jn);
    }
    if (jobNumbers.length > 0) {
        extrasHtml += '<div class="askdot-jobs">';
        jobNumbers.forEach((jobNumber) => {
            const job = (state.allJobs || []).find((j) => j.jobNumber === jobNumber);
            extrasHtml += renderJobCard(jobNumber, job);
        });
        extrasHtml += '</div>';
    }

    // Chart attachment (used by `chart` — YTD spend chart, etc.)
    if (turn.attachment?.type === 'chart' && turn.attachment.imageBase64) {
        const raw = turn.attachment.imageBase64;
        const src = raw.startsWith('data:') ? raw : `data:image/png;base64,${raw}`;
        const altText = `${turn.attachment.clientName || 'Client'} ${turn.attachment.fyLabel || ''} YTD spend chart`.trim();
        // Filename: "TOWER YTD FY26.png" — display name uppercased, FY end-year only.
        // fyLabel comes through as "FY25-26"; we want just the end "FY26".
        const namePart = (turn.attachment.clientName || 'Client').toUpperCase();
        const fyMatch = (turn.attachment.fyLabel || '').match(/^FY\d+-(\d+)$/);
        const fyPart = fyMatch ? `FY${fyMatch[1]}` : (turn.attachment.fyLabel || '');
        const filename = `${namePart} YTD${fyPart ? ' ' + fyPart : ''}.png`;
        extrasHtml += `
            <div class="askdot-chart">
                <img src="${src}" alt="${escapeHtml(altText)}" />
                <button class="askdot-chart-download" data-askdot-download="${escapeHtml(filename)}" aria-label="Download chart">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                        <polyline points="7 10 12 15 17 10"></polyline>
                        <line x1="12" y1="15" x2="12" y2="3"></line>
                    </svg>
                    Download
                </button>
            </div>
        `;
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

    // Next prompt — subtle hint line, not interactive
    const promptHtml = turn.nextPrompt
        ? `<div class="askdot-prompt">${escapeHtml(turn.nextPrompt)}</div>`
        : '';

    return `
        <div class="askdot-turn askdot-turn-dot">
            ${labelHtml}
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
