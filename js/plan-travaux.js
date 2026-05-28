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
const SAVED_ID_KEY  = 'rtc_plan_saved_id';
const SAVED_NOM_KEY = 'rtc_plan_saved_nom';
const SAVED_AT_KEY  = 'rtc_plan_saved_at_ms';
const TARIF_KEY     = 'rtc_plan_tarif_ml';
const NOTE_KEY      = 'rtc_plan_note';
const SAVED_SNAPSHOT_KEY = 'rtc_plan_saved_snapshot';
const DEFAULT_TARIF_ML = 1000;
const PLAN_TITLE_DEFAULT = 'Plan de travaux';
const PLAN_PAGE_SIZE = 10;

/** welcome | new | open — ignoré dès qu'il y a des lignes dans le plan */
let planUiMode = 'welcome';
let planCurrentPage = 1;

let planItems = [];
let budget    = 0;
let isFige    = false;
/** ID en base du plan ouvert (null = jamais enregistré sous ce brouillon). */
let savedPlanId = null;
let savedPlanNom = '';
let savedPlanAtMs = null;
let tarifMl = DEFAULT_TARIF_ML;
let planNote = '';
/** Dernière version alignée sur la base (comparaison pour modifs non sauvegardées). */
let lastSavedSnapshot = null;

function planApiBase() {
    return `${window.__RTC_API_BASE__ || "http://127.0.0.1:8000"}/api/plans-travaux`;
}

// ── Persistence ───────────────────────────────────────────
function loadState() {
    try { planItems = JSON.parse(localStorage.getItem(PLAN_KEY) || '[]'); } catch { planItems = []; }
    budget = parseFloat(localStorage.getItem(BUDGET_KEY)) || 0;
    isFige = false;
    const rawSavedId = localStorage.getItem(SAVED_ID_KEY);
    savedPlanId = rawSavedId ? parseInt(rawSavedId, 10) : null;
    if (!Number.isFinite(savedPlanId)) savedPlanId = null;
    savedPlanNom = localStorage.getItem(SAVED_NOM_KEY) || '';
    const rawSavedAt = parseInt(localStorage.getItem(SAVED_AT_KEY) || '', 10);
    savedPlanAtMs = Number.isFinite(rawSavedAt) && rawSavedAt > 0 ? rawSavedAt : null;
    const rawTarif = parseFloat(localStorage.getItem(TARIF_KEY));
    tarifMl = Number.isFinite(rawTarif) && rawTarif > 0 ? rawTarif : DEFAULT_TARIF_ML;
    planNote = localStorage.getItem(NOTE_KEY) || '';
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
    lastSavedSnapshot = localStorage.getItem(SAVED_SNAPSHOT_KEY);
}

function serializePlanForComparison() {
    return JSON.stringify({
        savedPlanId: savedPlanId ?? null,
        nom: (savedPlanNom || '').trim(),
        budget: parseFloat(budget) || 0,
        tarifMl,
        note: (planNote || '').trim(),
        items: planItems.map((item, index) => ({
            facilityid: item.facilityid,
            adresse: item.adresse || '—',
            materiau: item.materiau || '—',
            diametre: item.diametre ?? null,
            longueur: roundToTenth(parseFloat(item.longueur) || 0),
            criticite: item.criticite ?? null,
            inclus: !!item.inclus,
            ordre: index + 1,
        })),
    });
}

function markPlanSavedSnapshot() {
    lastSavedSnapshot = serializePlanForComparison();
    localStorage.setItem(SAVED_SNAPSHOT_KEY, lastSavedSnapshot);
}

function clearPlanSavedSnapshot() {
    lastSavedSnapshot = null;
    localStorage.removeItem(SAVED_SNAPSHOT_KEY);
}

function isPlanDirty() {
    if (!planItems.length) {
        return savedPlanId != null && lastSavedSnapshot != null
            && serializePlanForComparison() !== lastSavedSnapshot;
    }
    if (savedPlanId == null) return true;
    if (lastSavedSnapshot == null) return true;
    return serializePlanForComparison() !== lastSavedSnapshot;
}

function requestClosePlan() {
    if (!isPlanDirty()) {
        closeCurrentPlan();
        showToast('Plan fermé', 'ok');
        return;
    }

    const message = savedPlanId == null
        ? 'Ce plan n’a pas encore été enregistré en base, ou des canalisations ont été ajoutées sans sauvegarde. Fermer quand même ? Les modifications locales seront perdues.'
        : 'Attention : des modifications n’ont pas été sauvegardées. Voulez-vous vraiment fermer le plan sans enregistrer ?';

    showPlanConfirm({
        title: 'Modifications non sauvegardées',
        message,
        confirmLabel: 'Fermer sans sauvegarder',
        danger: true,
        onConfirm: () => {
            closeCurrentPlan();
            showToast('Plan fermé', 'ok');
        },
    });
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
    localStorage.setItem(TARIF_KEY, String(tarifMl));
    if ((planNote || '').trim()) {
        localStorage.setItem(NOTE_KEY, planNote);
    } else {
        localStorage.removeItem(NOTE_KEY);
    }
    localStorage.removeItem(FIGE_KEY);
    if (savedPlanId != null) {
        localStorage.setItem(SAVED_ID_KEY, String(savedPlanId));
        localStorage.setItem(SAVED_NOM_KEY, savedPlanNom);
        if (savedPlanAtMs != null) {
            localStorage.setItem(SAVED_AT_KEY, String(savedPlanAtMs));
        } else {
            localStorage.removeItem(SAVED_AT_KEY);
        }
    } else {
        localStorage.removeItem(SAVED_ID_KEY);
        localStorage.removeItem(SAVED_NOM_KEY);
        localStorage.removeItem(SAVED_AT_KEY);
    }
    saveUiMode();
    if (typeof window.updatePlanNavCount === 'function') window.updatePlanNavCount();
}

// ── API publique — appelée depuis carte.js ────────────────
/**
 * Ajoute une canalisation au plan de travaux.
 * Accepte le format tooltip de carte.js {id, adr, mat, diam, long, crit}
 * ou le format API complet {facilityid, adresse, materiau, diametre, longueur, criticite}.
 */
function ajouterAuPlan(data) {
    const facilityid = data.facilityid || data.id || '—';
    const longueur   = roundToTenth(parseFloat(data.longueur ?? data.long) || 0);

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

    let added = 0;
    let skipped = 0;
    list.forEach(data => {
        const facilityid = data.facilityid || data.id || '';
        if (!facilityid || planItems.some(i => i.facilityid === facilityid)) {
            skipped += 1;
            return;
        }
        const longueur = roundToTenth(parseFloat(data.longueur ?? data.long) || 0);
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
    const addToolbar = document.getElementById('plan-add-toolbar');
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
    const carousel = document.getElementById('plan-table-carousel');
    if (carousel) {
        carousel.hidden = !hasPipes;
        carousel.classList.toggle('is-visible', hasPipes);
    }
    const showAddToolbar = !showWelcome && !showOpen;
    if (addToolbar) {
        addToolbar.hidden = !showAddToolbar;
        addToolbar.classList.toggle('is-visible', showAddToolbar);
    }

    const totalPages = Math.max(1, Math.ceil(planItems.length / PLAN_PAGE_SIZE));
    if (planCurrentPage > totalPages) planCurrentPage = totalPages;
    if (planCurrentPage < 1) planCurrentPage = 1;

    const pageStart = (planCurrentPage - 1) * PLAN_PAGE_SIZE;
    const pageEnd = pageStart + PLAN_PAGE_SIZE;

    tbody.innerHTML = '';
    let ordreInclus = 0;
    for (let i = 0; i < pageStart; i++) {
        if (planItems[i].inclus) ordreInclus++;
    }
    for (let index = pageStart; index < pageEnd && index < planItems.length; index++) {
        const item = planItems[index];
        const displayOrder = item.inclus ? ++ordreInclus : null;
        tbody.appendChild(buildRow(item, index, displayOrder));
    }

    updatePlanPagination(hasPipes, showWelcome, showOpen);
    updateSummary();
    updateCount();
    syncCheckAll();
    updatePageChrome();
    saveUiMode();
    updateSaveUI();
}

function formatPlanListBudgetStatus(plan) {
    const budget = parseFloat(plan.budget_enveloppe) || 0;
    const cout = parseFloat(plan.cout_total) || 0;
    if (budget <= 0) {
        return {
            text: 'Budget non défini',
            className: 'plan-open__budget--na',
        };
    }
    if (plan.budget_depasse === true) {
        return {
            text: `Dépassement budget · ${fmtCost(cout)} / ${fmtCost(budget)}`,
            className: 'plan-open__budget--over',
        };
    }
    return {
        text: `Dans le budget · ${fmtCost(cout)} / ${fmtCost(budget)}`,
        className: 'plan-open__budget--ok',
    };
}

async function renderSavedPlansList() {
    const list = document.getElementById('plan-open-list');
    const emptyMsg = document.getElementById('plan-open-empty');
    if (!list) return;

    list.innerHTML = '<li class="plan-open__loading">Chargement…</li>';
    if (emptyMsg) emptyMsg.hidden = true;

    try {
        const res = await fetch(planApiBase());
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const plans = data.plans || [];
        list.innerHTML = '';

        if (!plans.length) {
            if (emptyMsg) {
                emptyMsg.hidden = false;
                emptyMsg.textContent = 'Aucun plan sauvegardé pour le moment. Enregistrez un plan avec le bouton « Sauvegarder ».';
            }
            return;
        }
        if (emptyMsg) {
            emptyMsg.hidden = true;
            emptyMsg.textContent = 'Aucun plan sauvegardé pour le moment. Enregistrez un plan avec le bouton « Sauvegarder ».';
        }

        plans.forEach(plan => {
            const li = document.createElement('li');
            li.className = 'plan-open__item';
            const count = plan.ligne_count ?? 0;
            const date = new Date(plan.saved_at_ms || plan.created_at || 0);
            const dateLabel = Number.isFinite(date.getTime())
                ? date.toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' })
                : '—';
            const tarifLabel = formatTarifLabel(plan.tarif_ml);
            const budgetInfo = formatPlanListBudgetStatus(plan);

            const meta = document.createElement('div');
            meta.className = 'plan-open__meta';

            const name = document.createElement('span');
            name.className = 'plan-open__name';
            name.textContent = plan.nom || 'Plan sans nom';

            const sub1 = document.createElement('span');
            sub1.className = 'plan-open__sub';
            sub1.textContent = `${count} canalisation${count !== 1 ? 's' : ''} · ${dateLabel}`;

            const sub2 = document.createElement('span');
            sub2.className = 'plan-open__sub plan-open__sub--detail';
            if (tarifLabel) {
                sub2.append(document.createTextNode(`${tarifLabel} · `));
            }
            const budgetBadge = document.createElement('span');
            budgetBadge.className = `plan-open__budget ${budgetInfo.className}`;
            budgetBadge.textContent = budgetInfo.text;
            sub2.append(budgetBadge);

            meta.append(name, sub1, sub2);

            const actions = document.createElement('div');
            actions.className = 'plan-open__actions';

            const btnOpen = document.createElement('button');
            btnOpen.type = 'button';
            btnOpen.className = 'plan-btn plan-btn--primary plan-btn--sm';
            btnOpen.textContent = 'Ouvrir';
            btnOpen.addEventListener('click', () => loadPlanFromDatabase(plan.id));

            const btnDup = document.createElement('button');
            btnDup.type = 'button';
            btnDup.className = 'plan-btn plan-btn--outline plan-btn--sm';
            btnDup.textContent = 'Dupliquer';
            btnDup.addEventListener('click', () => duplicateSavedPlan(plan.id, plan.nom));

            const btnDel = document.createElement('button');
            btnDel.type = 'button';
            btnDel.className = 'plan-btn plan-btn--ghost plan-btn--sm plan-btn--danger-text';
            btnDel.textContent = 'Supprimer';
            btnDel.addEventListener('click', () => deleteSavedPlan(plan.id, plan.nom));

            actions.append(btnOpen, btnDup, btnDel);
            li.append(meta, actions);
            list.appendChild(li);
        });
    } catch {
        list.innerHTML = '';
        if (emptyMsg) {
            emptyMsg.hidden = false;
            emptyMsg.textContent = 'Impossible de charger les plans sauvegardés. Vérifiez que l’API est démarrée.';
        }
    }
}

function parsePlanTimestamp(value) {
    if (value == null || value === '') return null;
    const n = typeof value === 'number' ? value : Number(value);
    if (Number.isFinite(n) && n > 0) return n;
    const parsed = Date.parse(String(value).trim());
    return Number.isFinite(parsed) ? parsed : null;
}

function resolveSavedAtMs(detail) {
    if (!detail) return null;
    return parsePlanTimestamp(detail.saved_at_ms)
        ?? parsePlanTimestamp(detail.updated_at)
        ?? parsePlanTimestamp(detail.created_at);
}

function applyPlanFromDetail(detail) {
    savedPlanId = detail.id;
    savedPlanNom = detail.nom || '';
    savedPlanAtMs = resolveSavedAtMs(detail);
    planNote = detail.note != null ? String(detail.note) : '';
    budget = parseFloat(detail.budget_enveloppe) || 0;
    const loadedTarif = parseFloat(detail.tarif_ml);
    tarifMl = Number.isFinite(loadedTarif) && loadedTarif > 0 ? loadedTarif : DEFAULT_TARIF_ML;
    isFige = false;

    planItems = (detail.items || []).map(row => ({
        _id: crypto.randomUUID(),
        facilityid: row.facilityid,
        adresse: row.adresse || '—',
        materiau: row.materiau || '—',
        diametre: row.diametre,
        longueur: roundToTenth(parseFloat(row.longueur) || 0),
        criticite: row.criticite ?? row.criticite_snapshot ?? null,
        inclus: row.inclus !== false,
    }));

    planUiMode = 'active';
    saveState();
    markPlanSavedSnapshot();
}

function buildComparisonStateFromDetail(detail) {
    const loadedTarif = parseFloat(detail.tarif_ml);
    const tarif = Number.isFinite(loadedTarif) && loadedTarif > 0 ? loadedTarif : DEFAULT_TARIF_ML;
    const items = (detail.items || []).map((row, index) => ({
        facilityid: row.facilityid,
        adresse: row.adresse || '—',
        materiau: row.materiau || '—',
        diametre: row.diametre ?? null,
        longueur: roundToTenth(parseFloat(row.longueur) || 0),
        criticite: row.criticite ?? row.criticite_snapshot ?? null,
        inclus: row.inclus !== false,
        ordre: index + 1,
    }));
    return {
        savedPlanId: detail.id ?? null,
        nom: (detail.nom || '').trim(),
        budget: parseFloat(detail.budget_enveloppe) || 0,
        tarifMl: tarif,
        note: detail.note != null ? String(detail.note).trim() : '',
        items,
    };
}

async function reconcilePlanSavedSnapshot() {
    if (!savedPlanId || !planItems.length || lastSavedSnapshot) return;
    try {
        const res = await fetch(`${planApiBase()}/${savedPlanId}`);
        if (!res.ok) return;
        const detail = await res.json();
        const apiSnapshot = JSON.stringify(buildComparisonStateFromDetail(detail));
        if (serializePlanForComparison() === apiSnapshot) {
            lastSavedSnapshot = apiSnapshot;
            localStorage.setItem(SAVED_SNAPSHOT_KEY, lastSavedSnapshot);
        }
    } catch { /* API indisponible : on garde l'état prudent (dirty si pas de snapshot) */ }
}

async function duplicateSavedPlan(planId, planNom) {
    const label = (planNom || 'ce plan').trim();
    showPlanConfirm({
        title: 'Dupliquer le plan',
        message: `Créer une copie de « ${label} » ? La copie sera enregistrée avec le suffixe « (copie) ».`,
        confirmLabel: 'Dupliquer',
        onConfirm: async () => {
            try {
                const res = await fetch(`${planApiBase()}/${planId}/duplicate`, { method: 'POST' });
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                await renderSavedPlansList();
                showToast('Plan dupliqué', 'ok');
            } catch {
                showToast('Duplication impossible — vérifiez que l’API est démarrée', 'warn');
            }
        },
    });
}

async function deleteSavedPlan(planId, planNom) {
    const label = (planNom || 'ce plan').trim();
    showPlanConfirm({
        title: 'Supprimer le plan',
        message: `Supprimer définitivement « ${label} » et toutes ses lignes ? Cette action est irréversible.`,
        confirmLabel: 'Supprimer',
        danger: true,
        onConfirm: async () => {
            try {
                const res = await fetch(`${planApiBase()}/${planId}`, { method: 'DELETE' });
                if (res.status === 404) {
                    showToast('Plan introuvable', 'warn');
                } else if (!res.ok) {
                    throw new Error(`HTTP ${res.status}`);
                }
                if (savedPlanId === planId) {
                    savedPlanId = null;
                    savedPlanNom = '';
                    savedPlanAtMs = null;
                    clearPlanSavedSnapshot();
                    saveState();
                    updateSaveUI();
                }
                await renderSavedPlansList();
                showToast('Plan supprimé', 'ok');
            } catch {
                showToast('Suppression impossible — vérifiez que l’API est démarrée', 'warn');
            }
        },
    });
}

async function loadPlanFromDatabase(planId) {
    try {
        const res = await fetch(`${planApiBase()}/${planId}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const detail = await res.json();
        applyPlanFromDetail(detail);
        const budgetEl = document.getElementById('budget-input');
        if (budgetEl) budgetEl.value = budget;
        render();
        updateSaveUI();
        showToast('Plan chargé', 'ok');
    } catch {
        showToast('Plan introuvable ou API indisponible', 'warn');
        renderSavedPlansList();
    }
}

function buildPlanSavePayload(nom) {
    return {
        nom: (nom || savedPlanNom || '').trim(),
        budget_enveloppe: budget,
        tarif_ml: tarifMl,
        note: (planNote || '').trim() || null,
        items: planItems.map((item, index) => ({
            facilityid: item.facilityid,
            adresse: item.adresse,
            materiau: item.materiau,
            diametre: item.diametre,
            longueur: item.longueur,
            criticite: item.criticite,
            inclus: !!item.inclus,
            ordre: index + 1,
        })),
    };
}

async function persistPlanToDatabase(nom, options = {}) {
    const { toastOnSuccess = true } = options;
    const isUpdate = savedPlanId != null;
    let payload = buildPlanSavePayload(nom);

    if (!payload.nom) {
        if (isUpdate) {
            try {
                const res = await fetch(`${planApiBase()}/${savedPlanId}`);
                if (res.ok) {
                    const detail = await res.json();
                    payload = { ...payload, nom: (detail.nom || savedPlanNom || 'Plan sans nom').trim() };
                    savedPlanNom = payload.nom;
                }
            } catch { /* fallback ci-dessous */ }
        }
        if (!payload.nom) {
            showToast('Le nom du plan est obligatoire', 'warn');
            return false;
        }
    }

    const url = isUpdate ? `${planApiBase()}/${savedPlanId}` : planApiBase();
    const method = isUpdate ? 'PUT' : 'POST';

    let res;
    try {
        res = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
    } catch {
        showToast('Impossible de joindre l’API — démarrez le serveur (port 8000)', 'warn');
        return false;
    }

    if (!res.ok) {
        let detail = '';
        try {
            const err = await res.json();
            detail = err.detail ? ` — ${typeof err.detail === 'string' ? err.detail : JSON.stringify(err.detail)}` : '';
        } catch { /* ignore */ }
        showToast(`Enregistrement impossible${detail}`, 'warn');
        return false;
    }

    const data = await res.json();
    applyPlanFromDetail(data);
    if (savedPlanAtMs == null) savedPlanAtMs = Date.now();
    saveState();
    const budgetEl = document.getElementById('budget-input');
    if (budgetEl) budgetEl.value = budget;
    render();
    updateSaveUI();
    if (toastOnSuccess) {
        showToast(
            isUpdate ? 'Plan mis à jour' : 'Plan enregistré',
            'ok'
        );
    }
    return true;
}

async function persistPlanNoteAfterEdit() {
    saveState();
    updateNoteButtonUI();

    if (savedPlanId == null) {
        showToast((planNote || '').trim() ? 'Note enregistrée' : 'Note supprimée', 'ok');
        return true;
    }

    const ok = await persistPlanToDatabase(savedPlanNom, { toastOnSuccess: false });
    if (ok) {
        showToast((planNote || '').trim() ? 'Note enregistrée' : 'Note supprimée', 'ok');
    }
    return ok;
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
    planCurrentPage = 1;
    budget = 0;
    isFige = false;
    savedPlanId = null;
    savedPlanNom = '';
    savedPlanAtMs = null;
    tarifMl = DEFAULT_TARIF_ML;
    planNote = '';
    clearPlanSavedSnapshot();
    saveState();
    render();
    updateSaveUI();
    const budgetEl = document.getElementById('budget-input');
    if (budgetEl) budgetEl.value = 0;
}

/** Quitte le plan en cours : vide le cache actif et revient à l'écran d'accueil. */
function closeCurrentPlan() {
    planItems = [];
    planCurrentPage = 1;
    budget = 0;
    isFige = false;
    savedPlanId = null;
    savedPlanNom = '';
    savedPlanAtMs = null;
    tarifMl = DEFAULT_TARIF_ML;
    planNote = '';
    planUiMode = 'welcome';
    localStorage.removeItem(SESSION_KEY);
    clearPlanSavedSnapshot();
    saveState();
    render();
    updateSaveUI();
    const budgetEl = document.getElementById('budget-input');
    if (budgetEl) budgetEl.value = 0;
}

function showOpenSavedPlans() {
    planUiMode = 'open';
    saveUiMode();
    render();
}

function getPlanPageSlice() {
    const start = (planCurrentPage - 1) * PLAN_PAGE_SIZE;
    return { start, end: start + PLAN_PAGE_SIZE };
}

function goToPlanPage(page) {
    const totalPages = Math.max(1, Math.ceil(planItems.length / PLAN_PAGE_SIZE));
    planCurrentPage = Math.min(Math.max(1, page), totalPages);
    render();
}

function updatePlanPagination(hasPipes, showWelcome, showOpen) {
    const el = document.getElementById('plan-pagination');
    const prev = document.getElementById('plan-page-prev');
    const next = document.getElementById('plan-page-next');
    const info = document.getElementById('plan-page-info');
    if (!el) return;

    const show = hasPipes && !showWelcome && !showOpen;
    el.hidden = !show;
    el.classList.toggle('is-visible', show);
    if (!show) return;

    const total = planItems.length;
    const totalPages = Math.max(1, Math.ceil(total / PLAN_PAGE_SIZE));
    const from = (planCurrentPage - 1) * PLAN_PAGE_SIZE + 1;
    const to = Math.min(planCurrentPage * PLAN_PAGE_SIZE, total);

    if (info) {
        info.textContent = totalPages <= 1
            ? `${total} canalisation${total !== 1 ? 's' : ''}`
            : `Page ${planCurrentPage} / ${totalPages} · ${from}–${to} sur ${total}`;
    }
    if (prev) prev.disabled = planCurrentPage <= 1;
    if (next) next.disabled = planCurrentPage >= totalPages;
}

function getIncludedRowIndices() {
    return planItems.reduce((acc, row, i) => {
        if (row.inclus) acc.push(i);
        return acc;
    }, []);
}

function buildRow(item, index, displayOrder) {
    const tr   = document.createElement('tr');
    const cost = Math.round(item.longueur * tarifMl);

    if (!item.inclus) tr.classList.add('row--excluded');

    const lenStr = formatLengthInputValue(item.longueur);
    const lengthCell = `<div class="length-cell">
               <input type="number" class="length-input" data-id="${item._id}"
                   value="${lenStr}" min="0" step="0.1" style="width:${lengthInputWidthCh(lenStr)}">
               <span class="length-unit">m</span>
           </div>`;

    const orderLabel = displayOrder != null ? `#${displayOrder}` : '—';
    let isFirst;
    let isLast;
    if (item.inclus) {
        const includedIndices = getIncludedRowIndices();
        const posInIncluded = includedIndices.indexOf(index);
        isFirst = posInIncluded <= 0;
        isLast = posInIncluded < 0 || posInIncluded >= includedIndices.length - 1;
    } else {
        isFirst = index <= 0;
        isLast = index >= planItems.length - 1;
    }
    if (planItems.length <= 1) {
        isFirst = true;
        isLast = true;
    }
    const btnUp = isFirst ? '' : `
        <button type="button" class="row-btn row-btn--move row-btn--up" data-id="${item._id}" title="Monter">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                stroke-linecap="round" stroke-linejoin="round">
                <polyline points="18 15 12 9 6 15"/>
            </svg>
        </button>`;
    const btnDown = isLast ? '' : `
        <button type="button" class="row-btn row-btn--move row-btn--down" data-id="${item._id}" title="Descendre">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                stroke-linecap="round" stroke-linejoin="round">
                <polyline points="6 9 12 15 18 9"/>
            </svg>
        </button>`;
    const orderBtns = (btnUp || btnDown)
        ? `<div class="row-order">${btnUp}${btnDown}</div>`
        : '';
    const actions = `
        <button type="button" class="row-btn row-btn--delete" data-id="${item._id}" title="Supprimer du plan">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                stroke-linecap="round" stroke-linejoin="round">
                <polyline points="3 6 5 6 21 6"/>
                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                <path d="M9 6V4h6v2"/>
            </svg>
        </button>
        ${orderBtns}`;

    tr.innerHTML = `
        <td class="col-check">
            <input type="checkbox" class="row-check" data-id="${item._id}"
                ${item.inclus ? 'checked' : ''}>
        </td>
        <td class="col-order${displayOrder == null ? ' col-order--excluded' : ''}">${orderLabel}</td>
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
    const totalC = Math.round(totalL * tarifMl);

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
    const { start, end } = getPlanPageSlice();
    const pageItems = planItems.slice(start, end);
    const n = pageItems.filter(i => i.inclus).length;
    all.indeterminate = n > 0 && n < pageItems.length;
    all.checked       = n === pageItems.length && pageItems.length > 0;
}

// ── Événements (actifs seulement sur plan-travaux.html) ───
function bindPlanPagination() {
    if (document.body.dataset.planPaginationBound === '1') return;
    const prev = document.getElementById('plan-page-prev');
    const next = document.getElementById('plan-page-next');
    if (!prev && !next) return;
    document.body.dataset.planPaginationBound = '1';

    prev?.addEventListener('click', () => goToPlanPage(planCurrentPage - 1));
    next?.addEventListener('click', () => goToPlanPage(planCurrentPage + 1));
}

function bindSidebarActions() {
    if (!document.getElementById('btn-save-plan')) return;
    if (document.body.dataset.planSidebarBound === '1') return;
    document.body.dataset.planSidebarBound = '1';

    document.getElementById('btn-save-plan')?.addEventListener('click', e => {
        e.preventDefault();
        onSavePlanClick();
    });

    document.getElementById('plan-title-edit')?.addEventListener('click', onEditPlanNameClick);
    document.getElementById('plan-tarif-edit')?.addEventListener('click', onEditPlanTarifClick);
    document.getElementById('btn-plan-note')?.addEventListener('click', onEditPlanNoteClick);

    document.getElementById('btn-export-sidebar')?.addEventListener('click', exportCSV);

    document.getElementById('btn-plan-close')?.addEventListener('click', requestClosePlan);

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

function bindEvents() {
    bindSidebarActions();

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
                item.longueur = roundToTenth(parseFloat(e.target.value) || 0);
                e.target.value = formatLengthInputValue(item.longueur);
                e.target.style.width = lengthInputWidthCh(e.target.value);
                saveState();
                updateSummary();
                const costCell = e.target.closest('tr')?.querySelector('.col-cost');
                if (costCell) costCell.textContent = fmtCost(Math.round(item.longueur * tarifMl));
            }
        }
    });

    tbody.addEventListener('click', e => {
        const up = e.target.closest('.row-btn--up');
        if (up) {
            moveItem(up.dataset.id, -1);
            return;
        }
        const down = e.target.closest('.row-btn--down');
        if (down) {
            moveItem(down.dataset.id, 1);
            return;
        }
        const d = e.target.closest('.row-btn--delete');
        if (d) { deleteItem(d.dataset.id); }
    });

    document.getElementById('check-all')?.addEventListener('change', e => {
        const { start, end } = getPlanPageSlice();
        planItems.forEach((item, i) => {
            if (i >= start && i < end) item.inclus = e.target.checked;
        });
        saveState(); render();
    });

    bindPlanPagination();

    const budgetEl = document.getElementById('budget-input');
    if (budgetEl) {
        budgetEl.value = budget;
        budgetEl.addEventListener('input', () => {
            budget = parseFloat(budgetEl.value) || 0;
            saveState(); updateSummary();
        });
    }

}

// ── Actions sur les lignes ────────────────────────────────
function moveItem(id, delta) {
    const idx = planItems.findIndex(i => i._id === id);
    if (idx === -1) return;

    let targetIdx;
    if (planItems[idx].inclus) {
        const includedIndices = getIncludedRowIndices();
        const posInIncluded = includedIndices.indexOf(idx);
        if (posInIncluded === -1) return;
        const targetPos = posInIncluded + delta;
        if (targetPos < 0 || targetPos >= includedIndices.length) return;
        targetIdx = includedIndices[targetPos];
    } else {
        targetIdx = idx + delta;
        if (targetIdx < 0 || targetIdx >= planItems.length) return;
    }

    [planItems[idx], planItems[targetIdx]] = [planItems[targetIdx], planItems[idx]];
    saveState();
    render();
}

function deleteItem(id) {
    planItems = planItems.filter(i => i._id !== id);
    saveState(); render();
}

// ── Sauvegarde en base ────────────────────────────────────
async function onSavePlanClick() {
    if (!planItems.length) {
        showToast('Ajoutez au moins une canalisation avant d\'enregistrer', 'warn');
        return;
    }
    if (savedPlanId != null) {
        await persistPlanToDatabase(savedPlanNom);
        return;
    }
    openPlanNameModal(async nom => {
        await persistPlanToDatabase(nom);
    });
}

function updateNoteButtonUI() {
    const btn = document.getElementById('btn-plan-note');
    const dot = document.getElementById('btn-plan-note-dot');
    const label = document.getElementById('btn-plan-note-label');
    if (!btn) return;

    const onPlanScreen = planUiMode !== 'welcome' && planUiMode !== 'open' && planItems.length > 0;
    btn.hidden = !onPlanScreen;

    const hasNote = Boolean((planNote || '').trim());
    if (label) label.textContent = hasNote ? 'Voir la note' : 'Note';
    btn.title = hasNote ? 'Modifier la note du plan' : 'Ajouter une note au plan';
    btn.setAttribute('aria-label', btn.title);
    if (dot) dot.hidden = !hasNote;
}

function onEditPlanNoteClick() {
    const current = planNote || '';
    const hasNote = Boolean(current.trim());

    openPlanNoteModal(async text => {
        const next = text.trim();
        if (next === current.trim()) return;
        planNote = text;
        await persistPlanNoteAfterEdit();
    }, {
        initialValue: current,
        title: hasNote ? 'Note du plan' : 'Ajouter une note',
        message: '',
    });
}

function onEditPlanTarifClick() {
    openPlanTarifModal(value => {
        const next = Math.round(parseFloat(value) || 0);
        if (!Number.isFinite(next) || next <= 0) {
            showToast('Indiquez un tarif strictement positif', 'warn');
            return;
        }
        if (next === tarifMl) return;
        tarifMl = next;
        saveState();
        render();
        showToast('Tarif modifié — cliquez sur Sauvegarder pour enregistrer en base', 'ok');
    }, {
        initialValue: tarifMl,
        message: 'Le nouveau tarif sera enregistré en base lorsque vous cliquerez sur Sauvegarder.',
    });
}

function onEditPlanNameClick() {
    const current = (savedPlanNom || '').trim();
    if (!current) return;

    openPlanNameModal(nom => {
        if (nom === current) return;
        savedPlanNom = nom;
        saveState();
        updateSaveUI();
        showToast('Nom modifié — cliquez sur Sauvegarder pour enregistrer en base', 'ok');
    }, {
        initialValue: current,
        title: 'Renommer le plan',
        message: 'Le nouveau nom sera enregistré en base lorsque vous cliquerez sur Sauvegarder.',
        submitLabel: 'Valider',
    });
}

function updatePlanTitle() {
    const titleEl = document.getElementById('plan-title');
    const editBtn = document.getElementById('plan-title-edit');
    const nom = (savedPlanNom || '').trim();
    const label = nom || PLAN_TITLE_DEFAULT;
    if (titleEl) titleEl.textContent = label;
    document.title = nom
        ? `RenovTaCana — ${nom}`
        : 'RenovTaCana — Plan de travaux';

    const onPlanScreen = planUiMode !== 'welcome' && planUiMode !== 'open' && planItems.length > 0;
    const showEdit = Boolean(nom) && onPlanScreen;
    if (editBtn) {
        editBtn.hidden = !showEdit;
    }
}

function formatSavedAtLabel(ms) {
    if (!Number.isFinite(ms) || ms <= 0) return null;
    const date = new Date(ms);
    if (!Number.isFinite(date.getTime())) return null;
    return date.toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });
}

function formatSavedBadgeText() {
    const when = formatSavedAtLabel(savedPlanAtMs);
    return when ? `Plan enregistré — ${when}` : '';
}

let hydrateSavedAtPromise = null;

async function hydrateSavedPlanAt() {
    if (!savedPlanId || savedPlanAtMs != null) return;
    if (hydrateSavedAtPromise) {
        await hydrateSavedAtPromise;
        return;
    }
    hydrateSavedAtPromise = (async () => {
        try {
            const res = await fetch(`${planApiBase()}/${savedPlanId}`);
            if (!res.ok) return;
            const detail = await res.json();
            const ms = resolveSavedAtMs(detail);
            if (ms) {
                savedPlanAtMs = ms;
                saveState();
            }
        } catch { /* API indisponible */ }
    })();
    try {
        await hydrateSavedAtPromise;
    } finally {
        hydrateSavedAtPromise = null;
    }
}

function formatTarifLabel(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return '—';
    const amount = new Intl.NumberFormat('fr-FR', {
        style: 'currency',
        currency: 'EUR',
        maximumFractionDigits: 0,
    }).format(n);
    return `${amount} / ml`;
}

function updateTarifUI() {
    const display = document.getElementById('plan-tarif-display');
    const editBtn = document.getElementById('plan-tarif-edit');
    if (display) display.textContent = formatTarifLabel(tarifMl);

    const onPlanScreen = planUiMode !== 'welcome' && planUiMode !== 'open' && planItems.length > 0;
    if (editBtn) editBtn.hidden = !onPlanScreen;
}

function updateSaveUI() {
    updatePlanTitle();
    updateTarifUI();
    updateNoteButtonUI();
    const btn = document.getElementById('btn-save-plan');
    const badge = document.getElementById('plan-saved-badge');
    const badgeText = document.getElementById('plan-saved-badge-text');
    const saveSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;flex-shrink:0"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>`;
    if (btn) {
        btn.innerHTML = saveSvg + ' Sauvegarder';
        btn.disabled = false;
        btn.removeAttribute('disabled');
    }
    if (badge) {
        badge.hidden = !savedPlanId;
        badge.style.display = savedPlanId ? 'flex' : 'none';
    }
    if (badgeText && savedPlanId) {
        const label = formatSavedBadgeText();
        badgeText.textContent = label;
        if (!label) {
            hydrateSavedPlanAt().then(() => {
                if (savedPlanId) badgeText.textContent = formatSavedBadgeText();
            });
        }
    } else if (badgeText) {
        badgeText.textContent = '';
    }
}

let planNameModalOnSubmit = null;

function closePlanNameModal() {
    const modal = document.getElementById('plan-name-modal');
    if (!modal) return;
    modal.setAttribute('aria-hidden', 'true');
    modal.classList.remove('is-open');
    document.body.classList.remove('plan-name-open');
    planNameModalOnSubmit = null;
}

function openPlanNameModal(onSubmit, options = {}) {
    const {
        initialValue = '',
        title = 'Nom du plan',
        message = 'Donnez un nom à ce plan de travaux pour l\'enregistrer en base.',
        submitLabel = 'Enregistrer',
    } = options;

    const modal = document.getElementById('plan-name-modal');
    const input = document.getElementById('plan-name-input');
    if (!modal || !input) {
        const nom = window.prompt('Nom du plan de travaux :', initialValue);
        if (nom?.trim()) onSubmit?.(nom.trim());
        return;
    }

    const titleEl = document.getElementById('plan-name-title');
    const messageEl = document.getElementById('plan-name-message');
    const submitBtn = document.getElementById('plan-name-submit');
    if (titleEl) titleEl.textContent = title;
    if (messageEl) messageEl.textContent = message;
    if (submitBtn) submitBtn.textContent = submitLabel;

    planNameModalOnSubmit = onSubmit;
    input.value = initialValue;
    modal.setAttribute('aria-hidden', 'false');
    modal.classList.add('is-open');
    document.body.classList.add('plan-name-open');
    input.focus();
    input.select();
}

let planNoteModalOnSubmit = null;

function closePlanNoteModal() {
    const modal = document.getElementById('plan-note-modal');
    if (!modal) return;
    modal.setAttribute('aria-hidden', 'true');
    modal.classList.remove('is-open');
    document.body.classList.remove('plan-note-open');
    planNoteModalOnSubmit = null;
}

function openPlanNoteModal(onSubmit, options = {}) {
    const {
        initialValue = '',
        title = 'Note du plan',
        message = '',
    } = options;

    const modal = document.getElementById('plan-note-modal');
    const input = document.getElementById('plan-note-input');
    if (!modal || !input) {
        const raw = window.prompt('Note du plan :', initialValue);
        if (raw != null) onSubmit?.(raw);
        return;
    }

    const titleEl = document.getElementById('plan-note-title');
    const messageEl = document.getElementById('plan-note-message');
    if (titleEl) titleEl.textContent = title;
    if (messageEl) {
        messageEl.textContent = message;
        messageEl.hidden = !message;
    }

    planNoteModalOnSubmit = onSubmit;
    input.value = initialValue;
    modal.setAttribute('aria-hidden', 'false');
    modal.classList.add('is-open');
    document.body.classList.add('plan-note-open');
    input.focus();
}

function initPlanNoteModal() {
    const modal = document.getElementById('plan-note-modal');
    if (!modal) return;

    document.getElementById('plan-note-backdrop')?.addEventListener('click', closePlanNoteModal);
    document.getElementById('plan-note-cancel')?.addEventListener('click', closePlanNoteModal);

    const submit = async () => {
        const input = document.getElementById('plan-note-input');
        const fn = planNoteModalOnSubmit;
        closePlanNoteModal();
        await fn?.(input?.value ?? '');
    };

    document.getElementById('plan-note-submit')?.addEventListener('click', submit);
    document.getElementById('plan-note-input')?.addEventListener('keydown', e => {
        if (e.key === 'Escape') {
            e.preventDefault();
            closePlanNoteModal();
        }
    });

    document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && modal.getAttribute('aria-hidden') === 'false') {
            closePlanNoteModal();
        }
    });
}

let planTarifModalOnSubmit = null;

function closePlanTarifModal() {
    const modal = document.getElementById('plan-tarif-modal');
    if (!modal) return;
    modal.setAttribute('aria-hidden', 'true');
    modal.classList.remove('is-open');
    document.body.classList.remove('plan-tarif-open');
    planTarifModalOnSubmit = null;
}

function openPlanTarifModal(onSubmit, options = {}) {
    const {
        initialValue = DEFAULT_TARIF_ML,
        message = 'Indiquez le tarif en euros par mètre linéaire pour estimer les coûts du plan.',
    } = options;

    const modal = document.getElementById('plan-tarif-modal');
    const input = document.getElementById('plan-tarif-input');
    if (!modal || !input) {
        const raw = window.prompt('Tarif (€ / ml) :', String(initialValue));
        const value = parseFloat(raw);
        if (Number.isFinite(value) && value > 0) onSubmit?.(value);
        return;
    }

    const messageEl = document.getElementById('plan-tarif-message');
    if (messageEl) messageEl.textContent = message;

    planTarifModalOnSubmit = onSubmit;
    input.value = String(initialValue);
    modal.setAttribute('aria-hidden', 'false');
    modal.classList.add('is-open');
    document.body.classList.add('plan-tarif-open');
    input.focus();
    input.select();
}

function initPlanTarifModal() {
    const modal = document.getElementById('plan-tarif-modal');
    if (!modal) return;

    document.getElementById('plan-tarif-backdrop')?.addEventListener('click', closePlanTarifModal);
    document.getElementById('plan-tarif-cancel')?.addEventListener('click', closePlanTarifModal);

    const submit = async () => {
        const input = document.getElementById('plan-tarif-input');
        const value = parseFloat(input?.value);
        if (!Number.isFinite(value) || value <= 0) {
            showToast('Indiquez un tarif strictement positif', 'warn');
            input?.focus();
            return;
        }
        const fn = planTarifModalOnSubmit;
        closePlanTarifModal();
        await fn?.(value);
    };

    document.getElementById('plan-tarif-submit')?.addEventListener('click', submit);
    document.getElementById('plan-tarif-input')?.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
            e.preventDefault();
            submit();
        }
        if (e.key === 'Escape') {
            e.preventDefault();
            closePlanTarifModal();
        }
    });

    document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && modal.getAttribute('aria-hidden') === 'false') {
            closePlanTarifModal();
        }
    });
}

function initPlanNameModal() {
    const modal = document.getElementById('plan-name-modal');
    if (!modal) return;

    document.getElementById('plan-name-backdrop')?.addEventListener('click', closePlanNameModal);
    document.getElementById('plan-name-cancel')?.addEventListener('click', closePlanNameModal);

    const submit = async () => {
        const input = document.getElementById('plan-name-input');
        const nom = input?.value?.trim() || '';
        if (!nom) {
            showToast('Indiquez un nom pour le plan', 'warn');
            input?.focus();
            return;
        }
        const fn = planNameModalOnSubmit;
        closePlanNameModal();
        await fn?.(nom);
    };

    document.getElementById('plan-name-submit')?.addEventListener('click', submit);
    document.getElementById('plan-name-input')?.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
            e.preventDefault();
            submit();
        }
        if (e.key === 'Escape') {
            e.preventDefault();
            closePlanNameModal();
        }
    });

    document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && modal.getAttribute('aria-hidden') === 'false') {
            closePlanNameModal();
        }
    });
}

// ── Export CSV ────────────────────────────────────────────
function sanitizePlanExportBasename(name) {
    const raw = (name || savedPlanNom || PLAN_TITLE_DEFAULT).trim() || PLAN_TITLE_DEFAULT;
    const ascii = raw.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const safe = ascii
        .replace(/[<>:"/\\|?*]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/ /g, '-')
        .replace(/-+/g, '-')
        .replace(/^-+|-+$/g, '');
    return safe.slice(0, 80) || 'plan-de-travaux';
}

function formatExportTimestamp(date = new Date()) {
    const p = n => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}_${p(date.getHours())}-${p(date.getMinutes())}-${p(date.getSeconds())}`;
}

function buildPlanExportFilename() {
    return `${sanitizePlanExportBasename(savedPlanNom)}-${formatExportTimestamp()}.csv`;
}

function getIncludedPlanItemsInOrder() {
    return planItems.filter(i => i.inclus);
}

function exportCSV() {
    if (!planItems.length) { showToast('Le plan est vide', 'warn'); return; }

    const rows = getIncludedPlanItemsInOrder();
    if (!rows.length) { showToast('Aucune ligne cochée à exporter', 'warn'); return; }

    const sep = ';';
    const hdr = ['Ordre', 'ID Canalisation', 'Adresse', 'Matériau', 'Ø (mm)', 'Longueur (m)', 'Coût estimé (€)'].join(sep);
    const body = rows.map((i, index) => [
        index + 1,
        i.facilityid,
        `"${(i.adresse || '').replace(/"/g, '""')}"`,
        i.materiau,
        i.diametre ?? '',
        formatLengthInputValue(i.longueur),
        Math.round(i.longueur * tarifMl),
    ].join(sep)).join('\n');

    const blob = new Blob(['\uFEFF' + hdr + '\n' + body], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = Object.assign(document.createElement('a'), {
        href: url,
        download: buildPlanExportFilename(),
    });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast(`Export CSV — ${rows.length} ligne${rows.length !== 1 ? 's' : ''} cochée${rows.length !== 1 ? 's' : ''}`, 'ok');
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
const roundToTenth = n => Math.round((Number(n) || 0) * 10) / 10;
const formatLengthInputValue = n => roundToTenth(n).toFixed(1);
const lengthInputWidthCh = str => `${Math.max(String(str).length, 3)}ch`;

function critColor(c) {
    if (c == null) return 'var(--c-neutral, #64748b)';
    if (c >= 70)   return '#ef4444';
    if (c >= 40)   return '#f97316';
    if (c >= 20)   return '#eab308';
    return '#00d4aa';
}

// ── Init ──────────────────────────────────────────────────
async function refreshPlanFromStorage() {
    loadState();
    if (!document.getElementById('plan-tbody')) return;
    await hydrateSavedPlanAt();
    await reconcilePlanSavedSnapshot();
    render();
    updateSaveUI();
}

async function initPlanTravaux() {
    loadState();
    initPlanConfirm();
    initPlanNameModal();
    initPlanTarifModal();
    initPlanNoteModal();
    await hydrateSavedPlanAt();
    await reconcilePlanSavedSnapshot();
    render();
    bindEvents();
    bindSidebarActions();
    updateSaveUI();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { initPlanTravaux(); });
} else {
    initPlanTravaux();
}

window.addEventListener('pageshow', e => {
    if (e.persisted) refreshPlanFromStorage();
});

window.addEventListener('storage', e => {
    if (e.key === PLAN_KEY || e.key === BUDGET_KEY || e.key === TARIF_KEY || e.key === NOTE_KEY
        || e.key === SAVED_ID_KEY || e.key === SAVED_NOM_KEY || e.key === SAVED_AT_KEY) {
        refreshPlanFromStorage();
    }
});
