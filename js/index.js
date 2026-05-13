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
const COPY_PAYLOADS = new Map();
let copyPayloadSeq = 0;

const DETAIL_LABELS = {
    facilityid: "ID canalisation",
    adresse: "Adresse",
    commune: "Commune",
    commune_insee: "Code INSEE commune",
    materiau: "Matériau",
    diametre: "Diamètre (mm)",
    longueur: "Longueur (m)",
    annee_pose: "Année de pose",
    nb_fuites: "Nombre de fuites",
    vetuste: "Vétusté",
    categorie: "Catégorie",
    anciennete: "Ancienneté",
    densite: "Densité",
    criticite: "Criticité (%)",
    score_priorite: "Score de priorité",

    FACILITYID: "ID canalisation (source)",
    abandoned: "Abandonnée",
    COMMUNE: "Commune (source)",
    INSEE: "Code INSEE (source)",
    UDI: "UDI",
    NUM_OP: "N° opération",
    OBJECTID: "Identifiant objet",
    DIAMETER: "Diamètre source (mm)",
    DIAMEXT: "Diamètre externe",
    PRECISIOND: "Précision diamètre",
    MATERIAL: "Matériau source",
    PRECISIONM: "Précision matériau",
    INSTALLDAT: "Date de pose source",
    WATERTYPE: "Type d'eau",
    DOMAINE: "Domaine",
    FONCTION: "Fonction",
    ADRESSE: "Adresse source",
    EMPLACEMEN: "Emplacement",
    TXcasse: "Risque de casse (texte)",
    Prediction: "Prédiction (identifiant modèle)",
    Predicti_1: "Prédiction normalisée",
    lat: "Latitude (source)",
    lon: "Longitude (source)",
    geometry: "Géométrie (WKT)",
    PRECISIONI: "Précision date de pose",
    PERIODE_PO: "Période de pose",
    SENSIBILIT: "Sensibilité",
    PRESSION: "Pression",
    OSSATURE: "Ossature du réseau",
    CONTRAT: "Contrat",
    COTE_TN: "Cote terrain naturel",
    PROFONDEUR: "Profondeur",
    JOINT: "Type de joint",
    LITDEPOSE: "Lit de pose",
    TYPE_SOL: "Type de sol",
    ETAT_SOL: "État du sol",
    TRAFIC: "Trafic",
    ENVIR_ELEC: "Environnement électrique",
    NB_BRANCHE: "Nombre de branchements",
    FABRICANT: "Fabricant",
    TECHNIQUE_: "Technique",
    PROTECT_IN: "Protection interne",
    PROTECT_EX: "Protection externe",
    PROTECT_CA: "Protection cathodique",
    DEPOT: "Dépôt / dépose",
    CORROSION: "Corrosion",
    VALEUR_NEU: "Valeur à neuf",
    TRANSMISS: "Transmissibilité",
    LASTUPDATE: "Dernière mise à jour",
    LASTEDITOR: "Dernier éditeur",
    ENABLED: "Actif (enabled)",
    ACTIVEFLAG: "Drapeau actif",
    OWNEDBY: "Propriétaire",
    MAINTBY: "Mainteneur",
    LONGSYS: "Longueur système",
    COMMENTA: "Commentaire",
    MAJ: "Date MAJ",
    ETAGPRESSI: "Étage de pression",
    IDADRESS: "ID adresse",
    SECTORISAT: "Sectorisation",
    PRECISLOCA: "Précision localisation",
    CLASSE_DIC: "Classe DIC",
    NOMCANAUX: "Nom du canal",
    SAISIE: "Saisie",
    SYMBOLOGIE: "Symbologie",
    TYPE_POSE: "Type de pose",
    DN: "Diamètre nominal (DN)",
    PROTECATHO: "Protection cathodique",
    REGULATEUR: "Régulateur",
    AGENCE: "Agence",
    COMMENTA_D: "Commentaire détaillé",
    PROSP_RENO: "Prospective rénovation",
    MAJREFGEOM: "MAJ référence géométrie",
    DATEMAJGEO: "Date MAJ géométrie",
    CONVENTION: "Convention",
    DATEMAJH: "Date MAJ historique",
    SHAPE_Leng: "Longueur shape",
    dense: "Niveau de densité",
    ValoPat: "Valeur patrimoniale",
    Vetuste: "Vétusté (source)",
    nbFuites: "Nombre de fuites (source)",
    nbAbo: "Nombre d'abonnés",
    sumConso: "Consommation cumulée",
    PRESSIONAV: "Pression moyenne",
    DEM_EAU_LS: "Demande d'eau (L/s)",
    CATEGORIE_: "Catégorie (source)",
    Traffic: "Trafic (source)",
    PrioMerlin: "Priorité Merlin",
    Altimetrie: "Altimétrie",
    ABANDATE: "Date d'abandon",
    HS_CAUSE: "Cause hors service",
    CAUSECOM: "Commentaire cause",
    FACILITYKE: "Clé facility",
    LINETYPE: "Type de ligne",
};

const BOOLEAN_KEYS = new Set([
    "abandoned",
    "ENABLED",
    "ACTIVEFLAG",
    "PROSP_RENO",
]);

// ── Init ──────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", async function () {
    const params   = new URLSearchParams(window.location.search);
    currentAdresse = params.get("adresse") || "";
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
        await fetchStatsAdresse(currentAdresse);
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

    // Export CSV
    on("btn-export", "click", exportCSV);
    initDetailModal();

    // Formulaire recherche
    document.getElementById("search-form")?.addEventListener("submit", e => {
        e.preventDefault();
        const v = e.target.querySelector(".search-bar__input").value.trim();
        if (v) window.location.href = `index.html?adresse=${encodeURIComponent(v)}`;
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

    if (currentAdresse) p.append("adresse",   currentAdresse);
    if (commune)        p.append("commune",   commune);
    if (mat)            p.append("materiau",  mat);
    if (statut)         p.append("statut",    statut);
    if (anc)            p.append("anciennete", anc);
    if (id)             p.append("search",    id);
    if (onlyCriticiteNull) p.append("only_unknown_criticite", "true");
    if (onlyPrioriteNull) p.append("only_unknown_priorite", "true");

    return p.toString();
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
            <td>${row.criticite != null ? critBar(row.criticite) : unknownValueIcon("Criticité inconnue")}</td>
            <td>${row.score_priorite != null ? row.score_priorite : unknownValueIcon("Score de priorité inconnu")}</td>
            <td>
                <button class="row-action-btn" type="button" title="Voir le détail" data-action="view" data-facilityid="${escapeHtml(row.facilityid || "")}" aria-label="Voir le détail">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"></path>
                        <circle cx="12" cy="12" r="3"></circle>
                    </svg>
                </button>
            </td>
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

async function fetchChantiers(adresse) {
    chantierCommune = adresse.split(',').pop().trim();
    await fetchChantierPage(1);
}

async function fetchChantierPage(page) {
    chantierPage = page;
    const tbody = document.getElementById("chantiers-body");
    if (!tbody) return;
    tbody.innerHTML = `<tr class="row-loading"><td colspan="6">Chargement…</td></tr>`;
    try {
        const offset = (page - 1) * PAGE_SIZE_CHANTIERS;
        const url = `${API}/api/chantiers?commune=${encodeURIComponent(chantierCommune)}&limit=${PAGE_SIZE_CHANTIERS}&offset=${offset}`;
        const res  = await fetch(url);
        const json = await res.json();
        chantierTotal = json.total || 0;
        renderChantiers(json.chantiers || []);
        setEl("chantiers-count", chantierTotal.toLocaleString("fr-FR"));
        renderTabPagination("chantiers-pagination", chantierPage, chantierTotal, PAGE_SIZE_CHANTIERS, fetchChantierPage);
    } catch(e) {
        tbody.innerHTML = `<tr class="row-empty-msg"><td colspan="6">Données non disponibles</td></tr>`;
    }
}

function formatChantierAdresseCell(adresse) {
    const s = adresse == null ? "" : String(adresse).trim();
    if (s) return escapeHtml(s);
    return `<span class="cell-adresse-empty" title="Adresse non renseignée" aria-label="Adresse non renseignée"><i class="fa-solid fa-minus" aria-hidden="true"></i></span>`;
}

function renderChantiers(data) {
    const tbody = document.getElementById("chantiers-body");
    if (!data.length) {
        tbody.innerHTML = `<tr class="row-empty-msg"><td colspan="6">Aucun chantier trouvé pour cette zone</td></tr>`;
        return;
    }
    tbody.innerHTML = data.map(row => `
        <tr>
            <td class="cell-id">${row.num_op}</td>
            <td>${row.libelle || "—"}</td>
            <td>${row.commune}</td>
            <td class="cell-adresse">${formatChantierAdresseCell(row.adresse)}</td>
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

async function fetchOperations(adresse) {
    opsCommune = adresse.split(',').pop().trim();
    await fetchOpsPage(1);
}

async function fetchOpsPage(page) {
    opsPage = page;
    const tbody = document.getElementById("operations-body");
    if (!tbody) return;
    tbody.innerHTML = `<tr class="row-loading"><td colspan="5">Chargement…</td></tr>`;
    try {
        const offset = (page - 1) * PAGE_SIZE_OPS;
        const url = `${API}/api/operations?commune=${encodeURIComponent(opsCommune)}&limit=${PAGE_SIZE_OPS}&offset=${offset}`;
        const res  = await fetch(url);
        const json = await res.json();
        opsTotal = json.total || 0;
        renderOperations(json.operations || []);
        setEl("operations-count", opsTotal.toLocaleString("fr-FR"));
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
        <tr>
            <td>${row.titre || "—"}</td>
            <td>${row.commune || "—"}</td>
            <td>${row.localisation || "—"}</td>
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

function critBar(value) {
    const cls = value >= 70 ? "high" : value >= 40 ? "mid" : "low";
    return `<div class="crit-cell">
        <div class="crit-cell__bar">
            <div class="crit-cell__fill crit-cell__fill--${cls}" style="width:${Math.min(value,100)}%"></div>
        </div>
        <span class="crit-cell__value">${value.toFixed(1)}%</span>
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
    const modal = document.getElementById("canalisation-modal");
    const closeBtn = document.getElementById("canalisation-modal-close");
    const backdrop = document.getElementById("canalisation-modal-backdrop");
    const body = document.getElementById("canalisation-modal-body");
    if (!tbody || !modal) return;

    tbody.addEventListener("click", function (e) {
        const btn = e.target.closest("button[data-action='view'][data-facilityid]");
        if (!btn) return;
        const facilityid = btn.dataset.facilityid;
        if (!facilityid) return;
        openDetailModal(facilityid);
    });

    closeBtn?.addEventListener("click", closeDetailModal);
    backdrop?.addEventListener("click", closeDetailModal);
    body?.addEventListener("click", async function (e) {
        const btn = e.target.closest("button[data-copy-id]");
        if (!btn) return;
        const raw = COPY_PAYLOADS.get(btn.dataset.copyId || "") || "";
        if (!raw) return;
        try {
            await navigator.clipboard.writeText(raw);
            const old = btn.textContent;
            btn.textContent = "Copié";
            setTimeout(() => { btn.textContent = old; }, 1100);
        } catch (_) {}
    });
    document.addEventListener("keydown", function (e) {
        if (e.key === "Escape") closeDetailModal();
    });
}

async function openDetailModal(facilityid) {
    const modal = document.getElementById("canalisation-modal");
    const title = document.getElementById("canalisation-modal-title");
    const subtitle = document.getElementById("canalisation-modal-subtitle");
    const body = document.getElementById("canalisation-modal-body");
    if (!modal || !title || !subtitle || !body) return;

    title.textContent = "Chargement…";
    subtitle.textContent = facilityid;
    body.innerHTML = `<div class="row-loading">Chargement des détails…</div>`;
    modal.classList.add("detail-modal--open");
    modal.setAttribute("aria-hidden", "false");

    try {
        COPY_PAYLOADS.clear();
        const res = await fetch(`${API}/api/canalisations/${encodeURIComponent(facilityid)}`);
        if (!res.ok) throw new Error("detail fetch failed");
        const detail = await res.json();

        const communeName = detail.canalisation?.commune_display
            || detail.conduite?.COMMUNE_DISPLAY
            || detail.canalisation?.commune
            || detail.conduite?.COMMUNE
            || "";
        const adresseTitle = detail.adresse || "Canalisation";
        title.textContent = communeName ? `${adresseTitle}, ${communeName}` : adresseTitle;
        subtitle.textContent = detail.facilityid || facilityid;
        body.innerHTML = [
            renderDetailSection("Canalisation (API)", detail.canalisation || {}),
            renderDetailSection("Conduite (Source enrichie)", detail.conduite || {}),
        ].join("");
    } catch (e) {
        body.innerHTML = `<div class="row-empty-msg">Impossible de charger le détail de la canalisation.</div>`;
    }
}

function closeDetailModal() {
    const modal = document.getElementById("canalisation-modal");
    if (!modal) return;
    modal.classList.remove("detail-modal--open");
    modal.setAttribute("aria-hidden", "true");
}

function renderDetailSection(title, obj) {
    const entries = Object.entries(obj || {});
    const content = entries.length
        ? entries.map(([k, v]) => `
            <div class="detail-item">
                <div class="detail-item__k">${escapeHtml(prettyKey(k))}</div>
                <div class="detail-item__v">${formatDetailValue(v, k)}</div>
            </div>
        `).join("")
        : `<div class="detail-item"><div class="detail-item__v">Aucune donnée</div></div>`;

    return `
        <section class="detail-section">
            <div class="detail-section__header">${escapeHtml(title)}</div>
            <div class="detail-grid">${content}</div>
        </section>
    `;
}

function prettyKey(key) {
    if (DETAIL_LABELS[key]) return DETAIL_LABELS[key];
    return String(key)
        .replaceAll("_", " ")
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .trim();
}

function formatDetailValue(v, key = "") {
    if (v == null || v === "") return "—";
    if (BOOLEAN_KEYS.has(key)) {
        if (v === true) return "Oui";
        if (v === false) return "Non";
        const n = Number(v);
        if (!Number.isNaN(n)) {
            if (n === 1) return "Oui";
            if (n === 0) return "Non";
        }
    }
    if (typeof v === "number") return Number.isInteger(v) ? String(v) : v.toFixed(4);
    if (typeof v === "boolean") return v ? "true" : "false";

    const special = formatSpecialLongValue(String(v), key);
    if (special) return special;

    const formattedDate = formatDateTimeForHumans(v);
    if (formattedDate) return escapeHtml(formattedDate);
    return escapeHtml(String(v));
}

function escapeHtml(str) {
    return String(str)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

function formatDateTimeForHumans(v) {
    if (typeof v !== "string") return null;
    const s = v.trim();
    if (!s) return null;

    // Formats fréquents observés: "YYYY/MM/DD HH:MM:SS(.sss)", "YYYY-MM-DDTHH:MM:SS+00:00"
    let m = s.match(/^(\d{4})[/-](\d{2})[/-](\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?)?/);
    if (!m) return null;

    const [, y, mo, d, hh, mm, ss] = m;
    if (!hh || !mm) return `${d}/${mo}/${y}`;
    const sec = ss ?? "00";
    return `${d}/${mo}/${y} ${hh}:${mm}:${sec}`;
}

function formatSpecialLongValue(raw, key) {
    const isAlt = key === "Altimetrie";
    const isGeom = key === "geometry";
    if (!isAlt && !isGeom) return null;

    const txt = String(raw).trim();
    if (!txt) return null;

    const summary = isAlt ? summarizeAltitude(txt) : summarizeGeometry(txt);
    if (!summary) return null;

    const copyId = `copy_${++copyPayloadSeq}`;
    COPY_PAYLOADS.set(copyId, txt);
    return `
        <div class="detail-long-value">
            <span class="detail-long-value__summary">${escapeHtml(summary)}</span>
            <button class="detail-copy-btn" type="button" data-copy-id="${copyId}" title="Copier la valeur complète">Copier</button>
        </div>
    `;
}

function summarizeAltitude(txt) {
    const clean = txt.replace(/^\[/, "").replace(/\]$/, "");
    const values = clean.split(",").map(s => s.trim()).filter(Boolean);
    if (values.length < 2) return txt;
    return `${values[0]} ... ${values[values.length - 1]}`;
}

function summarizeGeometry(txt) {
    const upper = txt.toUpperCase();
    if (!upper.startsWith("LINESTRING")) return txt.length > 60 ? `${txt.slice(0, 18)} ... ${txt.slice(-18)}` : txt;
    const body = txt.slice(txt.indexOf("(") + 1, txt.lastIndexOf(")"));
    const pts = body.split(",").map(s => s.trim()).filter(Boolean);
    if (pts.length < 2) return txt.length > 60 ? `${txt.slice(0, 18)} ... ${txt.slice(-18)}` : txt;
    return `${shortPoint(pts[0])} ... ${shortPoint(pts[pts.length - 1])}`;
}

function shortPoint(p) {
    const nums = p.split(/\s+/).filter(Boolean);
    if (nums.length < 2) return p;
    const x = Number(nums[0]);
    const y = Number(nums[1]);
    if (Number.isNaN(x) || Number.isNaN(y)) return p;
    return `${x.toFixed(2)} ${y.toFixed(2)}`;
}
