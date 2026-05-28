/**
 * dashboard.js — Tableau de bord RenovTaCana
 */

const API = window.__RTC_API_BASE__ || "http://127.0.0.1:8000";
let planData = [];
let planCommune = "";
let planAdresseSearch = "";
let planPage = 1;
let planTotal = 0;
let planLoadId = 0;
const PLAN_PAGE_SIZE = 20;
const PLAN_STORAGE_KEY = "rtc_plan_travaux";
const PLAN_VALIDATE_LABEL_BASE = "Sélectionner pour le plan de travaux";
const COMMUNE_LABELS = new Map();
const selectedPlanRows = new Map();

/** Cache localStorage plan de travaux (affichage immédiat même « périmé », refresh réseau en arrière-plan). */
const DASH_CACHE_VER = 9;
const DASH_CACHE_PREFIX = `rtc_dash_v${DASH_CACHE_VER}_`;

let planTableOffset = 0;
let planPriorityScoresComputed = true;

function dashStableHash(str) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 16777619) >>> 0;
    }
    return h.toString(16);
}

/**
 * Lit le cache plan : la clé inclut déjà hash(qs), pas besoin de ré-égaler la chaîne
 * (évite les ratés si encodage / ordre des params diffère).
 */
function readDashPlanPayload(cacheKey) {
    try {
        const raw = localStorage.getItem(cacheKey);
        if (!raw) return null;
        const o = JSON.parse(raw);
        const p = o?.payload;
        if (!p || typeof p !== "object" || !Array.isArray(p.canalisations)) return null;
        return p;
    } catch (_) {
        return null;
    }
}

/** Payload JSON pour clés fixes (dashboard, filtres). */
function readDashStoragePayload(key) {
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return null;
        const o = JSON.parse(raw);
        return o?.payload ?? null;
    } catch (_) {
        return null;
    }
}

function localStorageRemoveKeys(predicate) {
    for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (k && predicate(k)) localStorage.removeItem(k);
    }
}

function writeDashCache(key, fields) {
    let blob;
    try {
        blob = JSON.stringify({ t: Date.now(), ...fields });
    } catch (_) {
        return;
    }
    const trySet = () => localStorage.setItem(key, blob);
    try {
        trySet();
    } catch (e) {
        if (e.name === "QuotaExceededError" || e.code === 22) {
            try {
                localStorageRemoveKeys(k => k.startsWith(DASH_CACHE_PREFIX) && k.includes("_plan_"));
                trySet();
            } catch (_) {
                try {
                    // Libère souvent de la place (cache pagination index)
                    localStorageRemoveKeys(k => k.includes("_canal_"));
                    trySet();
                } catch (_) { /* ignore */ }
            }
        }
    }
}

function normalizePlanAdresseForApi(adresse) {
    const raw = String(adresse || "").trim();
    if (!raw) return "";
    const beforeComma = raw.split(",")[0].trim();
    return beforeComma || raw;
}

function buildPlanTravauxQueryString(commune, offset, adresse = planAdresseSearch) {
    const params = new URLSearchParams({
        limit: String(PLAN_PAGE_SIZE),
        offset: String(offset),
    });
    if (commune) params.append("commune", commune);
    if (adresse) params.append("adresse", adresse);
    return params.toString();
}

function syncPlanCommuneFromSelect() {
    const sel = document.getElementById("plan-commune");
    if (sel) planCommune = sel.value || "";
    return planCommune;
}

async function applyPlanAdresseSearch(raw) {
    const next = normalizePlanAdresseForApi(raw);
    if (next === planAdresseSearch) return;
    const clearingOnly = Boolean(planAdresseSearch) && !next;
    planAdresseSearch = next;
    if (!clearingOnly) {
        selectedPlanRows.clear();
        syncPlanSelectionUi();
    }
    await loadPlanTravaux(0);
}

function bindPlanSearchBar() {
    const form = document.getElementById("plan-search-form");
    if (!form) return;
    const input = form.querySelector(".search-bar__input");
    let inputDebounceId = null;

    form.addEventListener("submit", e => {
        e.preventDefault();
        void applyPlanAdresseSearch(input?.value.trim() || "");
    });

    form.querySelector(".search-bar__clear-button")?.addEventListener("click", () => {
        setTimeout(() => void applyPlanAdresseSearch(""), 0);
    });

    input?.addEventListener("input", () => {
        clearTimeout(inputDebounceId);
        inputDebounceId = setTimeout(() => {
            const v = input.value.trim();
            if (!v && planAdresseSearch) void applyPlanAdresseSearch("");
        }, 280);
    });
}

document.addEventListener("DOMContentLoaded", async function () {
    // Paralléliser ; chaque charge peut sortir vite depuis le cache localStorage + refresh réseau en fond.
    await Promise.all([
        loadDashboard(),
        loadCommunes(),
        loadPlanTravaux(0),
    ]);

    on("plan-commune", "change", async function () {
        syncPlanCommuneFromSelect();
        selectedPlanRows.clear();
        syncPlanSelectionUi();
        await loadPlanTravaux(0);
    });

    on("export-plan", "click", exportPlanCSV);
    on("validate-work-plan", "click", validateSelectedWorkPlan);
    on("plan-select-all", "click", toggleAllVisiblePlanRows);
    bindPlanSearchBar();
});

// ── Dashboard principal ───────────────────────────────────
function applyDashboardPayload(data) {
    setEl("kpi-total",     data.total_canalisations.toLocaleString("fr-FR"));
    setEl("kpi-critiques", data.critiques.toLocaleString("fr-FR"));
    setEl("kpi-attention", data.attention.toLocaleString("fr-FR"));
    setEl("kpi-chantiers", data.nb_chantiers.toLocaleString("fr-FR"));
    setEl("kpi-chantiers-missing", Number(data.chantiers_missing_adresse || 0).toLocaleString("fr-FR"));
    setEl("kpi-operations-missing", Number(data.operations_missing_adresse || 0).toLocaleString("fr-FR"));
    setEl("kpi-crit-moy",  `${data.criticite_moyenne}%`);

    const total = data.total_canalisations;
    animBar("bar-critique", "val-critique", data.critiques, total);
    animBar("bar-attention", "val-attention", data.attention, total);
    animBar("bar-bon",       "val-bon",       data.bon,       total);
    animBar("bar-neval",     "val-neval",     data.non_eval,  total);

    renderChantiersEtat(data.chantiers_etat, data.nb_chantiers);
    renderMateriaux(data.materiaux);
    renderAnnees(data.annees);
}

async function refreshDashboardInBackground(cacheKey) {
    try {
        const res = await fetch(`${API}/api/dashboard`);
        if (!res.ok) return;
        const data = await res.json();
        writeDashCache(cacheKey, { payload: data });
        applyDashboardPayload(data);
    } catch (_) { /* garder l’affichage cache */ }
}

async function loadDashboard() {
    const cacheKey = `${DASH_CACHE_PREFIX}dashboard`;
    const cached = readDashStoragePayload(cacheKey);
    if (cached) {
        applyDashboardPayload(cached);
        void refreshDashboardInBackground(cacheKey);
        return;
    }
    try {
        const res  = await fetch(`${API}/api/dashboard`);
        if (!res.ok) throw new Error(String(res.status));
        const data = await res.json();
        writeDashCache(cacheKey, { payload: data });
        applyDashboardPayload(data);
    } catch (e) {
        console.error("Erreur dashboard:", e);
    }
}

// ── Barre animée ──────────────────────────────────────────
function animBar(barId, valId, count, total) {
    const pct = total > 0 ? (count / total * 100) : 0;
    setEl(valId, count.toLocaleString("fr-FR"));
    setTimeout(() => {
        const el = document.getElementById(barId);
        if (el) el.style.width = `${pct}%`;
    }, 100);
}

// ── Chantiers par état ────────────────────────────────────
function renderChantiersEtat(data, total) {
    const colors = {
        "Planifié":                    "crit-bar-fill--success",
        "Validé en planification":     "crit-bar-fill--cyan",
        "En attente de planification": "crit-bar-fill--neutral",
    };
    const container = document.getElementById("chantiers-bars");
    if (!container) return;
    container.innerHTML = data.map(r => `
        <div class="crit-bar-row">
            <span class="crit-bar-label" style="font-size:0.72rem">${r.etat}</span>
            <div class="crit-bar-track">
                <div class="crit-bar-fill ${colors[r.etat] || 'crit-bar-fill--neutral'}"
                     style="width:0%" data-target="${(r.count/total*100).toFixed(1)}"></div>
            </div>
            <span class="crit-bar-val">${r.count.toLocaleString("fr-FR")}</span>
        </div>
    `).join("");

    setTimeout(() => {
        container.querySelectorAll(".crit-bar-fill[data-target]").forEach(el => {
            el.style.width = el.dataset.target + "%";
        });
    }, 150);
}

// ── Matériaux ─────────────────────────────────────────────
function renderMateriaux(data) {
    const maxCount = Math.max(...data.map(d => d.count));
    const container = document.getElementById("mat-grid");
    if (!container) return;
    container.innerHTML = data.map(m => {
        const critCls = m.crit_moy >= 15 ? "mat-crit--high" : m.crit_moy >= 8 ? "mat-crit--mid" : "mat-crit--low";
        const pct = (m.count / maxCount * 100).toFixed(0);
        return `
        <div class="mat-row">
            <span class="mat-name">${m.nom}</span>
            <div class="crit-bar-track">
                <div class="crit-bar-fill crit-bar-fill--blue" style="width:0%" data-target="${pct}"></div>
            </div>
            <span class="mat-count">${m.count.toLocaleString("fr-FR")}</span>
            <span class="mat-crit ${critCls}">${m.crit_moy}%</span>
        </div>`;
    }).join("");

    setTimeout(() => {
        container.querySelectorAll(".crit-bar-fill[data-target]").forEach(el => {
            el.style.width = el.dataset.target + "%";
        });
    }, 200);
}

// ── Années de pose ────────────────────────────────────────
function renderAnnees(data) {
    const maxCount = Math.max(...data.map(d => d.count));
    const container = document.getElementById("annees-bars");
    if (!container) return;
    container.innerHTML = data.map(a => {
        const pct = (a.count / maxCount * 100).toFixed(0);
        const critCls = a.crit_moy >= 15 ? "crit-bar-fill--warning" : a.crit_moy >= 8 ? "crit-bar-fill--cyan" : "crit-bar-fill--success";
        return `
        <div class="crit-bar-row">
            <span class="crit-bar-label">${a.periode}</span>
            <div class="crit-bar-track">
                <div class="crit-bar-fill ${critCls}" style="width:0%" data-target="${pct}"></div>
            </div>
            <span class="crit-bar-val">${a.count.toLocaleString("fr-FR")}</span>
        </div>`;
    }).join("");

    setTimeout(() => {
        container.querySelectorAll(".crit-bar-fill[data-target]").forEach(el => {
            el.style.width = el.dataset.target + "%";
        });
    }, 250);
}

// ── Plan de travaux ───────────────────────────────────────
function togglePlanScoresMissing(show) {
    const panel = document.getElementById("plan-scores-missing");
    const wrap = document.getElementById("plan-table-wrap");
    if (panel) {
        panel.classList.toggle("is-visible", show);
        panel.hidden = !show;
    }
    if (wrap) {
        wrap.classList.toggle("is-hidden", show);
        wrap.hidden = show;
    }
}

function applyPlanPayloadMeta(payload) {
    planPriorityScoresComputed = payload?.priority_scores_computed === true;
    if (payload && typeof payload.total === "number") {
        planTotal = payload.total;
    }
}

function getPlanPageNumbers(current, total) {
    if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
    if (current <= 4) return [1, 2, 3, 4, 5, "…", total];
    if (current >= total - 3) return [1, "…", total - 4, total - 3, total - 2, total - 1, total];
    return [1, "…", current - 1, current, current + 1, "…", total];
}

function setPlanPaginationLoading(loading) {
    document.getElementById("plan-pagination")?.classList.toggle("is-loading", loading);
    const table = document.getElementById("plan-table");
    if (table) table.setAttribute("aria-busy", loading ? "true" : "false");
}

function renderPlanPagination() {
    const nav = document.getElementById("plan-pagination");
    if (!nav) return;

    if (!planPriorityScoresComputed || planTotal <= 0) {
        nav.hidden = true;
        nav.innerHTML = "";
        return;
    }

    const totalPages = Math.max(1, Math.ceil(planTotal / PLAN_PAGE_SIZE));
    const showNav = totalPages > 1;

    nav.hidden = false;
    nav.innerHTML = "";

    const prev = document.createElement("button");
    prev.type = "button";
    prev.className = `page-btn ${planPage === 1 ? "page-btn--disabled" : ""}`;
    prev.disabled = planPage === 1;
    prev.setAttribute("aria-label", "Page précédente");
    prev.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>`;
    prev.addEventListener("click", () => fetchPlanPage(planPage - 1));

    const pagesEl = document.createElement("div");
    pagesEl.className = "page-numbers";

    if (showNav) {
        getPlanPageNumbers(planPage, totalPages).forEach(p => {
            if (p === "…") {
                const sep = document.createElement("span");
                sep.className = "page-sep";
                sep.textContent = "…";
                pagesEl.appendChild(sep);
            } else {
                const btn = document.createElement("button");
                btn.type = "button";
                btn.className = `page-btn ${p === planPage ? "page-btn--active" : ""}`;
                btn.textContent = String(p);
                btn.setAttribute("aria-label", `Page ${p}`);
                if (p === planPage) btn.setAttribute("aria-current", "page");
                btn.addEventListener("click", () => fetchPlanPage(p));
                pagesEl.appendChild(btn);
            }
        });
    }

    const next = document.createElement("button");
    next.type = "button";
    next.className = `page-btn ${planPage === totalPages ? "page-btn--disabled" : ""}`;
    next.disabled = planPage === totalPages;
    next.setAttribute("aria-label", "Page suivante");
    next.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>`;
    next.addEventListener("click", () => fetchPlanPage(planPage + 1));

    const info = document.createElement("span");
    info.className = "page-info";
    const from = planTotal === 0 ? 0 : (planPage - 1) * PLAN_PAGE_SIZE + 1;
    const to = Math.min(planPage * PLAN_PAGE_SIZE, planTotal);
    const pagePart = showNav ? ` · page ${planPage}/${totalPages}` : "";
    info.textContent = `${from.toLocaleString("fr-FR")}–${to.toLocaleString("fr-FR")} sur ${planTotal.toLocaleString("fr-FR")}${pagePart}`;

    if (showNav) {
        nav.append(prev, pagesEl, next, info);
    } else {
        nav.append(info);
    }
}

function fetchPlanPage(page) {
    const totalPages = Math.max(1, Math.ceil(planTotal / PLAN_PAGE_SIZE));
    if (page < 1 || page > totalPages || page === planPage) return;
    const offset = (page - 1) * PLAN_PAGE_SIZE;
    void loadPlanTravaux(offset);
    document.getElementById("plan-table-wrap")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function isPlanCacheUsable(payload) {
    return Boolean(payload && payload.priority_scores_computed === true);
}

async function refreshPlanTravauxInBackground(cacheKey, qs, offset, loadId) {
    try {
        const res = await fetch(`${API}/api/plan-travaux?${qs}`);
        if (!res.ok) return;
        const json = await res.json();
        if (loadId !== planLoadId) return;
        if (buildPlanTravauxQueryString(planCommune, offset) !== qs) return;
        applyPlanPayloadMeta(json);
        writeDashCache(cacheKey, { qs, payload: json });
        planData = json.canalisations || [];
        await hydrateCommuneLabels(planData.map(r => r.commune));
        if (loadId !== planLoadId) return;
        planTableOffset = offset;
        planPage = Math.floor(offset / PLAN_PAGE_SIZE) + 1;
        renderPlanTable(planData, offset);
    } catch (_) { /* garder l’affichage actuel */ }
}

async function loadPlanTravaux(offset = 0) {
    const tbody = document.getElementById("plan-body");
    if (!tbody) return;

    const commune = syncPlanCommuneFromSelect();
    const loadId = ++planLoadId;
    planPage = Math.floor(offset / PLAN_PAGE_SIZE) + 1;
    planTableOffset = offset;

    const qs = buildPlanTravauxQueryString(commune, offset);
    const cacheKey = `${DASH_CACHE_PREFIX}plan_${dashStableHash(qs)}`;
    const cachedPayload = readDashPlanPayload(cacheKey);

    const applyPayload = async (payload, fromCache) => {
        if (loadId !== planLoadId) return;
        applyPlanPayloadMeta(payload);
        planData = payload.canalisations || [];
        planTableOffset = offset;
        planPage = Math.floor(offset / PLAN_PAGE_SIZE) + 1;
        renderPlanTable(planData, offset);
        await hydrateCommuneLabels(planData.map(r => r.commune));
        if (loadId !== planLoadId) return;
        renderPlanTable(planData, offset);
        setPlanPaginationLoading(false);
        if (!fromCache) renderPlanPagination();
    };

    if (isPlanCacheUsable(cachedPayload)) {
        await applyPayload(cachedPayload, true);
        if (loadId !== planLoadId) return;
        renderPlanPagination();
        void refreshPlanTravauxInBackground(cacheKey, qs, offset, loadId);
        return;
    }

    setPlanPaginationLoading(true);
    tbody.innerHTML = `<tr class="row-loading"><td colspan="8">Chargement…</td></tr>`;

    try {
        const res = await fetch(`${API}/api/plan-travaux?${qs}`);
        if (!res.ok) throw new Error(String(res.status));
        const json = await res.json();
        if (loadId !== planLoadId) return;
        writeDashCache(cacheKey, { qs, payload: json });
        await applyPayload(json, false);
        if (loadId !== planLoadId) return;
        renderPlanPagination();
    } catch (e) {
        if (loadId !== planLoadId) return;
        setPlanPaginationLoading(false);
        planTotal = 0;
        renderPlanPagination();
        togglePlanScoresMissing(false);
        tbody.innerHTML = `<tr class="row-empty-msg"><td colspan="8">Erreur chargement</td></tr>`;
    }
}

function renderPlanTable(data, offset = 0) {
    const tbody = document.getElementById("plan-body");
    if (!planPriorityScoresComputed) {
        togglePlanScoresMissing(true);
        tbody.innerHTML = "";
        planTotal = 0;
        renderPlanPagination();
        updatePlanSelectAllControl();
        return;
    }

    togglePlanScoresMissing(false);

    if (!data.length) {
        tbody.innerHTML = `<tr class="row-empty-msg"><td colspan="8">Aucune donnée</td></tr>`;
        renderPlanPagination();
        updatePlanSelectAllControl();
        return;
    }
    tbody.innerHTML = data.map((r, i) => {
        const rang = offset + i + 1;
        const scoreVal = r.score_priorite ?? r.score_max ?? r.avg_score ?? 0;
        const scorePct = Math.min(Number(scoreVal) || 0, 100);
        const crit = Number(r.criticite ?? r.crit_moy ?? 0);
        const critCls = crit >= 70 ? "table-pill--danger" : crit >= 40 ? "table-pill--warning" : "table-pill--success";
        const fuites = Number(r.nb_fuites ?? r.total_fuites ?? 0);
        const longueur = r.longueur != null ? Number(r.longueur).toFixed(1) : "—";
        const communeCode = normalizeCommuneCode(r.commune);
        const communeLabel = COMMUNE_LABELS.get(communeCode) || communeCode || "—";
        const key = planRowKey(r);
        const checked = selectedPlanRows.has(key) ? "checked" : "";
        const fuitesClass = fuites > 5 ? "plan-col-fuites plan-col-fuites--high" : "plan-col-fuites";
        return `<tr>
            <td class="plan-col-rang">#${rang}</td>
            <td class="plan-col-adresse">${escapeAttr(r.adresse || "—")}</td>
            <td class="plan-col-commune">${communeLabel}</td>
            <td class="plan-col-score">
                <div class="score-pill">
                    <div class="score-bar"><div class="score-bar__fill" style="width:${scorePct}%"></div></div>
                    <span class="score-pill__value">${scoreVal}</span>
                </div>
            </td>
            <td class="plan-col-crit"><span class="table-pill ${critCls}">${crit}%</span></td>
            <td class="${fuitesClass}">${fuites}</td>
            <td class="plan-col-longueur">${longueur} m</td>
            <td class="plan-col-action">
                <div class="row-actions">
                    <input type="checkbox" class="plan-row-check" data-plan-key="${escapeAttr(key)}" ${checked}
                        aria-label="Selectionner ${escapeAttr(r.facilityid || r.adresse || "cette canalisation")}">
                    <a class="row-action-btn row-action-btn--locate" href="index.html?adresse=${encodeURIComponent(r.adresse || "")}"
                        title="Voir l'adresse" aria-label="Voir l'adresse">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <circle cx="11" cy="11" r="8"></circle>
                            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                        </svg>
                    </a>
                </div>
            </td>
        </tr>`;
    }).join("");
    bindPlanSelectionRows(data);
    syncPlanSelectionUi();
    renderPlanPagination();
}

function planRowKey(row) {
    return String(row.facilityid || row.id || "").trim();
}

function areAllVisiblePlanRowsSelected() {
    const keys = planData.map(planRowKey).filter(Boolean);
    return keys.length > 0 && keys.every(k => selectedPlanRows.has(k));
}

function toggleAllVisiblePlanRows() {
    const select = !areAllVisiblePlanRowsSelected();
    planData.forEach(row => {
        const key = planRowKey(row);
        if (!key) return;
        if (select) selectedPlanRows.set(key, row);
        else selectedPlanRows.delete(key);
    });
    syncPlanRowCheckboxes();
}

function syncPlanRowCheckboxes() {
    document.querySelectorAll(".plan-row-check").forEach(check => {
        check.checked = selectedPlanRows.has(check.dataset.planKey);
    });
    syncPlanSelectionUi();
}

function updatePlanSelectAllControl() {
    const btn = document.getElementById("plan-select-all");
    if (!btn) return;
    const hasRows = planPriorityScoresComputed && planData.length > 0;
    btn.disabled = !hasRows;
    if (!hasRows) {
        btn.textContent = "Tout sélectionner";
        btn.setAttribute("aria-pressed", "false");
        return;
    }
    const allSelected = areAllVisiblePlanRowsSelected();
    btn.textContent = allSelected ? "Tout désélectionner" : "Tout sélectionner";
    btn.setAttribute("aria-pressed", allSelected ? "true" : "false");
}

function syncPlanSelectionUi() {
    updateValidateWorkPlanButton();
    updatePlanSelectAllControl();
}

function bindPlanSelectionRows(data) {
    const rowsByKey = new Map(data.map(row => [planRowKey(row), row]));
    document.querySelectorAll(".plan-row-check").forEach(check => {
        check.addEventListener("change", () => {
            const row = rowsByKey.get(check.dataset.planKey);
            if (!row) return;
            if (check.checked) selectedPlanRows.set(check.dataset.planKey, row);
            else selectedPlanRows.delete(check.dataset.planKey);
            syncPlanSelectionUi();
        });
    });
}

function getValidateWorkPlanButtonLabel(count = selectedPlanRows.size) {
    if (count <= 0) return PLAN_VALIDATE_LABEL_BASE;
    const word = count === 1 ? "canalisation" : "canalisations";
    return `${PLAN_VALIDATE_LABEL_BASE} (${count.toLocaleString("fr-FR")} ${word})`;
}

function updateValidateWorkPlanButton() {
    const btn = document.getElementById("validate-work-plan");
    if (!btn || btn.disabled) return;
    const count = selectedPlanRows.size;
    btn.classList.toggle("is-visible", count > 0);
    btn.textContent = getValidateWorkPlanButtonLabel(count);
}

function readWorkPlanItems() {
    try {
        const items = JSON.parse(localStorage.getItem(PLAN_STORAGE_KEY) || "[]");
        return Array.isArray(items) ? items : [];
    } catch (_) {
        return [];
    }
}

function writeWorkPlanItems(items) {
    localStorage.setItem(PLAN_STORAGE_KEY, JSON.stringify(items));
}

function makeWorkPlanId() {
    if (window.crypto?.randomUUID) return window.crypto.randomUUID();
    return `dash-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function toWorkPlanItem(row) {
    return {
        _id: makeWorkPlanId(),
        facilityid: row.facilityid || row.id || "-",
        adresse: row.adresse || row.adr || "-",
        materiau: row.materiau || row.mat || "-",
        diametre: row.diametre ?? row.diam ?? null,
        longueur: parseFloat(row.longueur ?? row.long) || 0,
        criticite: row.criticite ?? row.crit ?? null,
        inclus: true,
    };
}

async function validateSelectedWorkPlan() {
    if (!selectedPlanRows.size) return;
    const btn = document.getElementById("validate-work-plan");
    if (btn) {
        btn.disabled = true;
        btn.textContent = "Ajout en cours...";
    }

    try {
        const selectedRows = [...selectedPlanRows.values()];
        const current = readWorkPlanItems();
        const knownIds = new Set(current.map(item => item.facilityid));
        const additions = [];

        selectedRows.forEach(row => {
            const id = row.facilityid || row.id;
            if (!id || knownIds.has(id)) return;
            knownIds.add(id);
            additions.push(toWorkPlanItem(row));
        });

        writeWorkPlanItems([...current, ...additions]);
        window.location.href = "plan-travaux.html";
    } catch (e) {
        alert("Impossible de valider le plan de travaux pour le moment.");
        if (btn) {
            btn.disabled = false;
            updateValidateWorkPlanButton();
        }
    }
}

// ── Communes pour le filtre ───────────────────────────────
function clearPlanCommuneSelect(sel) {
    if (!sel) return;
    while (sel.options.length > 1) sel.remove(1);
}

function applyPlanCommuneFiltres(data, sel) {
    if (!sel) return;
    const previous = sel.value || planCommune || "";
    clearPlanCommuneSelect(sel);
    if (data.communes_options?.length) {
        data.communes_options.forEach(c => {
            const value = String(c.value || "").trim();
            const label = c.label || value;
            if (value) COMMUNE_LABELS.set(value, label);
            const opt = document.createElement("option");
            opt.value = value;
            opt.textContent = label;
            sel.appendChild(opt);
        });
    } else {
        data.communes?.forEach(c => {
            const value = String(c || "").trim();
            if (!value) return;
            COMMUNE_LABELS.set(value, value);
            const opt = document.createElement("option");
            opt.value = value;
            opt.textContent = value;
            sel.appendChild(opt);
        });
    }
    if (previous && [...sel.options].some(opt => opt.value === previous)) {
        sel.value = previous;
    }
    planCommune = sel.value || "";
}

async function finalizePlanCommuneLabels(sel, data) {
    if (data.communes_options?.length) {
        await hydrateCommuneLabels(data.communes_options.map(c => c.value));
    } else {
        await hydrateCommuneLabels(data.communes || []);
    }
    for (const opt of sel.options) {
        if (!opt.value) continue;
        opt.textContent = COMMUNE_LABELS.get(opt.value) || opt.textContent;
    }
    if (planData.length) {
        await hydrateCommuneLabels(planData.map(r => r.commune));
        renderPlanTable(planData, planTableOffset);
    }
}

async function refreshFiltresInBackground(cacheKey, sel) {
    try {
        const res = await fetch(`${API}/api/filtres`);
        if (!res.ok) return;
        const data = await res.json();
        writeDashCache(cacheKey, { payload: data });
        applyPlanCommuneFiltres(data, sel);
        await finalizePlanCommuneLabels(sel, data);
    } catch (_) { /* garder le select actuel */ }
}

async function loadCommunes() {
    const cacheKey = `${DASH_CACHE_PREFIX}filtres`;
    const sel = document.getElementById("plan-commune");
    if (!sel) return;

    const cached = readDashStoragePayload(cacheKey);
    if (cached) {
        applyPlanCommuneFiltres(cached, sel);
        await finalizePlanCommuneLabels(sel, cached);
        void refreshFiltresInBackground(cacheKey, sel);
        return;
    }

    try {
        const res  = await fetch(`${API}/api/filtres`);
        if (!res.ok) throw new Error(String(res.status));
        const data = await res.json();
        writeDashCache(cacheKey, { payload: data });
        applyPlanCommuneFiltres(data, sel);
        await finalizePlanCommuneLabels(sel, data);
    } catch (e) {}
}

function normalizeCommuneCode(v) {
    const code = String(v || "").trim();
    if (!code) return "";
    if (/^\d{4}$/.test(code)) return `0${code}`;
    return code;
}

async function fetchCommuneLabel(code) {
    const normalized = normalizeCommuneCode(code);
    if (!normalized) return "";
    if (!/^\d{5}$/.test(normalized)) return normalized;
    // Libellés issus du backend (table `communes`) via /api/filtres — pas d’appel gouv ici.
    return normalized;
}

async function hydrateCommuneLabels(codes) {
    const unique = [...new Set((codes || []).map(normalizeCommuneCode).filter(Boolean))];
    const missing = unique.filter(code => {
        const current = COMMUNE_LABELS.get(code);
        return !current || current === code;
    });
    if (!missing.length) return;

    const results = await Promise.all(missing.map(async code => [code, await fetchCommuneLabel(code)]));
    results.forEach(([code, label]) => {
        COMMUNE_LABELS.set(code, label || code);
    });
}

// ── Export CSV plan ───────────────────────────────────────
async function exportPlanCSV() {
    try {
        const params = new URLSearchParams({ limit: 5000, offset: 0 });
        if (planCommune) params.append("commune", planCommune);
        if (planAdresseSearch) params.append("adresse", planAdresseSearch);
        const res  = await fetch(`${API}/api/plan-travaux?${params}`);
        const json = await res.json();
        const data = json.canalisations || [];

        const headers = ["Rang","Facility ID","Adresse","Commune","Score priorité",
                         "Criticité (%)","Nb fuites","Longueur (m)"];
        const rows = data.map((r, i) => [
            i + 1,
            r.facilityid || "",
            r.adresse,
            COMMUNE_LABELS.get(normalizeCommuneCode(r.commune)) || normalizeCommuneCode(r.commune) || "",
            r.score_priorite ?? r.score_max ?? r.avg_score,
            r.criticite ?? r.crit_moy,
            r.nb_fuites ?? r.total_fuites,
            r.longueur ?? r.longueur_tot,
        ]);
        const csv  = [headers, ...rows].map(r => r.map(v => `"${v ?? ""}"`).join(",")).join("\n");
        const blob = new Blob(["\uFEFF"+csv], { type: "text/csv;charset=utf-8;" });
        const url  = URL.createObjectURL(blob);
        const a    = Object.assign(document.createElement("a"), { href: url, download: "plan_travaux.csv" });
        a.click();
        URL.revokeObjectURL(url);
    } catch(e) { alert("Erreur export"); }
}

// ── Utilitaires ───────────────────────────────────────────
function val(id)        { return document.getElementById(id)?.value || ""; }
function setEl(id, txt) { const e = document.getElementById(id); if (e) e.textContent = txt; }
function on(id, ev, fn) { document.getElementById(id)?.addEventListener(ev, fn); }
function escapeAttr(v) {
    return String(v ?? "")
        .replace(/&/g, "&amp;")
        .replace(/"/g, "&quot;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}
