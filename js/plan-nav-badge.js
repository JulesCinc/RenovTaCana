/** Compteur de canalisations du plan ouvert — badge sur l’onglet Plan de travaux (toutes les pages). */
const PLAN_NAV_STORAGE_KEY = 'rtc_plan_travaux';

function updatePlanNavCount() {
    const el = document.getElementById('plan-nav-count');
    if (!el) return;
    try {
        const items = JSON.parse(localStorage.getItem(PLAN_NAV_STORAGE_KEY) || '[]');
        const n = Array.isArray(items) ? items.length : 0;
        el.textContent = n > 0 ? String(n) : '';
        el.hidden = n === 0;
    } catch {
        el.textContent = '';
        el.hidden = true;
    }
}

function initPlanNavBadge() {
    updatePlanNavCount();
    window.addEventListener('storage', e => {
        if (e.key === PLAN_NAV_STORAGE_KEY) updatePlanNavCount();
    });
    window.addEventListener('pageshow', () => updatePlanNavCount());
}

window.updatePlanNavCount = updatePlanNavCount;

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPlanNavBadge);
} else {
    initPlanNavBadge();
}
