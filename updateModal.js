// ===== UPDATE MODAL MODULE =====
// Unified Update modal — replaces Edit Job + Tracker for the Plus menu path.
// Reads real data from /api/clients, state.allJobs, /api/job/<n>/budget.
// Submit chains job update → tracker create-or-update.
// Depends on: state, API_BASE, getLogoUrl, showToast, autoResizeTextarea (all from app.js)
// Exposes: openUpdateModal, closeUpdateModal (window globals)

(function setupUpdateModal() {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', wireUpdateModalListeners);
    } else {
        wireUpdateModalListeners();
    }
})();

// ===== STATE =====
const updateModalState = {
    open: false,
    view: 'picker', // 'picker' | 'populated' | 'completion'
    pickerStage: 'clients', // 'clients' | 'jobs'
    selectedClientCode: null,
    currentJob: null,
    withClient: false,
    ballpark: false,
    submitting: false,
    // Tracker entry for current month (loaded from /budget) — null if no entry yet
    currentMonthTrackerId: null,
    // All tracker entries for this job (used to compute "to date" and find current-month entry)
    trackerEntries: [],
    totalSpend: 0,
    // Completion view: next-up suggestion + jobs already touched in this modal session
    nextJobNumber: null,
    sessionUpdatedJobs: new Set(),
};

const STATUSES = ['Incoming', 'In Progress', 'On Hold', 'Completed'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
                'July', 'August', 'September', 'October', 'November', 'December'];
const LIVE_OPTIONS = ['TBC', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// ===== DOM HELPERS =====
function $um(id) { return document.getElementById(id); }

// ===== LISTENERS (one-time setup) =====
function wireUpdateModalListeners() {
    const overlay = $um('update-modal-overlay');
    if (!overlay || overlay.dataset.listenersAttached) return;
    overlay.dataset.listenersAttached = 'true';

    // Close on overlay click (only outside modal box)
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeUpdateModal();
    });

    // ESC to close
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && updateModalState.open) closeUpdateModal();
    });

    // X button
    $um('update-modal-close')?.addEventListener('click', closeUpdateModal);

    // NOTE: clientPicker + jobPicker mounts moved into openUpdateModal so this
    // modal coexists with other modals that mount the same single-instance
    // pickers (e.g. New Job modal in Phase F). Mount-on-open is cheap.

    // Update area tap-to-edit
    $um('update-modal-update-area')?.addEventListener('click', (e) => {
        if (e.target.tagName === 'TEXTAREA') return;
        const area = $um('update-modal-update-area');
        if (area.classList.contains('editing')) return;
        area.classList.add('editing');
        const ta = $um('update-modal-update-field');
        setTimeout(() => { ta?.focus(); autoGrow(ta); }, 50);
    });

    // Description tap-to-edit (in header)
    $um('update-modal-description-area')?.addEventListener('click', (e) => {
        if (e.target.tagName === 'TEXTAREA') return;
        const area = $um('update-modal-description-area');
        if (area.classList.contains('editing')) return;
        const ta = $um('update-modal-description-input');
        const display = $um('update-modal-description');
        if (!ta) return;
        ta.value = display?.textContent || '';
        area.classList.add('editing');
        setTimeout(() => { ta.focus(); autoGrow(ta); }, 50);
    });

    // Meta line — tap to switch to a different job for the same client
    $um('update-modal-meta')?.addEventListener('click', () => {
        const job = updateModalState.currentJob;
        if (!job?.clientCode) return;
        updateModalState.selectedClientCode = job.clientCode;
        window.jobPicker?.setClient(job.clientCode);

        // Set picker DOM directly to jobs stage (the outer view animation
        // carries the transition feel; no inner animation needed)
        const clientsEl = $um('update-modal-picker-clients');
        const jobsEl = $um('update-modal-picker-jobs');
        if (clientsEl) clientsEl.hidden = true;
        if (jobsEl) jobsEl.hidden = false;
        updateModalState.pickerStage = 'jobs';

        showView('picker', 'back');
    });

    // Auto-grow update + description textareas (notes is single-line — no auto-grow)
    $um('update-modal-update-field')?.addEventListener('input', (e) => autoGrow(e.target));
    $um('update-modal-description-input')?.addEventListener('input', (e) => autoGrow(e.target));

    // Due chip → opens native date picker
    $um('update-modal-due-chip')?.addEventListener('click', () => {
        const input = $um('update-modal-due-input');
        if (!input) return;
        if (typeof input.showPicker === 'function') input.showPicker();
        else input.click();
    });
    $um('update-modal-due-input')?.addEventListener('change', (e) => {
        const label = $um('update-modal-due-label');
        const chip = $um('update-modal-due-chip');
        if (e.target.value) {
            label.textContent = formatDueLabel(e.target.value);
            chip.classList.remove('empty');
        } else {
            label.textContent = 'Set due';
            chip.classList.add('empty');
        }
    });

    // Live chip — open dropdown
    $um('update-modal-live-chip')?.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleUmDropdown('live');
    });

    // Live menu — pick option
    $um('update-modal-live-menu')?.addEventListener('click', (e) => {
        const opt = e.target.closest('.custom-dropdown-option');
        if (!opt) return;
        const value = opt.dataset.value;
        $um('update-modal-live-label').textContent = `Live · ${value}`;
        $um('update-modal-live-chip').classList.toggle('empty', value === 'TBC');
        closeAllUmDropdowns();
    });

    // Status pill — open dropdown (drops up)
    $um('update-modal-status')?.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleUmDropdown('status');
    });

    // Status menu — pick option
    $um('update-modal-status-menu')?.addEventListener('click', (e) => {
        const opt = e.target.closest('.custom-dropdown-option');
        if (!opt) return;
        const value = opt.dataset.value;
        $um('update-modal-status-label').textContent = value.toUpperCase();
        renderStatusIndicator(value);
        closeAllUmDropdowns();
    });

    // With Client toggle
    $um('update-modal-with-client')?.addEventListener('click', () => {
        updateModalState.withClient = !updateModalState.withClient;
        const pair = $um('update-modal-with-client');
        const toggle = $um('update-modal-with-client-toggle');
        pair.classList.toggle('on', updateModalState.withClient);
        toggle.classList.toggle('on', updateModalState.withClient);
    });

    // Ballpark tick
    $um('update-modal-ballpark')?.addEventListener('click', () => {
        updateModalState.ballpark = !updateModalState.ballpark;
        $um('update-modal-ballpark').classList.toggle('on', updateModalState.ballpark);
    });

    // Spend — click pill focuses input
    $um('update-modal-spend-amount')?.addEventListener('click', () => {
        $um('update-modal-spend-input')?.focus();
    });

    // Spend input — format with commas, toggle empty
    $um('update-modal-spend-input')?.addEventListener('input', (e) => {
        const raw = e.target.value.replace(/,/g, '').replace(/[^0-9]/g, '');
        e.target.value = raw ? parseInt(raw, 10).toLocaleString() : '';
        $um('update-modal-spend-amount').classList.toggle('empty', !raw || raw === '0');
    });

    // Month chip — open dropdown
    $um('update-modal-month-chip')?.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleUmDropdown('month');
    });

    // Month menu — pick option
    $um('update-modal-month-menu')?.addEventListener('click', (e) => {
        const opt = e.target.closest('.custom-dropdown-option');
        if (!opt) return;
        const value = opt.dataset.value;
        $um('update-modal-month-label').textContent = value;
        // Re-resolve which tracker record matches the new month
        resolveTrackerForMonth(value);
        closeAllUmDropdowns();
    });

    // Submit
    $um('update-modal-submit')?.addEventListener('click', submitUpdate);

    // Completion view — main card loads the suggested job
    $um('update-modal-completion-next-main')?.addEventListener('click', async () => {
        const nextNum = updateModalState.nextJobNumber;
        if (!nextNum) return;
        await loadHotEntry(nextNum);
    });

    // Completion view — chevron toggles dropdown of other same-client jobs
    $um('update-modal-completion-next-toggle')?.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleCompletionMenu();
    });

    // Completion menu — click a row (job, status filter, or "choose another client")
    $um('update-modal-completion-menu')?.addEventListener('click', async (e) => {
        const row = e.target.closest('button[data-job-number], button[data-action]');
        if (!row) return;

        if (row.dataset.action === 'choose-client') {
            // Reset picker to clients stage and animate back
            const clientsEl = $um('update-modal-picker-clients');
            const jobsEl = $um('update-modal-picker-jobs');
            if (clientsEl) clientsEl.hidden = false;
            if (jobsEl) jobsEl.hidden = true;
            updateModalState.pickerStage = 'clients';
            window.clientPicker?.refresh();
            closeCompletionMenu();
            showView('picker', 'back');
            return;
        }

        if (row.dataset.action === 'filter-status') {
            // Jump to picker(jobs) filtered to this status for the current client
            const status = row.dataset.status;
            const allJobs = (typeof state !== 'undefined' && state.allJobs) ? state.allJobs : [];
            const currentJob = allJobs.find(j => j.jobNumber === updateModalState.nextJobNumber);
            const clientCode = currentJob?.clientCode;
            if (!clientCode || !status) return;

            updateModalState.selectedClientCode = clientCode;
            window.jobPicker?.setClient(clientCode, { statusFilter: status });

            // Set picker DOM directly to jobs stage
            const clientsEl = $um('update-modal-picker-clients');
            const jobsEl = $um('update-modal-picker-jobs');
            if (clientsEl) clientsEl.hidden = true;
            if (jobsEl) jobsEl.hidden = false;
            updateModalState.pickerStage = 'jobs';

            closeCompletionMenu();
            showView('picker', 'back');
            return;
        }

        const jobNumber = row.dataset.jobNumber;
        if (jobNumber) {
            closeCompletionMenu();
            await loadHotEntry(jobNumber);
        }
    });

    // Click outside the card+menu closes the menu
    document.addEventListener('click', (e) => {
        if (!updateModalState.open || updateModalState.view !== 'completion') return;
        const menu = $um('update-modal-completion-menu');
        if (!menu || menu.hidden) return;
        if (e.target.closest('.update-modal-completion-next-card')) return;
        if (e.target.closest('.update-modal-completion-menu')) return;
        closeCompletionMenu();
    });

    $um('update-modal-completion-btn-done')?.addEventListener('click', closeUpdateModal);
}

// ===== OPEN / CLOSE =====
async function openUpdateModal(jobNumber, month) {
    const overlay = $um('update-modal-overlay');
    if (!overlay) {
        console.warn('[update-modal] overlay element missing');
        return;
    }
    resetState();

    // Mount pickers (single-instance singletons — must be re-mounted on every open
    // so the modal coexists cleanly with other modals that mount the same pickers).
    const clientsContainer = $um('update-modal-picker-clients');
    const jobsContainer    = $um('update-modal-picker-jobs');
    if (clientsContainer && window.clientPicker) {
        window.clientPicker.mount(clientsContainer, {
            onPick: (code) => {
                updateModalState.selectedClientCode = code;
                window.jobPicker?.setClient(code);
                showPickerStage('jobs');
            },
        });
    }
    if (jobsContainer && window.jobPicker) {
        window.jobPicker.mount(jobsContainer, {
            onPick: (jobNumber) => loadHotEntry(jobNumber),
            onBack: () => showPickerStage('clients'),
        });
    }

    // Hard reset view display so showView's animation logic skips on first open
    const pickerEl = $um('update-modal-picker');
    const populatedEl = $um('update-modal-populated');
    const completionEl = $um('update-modal-completion');
    if (pickerEl) pickerEl.style.display = 'none';
    if (populatedEl) populatedEl.style.display = 'none';
    if (completionEl) completionEl.style.display = 'none';

    if (jobNumber) {
        // Hot entry — show modal instantly, populate as data loads
        showView('populated');
        overlay.classList.add('visible');
        updateModalState.open = true;
        document.body.style.overflow = 'hidden';
        await loadHotEntry(jobNumber, month);
    } else {
        // Cold entry — show picker
        showView('picker');
        window.clientPicker?.refresh();
        showPickerStage('clients');
        overlay.classList.add('visible');
        updateModalState.open = true;
        document.body.style.overflow = 'hidden';
    }
}

function closeUpdateModal() {
    closeAllUmDropdowns();
    const overlay = $um('update-modal-overlay');
    overlay?.classList.remove('visible');
    updateModalState.open = false;
    document.body.style.overflow = '';
}

function resetState() {
    updateModalState.view = 'picker';
    updateModalState.pickerStage = 'clients';
    updateModalState.selectedClientCode = null;
    updateModalState.currentJob = null;
    updateModalState.withClient = false;
    updateModalState.ballpark = false;
    updateModalState.submitting = false;
    updateModalState.currentMonthTrackerId = null;
    updateModalState.trackerEntries = [];
    updateModalState.totalSpend = 0;
    updateModalState.nextJobNumber = null;
    updateModalState.sessionUpdatedJobs = new Set();

    // Reset picker DOM so reopening always starts at the client list
    const clientsEl = $um('update-modal-picker-clients');
    const jobsEl = $um('update-modal-picker-jobs');
    if (clientsEl) {
        clientsEl.hidden = false;
        clientsEl.classList.remove('um-stage-leave-fwd', 'um-stage-leave-back', 'um-stage-enter-fwd', 'um-stage-enter-back');
    }
    if (jobsEl) {
        jobsEl.hidden = true;
        jobsEl.classList.remove('um-stage-leave-fwd', 'um-stage-leave-back', 'um-stage-enter-fwd', 'um-stage-enter-back');
    }
}

// ===== VIEW SWITCHING =====
function showView(view, direction = 'fwd') {
    const picker = $um('update-modal-picker');
    const populated = $um('update-modal-populated');
    const completion = $um('update-modal-completion');
    if (!picker || !populated || !completion) return;

    updateModalState.view = view;

    const views = { picker, populated, completion };
    const target = views[view];
    if (!target) return;

    // Find any currently visible views (one or zero)
    const others = Object.entries(views)
        .filter(([k, v]) => k !== view && v.style.display !== 'none')
        .map(([, v]) => v);

    // Already in correct state
    if (target.style.display !== 'none' && others.length === 0) return;

    // No views currently visible (first open after hard reset) — show target plain
    if (others.length === 0) {
        target.style.display = 'block';
        return;
    }

    // Animated swap
    const leaveCls = `um-stage-leave-${direction}`;
    const enterCls = `um-stage-enter-${direction}`;
    const DUR = 140;

    others.forEach(o => o.classList.add(leaveCls));
    setTimeout(() => {
        others.forEach(o => {
            o.style.display = 'none';
            o.classList.remove(leaveCls);
        });
        target.style.display = 'block';
        target.classList.add(enterCls);
        setTimeout(() => target.classList.remove(enterCls), DUR);
    }, DUR);
}

function showPickerStage(stage) {
    const clients = $um('update-modal-picker-clients');
    const jobs = $um('update-modal-picker-jobs');
    if (!clients || !jobs) return;

    const target = stage === 'jobs' ? jobs : clients;
    const other  = stage === 'jobs' ? clients : jobs;

    updateModalState.pickerStage = stage;

    // First-time render or already correct — skip animation
    if (!target.hidden && other.hidden) return;
    if (!target.hidden) return;

    // If 'other' isn't on screen either (both hidden), just show target plain
    if (other.hidden) {
        target.hidden = false;
        return;
    }

    // Animated: fade-out the leaving stage, then fade-in the target
    const direction = stage === 'jobs' ? 'fwd' : 'back';
    const leaveCls = `um-stage-leave-${direction}`;
    const enterCls = `um-stage-enter-${direction}`;
    const DUR = 140;

    other.classList.add(leaveCls);
    setTimeout(() => {
        other.hidden = true;
        other.classList.remove(leaveCls);
        target.hidden = false;
        target.classList.add(enterCls);
        setTimeout(() => target.classList.remove(enterCls), DUR);
    }, DUR);
}

// ===== HOT ENTRY (load a job into populated view) =====
async function loadHotEntry(jobNumber, month) {
    const allJobs = (typeof state !== 'undefined' && state.allJobs) ? state.allJobs : [];
    const job = allJobs.find(j => j.jobNumber === jobNumber);
    if (!job) {
        console.warn('[update-modal] job not found:', jobNumber);
        if (typeof showToast === 'function') showToast('Job not found.', 'error');
        return;
    }
    updateModalState.currentJob = job;

    // ===== SYNC BLOCK — populate from in-memory state, no awaits =====
    // Header populates instantly. Tracker section shows loading dots until fetch resolves.

    // Populate header
    const clientCode = job.clientCode || '';
    const logoUrl = (typeof getLogoUrl === 'function') ? getLogoUrl(clientCode) : `images/logos/${clientCode}.png`;
    const logoEl = $um('update-modal-header-logo');
    if (logoEl) {
        logoEl.src = logoUrl;
        logoEl.alt = clientCode;
        logoEl.onerror = () => { logoEl.src = 'images/logos/Unknown.png'; };
    }
    $um('update-modal-hero').textContent = job.jobName || '';
    $um('update-modal-description').textContent = job.description || '';
    // Reset description editing state — fresh job, fresh display
    const descArea = $um('update-modal-description-area');
    if (descArea) descArea.classList.remove('editing');
    const descInput = $um('update-modal-description-input');
    if (descInput) descInput.value = '';
    const metaEl = $um('update-modal-meta');
    const metaSecond = job.projectOwner || resolveClientName(clientCode);
    metaEl.textContent = `${formatJobDisplay(job.jobNumber)}  |  ${metaSecond}`;

    // Latest update — pull from updateHistory if present, else fall back to .update text
    const display = $um('update-modal-update-display');
    const area = $um('update-modal-update-area');
    area.classList.remove('editing');
    const latest = parseLatestUpdate(job);
    if (latest) {
        const datePrefix = latest.date ? `<span class="update-date">${escapeHtml(latest.date)} —</span>` : '';
        display.innerHTML = `${datePrefix}${escapeHtml(latest.text)}`;
        display.classList.remove('placeholder');
    } else {
        display.textContent = "What's happening?";
        display.classList.add('placeholder');
    }
    $um('update-modal-update-field').value = '';
    autoGrow($um('update-modal-update-field'));

    // Due chip
    const dueLabel = $um('update-modal-due-label');
    const dueInput = $um('update-modal-due-input');
    const dueChip = $um('update-modal-due-chip');
    const dueIso = friendlyDateToIso(job.updateDue);
    if (dueIso) {
        dueInput.value = dueIso;
        dueLabel.textContent = formatDueLabel(dueIso);
        dueChip.classList.remove('empty');
    } else {
        dueInput.value = '';
        dueLabel.textContent = 'Set due';
        dueChip.classList.add('empty');
    }

    // Live chip
    const liveLabel = $um('update-modal-live-label');
    const liveChip = $um('update-modal-live-chip');
    const liveVal = job.liveDate || 'TBC';
    const liveDisplay = LIVE_OPTIONS.find(o => o.toLowerCase() === String(liveVal).toLowerCase()) || 'TBC';
    liveLabel.textContent = `Live · ${liveDisplay}`;
    liveChip.classList.toggle('empty', liveDisplay === 'TBC');

    // Status
    const statusVal = job.status || 'In Progress';
    $um('update-modal-status-label').textContent = statusVal.toUpperCase();
    renderStatusIndicator(statusVal);

    // With Client toggle
    updateModalState.withClient = !!job.withClient;
    const wcPair = $um('update-modal-with-client');
    const wcToggle = $um('update-modal-with-client-toggle');
    wcPair.classList.toggle('on', updateModalState.withClient);
    wcToggle.classList.toggle('on', updateModalState.withClient);

    // Tracker section — show loading dots until fetch resolves
    showTrackerLoading(month);

    showView('populated');

    // ===== ASYNC BLOCK — fire-and-forget cache warm + tracker fetch =====

    // Refresh meta line if client name resolves later (was using fallback)
    ensureClientsCached().then(() => {
        if (updateModalState.currentJob !== job) return; // guard: another job loaded since
        if (job.projectOwner) return; // not using fallback — nothing to refresh
        const refreshed = job.projectOwner || resolveClientName(clientCode);
        metaEl.textContent = `${formatJobDisplay(job.jobNumber)}  |  ${refreshed}`;
    }).catch(() => { /* fire-and-forget */ });

    // Tracker — fetch budget data for this job
    await loadTrackerForJob(job.jobNumber, month);
}

// Show three bouncing dots in the tracker row while budget fetch runs
function showTrackerLoading(month) {
    const targetMonth = month || MONTHS[new Date().getMonth()];
    const monthLabel = $um('update-modal-month-label');
    const spendInput = $um('update-modal-spend-input');
    const spendAmount = $um('update-modal-spend-amount');
    const ballparkRow = $um('update-modal-ballpark');
    const toDate = $um('update-modal-to-date');
    const notes = $um('update-modal-tracker-notes');

    if (monthLabel) monthLabel.textContent = targetMonth;
    if (spendInput) spendInput.value = '';
    if (spendAmount) spendAmount.classList.add('empty');
    if (ballparkRow) ballparkRow.classList.remove('on');
    if (notes) notes.value = '';
    // Loading dots in the to-date area
    if (toDate) {
        toDate.innerHTML = (typeof loadingDots === 'function')
            ? loadingDots('small')
            : '<span class="loading-dots loading-dots--small"><span class="loading-dots__dot"></span><span class="loading-dots__dot"></span><span class="loading-dots__dot"></span></span>';
        toDate.classList.remove('hidden');
    }
}

// ===== TRACKER LOADING =====
async function loadTrackerForJob(jobNumber, month) {
    // Reset tracker UI to loading-ish state
    updateModalState.trackerEntries = [];
    updateModalState.totalSpend = 0;
    updateModalState.currentMonthTrackerId = null;

    const targetMonth = month || MONTHS[new Date().getMonth()];

    try {
        const res = await fetch(`${API_BASE}/job/${encodeURIComponent(jobNumber)}/budget`);
        if (res.ok) {
            const data = await res.json();
            updateModalState.trackerEntries = Array.isArray(data.entries) ? data.entries : [];
            updateModalState.totalSpend = Number(data.total) || 0;
        }
    } catch (e) {
        console.warn('[update-modal] budget fetch failed:', e);
    }

    // Default to target month (clicked row's month, or current calendar month)
    $um('update-modal-month-label').textContent = targetMonth;
    resolveTrackerForMonth(targetMonth);

    // To-date
    renderToDate();
}

function resolveTrackerForMonth(monthName) {
    const entry = updateModalState.trackerEntries.find(e => e.month === monthName);
    const spendInput = $um('update-modal-spend-input');
    const spendAmount = $um('update-modal-spend-amount');
    const notes = $um('update-modal-tracker-notes');
    const ballparkRow = $um('update-modal-ballpark');

    if (entry) {
        updateModalState.currentMonthTrackerId = entry.id;
        const spendNum = Number(entry.spend) || 0;
        spendInput.value = spendNum > 0 ? spendNum.toLocaleString() : '';
        spendAmount.classList.toggle('empty', spendNum === 0);
        notes.value = entry.notes || '';
        updateModalState.ballpark = !!entry.ballpark;
        ballparkRow.classList.toggle('on', updateModalState.ballpark);
    } else {
        // No record yet for this month — fresh entry, defaults
        updateModalState.currentMonthTrackerId = null;
        spendInput.value = '';
        spendAmount.classList.add('empty');
        notes.value = '';
        updateModalState.ballpark = true; // default ON for new entries
        ballparkRow.classList.add('on');
    }
}

function renderToDate() {
    const el = $um('update-modal-to-date');
    if (!el) return;
    const total = updateModalState.totalSpend;
    if (total > 0) {
        // Build "(Mon/Mon/Mon)" suffix from entries with spend > 0
        const monthAbbrev = { January:'Jan', February:'Feb', March:'Mar', April:'Apr',
            May:'May', June:'Jun', July:'Jul', August:'Aug', September:'Sep',
            October:'Oct', November:'Nov', December:'Dec' };
        const months = (updateModalState.trackerEntries || [])
            .filter(e => Number(e.spend) > 0 && e.month)
            .map(e => monthAbbrev[e.month] || e.month);
        const suffix = months.length > 0 ? ` (${months.join('/')})` : ' to date';
        el.textContent = `$${total.toLocaleString()}${suffix}`;
        el.classList.remove('hidden');
    } else {
        el.textContent = '';
        el.classList.add('hidden');
    }
}

// ===== STATUS INDICATOR =====
function renderStatusIndicator(status) {
    const el = $um('update-modal-status-indicator');
    if (!el) return;
    const stroke = '#ED1C24';
    const red = '#ED1C24';
    let svg = '';
    switch (status) {
        case 'Incoming':
            svg = `<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="6.5" fill="none" stroke="${stroke}" stroke-width="2"/></svg>`;
            break;
        case 'In Progress':
            svg = `<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="6.5" fill="none" stroke="${stroke}" stroke-width="2"/><path d="M 8 1.5 A 6.5 6.5 0 0 1 8 14.5 Z" fill="${stroke}"/></svg>`;
            break;
        case 'On Hold':
        case 'Completed':
            svg = `<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="6.5" fill="${red}"/></svg>`;
            break;
        default:
            svg = `<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="6.5" fill="none" stroke="${stroke}" stroke-width="2"/></svg>`;
    }
    el.innerHTML = svg;
}

// ===== SUBMIT =====
async function submitUpdate() {
    if (updateModalState.submitting) return;
    const job = updateModalState.currentJob;
    if (!job) return;

    const submitBtn = $um('update-modal-submit');
    updateModalState.submitting = true;
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'SAVING';
    }

    try {
        // 1. Build job-update payload
        const messageText = $um('update-modal-update-field').value.trim();
        const dueIso = $um('update-modal-due-input').value || null;
        const liveLabel = $um('update-modal-live-label').textContent.replace('Live · ', '').trim();
        const liveValue = liveLabel === 'TBC' ? 'Tbc' : liveLabel; // Airtable expects "Tbc" per app.py comment
        const statusLabel = $um('update-modal-status-label').textContent.trim();
        // Map back from uppercase display to canonical
        const statusValue = STATUSES.find(s => s.toUpperCase() === statusLabel) || statusLabel;
        const author = (typeof state !== 'undefined' && state.currentUser?.name) ? state.currentUser.name : 'Dot';

        const jobUpdatePayload = {
            status: statusValue,
            withClient: updateModalState.withClient,
            liveDate: liveValue,
            updateDue: dueIso,
            author: author,
        };
        if (messageText) jobUpdatePayload.message = messageText;

        // Include description only if the user opened the editor on it
        const descArea = $um('update-modal-description-area');
        if (descArea?.classList.contains('editing')) {
            jobUpdatePayload.description = $um('update-modal-description-input').value.trim();
        }

        const jobRes = await fetch(`${API_BASE}/job/${encodeURIComponent(job.jobNumber)}/update`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(jobUpdatePayload),
        });
        if (!jobRes.ok) throw new Error('Job update failed');

        // 2. Build tracker payload — only submit if there's a spend value
        const spendRaw = $um('update-modal-spend-input').value.replace(/,/g, '').replace(/[^0-9]/g, '');
        const spendNum = spendRaw ? parseInt(spendRaw, 10) : 0;
        const monthName = $um('update-modal-month-label').textContent.trim();
        const notesText = $um('update-modal-tracker-notes').value;

        // Submit tracker if: there's a spend value OR there's already a tracker record being edited
        const shouldWriteTracker = spendNum > 0 || updateModalState.currentMonthTrackerId;

        if (shouldWriteTracker) {
            if (updateModalState.currentMonthTrackerId) {
                // Update existing tracker record
                const trackerPayload = {
                    id: updateModalState.currentMonthTrackerId,
                    spend: spendNum,
                    month: monthName,
                    description: notesText,
                    ballpark: updateModalState.ballpark,
                    spendType: 'Project budget',
                };
                const trkRes = await fetch(`${API_BASE}/tracker/update`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(trackerPayload),
                });
                if (!trkRes.ok) throw new Error('Tracker update failed');
            } else {
                // Create new tracker record
                const trackerPayload = {
                    jobNumber: job.jobNumber,
                    spend: spendNum,
                    month: monthName,
                    description: notesText,
                    ballpark: updateModalState.ballpark,
                    spendType: 'Project budget',
                };
                const trkRes = await fetch(`${API_BASE}/tracker/create`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(trackerPayload),
                });
                if (!trkRes.ok) throw new Error('Tracker create failed');
            }
        }

        // Track this job as updated in this modal session (so it's not suggested as "next")
        updateModalState.sessionUpdatedJobs.add(job.jobNumber);

        // Refresh jobs (and tracker if visible) — needs fresh state.allJobs
        // before findNextJob below.
        try {
            if (typeof window.refreshAfterMutation === 'function') {
                await window.refreshAfterMutation(['jobs', 'tracker']);
            } else {
                // Fallback: shouldn't fire if app.js loaded normally
                const r = await fetch(`${API_BASE}/jobs/all`);
                if (r.ok && typeof state !== 'undefined') state.allJobs = await r.json();
                if (typeof window.renderWip === 'function') window.renderWip();
            }
        } catch (refreshErr) {
            console.warn('[update-modal] post-save refresh failed:', refreshErr);
        }

        // Suggest the next In-Progress job — same client first, else any client.
        // If nothing fits, close as before.
        const nextJob = findNextJob(job.jobNumber, job.clientCode);
        if (nextJob) {
            showCompletionView(job, nextJob);
        } else {
            closeUpdateModal();
        }

    } catch (err) {
        console.error('[update-modal] submit failed:', err);
        if (typeof showToast === 'function') showToast("Doh, that didn't work.", 'error');
    } finally {
        updateModalState.submitting = false;
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = 'UPDATE';
        }
    }
}

// ===== DROPDOWN HELPERS =====
const UM_DROPDOWN_CONFIG = {
    live:   { btnId: 'update-modal-live-chip',   menuId: 'update-modal-live-menu' },
    month:  { btnId: 'update-modal-month-chip',  menuId: 'update-modal-month-menu' },
    status: { btnId: 'update-modal-status',      menuId: 'update-modal-status-menu' },
};

function toggleUmDropdown(which) {
    const cfg = UM_DROPDOWN_CONFIG[which];
    if (!cfg) return;
    const btn = $um(cfg.btnId);
    const menu = $um(cfg.menuId);
    if (!btn || !menu) return;
    const wasOpen = menu.classList.contains('open');
    closeAllUmDropdowns();
    if (!wasOpen) {
        renderUmDropdownOptions(which);
        btn.classList.add('open');
        menu.classList.add('open');
    }
}

function closeAllUmDropdowns() {
    Object.values(UM_DROPDOWN_CONFIG).forEach(cfg => {
        $um(cfg.btnId)?.classList.remove('open');
        $um(cfg.menuId)?.classList.remove('open');
    });
}

function renderUmDropdownOptions(which) {
    if (which === 'live') {
        const menu = $um('update-modal-live-menu');
        const current = $um('update-modal-live-label').textContent.replace('Live · ', '').trim();
        menu.innerHTML = LIVE_OPTIONS.map(opt => {
            const sel = opt === current ? ' selected' : '';
            return `<div class="custom-dropdown-option${sel}" data-value="${escapeAttr(opt)}">${escapeHtml(opt)}</div>`;
        }).join('');
    } else if (which === 'month') {
        const menu = $um('update-modal-month-menu');
        const current = $um('update-modal-month-label').textContent.trim();
        menu.innerHTML = MONTHS.map(m => {
            const sel = m === current ? ' selected' : '';
            return `<div class="custom-dropdown-option${sel}" data-value="${escapeAttr(m)}">${escapeHtml(m)}</div>`;
        }).join('');
    } else if (which === 'status') {
        const menu = $um('update-modal-status-menu');
        const currentLabel = $um('update-modal-status-label').textContent.trim();
        const currentCanonical = STATUSES.find(s => s.toUpperCase() === currentLabel) || currentLabel;
        menu.innerHTML = STATUSES.map(s => {
            const sel = s === currentCanonical ? ' selected' : '';
            return `<div class="custom-dropdown-option${sel}" data-value="${escapeAttr(s)}">${escapeHtml(s)}</div>`;
        }).join('');
    }
}

// ===== HELPERS =====
function autoGrow(el) {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
}

// daysSinceUpdate is normally a number, but Airtable can return '-' or null.
// Treat anything non-numeric as "very stale" so it sorts to the bottom.
function clientRecencyValue(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : Infinity;
}

// Find the next In-Progress job to suggest after a save.
// Same client first (most recently touched), else any client (most recently touched).
// Excludes the just-saved job and anything already updated in this modal session.
function findNextJob(currentJobNumber, currentClientCode) {
    const allJobs = (typeof state !== 'undefined' && state.allJobs) ? state.allJobs : [];
    const session = updateModalState.sessionUpdatedJobs;

    const isCandidate = (j) =>
        j.status === 'In Progress' &&
        j.jobNumber !== currentJobNumber &&
        !session.has(j.jobNumber);

    const sortByRecency = (a, b) =>
        clientRecencyValue(a.daysSinceUpdate) - clientRecencyValue(b.daysSinceUpdate);

    const sameClient = allJobs
        .filter(j => isCandidate(j) && j.clientCode === currentClientCode)
        .sort(sortByRecency);
    if (sameClient.length > 0) return sameClient[0];

    const anyClient = allJobs.filter(isCandidate).sort(sortByRecency);
    return anyClient[0] || null;
}

function showCompletionView(savedJob, nextJob) {
    if (!nextJob) return;

    // Title = job name of the just-saved job (closes the loop without redundancy)
    const titleEl = $um('update-modal-completion-title');
    if (titleEl) titleEl.textContent = savedJob?.jobName || formatJobDisplay(savedJob?.jobNumber || '');

    // Main card — the suggested next job
    const logoEl = $um('update-modal-completion-next-logo');
    const logoUrl = (typeof getLogoUrl === 'function')
        ? getLogoUrl(nextJob.clientCode)
        : `images/logos/${nextJob.clientCode}.png`;
    if (logoEl) {
        logoEl.src = logoUrl;
        logoEl.alt = nextJob.clientCode || '';
        logoEl.onerror = () => { logoEl.src = 'images/logos/Unknown.png'; };
    }

    const kickerEl = $um('update-modal-completion-next-kicker');
    if (kickerEl) kickerEl.textContent = formatJobDisplay(nextJob.jobNumber);
    const nameEl = $um('update-modal-completion-next-name');
    if (nameEl) nameEl.textContent = nextJob.jobName || '';

    updateModalState.nextJobNumber = nextJob.jobNumber;

    // Build dropdown of OTHER same-client in-progress jobs (excluding next + session)
    const allJobs = (typeof state !== 'undefined' && state.allJobs) ? state.allJobs : [];
    const session = updateModalState.sessionUpdatedJobs;
    const sameClientOthers = allJobs
        .filter(j =>
            j.status === 'In Progress' &&
            j.clientCode === nextJob.clientCode &&
            j.jobNumber !== nextJob.jobNumber &&
            !session.has(j.jobNumber)
        )
        .sort((a, b) => clientRecencyValue(a.daysSinceUpdate) - clientRecencyValue(b.daysSinceUpdate));

    renderCompletionMenu(sameClientOthers, nextJob.clientCode);

    // Chevron is shown when there's anything else useful in the menu —
    // either other same-client In-Progress jobs, or On Hold/Incoming jobs to filter to.
    // (Choose-another-client alone isn't enough — too thin to be a menu.)
    const hasOtherStatuses = allJobs.some(j =>
        j.clientCode === nextJob.clientCode &&
        (j.status === 'On Hold' || j.status === 'Incoming') &&
        !session.has(j.jobNumber)
    );
    const hasMenu = sameClientOthers.length > 0 || hasOtherStatuses;
    const toggleEl = $um('update-modal-completion-next-toggle');
    if (toggleEl) toggleEl.hidden = !hasMenu;

    // Always start with menu closed
    closeCompletionMenu();

    showView('completion', 'fwd');
}

function renderCompletionMenu(sameClientJobs, currentClientCode) {
    const menu = $um('update-modal-completion-menu');
    if (!menu) return;

    const logoUrl = (typeof getLogoUrl === 'function')
        ? getLogoUrl(currentClientCode)
        : `images/logos/${currentClientCode}.png`;

    // Curated In-Progress rows for same client
    const jobRows = sameClientJobs.map(j => {
        const num = escapeAttr(j.jobNumber || '');
        const display = escapeHtml(formatJobDisplay(j.jobNumber));
        const name = escapeHtml(j.jobName || '');
        return `
          <button class="modal-row compact" data-job-number="${num}" type="button">
            <img class="modal-row-logo" src="${escapeAttr(logoUrl)}" alt="" onerror="this.src='images/logos/Unknown.png'">
            <div class="modal-row-content">
              <div class="modal-row-kicker">${display}</div>
              <div class="modal-row-name">${name}</div>
            </div>
          </button>
        `;
    }).join('');

    // Count On Hold / Incoming for same client (excluding session)
    const allJobs = (typeof state !== 'undefined' && state.allJobs) ? state.allJobs : [];
    const session = updateModalState.sessionUpdatedJobs;
    const countByStatus = (status) => allJobs.filter(j =>
        j.clientCode === currentClientCode &&
        j.status === status &&
        !session.has(j.jobNumber)
    ).length;
    const onHoldCount = countByStatus('On Hold');
    const incomingCount = countByStatus('Incoming');

    const statusRows = [
        onHoldCount > 0
            ? `<button class="um-status-row" data-action="filter-status" data-status="On Hold" type="button">
                 <span class="um-status-row-label">Jobs on hold <span class="um-status-row-count">(${onHoldCount})</span></span>
                 <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 6 15 12 9 18"/></svg>
               </button>`
            : '',
        incomingCount > 0
            ? `<button class="um-status-row" data-action="filter-status" data-status="Incoming" type="button">
                 <span class="um-status-row-label">Jobs incoming <span class="um-status-row-count">(${incomingCount})</span></span>
                 <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 6 15 12 9 18"/></svg>
               </button>`
            : '',
    ].filter(Boolean).join('');

    const chooseClientRow = `
      <button class="um-status-row" data-action="choose-client" type="button">
        <span class="um-status-row-label">Choose another client</span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 6 15 12 9 18"/></svg>
      </button>
    `;

    // Divider only between curated job rows and the status/escape rows
    const divider = jobRows ? '<div class="modal-divider update-modal-completion-menu-divider"></div>' : '';

    menu.innerHTML = jobRows + divider + statusRows + chooseClientRow;
}

function openCompletionMenu() {
    const menu = $um('update-modal-completion-menu');
    const toggle = $um('update-modal-completion-next-toggle');
    const card = $um('update-modal-completion-next-card');
    if (!menu) return;
    menu.hidden = false;
    toggle?.classList.add('open');
    card?.classList.add('menu-open');
}

function closeCompletionMenu() {
    const menu = $um('update-modal-completion-menu');
    const toggle = $um('update-modal-completion-next-toggle');
    const card = $um('update-modal-completion-next-card');
    if (!menu) return;
    menu.hidden = true;
    toggle?.classList.remove('open');
    card?.classList.remove('menu-open');
}

function toggleCompletionMenu() {
    const menu = $um('update-modal-completion-menu');
    if (!menu) return;
    if (menu.hidden) openCompletionMenu(); else closeCompletionMenu();
}

function formatJobDisplay(jobNumber) {
    if (!jobNumber) return '';
    // "ONB-094" → "ONB 094"
    return String(jobNumber).replace('-', ' ');
}

function formatDueLabel(isoDate) {
    if (!isoDate) return 'Set due';
    const d = new Date(isoDate);
    if (isNaN(d.getTime())) return 'Set due';
    const day = d.getDate();
    const month = d.toLocaleString('en', { month: 'short' });
    return `Due ${day} ${month}`;
}

// Convert "21/04/2026" or similar friendly date to ISO yyyy-mm-dd, else null
function friendlyDateToIso(friendly) {
    if (!friendly) return null;
    // Already ISO?
    if (/^\d{4}-\d{2}-\d{2}/.test(friendly)) return friendly.slice(0, 10);
    // D/M/YYYY or DD/MM/YYYY
    const m = String(friendly).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) {
        const [, d, mo, y] = m;
        return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
    }
    return null;
}

// Pull latest update from job's updateHistory or fall back to .update
function parseLatestUpdate(job) {
    const history = Array.isArray(job.updateHistory) ? job.updateHistory : [];
    if (history.length > 0) {
        const latest = history[history.length - 1];
        // Format may be "21/04/2026 — Some text" or just text. Try to split.
        const m = String(latest).match(/^(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)\s*[—-]\s*(.+)$/);
        if (m) {
            const [, dateStr, text] = m;
            // Format date as "21 Apr"
            return { date: prettyDateFromHistory(dateStr), text };
        }
        return { date: null, text: String(latest) };
    }
    if (job.update) return { date: null, text: String(job.update) };
    return null;
}

function prettyDateFromHistory(dateStr) {
    const m = String(dateStr).match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
    if (!m) return dateStr;
    const [, d, mo] = m;
    const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const monthIdx = parseInt(mo, 10) - 1;
    const monthLabel = (monthIdx >= 0 && monthIdx < 12) ? monthNames[monthIdx] : mo;
    return `${parseInt(d, 10)} ${monthLabel}`;
}

function resolveClientName(clientCode) {
    // Walk through the cached client list if available, else just show the code
    const cached = window._updateModalClientsCache;
    if (Array.isArray(cached)) {
        const c = cached.find(x => x.code === clientCode);
        if (c?.name) return c.name;
    }
    return clientCode || '';
}

async function ensureClientsCached() {
    if (Array.isArray(window._updateModalClientsCache) && window._updateModalClientsCache.length > 0) {
        return;
    }
    try {
        const res = await fetch(`${API_BASE}/clients`);
        if (!res.ok) return;
        const clients = await res.json();
        if (Array.isArray(clients)) {
            window._updateModalClientsCache = clients;
        }
    } catch (e) {
        console.warn('[update-modal] client cache fetch failed:', e);
    }
}

function escapeHtml(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
function escapeAttr(str) { return escapeHtml(str); }

// ===== EXPOSE TO WINDOW =====
window.openUpdateModal = openUpdateModal;
window.closeUpdateModal = closeUpdateModal;
