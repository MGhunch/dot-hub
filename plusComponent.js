// ===== PLUS COMPONENT MODULE =====
// Floating dock pinned to bottom-left of every page.
// v1 slice 1: visual only — dock + tray + circle, no menu yet.
// Depends on: nothing (yet)
// Exposes: nothing (yet)

(function setupPlusComponent() {
    // Wait for DOM ready in case this script loads before body parsed
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', wirePlusButton);
    } else {
        wirePlusButton();
    }
})();

function wirePlusButton() {
    const btn = document.getElementById('plus-button');
    if (!btn) return;
    
    btn.addEventListener('click', () => {
        // Menu wiring lands in next slice
        console.log('[plus] clicked — menu coming soon');
    });
}
