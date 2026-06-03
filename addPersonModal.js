// ===== ADD PERSON MODAL =====
// Settings → Add a person. Also opened from the Update modal's owner dropdown
// ("+ Add someone new") and via the ?open=add-person deep link.
// Creates a People record via POST /api/people.
// Depends on: API_BASE, showToast (app.js). Exposes: openAddPersonModal,
// closeAddPersonModal, invalidateUmTeamCache hook (window).

(function setupAddPersonModal() {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', wireAddPersonListeners);
    } else {
        wireAddPersonListeners();
    }
})();

const ACCESS_OPTIONS = ['Full', 'Client Tracker', 'Client WIP'];

const addPersonState = {
    open: false,
    submitting: false,
    clientCode: null,     // chosen client code (client-access only)
    clientsLoaded: false,
};

function $ap(id) { return document.getElementById(id); }

function wireAddPersonListeners() {
    const overlay = $ap('add-person-overlay');
    if (!overlay || overlay.dataset.listenersAttached) return;
    overlay.dataset.listenersAttached = 'true';

    // Settings row → open
    $ap('settings-add-person')?.addEventListener('click', openAddPersonModal);

    // Close / cancel / overlay / ESC
    $ap('add-person-close')?.addEventListener('click', closeAddPersonModal);
    $ap('add-person-cancel')?.addEventListener('click', closeAddPersonModal);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeAddPersonModal(); });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && addPersonState.open) closeAddPersonModal();
    });

    // Access dropdown
    $ap('add-person-access-chip')?.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleApDropdown('access');
    });
    $ap('add-person-access-menu')?.addEventListener('click', (e) => {
        const opt = e.target.closest('.custom-dropdown-option');
        if (!opt) return;
        const value = opt.dataset.value;
        $ap('add-person-access-label').textContent = value;
        closeApDropdowns();
        // Reveal the client field only for client-access people
        const clientField = $ap('add-person-client-field');
        if (value === 'Full') {
            clientField.hidden = true;
        } else {
            clientField.hidden = false;
            ensureClientsLoaded();
        }
    });

    // Client dropdown
    $ap('add-person-client-chip')?.addEventListener('click', (e) => {
        e.stopPropagation();
        ensureClientsLoaded().then(() => toggleApDropdown('client'));
    });
    $ap('add-person-client-menu')?.addEventListener('click', (e) => {
        const opt = e.target.closest('.custom-dropdown-option');
        if (!opt) return;
        addPersonState.clientCode = opt.dataset.value;
        $ap('add-person-client-label').textContent = opt.dataset.label || opt.dataset.value;
        closeApDropdowns();
    });

    // Outside click closes any open dropdown
    document.addEventListener('click', (e) => {
        if (!addPersonState.open) return;
        if (e.target.closest('.add-person-dropdown')) return;
        closeApDropdowns();
    });

    // Save
    $ap('add-person-save')?.addEventListener('click', submitAddPerson);
}

function openAddPersonModal() {
    const overlay = $ap('add-person-overlay');
    if (!overlay) return;
    resetAddPersonForm();
    overlay.classList.add('visible');
    addPersonState.open = true;
    document.body.style.overflow = 'hidden';
    setTimeout(() => $ap('add-person-first')?.focus(), 60);
}

function closeAddPersonModal() {
    closeApDropdowns();
    $ap('add-person-overlay')?.classList.remove('visible');
    addPersonState.open = false;
    document.body.style.overflow = '';
}

function resetAddPersonForm() {
    addPersonState.clientCode = null;
    ['add-person-first', 'add-person-last', 'add-person-email'].forEach(id => {
        const el = $ap(id); if (el) el.value = '';
    });
    $ap('add-person-access-label').textContent = 'Full';
    $ap('add-person-client-label').textContent = 'Choose client';
    const clientField = $ap('add-person-client-field');
    if (clientField) clientField.hidden = true;
}

// ===== DROPDOWNS =====
const AP_DROPDOWN_CONFIG = {
    access: { btnId: 'add-person-access-chip', menuId: 'add-person-access-menu' },
    client: { btnId: 'add-person-client-chip', menuId: 'add-person-client-menu' },
};

function toggleApDropdown(which) {
    const cfg = AP_DROPDOWN_CONFIG[which];
    if (!cfg) return;
    const btn = $ap(cfg.btnId);
    const menu = $ap(cfg.menuId);
    if (!btn || !menu) return;
    const wasOpen = menu.classList.contains('open');
    closeApDropdowns();
    if (!wasOpen) {
        renderApDropdownOptions(which);
        btn.classList.add('open');
        menu.classList.add('open');
    }
}

function closeApDropdowns() {
    Object.values(AP_DROPDOWN_CONFIG).forEach(cfg => {
        $ap(cfg.btnId)?.classList.remove('open');
        $ap(cfg.menuId)?.classList.remove('open');
    });
}

function renderApDropdownOptions(which) {
    if (which === 'access') {
        const menu = $ap('add-person-access-menu');
        const current = $ap('add-person-access-label').textContent.trim();
        menu.innerHTML = ACCESS_OPTIONS.map(opt => {
            const sel = opt === current ? ' selected' : '';
            return `<div class="custom-dropdown-option${sel}" data-value="${apEsc(opt)}">${apEsc(opt)}</div>`;
        }).join('');
    } else if (which === 'client') {
        const menu = $ap('add-person-client-menu');
        const clients = Array.isArray(window._addPersonClientsCache) ? window._addPersonClientsCache : [];
        const current = addPersonState.clientCode;
        menu.innerHTML = clients.map(c => {
            const sel = c.code === current ? ' selected' : '';
            return `<div class="custom-dropdown-option${sel}" data-value="${apEsc(c.code)}" data-label="${apEsc(c.name || c.code)}">${apEsc(c.name || c.code)}</div>`;
        }).join('');
    }
}

async function ensureClientsLoaded() {
    if (addPersonState.clientsLoaded && Array.isArray(window._addPersonClientsCache)) return;
    try {
        const res = await fetch(`${API_BASE}/clients`);
        window._addPersonClientsCache = res.ok ? await res.json() : [];
        addPersonState.clientsLoaded = true;
    } catch (err) {
        console.warn('[add-person] clients fetch failed:', err);
        window._addPersonClientsCache = [];
    }
}

// ===== SUBMIT =====
async function submitAddPerson() {
    if (addPersonState.submitting) return;

    const first = ($ap('add-person-first')?.value || '').trim();
    const last = ($ap('add-person-last')?.value || '').trim();
    const email = ($ap('add-person-email')?.value || '').trim();
    const access = ($ap('add-person-access-label')?.textContent || 'Full').trim();
    const clientCode = access === 'Full' ? '' : (addPersonState.clientCode || '');

    if (!first && !last) {
        if (typeof showToast === 'function') showToast('Add a name.', 'error');
        return;
    }
    if (!email) {
        if (typeof showToast === 'function') showToast('Add an email.', 'error');
        return;
    }

    const saveBtn = $ap('add-person-save');
    addPersonState.submitting = true;
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'ADDING…'; }

    try {
        const res = await fetch(`${API_BASE}/people`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ firstName: first, lastName: last, email, access, clientCode }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            const msg = data.error === 'A person with that email already exists'
                ? 'That email already exists.'
                : "Doh, that didn't save.";
            if (typeof showToast === 'function') showToast(msg, 'error');
            return;
        }

        // New team member — drop the Update modal's cached team list so they show up
        if (typeof window.invalidateUmTeamCache === 'function') window.invalidateUmTeamCache();

        closeAddPersonModal();
        if (typeof showToast === 'function') showToast(`Added ${data.name || first}.`, 'success');
    } catch (err) {
        console.error('[add-person] submit failed:', err);
        if (typeof showToast === 'function') showToast("Doh, that didn't save.", 'error');
    } finally {
        addPersonState.submitting = false;
        if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'ADD PERSON'; }
    }
}

function apEsc(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Expose for the owner dropdown + deep link
window.openAddPersonModal = openAddPersonModal;
window.closeAddPersonModal = closeAddPersonModal;
