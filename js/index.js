/**
 * index.js — Page résultats adresse
 * Pagination serveur : les filtres/tri/pages sont envoyés à l'API
 */

const API        = window.__RTC_API_BASE__ || "http://127.0.0.1:8000";
const PAGE_SIZE  = 100;

/** Cache localStorage (filtres/stats ; liste canalisations = page 1 seule, une entrée max). */
const INDEX_CACHE_VER = 4;
const INDEX_CACHE_TTL_MS = 10 * 60 * 1000; // 10 min
const INDEX_CACHE_PREFIX = `rtc_idx_v${INDEX_CACHE_VER}_`;

function indexCacheStableHash(str) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 16777619) >>> 0;
    }
    return h.toString(16);
}

function readIndexCache(key) {
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return null;
        const o = JSON.parse(raw);
        if (!o || typeof o.t !== "number") return null;
        if (Date.now() - o.t > INDEX_CACHE_TTL_MS) return null;
        return o;
    } catch (_) {
        return null;
    }
}

function writeIndexCache(key, fields) {
    try {
        const payload = JSON.stringify({ t: Date.now(), ...fields });
        localStorage.setItem(key, payload);
    } catch (e) {
        if (e.name === "QuotaExceededError" || e.code === 22) {
            try {
                for (let i = localStorage.length - 1; i >= 0; i--) {
                    const k = localStorage.key(i);
                    if (k && k.startsWith(INDEX_CACHE_PREFIX) && k.includes("_canal_")) localStorage.removeItem(k);
                }
                localStorage.setItem(key, JSON.stringify({ t: Date.now(), ...fields }));
            } catch (_) { /* ignore */ }
        }
    }
}

/** Ne garde qu’une entrée liste canalisations (dernière page 1) pour limiter le quota. */
function pruneCanalCacheExcept(keepKey) {
    try {
        for (let i = localStorage.length - 1; i >= 0; i--) {
            const k = localStorage.key(i);
            if (!k || !k.startsWith(INDEX_CACHE_PREFIX) || !k.includes("_canal_")) continue;
            if (k !== keepKey) localStorage.removeItem(k);
        }
    } catch (_) { /* ignore */ }
}

/** Réponses liste canalisations en RAM (même filtres/tri), pour pagination instantanée. */
const CANAL_PAGE_MEMORY = new Map();
let lastCanalListSessionKey = "";
let canalPrefetchGen = 0;
/** Au-delà, les pages restantes se chargent à la demande (évite de saturer le réseau). */
const CANAL_PREFETCH_MAX_PAGES = 50;
const CANAL_PREFETCH_PARALLEL = 3;

function getCanalListSessionKey() {
    const u = new URLSearchParams(buildQueryParams(1));
    u.delete("offset");
    return u.toString();
}

function canalMemoryKey(sessionKey, page) {
    return `${sessionKey}|p${page}`;
}

async function prefetchCanalListPages(sessionKey, totalHint, gen) {
    const total = Math.max(0, Number(totalHint) || 0);
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const maxPage = Math.min(totalPages, CANAL_PREFETCH_MAX_PAGES);
    const pages = [];
    for (let p = 2; p <= maxPage; p++) {
        const mk = canalMemoryKey(sessionKey, p);
        if (!CANAL_PAGE_MEMORY.has(mk)) pages.push(p);
    }
    const worker = async () => {
        for (;;) {
            if (gen !== canalPrefetchGen) return;
            if (getCanalListSessionKey() !== sessionKey) return;
            const p = pages.pop();
            if (p == null) return;
            const mk = canalMemoryKey(sessionKey, p);
            if (CANAL_PAGE_MEMORY.has(mk)) continue;
            try {
                const q = buildQueryParams(p);
                const res = await fetch(`${API}/api/canalisations?${q}`);
                if (!res.ok) continue;
                const json = await res.json();
                if (gen !== canalPrefetchGen) return;
                if (getCanalListSessionKey() !== sessionKey) return;
                CANAL_PAGE_MEMORY.set(mk, json);
            } catch (_) { /* ignore */ }
        }
    };
    await Promise.all(Array.from({ length: CANAL_PREFETCH_PARALLEL }, () => worker()));
}

/** Après affichage depuis le cache disque page 1 : rafraîchir puis précharger les autres pages. */
async function refreshCanalPage1InBackground(query, cacheKey, sessionKey, gen) {
    try {
        const res = await fetch(`${API}/api/canalisations?${query}`);
        if (!res.ok) return;
        const json = await res.json();
        if (gen !== canalPrefetchGen) return;
        if (getCanalListSessionKey() !== sessionKey) return;
        CANAL_PAGE_MEMORY.set(canalMemoryKey(sessionKey, 1), json);
        if (cacheKey) {
            pruneCanalCacheExcept(cacheKey);
            writeIndexCache(cacheKey, { qs: query, payload: json });
        }
        if (currentPage === 1) applyCanalisationsListPayload(json);
        void prefetchCanalListPages(sessionKey, json.total || 0, gen);
    } catch (_) { /* ignore */ }
}

function clearSelectKeepFirst(sel) {
    if (!sel) return;
    while (sel.options.length > 1) sel.remove(1);
}

// ── État global ───────────────────────────────────────────
let currentPage  = 1;
let totalResults = 0;
let sortCol      = "criticite";
let sortDir      = "desc";
let currentAdresse = "";
let currentAdresseQuery = "";
const ADRESSE_EDIT_STATE = { kind: "", ref: "", id: "", rowEl: null, cellEl: null, prevCellHtml: "" };

// ── Init ──────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", async function () {
    const params   = new URLSearchParams(window.location.search);
    currentAdresse = params.get("adresse") || "";
    currentAdresseQuery = normalizeAdresseForApi(currentAdresse);
    const zoneMode = params.get("zone") === "1";

    if (zoneMode) {
        // Mode sélection de zone — charger depuis sessionStorage
        const zoneIds   = JSON.parse(sessionStorage.getItem("zone_ids") || "[]");
        const zoneCount = sessionStorage.getItem("zone_count") || zoneIds.length;

        document.title = `RenovTaCana — Zone sélectionnée`;
        setEl("adresse-titre", `Zone sélectionnée (${zoneCount} canalisations)`);
        setEl("side-adresse",  `Zone — ${zoneCount} canalisations`);
        setEl("result-count",  `${zoneCount} résultat${zoneCount > 1 ? "s" : ""}`);
        setEl("side-total",    zoneCount);

        await loadFiltres();
        await fetchZone(zoneIds);
        await fetchChantiers("");
        await fetchOperations("");
    } else {
        if (currentAdresse) {
            document.title = `RenovTaCana — ${currentAdresse}`;
            setEl("adresse-titre", currentAdresse);
            setEl("side-adresse",  currentAdresse);
            document.querySelectorAll(".search-bar__input").forEach(i => i.value = currentAdresse);
        }

        await loadFiltres();
        await fetchPage(1);
        await fetchStatsAdresse(currentAdresseQuery);
        await fetchChantiers(currentAdresse);
        await fetchOperations(currentAdresse);
    }

    // Filtres → retour page 1
    on("filter-commune",    "change", () => fetchPage(1));
    on("filter-materiau",   "change", () => fetchPage(1));
    on("filter-statut",     "change", () => fetchPage(1));
    on("filter-anciennete", "change", () => fetchPage(1));
    on("filter-criticite-null", "change", () => fetchPage(1));
    on("filter-priorite-null", "change", () => fetchPage(1));
    on("filter-crit-min",   "input",  onRangeChange);
    on("filter-crit-max",   "input",  onRangeChange);
    on("filter-reset",      "click",  resetFilters);

    // Recherche texte — debounce 400ms
    let debounce;
    document.getElementById("filter-id")?.addEventListener("input", () => {
        clearTimeout(debounce);
        debounce = setTimeout(() => fetchPage(1), 400);
    });

    // Tri colonnes
    document.querySelectorAll("#main-table thead th[data-col]")
        .forEach(th => th.addEventListener("click", () => onSort(th.dataset.col)));

    // Tabs
    document.querySelectorAll(".tab-btn")
        .forEach(btn => btn.addEventListener("click", () => switchTab(btn.dataset.tab)));

    // Filtres chantiers
    let chantierDebounce;
    on("filter-chantiers-missing", "change", () => fetchChantiers(currentAdresse));
    on("filter-chantiers-commune", "input", () => {
        clearTimeout(chantierDebounce);
        chantierDebounce = setTimeout(() => fetchChantiers(currentAdresse), 300);
    });
    on("filter-chantiers-search", "input", () => {
        clearTimeout(chantierDebounce);
        chantierDebounce = setTimeout(() => fetchChantiers(currentAdresse), 300);
    });

    // Filtres operations
    let opsDebounce;
    on("filter-operations-missing", "change", () => fetchOperations(currentAdresse));
    on("filter-operations-commune", "input", () => {
        clearTimeout(opsDebounce);
        opsDebounce = setTimeout(() => fetchOperations(currentAdresse), 300);
    });
    on("filter-operations-search", "input", () => {
        clearTimeout(opsDebounce);
        opsDebounce = setTimeout(() => fetchOperations(currentAdresse), 300);
    });

    // Export CSV
    on("btn-export", "click", exportCSV);
    initDetailModal();
    initAdresseModal();

    // Formulaire recherche
    document.getElementById("search-form")?.addEventListener("submit", e => {
        e.preventDefault();
        const v = e.target.querySelector(".search-bar__input").value.trim();
        if (v) window.location.href = `index.html?adresse=${encodeURIComponent(v)}`;
    });

    // Clic sur une canalisation de la mini-heatmap: recharge la page de resultats sans full reload.
    window.addEventListener("rtc:mini-map-address-select", async (e) => {
        const adresse = e?.detail?.adresse ? String(e.detail.adresse).trim() : "";
        if (!adresse) return;
        if (adresse === currentAdresse) {
            await updateSidebarStatsForAdresse(adresse);
            return;
        }
        await applySelectedAddress(adresse);
    });

    markSortHeader("criticite", "desc");
});

// ── Construire les paramètres de requête ──────────────────
function buildQueryParams(page) {
    const offset   = (page - 1) * PAGE_SIZE;
    const commune  = val("filter-commune");
    const mat      = val("filter-materiau");
    const statut   = val("filter-statut");
    const anc      = val("filter-anciennete");
    const id       = val("filter-id");
    const critMin  = val("filter-crit-min") || "0";
    const critMax  = val("filter-crit-max") || "100";
    const onlyCriticiteNull = document.getElementById("filter-criticite-null")?.checked;
    const onlyPrioriteNull = document.getElementById("filter-priorite-null")?.checked;

    const p = new URLSearchParams({
        limit:    PAGE_SIZE,
        offset:   offset,
        crit_min: critMin,
        crit_max: critMax,
        sort_col: sortCol,
        sort_dir: sortDir,
    });

    if (currentAdresseQuery) p.append("adresse", currentAdresseQuery);
    if (commune)        p.append("commune",   commune);
    if (mat)            p.append("materiau",  mat);
    if (statut)         p.append("statut",    statut);
    if (anc)            p.append("anciennete", anc);
    if (id)             p.append("search",    id);
    if (onlyCriticiteNull) p.append("only_unknown_criticite", "true");
    if (onlyPrioriteNull) p.append("only_unknown_priorite", "true");

    return p.toString();
}

function normalizeAdresseForApi(adresse) {
    const raw = String(adresse || "").trim();
    if (!raw) return "";
    const beforeComma = raw.split(",")[0].trim();
    return beforeComma || raw;
}

async function applySelectedAddress(adresse) {
    currentAdresse = adresse;
    currentAdresseQuery = normalizeAdresseForApi(adresse);

    const url = new URL(window.location.href);
    url.searchParams.set("adresse", adresse);
    url.searchParams.delete("zone");
    window.history.replaceState({}, "", url.toString());

    document.title = `RenovTaCana — ${currentAdresse}`;
    setEl("adresse-titre", currentAdresse);
    setEl("side-adresse", currentAdresse);
    document.querySelectorAll(".search-bar__input").forEach(i => { i.value = currentAdresse; });

    // Evite les incoherences de cache/memoire entre deux adresses.
    CANAL_PAGE_MEMORY.clear();
    lastCanalListSessionKey = "";
    canalPrefetchGen++;

    switchTab("canalisations");
    await fetchPage(1);
    await fetchStatsAdresse(currentAdresseQuery);
    await fetchChantiers(currentAdresse);
    await fetchOperations(currentAdresse);
}

// ── Fetch une page ────────────────────────────────────────
// ── Fetch zone (IDs depuis sessionStorage) ────────────────
async function fetchZone(ids) {
    if (!ids || !ids.length) return;
    const tbody = document.getElementById("table-body");
    tbody.innerHTML = `<tr class="row-loading"><td colspan="10">Chargement des ${ids.length} canalisations…</td></tr>`;
    try {
        const res  = await fetch(`${API}/api/canalisations/zone`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ids, limit: PAGE_SIZE, offset: 0 })
        });
        const json = await res.json();
        totalResults = json.total || 0;
        renderTable(json.canalisations || []);
        renderPagination();
        setEl("result-count", `${totalResults.toLocaleString("fr-FR")} résultat${totalResults > 1 ? "s" : ""}`);

        const data = json.canalisations || [];
        if (data.length) {
            const crits = data.filter(r => (r.criticite ?? 0) >= 70).length;
            const moy   = data.filter(r => r.criticite != null)
                .reduce((s, r, _, a) => s + r.criticite / a.length, 0);
            setEl("side-total",     totalResults);
            setEl("side-crit-moy",  `${moy.toFixed(1)}%`);
            setEl("side-critiques", crits);
            setEl("side-crit-pct",  `${moy.toFixed(1)}%`);
            const bar = document.getElementById("side-crit-bar");
            if (bar) setTimeout(() => bar.style.width = `${moy}%`, 150);
        }
    } catch(e) {
        tbody.innerHTML = `<tr class="row-empty-msg"><td colspan="10">⚠️ Erreur chargement zone</td></tr>`;
    }
}

function applyCanalisationsListPayload(json) {
    totalResults = json.total || 0;
    renderTable(json.canalisations || [], json.sort_col, json.sort_dir);
    renderPagination();
    setEl("result-count", `${totalResults.toLocaleString("fr-FR")} résultat${totalResults > 1 ? "s" : ""}`);
}

async function fetchPage(page) {
    currentPage = page;
    const tbody = document.getElementById("table-body");
    const sessionKey = getCanalListSessionKey();
    if (sessionKey !== lastCanalListSessionKey) {
        lastCanalListSessionKey = sessionKey;
        canalPrefetchGen++;
        CANAL_PAGE_MEMORY.clear();
    }
    const myGen = canalPrefetchGen;

    const query = buildQueryParams(page);
    const memKey = canalMemoryKey(sessionKey, page);
    const memPayload = CANAL_PAGE_MEMORY.get(memKey);
    if (memPayload) {
        applyCanalisationsListPayload(memPayload);
        return;
    }

    const useCanalCache = page === 1;
    const cacheKey = useCanalCache ? `${INDEX_CACHE_PREFIX}canal_${indexCacheStableHash(query)}` : null;
    const lsCached = useCanalCache && cacheKey ? readIndexCache(cacheKey) : null;

    if (useCanalCache && lsCached && lsCached.qs === query && lsCached.payload) {
        applyCanalisationsListPayload(lsCached.payload);
        CANAL_PAGE_MEMORY.set(memKey, lsCached.payload);
        void prefetchCanalListPages(sessionKey, lsCached.payload.total || 0, myGen);
        void refreshCanalPage1InBackground(query, cacheKey, sessionKey, myGen);
        return;
    }

    tbody.innerHTML = `<tr class="row-loading"><td colspan="10">Chargement…</td></tr>`;

    try {
        const res = await fetch(`${API}/api/canalisations?${query}`);
        if (!res.ok) throw new Error(String(res.status));
        const json = await res.json();
        if (myGen !== canalPrefetchGen) return;
        if (getCanalListSessionKey() !== sessionKey) return;

        CANAL_PAGE_MEMORY.set(memKey, json);
        if (useCanalCache && cacheKey) {
            pruneCanalCacheExcept(cacheKey);
            writeIndexCache(cacheKey, { qs: query, payload: json });
        }
        applyCanalisationsListPayload(json);
        if (page === 1) void prefetchCanalListPages(sessionKey, json.total || 0, myGen);
    } catch (e) {
        tbody.innerHTML = `<tr class="row-empty-msg"><td colspan="10">
            ⚠️ Serveur non disponible — lancez <code>uvicorn main:app --reload</code>
        </td></tr>`;
        document.getElementById("pagination")?.remove();
    }
}

// ── Rendu tableau ─────────────────────────────────────────
function renderTable(data) {
    const tbody = document.getElementById("table-body");
    if (!data.length) {
        tbody.innerHTML = `<tr class="row-empty-msg"><td colspan="10">Aucune canalisation trouvée</td></tr>`;
        renderPagination();
        return;
    }
    tbody.innerHTML = data.map(row => `
        <tr>
            <td>${row.commune_display || row.commune || "—"}</td>
            <td>${row.adresse || "—"}</td>
            <td>${row.materiau || "—"}</td>
            <td>${row.diametre != null ? Number(row.diametre).toFixed(1) + " mm" : "—"}</td>
            <td>${row.longueur != null ? row.longueur.toFixed(1) + " m" : "—"}</td>
            <td>${row.annee_pose || "—"}</td>
            <td>${row.nb_fuites != null ? row.nb_fuites : "—"}</td>
            <td>${criticitePill(row.criticite)}</td>
            <td>${priorityScoreBar(row.score_priorite)}</td>
            <td><div class="row-actions">
                <button class="row-action-btn" type="button" title="Voir le détail" data-action="view" data-facilityid="${escapeHtml(row.facilityid || "")}" aria-label="Voir le détail">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"></path>
                        <circle cx="12" cy="12" r="3"></circle>
                    </svg>
                </button>
                <button class="row-action-btn row-action-btn--map" type="button" title="Localiser sur la mini-carte" data-action="locate" data-facilityid="${escapeHtml(row.facilityid || "")}" data-adresse="${escapeHtml(row.adresse || "")}" aria-label="Localiser sur la mini-carte">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/>
                        <line x1="8" y1="2" x2="8" y2="18"/>
                        <line x1="16" y1="6" x2="16" y2="22"/>
                    </svg>
                </button>
            </div></td>
        </tr>
    `).join("");
}

// ── Pagination ────────────────────────────────────────────
function renderPagination() {
    // Supprimer l'ancienne pagination
    document.getElementById("pagination")?.remove();

    const totalPages = Math.ceil(totalResults / PAGE_SIZE);
    if (totalPages <= 1) return;

    const container = document.createElement("div");
    container.id = "pagination";
    container.className = "pagination";

    // Bouton précédent
    const prev = document.createElement("button");
    prev.className = `page-btn ${currentPage === 1 ? "page-btn--disabled" : ""}`;
    prev.disabled  = currentPage === 1;
    prev.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>`;
    prev.addEventListener("click", () => fetchPage(currentPage - 1));

    // Numéros de pages
    const pages = getPageNumbers(currentPage, totalPages);
    const pagesEl = document.createElement("div");
    pagesEl.className = "page-numbers";

    pages.forEach(p => {
        if (p === "…") {
            const sep = document.createElement("span");
            sep.className = "page-sep";
            sep.textContent = "…";
            pagesEl.appendChild(sep);
        } else {
            const btn = document.createElement("button");
            btn.className = `page-btn ${p === currentPage ? "page-btn--active" : ""}`;
            btn.textContent = p;
            btn.addEventListener("click", () => fetchPage(p));
            pagesEl.appendChild(btn);
        }
    });

    // Bouton suivant
    const next = document.createElement("button");
    next.className = `page-btn ${currentPage === totalPages ? "page-btn--disabled" : ""}`;
    next.disabled  = currentPage === totalPages;
    next.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>`;
    next.addEventListener("click", () => fetchPage(currentPage + 1));

    // Info total
    const info = document.createElement("span");
    info.className = "page-info";
    const from = (currentPage - 1) * PAGE_SIZE + 1;
    const to   = Math.min(currentPage * PAGE_SIZE, totalResults);
    info.textContent = `${from.toLocaleString("fr-FR")}–${to.toLocaleString("fr-FR")} sur ${totalResults.toLocaleString("fr-FR")}`;

    container.append(prev, pagesEl, next, info);

    // Insérer après le tableau
    document.querySelector(".table-scroll").after(container);

    // Scroll haut du tableau au changement de page
    document.querySelector(".address-main-block")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function getPageNumbers(current, total) {
    if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
    if (current <= 4) return [1, 2, 3, 4, 5, "…", total];
    if (current >= total - 3) return [1, "…", total-4, total-3, total-2, total-1, total];
    return [1, "…", current-1, current, current+1, "…", total];
}

// ── Tri ───────────────────────────────────────────────────
function onSort(col) {
    sortDir = sortCol === col && sortDir === "asc" ? "desc" : "asc";
    sortCol = col;
    markSortHeader(col, sortDir);
    fetchPage(1);
}

function markSortHeader(col, dir) {
    document.querySelectorAll("#main-table thead th").forEach(th => {
        th.classList.remove("sort-asc", "sort-desc");
        if (th.dataset.col === col) th.classList.add(`sort-${dir}`);
    });
}

// ── Slider criticité ──────────────────────────────────────
let rangeDebounce;
function onRangeChange() {
    let min = parseFloat(val("filter-crit-min"));
    let max = parseFloat(val("filter-crit-max"));
    if (min > max) { document.getElementById("filter-crit-min").value = max; min = max; }
    setEl("criticite-range-label", `${min}% — ${max}%`);
    clearTimeout(rangeDebounce);
    rangeDebounce = setTimeout(() => fetchPage(1), 300);
}

// ── Reset filtres ─────────────────────────────────────────
function resetFilters() {
    ["filter-commune","filter-materiau","filter-statut","filter-anciennete","filter-id"].forEach(id => setInputVal(id, ""));
    setInputVal("filter-crit-min", "0");
    setInputVal("filter-crit-max", "100");
    const critNullEl = document.getElementById("filter-criticite-null");
    const prioNullEl = document.getElementById("filter-priorite-null");
    if (critNullEl) critNullEl.checked = false;
    if (prioNullEl) prioNullEl.checked = false;
    setEl("criticite-range-label", "0% — 100%");
    sortCol = "criticite"; sortDir = "desc";
    markSortHeader("criticite", "desc");
    fetchPage(1);
}

// ── Filtres dynamiques ────────────────────────────────────
function applyFiltresPayload(data) {
    const selCommune = document.getElementById("filter-commune");
    const selMat = document.getElementById("filter-materiau");
    const selAnc = document.getElementById("filter-anciennete");
    clearSelectKeepFirst(selCommune);
    clearSelectKeepFirst(selMat);
    clearSelectKeepFirst(selAnc);

    if (data.communes_options?.length) {
        data.communes_options.forEach(c => {
            const opt = document.createElement("option");
            opt.value = c.value;
            opt.textContent = c.label || c.value;
            selCommune?.appendChild(opt);
        });
    } else {
        data.communes?.forEach(c => {
            const opt = document.createElement("option");
            opt.value = c;
            opt.textContent = c;
            selCommune?.appendChild(opt);
        });
    }

    data.materiaux?.forEach(m => {
        const opt = document.createElement("option");
        opt.value = m;
        opt.textContent = m;
        selMat?.appendChild(opt);
    });

    data.anciennetes?.forEach(a => {
        const opt = document.createElement("option");
        opt.value = a;
        opt.textContent = a;
        selAnc?.appendChild(opt);
    });
}

async function loadFiltres() {
    const key = `${INDEX_CACHE_PREFIX}filtres`;
    const cached = readIndexCache(key);
    if (cached && cached.payload) {
        applyFiltresPayload(cached.payload);
    }

    try {
        const res = await fetch(`${API}/api/filtres`);
        const data = await res.json();
        writeIndexCache(key, { payload: data });
        applyFiltresPayload(data);
    } catch (e) {
        if (!cached || !cached.payload) {
            console.warn("Filtres non chargés", e);
        }
    }
}

async function updateSidebarStatsForAdresse(adresse) {
    const trimmed = String(adresse || "").trim();
    if (!trimmed) return;
    setEl("side-adresse", trimmed);
    await fetchStatsAdresse(normalizeAdresseForApi(trimmed));
}

// ── Stats adresse ─────────────────────────────────────────
function applyStatsAdressePayload(data) {
    setEl("side-total", data.nb_canalisations || "—");
    setEl("side-crit-moy", data.criticite_moyenne != null ? `${data.criticite_moyenne}%` : "—");
    setEl("side-critiques", data.critiques ?? "—");
    setEl("side-nb-fuites", data.nb_fuites_total ?? "—");
    setEl("side-longueur", data.longueur_totale != null ? `${data.longueur_totale} m` : "—");
    setEl("side-crit-pct", data.criticite_moyenne != null ? `${data.criticite_moyenne}%` : "—");
    const bar = document.getElementById("side-crit-bar");
    if (bar) setTimeout(() => { bar.style.width = `${data.criticite_moyenne || 0}%`; }, 150);
}

async function fetchStatsAdresse(adresse) {
    if (!adresse) return;

    const addrKey = String(adresse).trim();
    const cacheKey = `${INDEX_CACHE_PREFIX}stats_${indexCacheStableHash(addrKey)}`;
    const cached = readIndexCache(cacheKey);

    if (cached && cached.adresse === addrKey && cached.payload) {
        applyStatsAdressePayload(cached.payload);
    }

    try {
        const res = await fetch(`${API}/api/stats/adresse?adresse=${encodeURIComponent(addrKey)}`);
        const data = await res.json();
        writeIndexCache(cacheKey, { adresse: addrKey, payload: data });
        applyStatsAdressePayload(data);
    } catch (e) {
        if (!cached || !cached.payload || cached.adresse !== addrKey) {
            console.warn(e);
        }
    }
}

// ── Chantiers (paginé) ───────────────────────────────────
const PAGE_SIZE_CHANTIERS = 100;
let chantierPage  = 1;
let chantierTotal = 0;
let chantierCommune = "";
let chantierSearch = "";
let chantierOnlyMissing = false;

async function fetchChantiers(adresse) {
    chantierCommune = val("filter-chantiers-commune") || adresse.split(',').pop().trim();
    chantierSearch = val("filter-chantiers-search");
    chantierOnlyMissing = !!document.getElementById("filter-chantiers-missing")?.checked;
    await fetchChantierPage(1);
}

async function fetchChantierPage(page) {
    chantierPage = page;
    const tbody = document.getElementById("chantiers-body");
    if (!tbody) return;
    tbody.innerHTML = `<tr class="row-loading"><td colspan="6">Chargement…</td></tr>`;
    try {
        const offset = (page - 1) * PAGE_SIZE_CHANTIERS;
        const p = new URLSearchParams({
            commune: chantierCommune,
            search: chantierSearch,
            only_missing_adresse: chantierOnlyMissing ? "true" : "false",
            limit: String(PAGE_SIZE_CHANTIERS),
            offset: String(offset),
        });
        const url = `${API}/api/chantiers?${p.toString()}`;
        const res  = await fetch(url);
        const json = await res.json();
        chantierTotal = json.total || 0;
        renderChantiers(json.chantiers || []);
        setEl("chantiers-count", chantierTotal.toLocaleString("fr-FR"));
        setEl("chantiers-missing-count", `⚠ ${Number(json.missing_count || 0).toLocaleString("fr-FR")} adresse(s) manquante(s)`);
        renderTabPagination("chantiers-pagination", chantierPage, chantierTotal, PAGE_SIZE_CHANTIERS, fetchChantierPage);
    } catch(e) {
        tbody.innerHTML = `<tr class="row-empty-msg"><td colspan="6">Données non disponibles</td></tr>`;
    }
}

function formatChantierAdresseCell(adresse, numOp = "") {
    const s = adresse == null ? "" : String(adresse).trim();
    if (s) return escapeHtml(s);
    return buildAdresseMissingCell("chantier", numOp, numOp);
}

function chantierHasMissingAdresse(adresse) {
    return !(adresse != null && String(adresse).trim());
}

function operationHasMissingLocalisation(localisation) {
    return !(localisation != null && String(localisation).trim());
}

function buildAdresseMissingCell(kind, id = "", ref = "") {
    const safeKind = escapeHtml(kind);
    const safeId = escapeHtml(id);
    const safeRef = escapeHtml(ref);
    return `
        <div class="cell-adresse-missing-wrap">
            <button
                class="cell-adresse-complete-btn"
                type="button"
                data-action="complete-address"
                data-kind="${safeKind}"
                data-id="${safeId}"
                data-ref="${safeRef}"
            >Completer l'adresse</button>
        </div>
    `;
}

function formatOperationAdresseCell(localisation, idProjet = "", ref = "") {
    const s = localisation == null ? "" : String(localisation).trim();
    if (s) return escapeHtml(s);
    return buildAdresseMissingCell("operation", idProjet, ref);
}

function renderChantiers(data) {
    const tbody = document.getElementById("chantiers-body");
    if (!data.length) {
        tbody.innerHTML = `<tr class="row-empty-msg"><td colspan="6">Aucun chantier trouvé pour cette zone</td></tr>`;
        return;
    }
    tbody.innerHTML = data.map(row => `
        <tr class="${chantierHasMissingAdresse(row.adresse) ? "chantier-row--missing-address" : ""}">
            <td class="cell-id">${row.num_op}</td>
            <td>${row.libelle || "—"}</td>
            <td>${row.commune}</td>
            <td class="cell-adresse">${formatChantierAdresseCell(row.adresse, row.num_op || "")}</td>
            <td><span class="table-pill ${etatClass(row.etat)}">${row.etat}</span></td>
            <td>${row.date_debut} → ${row.date_fin}</td>
        </tr>
    `).join("");
}

// ── Opérations (paginé) ───────────────────────────────────
const PAGE_SIZE_OPS = 100;
let opsPage    = 1;
let opsTotal   = 0;
let opsCommune = "";
let opsSearch = "";
let opsOnlyMissing = false;

async function fetchOperations(adresse) {
    opsCommune = val("filter-operations-commune") || adresse.split(',').pop().trim();
    opsSearch = val("filter-operations-search");
    opsOnlyMissing = !!document.getElementById("filter-operations-missing")?.checked;
    await fetchOpsPage(1);
}

async function fetchOpsPage(page) {
    opsPage = page;
    const tbody = document.getElementById("operations-body");
    if (!tbody) return;
    tbody.innerHTML = `<tr class="row-loading"><td colspan="5">Chargement…</td></tr>`;
    try {
        const offset = (page - 1) * PAGE_SIZE_OPS;
        const p = new URLSearchParams({
            commune: opsCommune,
            search: opsSearch,
            only_missing_adresse: opsOnlyMissing ? "true" : "false",
            limit: String(PAGE_SIZE_OPS),
            offset: String(offset),
        });
        const url = `${API}/api/operations?${p.toString()}`;
        const res  = await fetch(url);
        const json = await res.json();
        opsTotal = json.total || 0;
        renderOperations(json.operations || []);
        setEl("operations-count", opsTotal.toLocaleString("fr-FR"));
        setEl("operations-missing-count", `⚠ ${Number(json.missing_count || 0).toLocaleString("fr-FR")} adresse(s) manquante(s)`);
        renderTabPagination("operations-pagination", opsPage, opsTotal, PAGE_SIZE_OPS, fetchOpsPage);
    } catch(e) {
        tbody.innerHTML = `<tr class="row-empty-msg"><td colspan="5">Données non disponibles</td></tr>`;
    }
}

function renderOperations(data) {
    const tbody = document.getElementById("operations-body");
    if (!data.length) {
        tbody.innerHTML = `<tr class="row-empty-msg"><td colspan="5">Aucune opération trouvée pour cette zone</td></tr>`;
        return;
    }
    tbody.innerHTML = data.map(row => `
        <tr class="${operationHasMissingLocalisation(row.localisation) ? "operation-row--missing-address" : ""}">
            <td>${row.titre || "—"}</td>
            <td>${row.commune || "—"}</td>
            <td class="cell-adresse">${formatOperationAdresseCell(row.localisation, row.operation_rowid || "", row.titre || row.cpi || "")}</td>
            <td>${row.annee || "—"}</td>
            <td><span style="color:var(--c-cyan);font-weight:600">${row.cpi || "—"}</span></td>
        </tr>
    `).join("");
}

// ── Pagination générique pour tabs ────────────────────────
function renderTabPagination(containerId, page, total, pageSize, fetchFn) {
    document.getElementById(containerId)?.remove();
    const totalPages = Math.ceil(total / pageSize);
    if (totalPages <= 1) return;

    const container = document.createElement("div");
    container.id = containerId;
    container.className = "pagination";

    const prev = document.createElement("button");
    prev.className = `page-btn ${page === 1 ? "page-btn--disabled" : ""}`;
    prev.disabled  = page === 1;
    prev.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>`;
    prev.addEventListener("click", () => fetchFn(page - 1));

    const pagesEl = document.createElement("div");
    pagesEl.className = "page-numbers";
    getPageNumbers(page, totalPages).forEach(p => {
        if (p === "…") {
            const sep = document.createElement("span");
            sep.className = "page-sep"; sep.textContent = "…";
            pagesEl.appendChild(sep);
        } else {
            const btn = document.createElement("button");
            btn.className = `page-btn ${p === page ? "page-btn--active" : ""}`;
            btn.textContent = p;
            btn.addEventListener("click", () => fetchFn(p));
            pagesEl.appendChild(btn);
        }
    });

    const next = document.createElement("button");
    next.className = `page-btn ${page === totalPages ? "page-btn--disabled" : ""}`;
    next.disabled  = page === totalPages;
    next.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>`;
    next.addEventListener("click", () => fetchFn(page + 1));

    const info = document.createElement("span");
    info.className = "page-info";
    const from = (page - 1) * pageSize + 1;
    const to   = Math.min(page * pageSize, total);
    info.textContent = `${from.toLocaleString("fr-FR")}–${to.toLocaleString("fr-FR")} sur ${total.toLocaleString("fr-FR")}`;

    container.append(prev, pagesEl, next, info);

    // Insérer après le tableau scrollable dans le bon panel
    const panel = document.querySelector(`.tab-panel[data-tab="${containerId.replace("-pagination","")}"]`);
    panel?.querySelector(".table-scroll")?.after(container);
}

// ── Tabs ──────────────────────────────────────────────────
function switchTab(tab) {
    document.querySelectorAll(".tab-btn").forEach(b =>
        b.classList.toggle("tab-btn--active", b.dataset.tab === tab));
    document.querySelectorAll(".tab-panel").forEach(p =>
        p.style.display = p.dataset.tab === tab ? "" : "none");
}

// ── Export CSV (page courante) ────────────────────────────
async function exportCSV() {
    try {
        const query = buildQueryParams(currentPage);
        const res   = await fetch(`${API}/api/canalisations?${query}&limit=10000&offset=0`);
        const json  = await res.json();
        const data  = json.canalisations || [];

        const headers = ["ID","Adresse","Matériaux","Diamètre (mm)","Longueur (m)",
                         "Année pose","Nb fuites","Criticité (%)","Statut"];
        const rows = data.map(r => [
            r.facilityid, r.adresse, r.materiau, r.diametre,
            r.longueur?.toFixed(1), r.annee_pose, r.nb_fuites,
            r.criticite, statutLabel(r.criticite)
        ]);
        const csv  = [headers, ...rows].map(r => r.map(v => `"${v ?? ""}"`).join(",")).join("\n");
        const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
        const url  = URL.createObjectURL(blob);
        const a    = Object.assign(document.createElement("a"), { href: url, download: "canalisations.csv" });
        a.click();
        URL.revokeObjectURL(url);
    } catch(e) { alert("Erreur lors de l'export"); }
}

// ── Utilitaires ───────────────────────────────────────────
function val(id)            { return document.getElementById(id)?.value || ""; }
function setEl(id, txt)     { const e = document.getElementById(id); if (e) e.textContent = txt; }
function setInputVal(id, v) { const e = document.getElementById(id); if (e) e.value = v; }
function on(id, ev, fn)     { document.getElementById(id)?.addEventListener(ev, fn); }

/** Arrondi identique au dashboard (ROUND(x, 1) côté SQL). */
function roundCriticite(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    return Math.round(n * 10) / 10;
}

function criticitePill(criticite) {
    const critVal = roundCriticite(criticite);
    if (critVal == null) return unknownValueIcon("Criticité inconnue");
    const critCls =
        critVal >= 70 ? "table-pill--danger" : critVal >= 40 ? "table-pill--warning" : "table-pill--success";
    return `<span class="table-pill ${critCls}">${critVal.toFixed(1)}%</span>`;
}

/** Arrondi identique au dashboard (ROUND(x, 2) côté SQL). */
function roundPriorityScore(score) {
    const n = Number(score);
    if (!Number.isFinite(n)) return null;
    return Math.round(n * 100) / 100;
}

function priorityScoreBar(score) {
    const scoreVal = roundPriorityScore(score);
    if (scoreVal == null) return unknownValueIcon("Score de priorité inconnu");
    const scorePct = Math.min(scoreVal, 100);
    return `<div class="score-pill">
        <div class="score-bar"><div class="score-bar__fill" style="width:${scorePct}%"></div></div>
        <span class="score-pill__value">${scoreVal.toFixed(2)}</span>
    </div>`;
}

function unknownValueIcon(label = "Valeur inconnue") {
    return `<span class="value-unknown-icon" title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}">
        <i class="fas fa-circle-question" aria-hidden="true"></i>
    </span>`;
}

function statutLabel(crit) {
    if (crit == null) return "Non évalué";
    if (crit >= 70)   return "Critique";
    if (crit >= 40)   return "Attention";
    return "Bon état";
}

function statutPill(crit) {
    const label = statutLabel(crit);
    const cls   = crit >= 70 ? "danger" : crit >= 40 ? "warning" : crit != null ? "success" : "neutral";
    return `<span class="table-pill table-pill--${cls}">${label}</span>`;
}

function etatClass(etat) {
    if (etat === "Planifié")                    return "table-pill--success";
    if (etat === "Validé en planification")     return "table-pill--warning";
    if (etat === "En attente de planification") return "table-pill--neutral";
    return "table-pill--neutral";
}

function initDetailModal() {
    const tbody = document.getElementById("table-body");
    if (!tbody) return;

    tbody.addEventListener("click", function (e) {
        const locateBtn = e.target.closest("button[data-action='locate'][data-facilityid]");
        if (locateBtn) {
            const id = locateBtn.dataset.facilityid;
            const adresse = locateBtn.dataset.adresse || "";
            if (id) void focusCanalOnMiniMap(id, adresse);
            return;
        }
        const btn = e.target.closest("button[data-action='view'][data-facilityid]");
        if (!btn) return;
        const facilityid = btn.dataset.facilityid;
        if (!facilityid) return;
        window.rtcOpenCanalisationDetailModal?.(facilityid, { displayId: facilityid });
    });
}

async function focusCanalOnMiniMap(facilityid, adresseHint) {
    const focusResult = window.rtcMiniMapFocus?.(facilityid);
    document.querySelector(".address-side-card")
        ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    const adresse = String(adresseHint || focusResult?.adresse || "").trim();
    if (adresse) await updateSidebarStatsForAdresse(adresse);
}

function initAdresseModal() {
    const chantierBody = document.getElementById("chantiers-body");
    const operationBody = document.getElementById("operations-body");
    const modal = document.getElementById("adresse-modal");
    const closeBtn = document.getElementById("adresse-modal-close");
    const cancelBtn = document.getElementById("adresse-modal-cancel");
    const validateBtn = document.getElementById("adresse-modal-validate");
    const backdrop = document.getElementById("adresse-modal-backdrop");
    const subtitle = document.getElementById("adresse-modal-subtitle");
    const input = document.getElementById("adresse-modal-input");
    if (!modal || !input || !subtitle) return;

    const openFromButton = (btn) => {
        const kind = btn.dataset.kind || "";
        const id = btn.dataset.id || "";
        const ref = btn.dataset.ref || "";
        const rowEl = btn.closest("tr");
        const cellEl = btn.closest("td");
        ADRESSE_EDIT_STATE.kind = kind;
        ADRESSE_EDIT_STATE.id = id;
        ADRESSE_EDIT_STATE.ref = ref;
        ADRESSE_EDIT_STATE.rowEl = rowEl;
        ADRESSE_EDIT_STATE.cellEl = cellEl;
        ADRESSE_EDIT_STATE.prevCellHtml = cellEl ? cellEl.innerHTML : "";
        subtitle.textContent = ref ? `${kind} — ${ref}` : kind;
        input.value = "";
        modal.classList.add("detail-modal--open");
        modal.setAttribute("aria-hidden", "false");
        setTimeout(() => input.focus(), 0);
    };

    const onBodyClick = (e) => {
        const btn = e.target.closest("button[data-action='complete-address']");
        if (!btn) return;
        openFromButton(btn);
    };

    chantierBody?.addEventListener("click", onBodyClick);
    operationBody?.addEventListener("click", onBodyClick);

    const close = () => {
        modal.classList.remove("detail-modal--open");
        modal.setAttribute("aria-hidden", "true");
        ADRESSE_EDIT_STATE.kind = "";
        ADRESSE_EDIT_STATE.id = "";
        ADRESSE_EDIT_STATE.ref = "";
        ADRESSE_EDIT_STATE.rowEl = null;
        ADRESSE_EDIT_STATE.cellEl = null;
        ADRESSE_EDIT_STATE.prevCellHtml = "";
    };

    closeBtn?.addEventListener("click", close);
    cancelBtn?.addEventListener("click", close);
    backdrop?.addEventListener("click", close);
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") close();
    });

    validateBtn?.addEventListener("click", async () => {
        const adresse = String(input.value || "").trim();
        if (!adresse) {
            input.focus();
            return;
        }
        const { kind, id, rowEl, cellEl, prevCellHtml } = ADRESSE_EDIT_STATE;
        if (!kind || !id || !rowEl || !cellEl) return;

        // 1) Mise a jour immediate en front
        cellEl.textContent = adresse;
        rowEl.classList.remove("chantier-row--missing-address", "operation-row--missing-address");

        // 2) Persistance en base via endpoint dedie
        try {
            const isChantier = kind === "chantier";
            const endpoint = isChantier ? `${API}/api/chantiers/adresse` : `${API}/api/operations/adresse`;
            const payload = isChantier ? { num_op: id, adresse } : { operation_rowid: Number(id), adresse };
            const res = await fetch(endpoint, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
        } catch (e) {
            // rollback front si l'API echoue
            cellEl.innerHTML = prevCellHtml;
            if (kind === "chantier") rowEl.classList.add("chantier-row--missing-address");
            if (kind === "operation") rowEl.classList.add("operation-row--missing-address");
            alert("La mise a jour de l'adresse a echoue cote serveur.");
            return;
        }
        close();
    });
}

function escapeHtml(str) {
    return String(str)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}
