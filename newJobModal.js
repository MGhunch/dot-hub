// ===== NEW JOB MODAL MODULE =====
// Modal-system-based New Job modal — replaces the legacy form-style modal.
// Flow: client picker → populated form → submit to dot-workers /setup → close + refresh.
//
// Depends on: state, API_BASE, getLogoUrl, showToast, loadJobs (from app.js),
//             window.clientPicker (clientPicker.js)
// Exposes:    openNewJobModal, closeNewJobModal (window globals — same surface as before)

(function setupNewJobModal() {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', wireNewJobModalListeners);
    } else {
        wireNewJobModalListeners();
    }
})();

// ===== STATE =====
const newJobModalState = {
    open: false,
    view: 'picker', // 'picker' | 'populated'
    clientCode: null,
    clientName: null,
    jobNumber: null,        // previewed (not yet reserved)
    owner: '',              // selected client-side person name
    submitting: false,
    // Toggles default for a fresh job: not with client, status = Incoming
    withClient: false,
    incoming: true,
};

const SETUP_WORKER_URL = 'https://dot-workers.up.railway.app/setup';

const NJ_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
                   'July', 'August', 'September', 'October', 'November', 'December'];
const NJ_LIVE_OPTIONS = ['TBC', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                         'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// ===== DOM HELPERS =====
function $nj(id) { return document.getElementById(id); }

function njEscapeHtml(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function njAutoGrow(el) {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
}

function njFormatDueLabel(iso) {
    if (!iso) return 'Set due';
    try {
        const d = new Date(iso + 'T00:00:00');
        const day = d.getDate();
        const month = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()];
        return `Due ${day} ${month}`;
    } catch (e) {
        return 'Set due';
    }
}

function njGetWorkingDaysFromNow(days) {
    const date = new Date();
    let added = 0;
    while (added < days) {
        date.setDate(date.getDate() + 1);
        const dayOfWeek = date.getDay();
        if (dayOfWeek !== 0 && dayOfWeek !== 6) added++;
    }
    return date.toISOString().split('T')[0];
}

function njCurrentMonthName() {
    return NJ_MONTHS[new Date().getMonth()];
}

// ===== LISTENERS (one-time setup) =====
function wireNewJobModalListeners() {
    const overlay = $nj('new-job-modal-overlay');
    if (!overlay || overlay.dataset.listenersAttached) return;
    overlay.dataset.listenersAttached = 'true';

    // Close on overlay click (only outside the shell)
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeNewJobModal();
    });

    // ESC to close
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && newJobModalState.open) closeNewJobModal();
    });

    // X button
    $nj('new-job-modal-close')?.addEventListener('click', closeNewJobModal);

    // Mobile scroll lid — fade in shadow on populated header when content scrolls under
    const njPop = $nj('new-job-populated');
    if (njPop) njPop.addEventListener('scroll', () => {
        njPop.classList.toggle('is-scrolled', njPop.scrollTop > 0);
    }, { passive: true });

    // Hero input — basic typing handler, no extra logic needed
    $nj('new-job-hero-input')?.addEventListener('input', (e) => {
        e.target.classList.remove('input-error');
    });

    // Description / notes — auto-grow
    $nj('new-job-description-input')?.addEventListener('input', (e) => njAutoGrow(e.target));
    $nj('new-job-notes-input')?.addEventListener('input', (e) => njAutoGrow(e.target));

    // Owner trigger — opens dropdown
    $nj('new-job-owner-trigger')?.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleNjDropdown('owner');
    });

    // Owner menu — pick option (delegated)
    $nj('new-job-owner-menu')?.addEventListener('click', (e) => {
        const opt = e.target.closest('.custom-dropdown-option');
        if (!opt) return;
        const value = opt.dataset.value || '';
        newJobModalState.owner = value;
        const trigger = $nj('new-job-owner-trigger');
        const label   = $nj('new-job-owner-label');
        if (label) label.textContent = value || 'Choose project owner...';
        if (trigger) trigger.classList.toggle('empty', !value);
        closeAllNjDropdowns();
    });

    // Due chip → opens native date picker
    $nj('new-job-due-chip')?.addEventListener('click', () => {
        const input = $nj('new-job-due-input');
        if (!input) return;
        if (typeof input.showPicker === 'function') input.showPicker();
        else input.click();
    });
    $nj('new-job-due-input')?.addEventListener('change', (e) => {
        const label = $nj('new-job-due-label');
        const chip  = $nj('new-job-due-chip');
        if (e.target.value) {
            label.textContent = njFormatDueLabel(e.target.value);
            chip.classList.remove('empty');
        } else {
            label.textContent = 'Set due';
            chip.classList.add('empty');
        }
    });

    // Live chip — open dropdown
    $nj('new-job-live-chip')?.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleNjDropdown('live');
    });
    $nj('new-job-live-menu')?.addEventListener('click', (e) => {
        const opt = e.target.closest('.custom-dropdown-option');
        if (!opt) return;
        const value = opt.dataset.value;
        $nj('new-job-live-label').textContent = `Live · ${value}`;
        $nj('new-job-live-chip').classList.toggle('empty', value === 'TBC');
        closeAllNjDropdowns();
    });

    // Month chip — open dropdown
    $nj('new-job-month-chip')?.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleNjDropdown('month');
    });
    $nj('new-job-month-menu')?.addEventListener('click', (e) => {
        const opt = e.target.closest('.custom-dropdown-option');
        if (!opt) return;
        $nj('new-job-month-label').textContent = opt.dataset.value;
        closeAllNjDropdowns();
    });

    // Spend pill — click focuses input
    $nj('new-job-spend-amount')?.addEventListener('click', () => {
        $nj('new-job-spend-input')?.focus();
    });
    $nj('new-job-spend-input')?.addEventListener('input', (e) => {
        const raw = e.target.value.replace(/,/g, '').replace(/[^0-9]/g, '');
        e.target.value = raw ? parseInt(raw, 10).toLocaleString() : '';
        $nj('new-job-spend-amount').classList.toggle('empty', !raw || raw === '0');
    });

    // Ballpark tick
    $nj('new-job-ballpark')?.addEventListener('click', () => {
        $nj('new-job-ballpark').classList.toggle('on');
    });

    // With Client toggle
    $nj('new-job-with-client')?.addEventListener('click', () => {
        newJobModalState.withClient = !newJobModalState.withClient;
        $nj('new-job-with-client')?.classList.toggle('on', newJobModalState.withClient);
        $nj('new-job-with-client-toggle')?.classList.toggle('on', newJobModalState.withClient);
    });

    // Incoming toggle (ON = Incoming, OFF = In Progress)
    $nj('new-job-incoming')?.addEventListener('click', () => {
        newJobModalState.incoming = !newJobModalState.incoming;
        $nj('new-job-incoming')?.classList.toggle('on', newJobModalState.incoming);
        $nj('new-job-incoming-toggle')?.classList.toggle('on', newJobModalState.incoming);
    });

    // Submit
    $nj('new-job-submit')?.addEventListener('click', submitNewJob);
}

// ===== DROPDOWN HELPERS =====
const NJ_DROPDOWN_CONFIG = {
    owner: { btnId: 'new-job-owner-trigger', menuId: 'new-job-owner-menu' },
    live:  { btnId: 'new-job-live-chip',     menuId: 'new-job-live-menu'  },
    month: { btnId: 'new-job-month-chip',    menuId: 'new-job-month-menu' },
};

function closeAllNjDropdowns() {
    Object.values(NJ_DROPDOWN_CONFIG).forEach(({ btnId, menuId }) => {
        $nj(btnId)?.classList.remove('open');
        $nj(menuId)?.classList.remove('open');
    });
}

function toggleNjDropdown(name) {
    const cfg = NJ_DROPDOWN_CONFIG[name];
    if (!cfg) return;
    const btn  = $nj(cfg.btnId);
    const menu = $nj(cfg.menuId);
    if (!btn || !menu) return;
    const willOpen = !menu.classList.contains('open');
    closeAllNjDropdowns();
    if (willOpen) {
        btn.classList.add('open');
        menu.classList.add('open');
    }
}

// ===== OPEN / CLOSE =====
async function openNewJobModal() {
    const overlay = $nj('new-job-modal-overlay');
    if (!overlay) {
        console.warn('[new-job-modal] overlay element missing');
        return;
    }

    resetNewJobState();

    // Hard-reset view display so first-open skips the swap animation
    const pickerEl    = $nj('new-job-picker');
    const populatedEl = $nj('new-job-populated');
    if (pickerEl)    pickerEl.style.display    = 'block';
    if (populatedEl) populatedEl.style.display = 'none';

    // Mount the client picker fresh — singleton may have been destroyed by
    // another modal. Filter 'all' = every client, top-clients first then a-z.
    const clientsContainer = $nj('new-job-picker-clients');
    if (clientsContainer && window.clientPicker) {
        window.clientPicker.mount(clientsContainer, {
            title: "Who's it for?",
            filter: 'all',
            onPick: (code) => onClientPicked(code),
        });
        window.clientPicker.refresh();
    }

    overlay.classList.add('visible');
    newJobModalState.open = true;
    document.body.style.overflow = 'hidden';
}

function closeNewJobModal() {
    closeAllNjDropdowns();
    const overlay = $nj('new-job-modal-overlay');
    overlay?.classList.remove('visible');
    newJobModalState.open = false;
    document.body.style.overflow = '';
}

function resetNewJobState() {
    newJobModalState.view = 'picker';
    newJobModalState.clientCode = null;
    newJobModalState.clientName = null;
    newJobModalState.jobNumber = null;
    newJobModalState.owner = '';
    newJobModalState.submitting = false;
    newJobModalState.withClient = false;
    newJobModalState.incoming = true;

    // Inputs
    const hero = $nj('new-job-hero-input');
    if (hero) {
        hero.value = '';
        hero.classList.remove('input-error');
    }
    const desc = $nj('new-job-description-input');
    if (desc) {
        desc.value = '';
        desc.style.height = 'auto';
    }
    const notes = $nj('new-job-notes-input');
    if (notes) {
        notes.value = '';
        notes.style.height = 'auto';
    }

    // Header
    const logo = $nj('new-job-header-logo');
    if (logo) logo.src = 'images/logos/Unknown.png';
    const meta = $nj('new-job-meta');
    if (meta) meta.textContent = '';

    // Owner
    const ownerLabel = $nj('new-job-owner-label');
    if (ownerLabel) ownerLabel.textContent = 'Choose project owner...';
    const ownerTrigger = $nj('new-job-owner-trigger');
    if (ownerTrigger) ownerTrigger.classList.add('empty');
    const ownerMenu = $nj('new-job-owner-menu');
    if (ownerMenu) ownerMenu.innerHTML = '';

    // Due — default to +5 working days
    const dueIso = njGetWorkingDaysFromNow(5);
    const dueInput = $nj('new-job-due-input');
    if (dueInput) dueInput.value = dueIso;
    const dueLabel = $nj('new-job-due-label');
    const dueChip  = $nj('new-job-due-chip');
    if (dueLabel) dueLabel.textContent = njFormatDueLabel(dueIso);
    if (dueChip)  dueChip.classList.remove('empty');

    // Live — TBC default
    $nj('new-job-live-label').textContent = 'Live · TBC';
    $nj('new-job-live-chip').classList.add('empty');
    populateNjLiveMenu();

    // Tracker — $5,000 + Ballpark on + current month
    const spendInput = $nj('new-job-spend-input');
    if (spendInput) spendInput.value = '5,000';
    $nj('new-job-spend-amount').classList.remove('empty');
    $nj('new-job-month-label').textContent = njCurrentMonthName();
    populateNjMonthMenu();
    $nj('new-job-ballpark').classList.add('on');

    // Toggles
    $nj('new-job-with-client')?.classList.remove('on');
    $nj('new-job-with-client-toggle')?.classList.remove('on');
    $nj('new-job-incoming')?.classList.add('on');
    $nj('new-job-incoming-toggle')?.classList.add('on');

    // Submit button
    const submit = $nj('new-job-submit');
    if (submit) {
        submit.disabled = false;
        submit.textContent = 'CREATE JOB';
    }
}

function populateNjLiveMenu() {
    const menu = $nj('new-job-live-menu');
    if (!menu) return;
    menu.innerHTML = NJ_LIVE_OPTIONS.map(v =>
        `<div class="custom-dropdown-option" data-value="${njEscapeHtml(v)}">${njEscapeHtml(v)}</div>`
    ).join('');
}

function populateNjMonthMenu() {
    const menu = $nj('new-job-month-menu');
    if (!menu) return;
    menu.innerHTML = NJ_MONTHS.map(m =>
        `<div class="custom-dropdown-option" data-value="${njEscapeHtml(m)}">${njEscapeHtml(m)}</div>`
    ).join('');
}

// ===== CLIENT PICKED =====
async function onClientPicked(code) {
    if (!code) return;

    // Resolve client name from cache (clientPicker stores it on window._updateModalClientsCache)
    const cache = (typeof window.clientPicker?.getClients === 'function')
        ? window.clientPicker.getClients()
        : (Array.isArray(window._updateModalClientsCache) ? window._updateModalClientsCache : []);
    const clientObj = cache.find(c => c.code === code);
    const clientName = clientObj?.name || code;

    newJobModalState.clientCode = code;
    newJobModalState.clientName = clientName;

    // Header — logo + meta line (job number gets filled in once previewed)
    const logo = $nj('new-job-header-logo');
    if (logo) {
        const url = (typeof getLogoUrl === 'function') ? getLogoUrl(code) : `images/logos/${code}.png`;
        logo.src = url;
        logo.alt = code;
        logo.onerror = () => { logo.src = 'images/logos/Unknown.png'; };
    }
    const meta = $nj('new-job-meta');
    if (meta) meta.textContent = `${code} ···`;

    // Switch view first so the user sees motion
    showNewJobView('populated');

    // Focus the hero input so the user can start typing the job name
    setTimeout(() => $nj('new-job-hero-input')?.focus(), 60);

    // Kick off parallel fetches: previewed job number + people for this client
    fetchPreviewJobNumber(code);
    fetchOwnersForClient(code);
}

async function fetchPreviewJobNumber(code) {
    try {
        const res = await fetch(`${API_BASE}/preview-job-number/${code}`);
        const data = await res.json();
        if (data.error) {
            console.error('[new-job-modal] preview error:', data.error);
            return;
        }
        newJobModalState.jobNumber = data.previewJobNumber;
        const meta = $nj('new-job-meta');
        if (meta) meta.textContent = data.previewJobNumber;
    } catch (err) {
        console.error('[new-job-modal] preview fetch failed:', err);
        const meta = $nj('new-job-meta');
        if (meta) meta.textContent = `${newJobModalState.clientCode} —`;
    }
}

async function fetchOwnersForClient(code) {
    const menu = $nj('new-job-owner-menu');
    if (!menu) return;
    menu.innerHTML = '<div class="custom-dropdown-option" data-value="">Loading...</div>';
    try {
        const res = await fetch(`${API_BASE}/people/${code}`);
        const people = await res.json();
        const rows = [
            `<div class="custom-dropdown-option" data-value="">— None —</div>`,
            ...(Array.isArray(people) ? people : []).map(p => {
                const name = njEscapeHtml(p.name || '');
                return `<div class="custom-dropdown-option" data-value="${name}">${name}</div>`;
            })
        ];
        menu.innerHTML = rows.join('');
    } catch (err) {
        console.error('[new-job-modal] owner fetch failed:', err);
        menu.innerHTML = '<div class="custom-dropdown-option" data-value="">Failed to load</div>';
    }
}

// ===== VIEW SWITCHING =====
function showNewJobView(view) {
    const picker    = $nj('new-job-picker');
    const populated = $nj('new-job-populated');
    if (!picker || !populated) return;

    newJobModalState.view = view;

    if (view === 'populated') {
        picker.style.display = 'none';
        populated.style.display = 'block';
    } else {
        picker.style.display = 'block';
        populated.style.display = 'none';
    }
}

// ===== SUBMIT =====
async function submitNewJob() {
    if (newJobModalState.submitting) return;

    // Validate job name
    const heroInput = $nj('new-job-hero-input');
    const jobName = (heroInput?.value || '').trim();
    if (!jobName) {
        heroInput?.classList.add('input-error');
        heroInput?.focus();
        setTimeout(() => heroInput?.classList.remove('input-error'), 2000);
        return;
    }

    // Validate client (defensive — picker flow guarantees this is set)
    if (!newJobModalState.clientCode) {
        if (typeof showToast === 'function') showToast('No client selected.', 'error');
        return;
    }

    const submitBtn = $nj('new-job-submit');
    newJobModalState.submitting = true;
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'CREATING...';
    }

    if (typeof showToast === 'function') showToast('Setting up job...', 'info');

    // Read form values
    const description = $nj('new-job-description-input').value.trim();
    const ownerValue  = newJobModalState.owner;

    const dueIso = $nj('new-job-due-input').value || null;

    const liveLabel = $nj('new-job-live-label').textContent.replace('Live · ', '').trim();
    const liveValue = liveLabel === 'TBC' ? 'Tbc' : liveLabel;

    const monthValue = $nj('new-job-month-label').textContent.trim();

    const spendRaw = $nj('new-job-spend-input').value.replace(/,/g, '').replace(/[^0-9]/g, '');
    const spendNum = spendRaw ? parseInt(spendRaw, 10) : 5000;

    const ballparkOn = $nj('new-job-ballpark').classList.contains('on');
    const trackerNotes = $nj('new-job-notes-input').value.trim();

    const status = newJobModalState.incoming ? 'Incoming' : 'In Progress';

    // Build brief — extends the legacy shape with status/withClient/spend/ballpark/month/trackerNotes.
    // Setup worker schema is back-compat: missing fields fall through to today's defaults.
    const brief = {
        jobName: jobName,
        theJob: description || null,
        owner: ownerValue || null,
        costs: spendNum ? `$${spendNum.toLocaleString()}` : null,  // legacy field, kept for back-compat
        when: liveValue || null,
        updateDue: dueIso,
        // New fields (require the patched setup worker — handler.py v2):
        status: status,
        withClient: newJobModalState.withClient,
        spend: spendNum,
        ballpark: ballparkOn,
        month: monthValue,
        trackerNotes: trackerNotes || null,
    };

    const payload = {
        clientCode: newJobModalState.clientCode,
        clientName: newJobModalState.clientName,
        senderEmail: `${state.currentUser?.name?.toLowerCase() || 'hub'}@hunch.co.nz`,
        senderName:  state.currentUser?.fullName || state.currentUser?.name || 'Hub User',
        subjectLine: `New job: ${jobName}`,
        brief: brief,
    };

    try {
        const res = await fetch(SETUP_WORKER_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        const data = await res.json();

        if (!data.success) {
            const msg = data.error || 'Unknown error';
            console.error('[new-job-modal] setup failed:', msg);
            if (typeof showToast === 'function') showToast(`Couldn't create job: ${msg}`, 'error');
            newJobModalState.submitting = false;
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.textContent = 'CREATE JOB';
            }
            return;
        }

        const createdJobNumber = data.jobNumber || newJobModalState.jobNumber || '';

        // Refresh jobs (and tracker if visible) — don't let this fail the close.
        try {
            if (typeof window.refreshAfterMutation === 'function') {
                await window.refreshAfterMutation(['jobs', 'tracker']);
            } else if (typeof loadJobs === 'function') {
                await loadJobs();
            }
        } catch (refreshErr) {
            console.warn('[new-job-modal] post-create refresh failed:', refreshErr);
        }

        if (typeof showToast === 'function') {
            showToast(`Job created: ${createdJobNumber}`, 'success');
        }
        closeNewJobModal();

    } catch (err) {
        console.error('[new-job-modal] submit failed:', err);
        if (typeof showToast === 'function') showToast("Doh, that didn't work.", 'error');
        newJobModalState.submitting = false;
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = 'CREATE JOB';
        }
    }
}

// ===== EXPOSE TO WINDOW =====
window.openNewJobModal  = openNewJobModal;
window.closeNewJobModal = closeNewJobModal;
