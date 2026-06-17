/**
 * Modale détail canalisation — partagée (index, plan de travaux).
 */
(function () {
    const SEGMENT_FACILITY_RE = /^(.+?) \((\d+\/\d+)\)$/;
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


    function apiBase() {
        return (window.__RTC_API_BASE__ || "http://127.0.0.1:8000");
    }

    function resolveDetailFacilityId(facilityid) {
        const fid = String(facilityid || "").trim();
        const match = SEGMENT_FACILITY_RE.exec(fid);
        return match ? match[1].trim() : fid;
    }

    function closeCanalisationDetailModal() {
        const modal = document.getElementById("canalisation-modal");
        if (!modal) return;
        modal.classList.remove("detail-modal--open");
        modal.setAttribute("aria-hidden", "true");
        document.body.classList.remove("detail-modal-open");
    }

    async function openCanalisationDetailModal(facilityid, options) {
        const modal = document.getElementById("canalisation-modal");
        const title = document.getElementById("canalisation-modal-title");
        const subtitle = document.getElementById("canalisation-modal-subtitle");
        const body = document.getElementById("canalisation-modal-body");
        if (!modal || !title || !subtitle || !body) return;

        const displayId = String((options && options.displayId) || facilityid || "").trim();
        const fetchId = resolveDetailFacilityId(displayId);
        const segmentMatch = SEGMENT_FACILITY_RE.exec(displayId);

        title.textContent = "Chargement…";
        subtitle.textContent = displayId || fetchId;
        body.innerHTML = '<div class="detail-modal__loading">Chargement des détails…</div>';
        modal.classList.add("detail-modal--open");
        modal.setAttribute("aria-hidden", "false");
        document.body.classList.add("detail-modal-open");

        try {
            COPY_PAYLOADS.clear();
            const res = await fetch(
                `${apiBase()}/api/canalisations/${encodeURIComponent(fetchId)}`
            );
            if (!res.ok) throw new Error("detail fetch failed");
            const detail = await res.json();

            const communeName = detail.canalisation?.commune_display
                || detail.conduite?.COMMUNE_DISPLAY
                || detail.canalisation?.commune
                || detail.conduite?.COMMUNE
                || "";
            const adresseTitle = detail.adresse || "Canalisation";
            title.textContent = communeName ? `${adresseTitle}, ${communeName}` : adresseTitle;
            subtitle.textContent = displayId || detail.facilityid || fetchId;

            const segmentNote = segmentMatch
                ? `<p class="detail-modal__segment-note">Tronçon planifié <strong>${escapeHtml(segmentMatch[2])}</strong> — données de la canalisation d'origine <code>${escapeHtml(fetchId)}</code>.</p>`
                : "";

            // Ouverture depuis le plan de travaux : on dispose de la longueur réelle du
            // segment planifié (≠ longueur totale de la canalisation d'origine renvoyée par
            // l'API). On l'utilise pour la 1re boite et on la retitre « Segment de canalisation ».
            const segmentLength = options ? Number(options.segmentLength) : NaN;
            const isPlannedSegment = Number.isFinite(segmentLength) && segmentLength > 0;

            const canalisationData = { ...(detail.canalisation || {}) };
            if (isPlannedSegment) {
                canalisationData.longueur = segmentLength;
            }
            const firstSectionTitle = isPlannedSegment
                ? "Segment de canalisation"
                : "Canalisation (API)";

            body.innerHTML = segmentNote + [
                renderDetailSection(firstSectionTitle, canalisationData),
                renderDetailSection("Conduite (Source enrichie)", detail.conduite || {}),
            ].join("");
        } catch {
            body.innerHTML = '<div class="detail-modal__error">Impossible de charger le détail de la canalisation.</div>';
        }
    }

    function initCanalisationDetailModal() {
        const modal = document.getElementById("canalisation-modal");
        if (!modal || modal.dataset.bound === "1") return;
        modal.dataset.bound = "1";

        const closeBtn = document.getElementById("canalisation-modal-close");
        const backdrop = document.getElementById("canalisation-modal-backdrop");
        const body = document.getElementById("canalisation-modal-body");

        closeBtn?.addEventListener("click", closeCanalisationDetailModal);
        backdrop?.addEventListener("click", closeCanalisationDetailModal);
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
            if (e.key === "Escape" && modal.getAttribute("aria-hidden") === "false") {
                closeCanalisationDetailModal();
            }
        });
    }

    window.rtcOpenCanalisationDetailModal = openCanalisationDetailModal;
    window.rtcCloseCanalisationDetailModal = closeCanalisationDetailModal;

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initCanalisationDetailModal);
    } else {
        initCanalisationDetailModal();
    }
})();
