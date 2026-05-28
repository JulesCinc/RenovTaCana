/* =========================================================
   plan-travaux.js
   Gestion du plan de travaux (panier de canalisations)
   Inclure sur plan-travaux.html ET carte.html.
   ========================================================= */

const PLAN_KEY      = 'rtc_plan_travaux';
const BUDGET_KEY    = 'rtc_plan_budget';
const FIGE_KEY      = 'rtc_plan_fige';
const SESSION_KEY   = 'rtc_plan_ui_mode';
const ARCHIVES_KEY  = 'rtc_plan_archives';
const COST_PER_M    = 1000; // € par mètre linéaire

/** welcome | new | open — ignoré dès qu'il y a des lignes dans le plan */
let planUiMode = 'welcome';

let planItems = [];
let budget    = 0;
let isFige    = false;

// ── Persistence ───────────────────────────────────────────
function loadState() {
    try { planItems = JSON.parse(localStorage.getItem(PLAN_KEY) || '[]'); } catch { planItems = []; }
    budget = parseFloat(localStorage.getItem(BUDGET_KEY)) || 0;
    isFige = localStorage.getItem(FIGE_KEY) === '1';
    const savedMode = localStorage.getItem(SESSION_KEY);
    if (planItems.length > 0) {
        planUiMode = 'active';
    } else if (savedMode === 'new') {
        planUiMode = 'new';
    } else if (savedMode === 'open') {
        planUiMode = 'open';
    } else {
        planUiMode = 'welcome';
    }
}

function saveUiMode() {
    if (planItems.length > 0) {
        localStorage.setItem(SESSION_KEY, 'active');
        return;
    }
    if (planUiMode === 'open') return;
    localStorage.setItem(SESSION_KEY, planUiMode);
}

function readArchives() {
    try {
        const raw = JSON.parse(localStorage.getItem(ARCHIVES_KEY) || '[]');
        return Array.isArray(raw) ? raw : [];
    } catch {
        return [];
    }
}

function writeArchives(archives) {
    localStorage.setItem(ARCHIVES_KEY, JSON.stringify(archives.slice(0, 20)));
}

function archiveCurrentPlan() {
    if (!planItems.length) return;
    const archives = readArchives();
    const stamp = new Date();
    archives.unshift({
        id: crypto.randomUUID(),
        name: `Plan du ${stamp.toLocaleDateString('fr-FR')} ${stamp.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`,
        savedAt: stamp.getTime(),
        items: JSON.parse(JSON.stringify(planItems)),
        budget,
        isFige: true,
    });
    writeArchives(archives);
}

function loadArchive(id) {
    const archive = readArchives().find(a => a.id === id);
    if (!archive) return false;
    planItems = JSON.parse(JSON.stringify(archive.items || []));
    budget = parseFloat(archive.budget) || 0;
    isFige = Boolean(archive.isFige);
    planUiMode = 'active';
    saveState();
    saveUiMode();
    return true;
}

function saveState() {
    localStorage.setItem(PLAN_KEY, JSON.stringify(planItems));
    localStorage.setItem(BUDGET_KEY, String(budget));
    localStorage.setItem(FIGE_KEY, isFige ? '1' : '0');
    saveUiMode();
}

// ── API publique — appelée depuis carte.js ────────────────
/**
 * Ajoute une canalisation au plan de travaux.
 * Accepte le format tooltip de carte.js {id, adr, mat, diam, long, crit}
 * ou le format API complet {facilityid, adresse, materiau, diametre, longueur, criticite}.
 */
function ajouterAuPlan(data) {
    const facilityid = data.facilityid || data.id || '—';
    const longueur   = parseFloat(data.longueur ?? data.long) || 0;

    if (isFige) {
        showToast('Plan figé — dégeler avant d\'ajouter.', 'warn');
        return;
    }
    if (planItems.some(i => i.facilityid === facilityid)) {
        showToast(`${facilityid} déjà dans le plan`, 'warn');
        return;
    }

    planItems.push({
        _id:       crypto.randomUUID(),
        facilityid,
        adresse:   data.adresse  || data.adr || '—',
        materiau:  data.materiau || data.mat || '—',
        diametre:  data.diametre ?? data.diam ?? null,
        longueur,
        criticite: data.criticite ?? data.crit ?? null,
        inclus:    true,
    });

    saveState();
    showToast(`${facilityid} ajouté au plan`, 'ok');
    if (document.getElementById('plan-tbody')) render();
}

window.ajouterAuPlan = ajouterAuPlan;

/**
 * Ajoute plusieurs canalisations (ex. sélection carte). Retourne { added, skipped }.
 */
function ajouterPlusieursAuPlan(items, options = {}) {
    const silent = options.silent !== false;
    const list = Array.isArray(items) ? items : [];
    if (!list.length) return { added: 0, skipped: 0 };

    if (isFige) {
        if (!silent) showToast('Plan figé — dégeler avant d\'ajouter.', 'warn');
        return { added: 0, skipped: list.length };
    }

    let added = 0;
    let skipped = 0;
    list.forEach(data => {
        const facilityid = data.facilityid || data.id || '';
        if (!facilityid || planItems.some(i => i.facilityid === facilityid)) {
            skipped += 1;
            return;
        }
        const longueur = parseFloat(data.longueur ?? data.long) || 0;
        planItems.push({
            _id: crypto.randomUUID(),
            facilityid,
            adresse: data.adresse || data.adr || '—',
            materiau: data.materiau || data.mat || '—',
            diametre: data.diametre ?? data.diam ?? null,
            longueur,
            criticite: data.criticite ?? data.crit ?? null,
            inclus: true,
        });
        added += 1;
    });

    if (added) saveState();
    if (!silent && added) {
        showToast(
            `${added} canalisation${added > 1 ? 's' : ''} ajoutée${added > 1 ? 's' : ''} au plan`,
            'ok'
        );
    }
    if (document.getElementById('plan-tbody')) render();
    return { added, skipped };
}

window.ajouterPlusieursAuPlan = ajouterPlusieursAuPlan;

// ── Rendu du tableau ──────────────────────────────────────
function render() {
    const tbody = document.getElementById('plan-tbody');
    if (!tbody) return;

    const welcome = document.getElementById('plan-welcome');
    const empty = document.getElementById('plan-empty');
    const openPanel = document.getElementById('plan-open');
    const table = document.getElementById('plan-table');
    const hasPipes = planItems.length > 0;

    if (hasPipes) planUiMode = 'active';

    const showWelcome = !hasPipes && planUiMode === 'welcome';
    const showNew = !hasPipes && planUiMode === 'new';
    const showOpen = !hasPipes && planUiMode === 'open';

    if (welcome) welcome.classList.toggle('is-visible', showWelcome);
    if (empty) {
        empty.hidden = !showNew;
        empty.classList.toggle('is-visible', showNew);
    }
    if (openPanel) {
        openPanel.hidden = !showOpen;
        openPanel.classList.toggle('is-visible', showOpen);
        if (showOpen) renderSavedPlansList();
    }
    if (table) table.style.display = hasPipes ? '' : 'none';

    tbody.innerHTML = '';
    planItems.forEach(item => tbody.appendChild(buildRow(item)));

    updateSummary();
    updateCount();
    syncCheckAll();
    updatePageChrome();
    saveUiMode();
}

function renderSavedPlansList() {
    const list = document.getElementById('plan-open-list');
    const emptyMsg = document.getElementById('plan-open-empty');
    if (!list) return;

    const archives = readArchives();
    list.innerHTML = '';

    if (!archives.length) {
        if (emptyMsg) emptyMsg.hidden = false;
        return;
    }
    if (emptyMsg) emptyMsg.hidden = true;

    archives.forEach(archive => {
        const li = document.createElement('li');
        li.className = 'plan-open__item';
        const count = (archive.items || []).length;
        const date = new Date(archive.savedAt || 0);
        const dateLabel = Number.isFinite(date.getTime())
            ? date.toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' })
            : '—';

        li.innerHTML = `
            <div class="plan-open__meta">
                <span class="plan-open__name">${escapeHtml(archive.name || 'Plan sans nom')}</span>
                <span class="plan-open__sub">${count} canalisation${count !== 1 ? 's' : ''} · ${dateLabel}</span>
            </div>
            <button type="button" class="plan-btn plan-btn--primary plan-btn--sm">Ouvrir</button>
        `;
        li.querySelector('button')?.addEventListener('click', () => {
            if (!loadArchive(archive.id)) {
                showToast('Plan introuvable', 'warn');
                renderSavedPlansList();
                return;
            }
            const budgetEl = document.getElementById('budget-input');
            if (budgetEl) budgetEl.value = budget;
            render();
            updateFigeUI();
            showToast('Plan chargé', 'ok');
        });
        list.appendChild(li);
    });
}

function updatePageChrome() {
    const hideChrome = planItems.length === 0 && (planUiMode === 'welcome' || planUiMode === 'open');
    document.querySelector('.plan-header-actions')?.classList.toggle('is-hidden', hideChrome);
    document.querySelector('.plan-sidebar')?.classList.toggle('is-hidden', hideChrome);
}

function escapeHtml(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function startNewPlan() {
    planUiMode = 'new';
    planItems = [];
    budget = 0;
    isFige = false;
    saveState();
    render();
    updateFigeUI();
    const budgetEl = document.getElementById('budget-input');
    if (budgetEl) budgetEl.value = 0;
}

/** Quitte le plan en cours : vide le cache actif et revient à l'écran d'accueil. */
function closeCurrentPlan() {
    planItems = [];
    budget = 0;
    isFige = false;
    planUiMode = 'welcome';
    localStorage.removeItem(SESSION_KEY);
    saveState();
    render();
    updateFigeUI();
    const budgetEl = document.getElementById('budget-input');
    if (budgetEl) budgetEl.value = 0;
}

function showOpenSavedPlans() {
    planUiMode = 'open';
    saveUiMode();
    render();
}

function buildRow(item) {
    const tr   = document.createElement('tr');
    const cost = Math.round(item.longueur * COST_PER_M);

    if (!item.inclus) tr.classList.add('row--excluded');
    if (isFige)       tr.classList.add('row--fige');

    const lengthCell = isFige
        ? `<span style="font-family:var(--font-mono)">${fmt(item.longueur)} m</span>`
        : `<div class="length-cell">
               <input type="number" class="length-input" data-id="${item._id}"
                   value="${item.longueur}" min="0" step="0.1">
               <span class="length-unit">m</span>
           </div>`;

    const actions = isFige ? '' : `
        <button class="row-btn row-btn--split" data-id="${item._id}" title="Séparer en 2 tronçons">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 3v5m-5 13l5-13 5 13"/>
            </svg>
        </button>
        <button class="row-btn row-btn--delete" data-id="${item._id}" title="Supprimer du plan">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                stroke-linecap="round" stroke-linejoin="round">
                <polyline points="3 6 5 6 21 6"/>
                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                <path d="M9 6V4h6v2"/>
            </svg>
        </button>`;

    tr.innerHTML = `
        <td class="col-check">
            <input type="checkbox" class="row-check" data-id="${item._id}"
                ${item.inclus ? 'checked' : ''} ${isFige ? 'disabled' : ''}>
        </td>
        <td>
            <div class="cell-id">
                <span class="crit-dot" style="background:${critColor(item.criticite)}"
                    title="Criticité ${item.criticite != null ? Math.round(item.criticite) + ' %' : 'N/A'}"></span>
                <span class="cell-id__text" title="${item.facilityid}">${item.facilityid}</span>
            </div>
        </td>
        <td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"
            title="${item.adresse}">${item.adresse}</td>
        <td class="col-num">${lengthCell}</td>
        <td class="col-num col-cost">${fmtCost(cost)}</td>
        <td class="col-actions"><div class="row-actions">${actions}</div></td>
    `;
    return tr;
}

// ── Récapitulatif budgétaire ──────────────────────────────
function updateSummary() {
    const inc    = planItems.filter(i => i.inclus);
    const totalL = inc.reduce((s, i) => s + i.longueur, 0);
    const totalC = Math.round(totalL * COST_PER_M);

    setText('sum-count',  inc.length);
    setText('sum-length', fmt(totalL) + ' m');
    setText('sum-total',  fmtCost(totalC));

    const pct     = budget > 0 ? (totalC / budget) * 100 : 0;
    const fill    = document.getElementById('budget-fill');
    if (fill) {
        fill.style.width      = Math.min(pct, 100) + '%';
        fill.style.background = pct > 100 ? 'var(--c-danger)' : pct > 80 ? 'var(--c-warning)' : 'var(--c-cyan)';
    }
    setText('budget-pct', Math.round(pct) + ' %');

    const solde = budget - totalC;
    setText('solde-value', fmtCost(Math.abs(solde)));
    setText('solde-label', solde < 0 ? 'Dépassement budget' : 'Reste à dépenser');
    const sv = document.getElementById('solde-value');
    if (sv) sv.className = 'plan-solde__value' + (solde < 0 ? ' plan-solde__value--over' : solde > 0 ? ' plan-solde__value--ok' : '');
}

function updateCount() {
    const el = document.getElementById('plan-count');
    if (!el) return;
    const welcomeVisible = document.getElementById('plan-welcome')?.classList.contains('is-visible');
    const hideBadge = Boolean(welcomeVisible);
    el.classList.toggle('is-hidden', hideBadge);
    el.toggleAttribute('hidden', hideBadge);
    if (hideBadge) return;
    el.textContent = `${planItems.length} canalisation${planItems.length !== 1 ? 's' : ''}`;
}

function syncCheckAll() {
    const all = document.getElementById('check-all');
    if (!all) return;
    const n = planItems.filter(i => i.inclus).length;
    all.indeterminate = n > 0 && n < planItems.length;
    all.checked       = n === planItems.length && planItems.length > 0;
}

// ── Événements (actifs seulement sur plan-travaux.html) ───
function bindEvents() {
    const tbody = document.getElementById('plan-tbody');
    if (!tbody) return;

    tbody.addEventListener('change', e => {
        if (e.target.classList.contains('row-check')) {
            const item = byId(e.target.dataset.id);
            if (item) { item.inclus = e.target.checked; saveState(); render(); }
        }
        if (e.target.classList.contains('length-input')) {
            const item = byId(e.target.dataset.id);
            if (item) {
                item.longueur = parseFloat(e.target.value) || 0;
                saveState();
                updateSummary();
                const costCell = e.target.closest('tr')?.querySelector('.col-cost');
                if (costCell) costCell.textContent = fmtCost(Math.round(item.longueur * COST_PER_M));
            }
        }
    });

    tbody.addEventListener('click', e => {
        const s = e.target.closest('.row-btn--split');
        if (s) { splitItem(s.dataset.id); return; }
        const d = e.target.closest('.row-btn--delete');
        if (d) { deleteItem(d.dataset.id); }
    });

    document.getElementById('check-all')?.addEventListener('change', e => {
        planItems.forEach(i => i.inclus = e.target.checked);
        saveState(); render();
    });

    const budgetEl = document.getElementById('budget-input');
    if (budgetEl) {
        budgetEl.value = budget;
        budgetEl.addEventListener('input', () => {
            budget = parseFloat(budgetEl.value) || 0;
            saveState(); updateSummary();
        });
    }

    document.getElementById('btn-figer')?.addEventListener('click', toggleFige);
    document.getElementById('btn-export-sidebar')?.addEventListener('click', exportCSV);

    document.getElementById('btn-plan-close')?.addEventListener('click', () => {
        showPlanConfirm({
            title: 'Fermer le plan',
            message: planItems.length
                ? 'Les canalisations non archivées seront retirées du plan actif. Vous reviendrez à l\'écran d\'accueil.'
                : 'Revenir à l\'écran d\'accueil et quitter ce plan ?',
            confirmLabel: 'Fermer le plan',
            danger: true,
            onConfirm: () => {
                closeCurrentPlan();
                showToast('Plan fermé', 'ok');
            },
        });
    });

    document.getElementById('btn-clear')?.addEventListener('click', () => {
        if (!planItems.length) return;
        showPlanConfirm({
            title: 'Vider le plan',
            message: 'Toutes les canalisations seront retirées du plan en cours. Cette action est irréversible.',
            confirmLabel: 'Vider le plan',
            danger: true,
            onConfirm: () => {
                closeCurrentPlan();
                showToast('Plan vidé', 'ok');
            },
        });
    });

    document.getElementById('btn-plan-new')?.addEventListener('click', startNewPlan);
    document.getElementById('btn-plan-open')?.addEventListener('click', showOpenSavedPlans);
    document.getElementById('btn-plan-open-back')?.addEventListener('click', () => {
        planUiMode = 'welcome';
        saveUiMode();
        render();
    });
}

// ── Actions sur les lignes ────────────────────────────────
function splitItem(id) {
    const idx = planItems.findIndex(i => i._id === id);
    if (idx === -1) return;

    const orig = planItems[idx];
    const half = Math.round((orig.longueur / 2) * 10) / 10;
    const base = orig.facilityid.replace(/ \(\d\/2\)$/, '');

    planItems.splice(idx, 1,
        { ...orig, _id: crypto.randomUUID(), longueur: half,                     facilityid: base + ' (1/2)' },
        { ...orig, _id: crypto.randomUUID(), longueur: orig.longueur - half,     facilityid: base + ' (2/2)' }
    );
    saveState(); render();
    showToast('Canalisation séparée en 2 tronçons', 'ok');
}

function deleteItem(id) {
    planItems = planItems.filter(i => i._id !== id);
    saveState(); render();
}

// ── Figer / dégeler ───────────────────────────────────────
function toggleFige() {
    const wasFige = isFige;
    isFige = !isFige;
    if (isFige && !wasFige) archiveCurrentPlan();
    saveState();
    updateFigeUI();
    render();
    showToast(
        isFige ? 'Plan figé et sauvegardé — lecture seule' : 'Plan dégelé',
        isFige ? 'ok' : 'warn'
    );
}

function updateFigeUI() {
    const btn   = document.getElementById('btn-figer');
    const badge = document.getElementById('fige-badge');
    if (btn) {
        const lockSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;flex-shrink:0"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`;
        btn.innerHTML = lockSvg + (isFige ? ' Dégeler le plan' : ' Figer le plan de travaux');
    }
    if (badge) badge.style.display = isFige ? 'flex' : 'none';
}

// ── Export CSV ────────────────────────────────────────────
function exportCSV() {
    if (!planItems.length) { showToast('Le plan est vide', 'warn'); return; }

    const rows = planItems.filter(i => i.inclus);
    if (!rows.length) { showToast('Aucune ligne cochée à exporter', 'warn'); return; }

    const sep = ';';
    const hdr = ['ID Canalisation', 'Adresse', 'Matériau', 'Ø (mm)', 'Longueur (m)', 'Coût estimé (€)'].join(sep);
    const body = rows.map(i => [
        i.facilityid,
        `"${(i.adresse || '').replace(/"/g, '""')}"`,
        i.materiau,
        i.diametre ?? '',
        i.longueur,
        Math.round(i.longueur * COST_PER_M),
    ].join(sep)).join('\n');

    const blob = new Blob(['﻿' + hdr + '\n' + body], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = Object.assign(document.createElement('a'), {
        href: url,
        download: `plan_travaux_${new Date().toISOString().slice(0, 10)}.csv`,
    });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('Export CSV téléchargé', 'ok');
}

// ── Modal de confirmation ─────────────────────────────────
let planConfirmOnOk = null;

function closePlanConfirm() {
    const modal = document.getElementById('plan-confirm');
    if (!modal) return;
    modal.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('plan-confirm-open');
    planConfirmOnOk = null;
}

function showPlanConfirm({ title, message, confirmLabel = 'Confirmer', cancelLabel = 'Annuler', danger = false, onConfirm }) {
    const modal = document.getElementById('plan-confirm');
    if (!modal) {
        if (window.confirm(message)) onConfirm?.();
        return;
    }

    const titleEl = document.getElementById('plan-confirm-title');
    const messageEl = document.getElementById('plan-confirm-message');
    const okBtn = document.getElementById('plan-confirm-ok');
    const cancelBtn = document.getElementById('plan-confirm-cancel');

    if (titleEl) titleEl.textContent = title;
    if (messageEl) messageEl.textContent = message;
    if (okBtn) {
        okBtn.textContent = confirmLabel;
        okBtn.classList.toggle('plan-btn--danger', danger);
        okBtn.classList.toggle('plan-btn--primary', !danger);
    }
    if (cancelBtn) cancelBtn.textContent = cancelLabel;

    planConfirmOnOk = onConfirm;
    modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('plan-confirm-open');
    cancelBtn?.focus();
}

function initPlanConfirm() {
    const modal = document.getElementById('plan-confirm');
    if (!modal) return;

    document.getElementById('plan-confirm-backdrop')?.addEventListener('click', closePlanConfirm);
    document.getElementById('plan-confirm-cancel')?.addEventListener('click', closePlanConfirm);
    document.getElementById('plan-confirm-ok')?.addEventListener('click', () => {
        const fn = planConfirmOnOk;
        closePlanConfirm();
        fn?.();
    });

    document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && modal.getAttribute('aria-hidden') === 'false') {
            e.preventDefault();
            closePlanConfirm();
        }
    });
}

// ── Toast ─────────────────────────────────────────────────
function showToast(msg, type = 'ok') {
    let toast = document.getElementById('plan-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'plan-toast';
        // Styles inline de secours si plan-travaux.css n'est pas chargé
        Object.assign(toast.style, {
            position: 'fixed', bottom: '28px', right: '28px', zIndex: '9000',
            padding: '11px 18px', borderRadius: '10px', fontSize: '0.80rem',
            fontFamily: 'Inter, sans-serif', pointerEvents: 'none',
            transition: 'opacity 0.22s ease, transform 0.22s ease',
            transform: 'translateY(8px)', opacity: '0',
        });
        document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.className   = `plan-toast plan-toast--${type} plan-toast--visible`;

    // Couleurs inline en cas de chargement hors plan-travaux.html (ex. carte.html)
    if (type === 'ok') {
        toast.style.cssText += ';background:var(--c-surface,#fff);border:1px solid #00d4aa;color:#00d4aa;';
    } else {
        toast.style.cssText += ';background:var(--c-surface,#fff);border:1px solid #f59e0b;color:#f59e0b;';
    }
    toast.style.opacity   = '1';
    toast.style.transform = 'translateY(0)';

    clearTimeout(toast._t);
    toast._t = setTimeout(() => {
        toast.style.opacity   = '0';
        toast.style.transform = 'translateY(8px)';
        toast.className = `plan-toast plan-toast--${type}`;
    }, 3000);
}

// ── Utilitaires ───────────────────────────────────────────
const byId    = id => planItems.find(i => i._id === id);
const setText = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
const fmt     = n  => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(n);
const fmtCost = n  => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n);

function critColor(c) {
    if (c == null) return 'var(--c-neutral, #64748b)';
    if (c >= 70)   return '#ef4444';
    if (c >= 40)   return '#f97316';
    if (c >= 20)   return '#eab308';
    return '#00d4aa';
}

// ── Init ──────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    loadState();
    initPlanConfirm();
    render();       // no-op si les éléments DOM n'existent pas (ex. carte.html)
    bindEvents();   // no-op si les éléments DOM n'existent pas
    updateFigeUI();
});
