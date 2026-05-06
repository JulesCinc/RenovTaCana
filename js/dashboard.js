/**
 * dashboard.js — Tableau de bord RenovTaCana
 */

const API = window.__RTC_API_BASE__ || "http://127.0.0.1:8000";
let planData = [];
let planCommune = "";
let planPage = 1;
const PLAN_PAGE_SIZE = 50;
const COMMUNE_LABELS = new Map();

document.addEventListener("DOMContentLoaded", async function () {
    await loadDashboard();
    await loadCommunes();
    await loadPlanTravaux("");

    on("plan-commune", "change", async function () {
        planCommune = val("plan-commune");
        await loadPlanTravaux(planCommune);
    });

    on("export-plan", "click", exportPlanCSV);
});

// ── Dashboard principal ───────────────────────────────────
async function loadDashboard() {
    try {
        const res  = await fetch(`${API}/api/dashboard`);
        const data = await res.json();

        // KPIs
        setEl("kpi-total",     data.total_canalisations.toLocaleString("fr-FR"));
        setEl("kpi-km",        `${data.km_total} km`);
        setEl("kpi-critiques", data.critiques.toLocaleString("fr-FR"));
        setEl("kpi-attention", data.attention.toLocaleString("fr-FR"));
        setEl("kpi-chantiers", data.nb_chantiers.toLocaleString("fr-FR"));
        setEl("kpi-fuites",    data.total_fuites.toLocaleString("fr-FR"));
        setEl("kpi-crit-moy",  `${data.criticite_moyenne}%`);

        // Barres criticité
        const total = data.total_canalisations;
        animBar("bar-critique", "val-critique", data.critiques, total);
        animBar("bar-attention", "val-attention", data.attention, total);
        animBar("bar-bon",       "val-bon",       data.bon,       total);
        animBar("bar-neval",     "val-neval",     data.non_eval,  total);

        // Chantiers par état
        renderChantiersEtat(data.chantiers_etat, data.nb_chantiers);

        // Matériaux
        renderMateriaux(data.materiaux);

        // Années de pose
        renderAnnees(data.annees);

    } catch(e) {
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
async function loadPlanTravaux(commune, offset = 0) {
    const tbody = document.getElementById("plan-body");
    if (!tbody) return;
    tbody.innerHTML = `<tr class="row-loading"><td colspan="10">Chargement…</td></tr>`;

    try {
        const params = new URLSearchParams({ limit: PLAN_PAGE_SIZE, offset });
        if (commune) params.append("commune", commune);

        const res  = await fetch(`${API}/api/plan-travaux?${params}`);
        const json = await res.json();
        planData   = json.rues || [];
        await hydrateCommuneLabels(planData.map(r => r.commune));
        renderPlanTable(planData, offset);
    } catch(e) {
        tbody.innerHTML = `<tr class="row-empty-msg"><td colspan="10">Erreur chargement</td></tr>`;
    }
}

function renderPlanTable(data, offset = 0) {
    const tbody = document.getElementById("plan-body");
    if (!data.length) {
        tbody.innerHTML = `<tr class="row-empty-msg"><td colspan="10">Aucune donnée</td></tr>`;
        return;
    }
    tbody.innerHTML = data.map((r, i) => {
        const rang = offset + i + 1;
        const scorePct = Math.min(r.score_max, 100);
        const critCls = r.crit_moy >= 70 ? "table-pill--danger" : r.crit_moy >= 40 ? "table-pill--warning" : "table-pill--success";
        const mats = (r.materiaux || "").split(",").slice(0, 2).join(", ");
        const communeCode = normalizeCommuneCode(r.commune);
        const communeLabel = COMMUNE_LABELS.get(communeCode) || communeCode || "—";
        return `<tr>
            <td style="color:var(--c-text-dim);font-weight:600;width:50px">#${rang}</td>
            <td style="color:var(--c-text);width:180px">${r.adresse}</td>
            <td style="color:var(--c-text-muted);width:130px">${communeLabel}</td>
            <td style="text-align:center;width:80px">${r.nb_canalisations}</td>
            <td style="width:120px">
                <div class="score-pill">
                    <div class="score-bar"><div class="score-bar__fill" style="width:${scorePct}%"></div></div>
                    <span style="font-size:0.8rem;color:var(--c-text)">${r.score_max}</span>
                </div>
            </td>
            <td style="width:90px"><span class="table-pill ${critCls}">${r.crit_moy}%</span></td>
            <td style="text-align:center;width:60px;color:${r.total_fuites > 5 ? 'var(--c-danger)' : 'var(--c-text-muted)'}">${r.total_fuites}</td>
            <td style="color:var(--c-text-muted);width:80px">${r.longueur_tot} m</td>
            <td style="font-size:0.72rem;color:var(--c-text-dim);width:160px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:160px">${mats}</td>
            <td style="width:70px">
                <a class="btn-view" href="index.html?adresse=${encodeURIComponent(r.adresse)}">Voir →</a>
            </td>
        </tr>`;
    }).join("");
}

// ── Communes pour le filtre ───────────────────────────────
async function loadCommunes() {
    try {
        const res  = await fetch(`${API}/api/filtres`);
        const data = await res.json();
        const sel  = document.getElementById("plan-commune");
        if (!sel) return;
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
            await hydrateCommuneLabels(data.communes_options.map(c => c.value));
            for (const opt of sel.options) {
                if (!opt.value) continue;
                opt.textContent = COMMUNE_LABELS.get(opt.value) || opt.textContent;
            }
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
            await hydrateCommuneLabels(data.communes || []);
            for (const opt of sel.options) {
                if (!opt.value) continue;
                opt.textContent = COMMUNE_LABELS.get(opt.value) || opt.textContent;
            }
        }
    } catch(e) {}
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
    try {
        const res = await fetch(`https://geo.api.gouv.fr/communes/${normalized}?fields=nom&format=json&geometry=centre`);
        if (!res.ok) return normalized;
        const json = await res.json();
        return String(json?.nom || "").trim() || normalized;
    } catch (_) {
        return normalized;
    }
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
        const res  = await fetch(`${API}/api/plan-travaux?${params}`);
        const json = await res.json();
        const data = json.rues || [];

        const headers = ["Rang","Adresse","Commune","Nb canalisations","Score priorité",
                         "Criticité moy. (%)","Fuites totales","Longueur (m)","Matériaux"];
        const rows = data.map((r, i) => [
            i+1, r.adresse, (COMMUNE_LABELS.get(normalizeCommuneCode(r.commune)) || normalizeCommuneCode(r.commune) || ""), r.nb_canalisations,
            r.score_max, r.crit_moy, r.total_fuites, r.longueur_tot, r.materiaux
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
