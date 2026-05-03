// ===== CLIENT PICKER MODULE =====
// Standalone client picker — mounts into a caller-supplied container.
// Renders its own markup (title + list of client rows), handles its own clicks.
// Used by Update modal (Phase B) and New Job modal (Phase F).
//
// Depends on (window globals): API_BASE, state, getLogoUrl
// Reads/writes: window._updateModalClientsCache (shared cache, kept as-is)
// Exposes: window.clientPicker = { mount, refresh, getClients, destroy }

(function () {
    'use strict';

    // ===== LOCAL HELPERS (duplicated to avoid load-order coupling) =====

    function escapeHtml(str) {
        return String(str ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }
    function escapeAttr(str) { return escapeHtml(str); }

    // daysSinceUpdate may be a number, '-' or null. Non-numeric → sort to bottom.
    function clientRecencyValue(v) {
        const n = Number(v);
        return Number.isFinite(n) ? n : Infinity;
    }

    // ===== PICKER INSTANCE STATE =====
    // One module-level instance is fine — Update modal mounts once per page.
    // (If New Job modal in Phase F mounts a second instance, we'll revisit
    //  to support multiple instances. For now: single-instance is simpler.)
    let mounted = false;
    let containerEl = null;
    let listEl = null;
    let onPickFn = null;
    let clickHandler = null;

    // ===== MOUNT =====
    function mount(container, opts = {}) {
        if (!container) {
            console.warn('[client-picker] mount: container missing');
            return;
        }
        if (mounted) destroy();

        containerEl = container;
        onPickFn = opts.onPick || (() => {});
        const title = opts.title || 'Choose a client';

        containerEl.innerHTML = `
          <h2 class="update-modal-picker-title">${escapeHtml(title)}</h2>
          <div class="update-modal-picker-list" data-client-picker-list></div>
        `;
        listEl = containerEl.querySelector('[data-client-picker-list]');

        // Event delegation — one listener for all rows
        clickHandler = (e) => {
            const row = e.target.closest('.modal-row');
            if (!row || !listEl.contains(row)) return;
            const code = row.dataset.code;
            if (code) onPickFn(code);
        };
        listEl.addEventListener('click', clickHandler);

        mounted = true;
    }

    // ===== REFRESH =====
    // Re-fetch /api/clients, filter to clients with active jobs, render.
    async function refresh() {
        if (!mounted || !listEl) {
            console.warn('[client-picker] refresh: not mounted');
            return;
        }

        listEl.innerHTML = '<div class="update-modal-picker-empty">Loading clients…</div>';

        let clients = [];
        try {
            const res = await fetch(`${API_BASE}/clients`);
            if (!res.ok) throw new Error('Failed to fetch clients');
            clients = await res.json();
            // Cache for resolveClientName() in updateModal.js — used by hot-entry meta line.
            // Kept as a window global (may be used by other lists in the future).
            window._updateModalClientsCache = clients;
        } catch (e) {
            console.error('[client-picker] client fetch failed:', e);
            listEl.innerHTML = '<div class="update-modal-picker-empty">Could not load clients.</div>';
            return;
        }

        if (!Array.isArray(clients) || clients.length === 0) {
            listEl.innerHTML = '<div class="update-modal-picker-empty">No clients found.</div>';
            return;
        }

        // Filter to clients that have at least one active job, ordered by recency
        // (smallest daysSinceUpdate across the client's jobs = most recently touched).
        const allJobs = (typeof state !== 'undefined' && state.allJobs) ? state.allJobs : [];
        const recencyByClient = {};
        for (const j of allJobs) {
            const code = j.clientCode;
            if (!code) continue;
            const days = clientRecencyValue(j.daysSinceUpdate);
            if (recencyByClient[code] === undefined || days < recencyByClient[code]) {
                recencyByClient[code] = days;
            }
        }

        const visible = clients
            .filter(c => recencyByClient[c.code] !== undefined)
            .sort((a, b) => recencyByClient[a.code] - recencyByClient[b.code]);

        if (visible.length === 0) {
            listEl.innerHTML = '<div class="update-modal-picker-empty">No active jobs to update.</div>';
            return;
        }

        listEl.innerHTML = visible.map(c => {
            const code = escapeAttr(c.code || '');
            const name = escapeHtml(c.name || c.code || '');
            const logoUrl = (typeof getLogoUrl === 'function')
                ? getLogoUrl(c.code)
                : `images/logos/${c.code}.png`;
            return `
              <button class="modal-row" data-code="${code}">
                <img class="modal-row-logo" src="${escapeAttr(logoUrl)}" alt="${code}" onerror="this.src='images/logos/Unknown.png'">
                <div class="modal-row-content">
                  <div class="modal-row-kicker">${code}</div>
                  <div class="modal-row-name">${name}</div>
                </div>
              </button>
            `;
        }).join('');
    }

    // ===== GET CLIENTS =====
    // Return the cached clients array (for callers who need to look up names etc).
    // Reads the same global as before — no behaviour change.
    function getClients() {
        return Array.isArray(window._updateModalClientsCache)
            ? window._updateModalClientsCache
            : [];
    }

    // ===== DESTROY =====
    function destroy() {
        if (!mounted) return;
        if (listEl && clickHandler) {
            listEl.removeEventListener('click', clickHandler);
        }
        if (containerEl) containerEl.innerHTML = '';
        mounted = false;
        containerEl = null;
        listEl = null;
        onPickFn = null;
        clickHandler = null;
    }

    // ===== EXPOSE TO WINDOW =====
    window.clientPicker = { mount, refresh, getClients, destroy };
})();
