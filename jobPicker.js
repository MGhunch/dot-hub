// ===== JOB PICKER MODULE =====
// Standalone job picker — mounts into a caller-supplied container.
// Renders its own markup (back button + title + list of job rows), handles its own clicks.
// Used by Update modal (Phase B). Update-modal-only for now.
//
// The picker is given a clientCode (and optional statusFilter) via setClient(),
// then renders matching jobs from state.allJobs. Caller decides when to mount and
// when to swap to/from this picker (stage transitions are caller-owned).
//
// Depends on (window globals): state, getLogoUrl
// Exposes: window.jobPicker = { mount, setClient, destroy }

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

    function clientRecencyValue(v) {
        const n = Number(v);
        return Number.isFinite(n) ? n : Infinity;
    }

    // "ONB-094" → "ONB 094"
    function formatJobDisplay(jobNumber) {
        if (!jobNumber) return '';
        return String(jobNumber).replace('-', ' ');
    }

    // "a/an" picker for status titles. "Choose an On Hold job" / "Choose a Completed job"
    function statusIndefiniteArticle(status) {
        return /^[aeiouAEIOU]/.test(status || '') ? 'an' : 'a';
    }

    // ===== PICKER INSTANCE STATE =====
    // Single-instance for now (matches clientPicker pattern).
    let mounted = false;
    let containerEl = null;
    let titleEl = null;
    let listEl = null;
    let backEl = null;
    let onPickFn = null;
    let onBackFn = null;
    let listClickHandler = null;
    let backClickHandler = null;
    let defaultTitle = 'Choose a job';

    // ===== MOUNT =====
    function mount(container, opts = {}) {
        if (!container) {
            console.warn('[job-picker] mount: container missing');
            return;
        }
        if (mounted) destroy();

        containerEl = container;
        onPickFn = opts.onPick || (() => {});
        onBackFn = opts.onBack || (() => {});
        defaultTitle = opts.defaultTitle || 'Choose a job';

        containerEl.innerHTML = `
          <button class="update-modal-picker-back" data-job-picker-back>← back</button>
          <h2 class="update-modal-picker-title" data-job-picker-title>${escapeHtml(defaultTitle)}</h2>
          <div class="update-modal-picker-list" data-job-picker-list></div>
        `;
        backEl  = containerEl.querySelector('[data-job-picker-back]');
        titleEl = containerEl.querySelector('[data-job-picker-title]');
        listEl  = containerEl.querySelector('[data-job-picker-list]');

        // Back button
        backClickHandler = () => onBackFn();
        backEl.addEventListener('click', backClickHandler);

        // Job rows — event delegation
        listClickHandler = (e) => {
            const row = e.target.closest('.modal-row');
            if (!row || !listEl.contains(row)) return;
            const jobNumber = row.dataset.jobNumber;
            if (jobNumber) onPickFn(jobNumber);
        };
        listEl.addEventListener('click', listClickHandler);

        mounted = true;
    }

    // ===== SET CLIENT =====
    // Set the active client and (optionally) status filter, then re-render.
    // Title flips to "Choose a/an [status] job" when statusFilter is set.
    function setClient(clientCode, opts = {}) {
        if (!mounted || !listEl) {
            console.warn('[job-picker] setClient: not mounted');
            return;
        }
        const statusFilter = opts.statusFilter || null;

        // Update title
        if (titleEl) {
            titleEl.textContent = statusFilter
                ? `Choose ${statusIndefiniteArticle(statusFilter)} ${statusFilter} job`
                : defaultTitle;
        }

        // Filter + sort jobs
        const allJobs = (typeof state !== 'undefined' && state.allJobs) ? state.allJobs : [];
        const jobs = allJobs
            .filter(j => j.clientCode === clientCode)
            .filter(j => statusFilter ? j.status === statusFilter : true)
            .sort((a, b) => clientRecencyValue(a.daysSinceUpdate) - clientRecencyValue(b.daysSinceUpdate));

        if (jobs.length === 0) {
            listEl.innerHTML = '<div class="update-modal-picker-empty">No jobs to update.</div>';
            return;
        }

        const logoUrl = (typeof getLogoUrl === 'function')
            ? getLogoUrl(clientCode)
            : `images/logos/${clientCode}.png`;

        listEl.innerHTML = jobs.map(j => {
            const num = escapeAttr(j.jobNumber || '');
            const display = escapeHtml(formatJobDisplay(j.jobNumber));
            const name = escapeHtml(j.jobName || '');
            return `
              <button class="modal-row" data-job-number="${num}">
                <img class="modal-row-logo" src="${escapeAttr(logoUrl)}" alt="${escapeAttr(clientCode)}" onerror="this.src='images/logos/Unknown.png'">
                <div class="modal-row-content">
                  <div class="modal-row-kicker">${display}</div>
                  <div class="modal-row-name">${name}</div>
                </div>
              </button>
            `;
        }).join('');
    }

    // ===== DESTROY =====
    function destroy() {
        if (!mounted) return;
        if (backEl && backClickHandler) backEl.removeEventListener('click', backClickHandler);
        if (listEl && listClickHandler) listEl.removeEventListener('click', listClickHandler);
        if (containerEl) containerEl.innerHTML = '';
        mounted = false;
        containerEl = null;
        titleEl = null;
        listEl = null;
        backEl = null;
        onPickFn = null;
        onBackFn = null;
        listClickHandler = null;
        backClickHandler = null;
    }

    // ===== EXPOSE TO WINDOW =====
    window.jobPicker = { mount, setClient, destroy };
})();
