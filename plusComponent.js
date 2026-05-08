// ===== PLUS COMPONENT MODULE =====
// Floating dock pinned to bottom-left (desktop) / bottom-centre (phone) of every page.
// Owns the FAB and its three-action menu.
// Depends on: openNewJobModal (newJobModal.js), openUpdateModal (updateModal.js), showComingSoonModal (app.js)
// Exposes: openPlusMenu, closePlusMenu, togglePlusMenu (window globals)

(function setupPlusComponent() {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', wirePlusComponent);
    } else {
        wirePlusComponent();
    }
})();

function wirePlusComponent() {
    const dock = document.getElementById('plus-dock');
    const button = document.getElementById('plus-button');
    const backdrop = document.getElementById('plus-backdrop');
    const menu = document.getElementById('plus-actions');

    if (!dock || !button || !backdrop || !menu) {
        console.warn('[plus] missing markup — dock/button/backdrop/menu not found');
        return;
    }

    // FAB toggles the menu
    button.addEventListener('click', (e) => {
        e.stopPropagation();
        togglePlusMenu();
    });

    // Backdrop click closes the menu
    backdrop.addEventListener('click', () => {
        closePlusMenu();
    });

    // Pill clicks: close menu, then fire action
    menu.addEventListener('click', (e) => {
        const pill = e.target.closest('.plus-pill');
        if (!pill) return;
        const action = pill.dataset.action;
        closePlusMenu();
        // Defer action so close animation can start before any modal opens
        setTimeout(() => firePlusAction(action), 50);
    });

    // ESC closes the menu
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && dock.classList.contains('open')) {
            closePlusMenu();
        }
    });
}

function togglePlusMenu() {
    const dock = document.getElementById('plus-dock');
    if (!dock) return;
    if (dock.classList.contains('open')) {
        closePlusMenu();
    } else {
        openPlusMenu();
    }
}

function openPlusMenu() {
    const dock = document.getElementById('plus-dock');
    const backdrop = document.getElementById('plus-backdrop');
    const button = document.getElementById('plus-button');
    if (!dock || !backdrop) return;
    dock.classList.add('open');
    backdrop.classList.add('open');
    button?.setAttribute('aria-expanded', 'true');
}

function closePlusMenu() {
    const dock = document.getElementById('plus-dock');
    const backdrop = document.getElementById('plus-backdrop');
    const button = document.getElementById('plus-button');
    if (!dock || !backdrop) return;
    dock.classList.remove('open');
    backdrop.classList.remove('open');
    button?.setAttribute('aria-expanded', 'false');
}

function firePlusAction(action) {
    switch (action) {
        case 'new-job':
            // Real wiring — modal exists and works cold-entry
            if (typeof window.openNewJobModal === 'function') {
                window.openNewJobModal();
            } else {
                console.warn('[plus] openNewJobModal not available');
            }
            break;
        case 'update':
            // Unified Update modal — replaces old edit-job + tracker pills
            if (typeof window.openUpdateModal === 'function') {
                window.openUpdateModal();
            } else {
                console.warn('[plus] openUpdateModal not available');
            }
            break;
        case 'ask-dot':
            // Chat-with-Dot modal — askDotModal.js
            if (typeof window.openAskDotModal === 'function') {
                window.openAskDotModal();
            } else {
                console.warn('[plus] openAskDotModal not available');
            }
            break;
        default:
            console.warn('[plus] unknown action:', action);
    }
}

// ===== EXPOSE TO WINDOW =====
window.openPlusMenu = openPlusMenu;
window.closePlusMenu = closePlusMenu;
window.togglePlusMenu = togglePlusMenu;
