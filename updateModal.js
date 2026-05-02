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
    view: 'picker', // 'picker' | 'populated'
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

    // Picker — client list (event delegation)
    $um('update-modal-client-list')?.addEventListener('click', (e) => {
        const row = e.target.closest('.update-modal-picker-row');
        if (!row) return;
        const code = row.dataset.code;
        updateModalState.selectedClientCode = code;
        renderJobList(code);
        showPickerStage('jobs');
    });

    // Picker — back button
    $um('update-modal-picker-back')?.addEventListener('click', () => {
        showPickerStage('clients');
    });

    // Picker — job list (event delegation)
    $um('update-modal-job-list')?.addEventListener('click', (e) => {
        const row = e.target.closest('.update-modal-picker-row');
        if (!row) return;
        const jobNumber = row.dataset.jobNumber;
        loadHotEntry(jobNumber);
    });

    // Update area tap-to-edit
    $um('update-modal-update-area')?.addEventListener('click', (e) => {
        if (e.target.tagName === 'TEXTAREA') return;
        const area = $um('update-modal-update-area');
        if (area.classList.contains('editing')) return;
        area.classList.add('editing');
        const ta = $um('update-modal-update-field');
        setTimeout(() => { ta?.focus(); autoGrow(ta); }, 50);
    });

    // Auto-grow update textarea (notes is single-line — no auto-grow)
    $um('update-modal-update-field')?.addEventListener('input', (e) => autoGrow(e.target));

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
}

// ===== OPEN / CLOSE =====
async function openUpdateModal(jobNumber) {
    const overlay = $um('update-modal-overlay');
    if (!overlay) {
        console.warn('[update-modal] overlay element missing');
        return;
    }
    resetState();

    if (jobNumber) {
        // Hot entry — open straight to populated view
        await loadHotEntry(jobNumber);
    } else {
        // Cold entry — show picker
        showView('picker');
        renderClientList();
        showPickerStage('clients');
    }

    overlay.classList.add('visible');
    updateModalState.open = true;
    document.body.style.overflow = 'hidden';
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
}

// ===== VIEW SWITCHING =====
function showView(view) {
    updateModalState.view = view;
    const picker = $um('update-modal-picker');
    const populated = $um('update-modal-populated');
    if (picker) picker.style.display = view === 'picker' ? 'block' : 'none';
    if (populated) populated.style.display = view === 'populated' ? 'block' : 'none';
}

function showPickerStage(stage) {
    updateModalState.pickerStage = stage;
    const clients = $um('update-modal-picker-clients');
    const jobs = $um('update-modal-picker-jobs');
    if (clients) clients.hidden = stage !== 'clients';
    if (jobs) jobs.hidden = stage !== 'jobs';
}

// ===== PICKER RENDERING =====
async function renderClientList() {
    const list = $um('update-modal-client-list');
    if (!list) return;
    list.innerHTML = '<div class="update-modal-picker-empty">Loading clients…</div>';

    let clients = [];
    try {
        const res = await fetch(`${API_BASE}/clients`);
        if (!res.ok) throw new Error('Failed to fetch clients');
        clients = await res.json();
        // Cache for resolveClientName() — used by hot-entry meta line
        window._updateModalClientsCache = clients;
    } catch (e) {
        console.error('[update-modal] client fetch failed:', e);
        list.innerHTML = '<div class="update-modal-picker-empty">Could not load clients.</div>';
        return;
    }

    if (!Array.isArray(clients) || clients.length === 0) {
        list.innerHTML = '<div class="update-modal-picker-empty">No clients found.</div>';
        return;
    }

    list.innerHTML = clients.map(c => {
        const code = escapeAttr(c.code || '');
        const name = escapeHtml(c.name || c.code || '');
        const logoUrl = (typeof getLogoUrl === 'function') ? getLogoUrl(c.code) : `images/logos/${c.code}.png`;
        return `
          <button class="update-modal-picker-row" data-code="${code}">
            <img class="update-modal-picker-logo" src="${escapeAttr(logoUrl)}" alt="${code}" onerror="this.src='images/logos/Unknown.png'">
            <div class="update-modal-picker-content">
              <div class="update-modal-picker-kicker">${code}</div>
              <div class="update-modal-picker-name">${name}</div>
            </div>
          </button>
        `;
    }).join('');
}

function renderJobList(clientCode) {
    const titleEl = $um('update-modal-picker-jobs-title');
    const subEl = $um('update-modal-picker-jobs-sub');
    const listEl = $um('update-modal-job-list');
    if (!listEl) return;

    const allJobs = (typeof state !== 'undefined' && state.allJobs) ? state.allJobs : [];
    const jobs = allJobs.filter(j => j.clientCode === clientCode);

    if (titleEl) titleEl.textContent = clientCode;
    if (subEl) {
        subEl.textContent = jobs.length === 0
            ? 'No active jobs for this client'
            : `${jobs.length} active job${jobs.length === 1 ? '' : 's'}`;
    }

    if (jobs.length === 0) {
        listEl.innerHTML = '<div class="update-modal-picker-empty">No jobs to update.</div>';
        return;
    }

    const logoUrl = (typeof getLogoUrl === 'function') ? getLogoUrl(clientCode) : `images/logos/${clientCode}.png`;
    listEl.innerHTML = jobs.map(j => {
        const num = escapeAttr(j.jobNumber || '');
        const display = escapeHtml(formatJobDisplay(j.jobNumber));
        const name = escapeHtml(j.jobName || '');
        return `
          <button class="update-modal-picker-row" data-job-number="${num}">
            <img class="update-modal-picker-logo" src="${escapeAttr(logoUrl)}" alt="${escapeAttr(clientCode)}" onerror="this.src='images/logos/Unknown.png'">
            <div class="update-modal-picker-content">
              <div class="update-modal-picker-kicker">${display}</div>
              <div class="update-modal-picker-name">${name}</div>
            </div>
          </button>
        `;
    }).join('');
}

// ===== HOT ENTRY (load a job into populated view) =====
async function loadHotEntry(jobNumber) {
    const allJobs = (typeof state !== 'undefined' && state.allJobs) ? state.allJobs : [];
    const job = allJobs.find(j => j.jobNumber === jobNumber);
    if (!job) {
        console.warn('[update-modal] job not found:', jobNumber);
        if (typeof showToast === 'function') showToast('Job not found.', 'error');
        return;
    }
    updateModalState.currentJob = job;

    // Make sure we have client names cached so the meta line shows the real name, not the code
    await ensureClientsCached();

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
    const metaSecond = job.projectOwner || resolveClientName(clientCode);
    $um('update-modal-meta').textContent = `${formatJobDisplay(job.jobNumber)}  |  ${metaSecond}`;

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

    // Tracker — fetch budget data for this job
    await loadTrackerForJob(job.jobNumber);

    showView('populated');
}

// ===== TRACKER LOADING =====
async function loadTrackerForJob(jobNumber) {
    // Reset tracker UI to loading-ish state
    updateModalState.trackerEntries = [];
    updateModalState.totalSpend = 0;
    updateModalState.currentMonthTrackerId = null;

    const currentMonth = MONTHS[new Date().getMonth()];

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

    // Default to current calendar month
    $um('update-modal-month-label').textContent = currentMonth;
    resolveTrackerForMonth(currentMonth);

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
        submitBtn.textContent = 'SAVING…';
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

        if (typeof showToast === 'function') showToast('On it.', 'success');
        closeUpdateModal();

        // Best-effort refresh of jobs list so WIP reflects new state
        try {
            if (typeof window.loadAllJobs === 'function') {
                await window.loadAllJobs();
            } else {
                const r = await fetch(`${API_BASE}/jobs/all`);
                if (r.ok && typeof state !== 'undefined') state.allJobs = await r.json();
            }
            if (typeof window.renderWip === 'function') window.renderWip();
        } catch (refreshErr) {
            console.warn('[update-modal] post-save refresh failed:', refreshErr);
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
