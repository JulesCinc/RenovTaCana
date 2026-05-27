/**
 * carte.js - Carte interactive Leaflet
 * Canalisations + sélection de zone
 */

function geoJsonCanalisationsUrl() {
    return (window.__RTC_API_BASE__ || "http://127.0.0.1:8000") + "/api/geojson/canalisations";
}

let map, geoLayer, drawLayer, selectRectangle;
let baseTileLayer = null;
let allFeatures = [];
let activeFilter = "all";
let selectMode = false;
let lastRenderToken = 0;

let currentClickPipe = null; // données de la canalisation cliquée

let chantierLayer = null;
let chantiersLoaded = false;
const CANA_CACHE_DB = "rtc_map_cache";
const CANA_CACHE_STORE = "geojson";
const CANA_CACHE_KEY = "canalisations_v1";
const CANA_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24h

// -- Init --------------------------------------------------
document.addEventListener("DOMContentLoaded", async function () {
    initMap();
    await loadCanalisations();
    initFilters();
    initSearch();
    initZoneSelect();
    initChantierToggle();
    initPipePopup();
    updatePlanNavCount();
});

// -- Carte Leaflet -----------------------------------------
function initMap() {
    map = L.map("map", {
        center: [43.705, 7.265],
        zoom: 13,
        zoomControl: false,
        preferCanvas: true,
    });

    applyMapTheme();

    L.control.zoom({ position: "topright" }).addTo(map);
    L.control.scale({ position: "bottomleft", imperial: false, maxWidth: 200 }).addTo(map);

    observeThemeChanges();
}

function applyMapTheme() {
    const dark = document.body.classList.contains("theme-dark");
    const tileUrl = dark
        ? "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
        : "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png";

    if (baseTileLayer) map.removeLayer(baseTileLayer);

    baseTileLayer = L.tileLayer(tileUrl, {
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OSM</a> © <a href="https://carto.com/">CARTO</a>',
        subdomains: "abcd",
        maxZoom: 20,
    }).addTo(map);
}

function observeThemeChanges() {
    const observer = new MutationObserver(() => applyMapTheme());
    observer.observe(document.body, {
        attributes: true,
        attributeFilter: ["class"],
    });
}

// -- Canalisations -----------------------------------------
async function loadCanalisations() {
    try {
        document.getElementById("map-loading").querySelector("span").textContent =
            "Chargement des canalisations...";
        const cached = await readCanalisationsCache();
        const now = Date.now();
        const hasFreshCache = cached && (now - cached.savedAt) < CANA_CACHE_MAX_AGE_MS;

        if (cached?.data?.features?.length) {
            allFeatures = cached.data.features;
            renderLayer(allFeatures);
            document.getElementById("map-count").textContent =
                `${allFeatures.length.toLocaleString("fr-FR")} canalisations`;
            document.getElementById("map-loading").style.display = "none";
            if (hasFreshCache) return;
        }

        const res = await fetch(geoJsonCanalisationsUrl());
        const data = await res.json();
        allFeatures = data.features || [];
        renderLayer(allFeatures);
        document.getElementById("map-count").textContent =
            `${allFeatures.length.toLocaleString("fr-FR")} canalisations`;
        document.getElementById("map-loading").style.display = "none";
        await writeCanalisationsCache(data);
    } catch (e) {
        document.getElementById("map-loading").innerHTML =
            `<span style="color:var(--c-danger)">Erreur chargement des donnees</span>`;
    }
}

function openCacheDb() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(CANA_CACHE_DB, 1);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(CANA_CACHE_STORE)) {
                db.createObjectStore(CANA_CACHE_STORE);
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function readCanalisationsCache() {
    if (!("indexedDB" in window)) return null;
    try {
        const db = await openCacheDb();
        const tx = db.transaction(CANA_CACHE_STORE, "readonly");
        const store = tx.objectStore(CANA_CACHE_STORE);
        const value = await new Promise((resolve, reject) => {
            const req = store.get(CANA_CACHE_KEY);
            req.onsuccess = () => resolve(req.result || null);
            req.onerror = () => reject(req.error);
        });
        db.close();
        return value;
    } catch {
        return null;
    }
}

async function writeCanalisationsCache(data) {
    if (!("indexedDB" in window)) return;
    try {
        const db = await openCacheDb();
        const tx = db.transaction(CANA_CACHE_STORE, "readwrite");
        tx.objectStore(CANA_CACHE_STORE).put({ savedAt: Date.now(), data }, CANA_CACHE_KEY);
        await new Promise((resolve, reject) => {
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error);
        });
        db.close();
    } catch {
        // Ignore cache write errors silently
    }
}

function renderLayer(features) {
    const renderToken = ++lastRenderToken;
    if (geoLayer) map.removeLayer(geoLayer);
    geoLayer = L.geoJSON(null, {
        renderer: L.canvas(),
        style: f => getLineStyle(f.properties.crit),
        onEachFeature: function (feature, layer) {
            const p = feature.properties;
            layer.on("mouseover", e => { layer.setStyle({ weight: 5, opacity: 1 }); showTooltip(e, p); });
            layer.on("mouseout", () => { if (!selectMode) geoLayer.resetStyle(layer); hideTooltip(); });
            layer.on("click", (e) => {
                if (selectMode) return;
                L.DomEvent.stopPropagation(e);
                currentClickPipe = p;
                showPipePopup(e, p);
                hideTooltip();
            });
        }
    }).addTo(map);

    // Rendu progressif pour eviter de bloquer le thread UI sur gros volumes
    const chunkSize = 1000;
    let index = 0;

    function addChunk() {
        if (renderToken !== lastRenderToken) return;
        const chunk = features.slice(index, index + chunkSize);
        if (chunk.length) {
            geoLayer.addData(chunk);
            index += chunkSize;
            requestAnimationFrame(addChunk);
        }
    }

    requestAnimationFrame(addChunk);
}

function getLineStyle(crit) {
    if (crit == null) return { color: "#475569", weight: 1.5, opacity: 0.5 };
    if (crit >= 70) return { color: "#ef4444", weight: 3, opacity: 0.9 };
    if (crit >= 40) return { color: "#f97316", weight: 2.5, opacity: 0.85 };
    if (crit >= 20) return { color: "#eab308", weight: 2, opacity: 0.75 };
    if (crit >= 10) return { color: "#84cc16", weight: 1.8, opacity: 0.7 };
    return { color: "#00d4aa", weight: 1.5, opacity: 0.65 };
}

// -- Sélection de zone -------------------------------------
function initZoneSelect() {
    drawLayer = new L.FeatureGroup().addTo(map);

    // Handler rectangle directement (sans passer par le contrôle UI)
    let drawHandler = null;

    const btn = document.getElementById("toggle-select");
    btn?.addEventListener("click", function () {
        selectMode = !selectMode;
        btn.classList.toggle("active", selectMode);

        if (selectMode) {
            // Activer le dessin rectangle directement
            drawHandler = new L.Draw.Rectangle(map, {
                shapeOptions: { color: "#00d4aa", weight: 2, fillOpacity: 0.08, dashArray: "6 4" }
            });
            drawHandler.enable();
            document.getElementById("map-count").textContent = "Dessinez un rectangle...";
        } else {
            drawHandler?.disable();
            drawLayer.clearLayers();
            document.getElementById("zone-panel").style.display = "none";
            applyFilter();
        }
    });

    map.on(L.Draw.Event.CREATED, function (e) {
        drawLayer.clearLayers();
        drawLayer.addLayer(e.layer);
        const bounds = e.layer.getBounds();
        // Désactiver le mode dessin après tracé
        selectMode = false;
        document.getElementById("toggle-select")?.classList.remove("active");
        analyseZone(bounds);
    });

    document.getElementById("zone-close")?.addEventListener("click", function () {
        document.getElementById("zone-panel").style.display = "none";
        drawLayer.clearLayers();
        selectMode = false;
        drawHandler?.disable();
        document.getElementById("toggle-select")?.classList.remove("active");
        applyFilter();
    });
}

function analyseZone(bounds) {
    const inside = allFeatures.filter(f => {
        const coords = f.geometry.coordinates;
        return coords.some(pt => bounds.contains(L.latLng(pt[1], pt[0])));
    });

    if (!inside.length) return;

    const total = inside.length;
    const crits = inside.filter(f => (f.properties.crit ?? 0) >= 70).length;
    const critMoy = inside.filter(f => f.properties.crit != null)
        .reduce((s, f, _, a) => s + f.properties.crit / a.length, 0);

    // Highlight les canalisations sélectionnées
    renderLayer(inside);

    document.getElementById("zone-stats").innerHTML = `
        <div class="zone-stat">
            <div class="zone-stat__val">${total}</div>
            <div class="zone-stat__label">Canalisations</div>
        </div>
        <div class="zone-stat">
            <div class="zone-stat__val" style="color:var(--c-danger)">${crits}</div>
            <div class="zone-stat__label">Critiques</div>
        </div>
        <div class="zone-stat">
            <div class="zone-stat__val">${critMoy.toFixed(1)}%</div>
            <div class="zone-stat__label">Crit. moy.</div>
        </div>
    `;

    // Stocker tous les IDs dans sessionStorage pour la page adresses
    const ids = inside.map(f => f.properties.id);
    sessionStorage.setItem("zone_ids", JSON.stringify(ids));
    sessionStorage.setItem("zone_count", total);

    document.getElementById("zone-voir-adresses").href = "index.html?zone=1";
    document.getElementById("zone-title").textContent =
        `${total} canalisation${total > 1 ? "s" : ""} dans la zone`;
    document.getElementById("zone-panel").style.display = "block";
    document.getElementById("map-count").textContent = `${total} dans la zone`;
}

// -- Filtres rapides ---------------------------------------
function initFilters() {
    document.querySelectorAll(".map-filter-btn").forEach(btn => {
        btn.addEventListener("click", function () {
            document.querySelectorAll(".map-filter-btn").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            activeFilter = btn.dataset.filter;
            applyFilter();
        });
    });
}

function applyFilter() {
    let filtered;
    switch (activeFilter) {
        case "critique": filtered = allFeatures.filter(f => (f.properties.crit ?? 0) >= 70); break;
        case "attention": filtered = allFeatures.filter(f => { const c = f.properties.crit ?? 0; return c >= 40 && c < 70; }); break;
        case "bon": filtered = allFeatures.filter(f => (f.properties.crit ?? 0) < 40); break;
        default: filtered = allFeatures;
    }
    renderLayer(filtered);
    document.getElementById("map-count").textContent =
        `${filtered.length.toLocaleString("fr-FR")} canalisations`;
    if (filtered.length > 0 && geoLayer)
        map.fitBounds(geoLayer.getBounds(), { padding: [20, 20] });
}

// -- Recherche ---------------------------------------------
function initSearch() {
    const form = document.getElementById("search-form");
    if (!form) return;

    form.addEventListener("submit", function (e) {
        e.preventDefault();
        const query = form.querySelector(".search-bar__input").value.trim().toLowerCase();
        if (!query) return;

        const matches = allFeatures.filter(f =>
            f.properties.adr?.toLowerCase().includes(query)
        );

        if (matches.length > 0) {
            renderLayer(matches);
            document.getElementById("map-count").textContent =
                `${matches.length} résultat${matches.length > 1 ? "s" : ""} pour "${query}"`;
            if (geoLayer) map.fitBounds(geoLayer.getBounds(), { padding: [40, 40] });
        } else {
            window.location.href = `index.html?adresse=${encodeURIComponent(query)}`;
        }
    });

    form.querySelector(".search-bar__clear-button")?.addEventListener("click", function () {
        renderLayer(allFeatures);
        document.getElementById("map-count").textContent =
            `${allFeatures.length.toLocaleString("fr-FR")} canalisations`;
        document.querySelectorAll(".map-filter-btn").forEach(b => b.classList.remove("active"));
        document.querySelector('[data-filter="all"]')?.classList.add("active");
    });
}

// -- Chantiers overlay -------------------------------------
function initChantierToggle() {
    const btn = document.getElementById("toggle-chantiers");
    if (!btn) return;
    btn.addEventListener("click", async function () {
        if (!chantiersLoaded) {
            btn.disabled = true;
            btn.style.opacity = "0.5";
            await loadChantiers();
            chantiersLoaded = true;
            btn.disabled = false;
            btn.style.opacity = "";
            btn.classList.add("active");
            return;
        }
        if (chantierLayer && map.hasLayer(chantierLayer)) {
            map.removeLayer(chantierLayer);
            btn.classList.remove("active");
        } else {
            if (chantierLayer) chantierLayer.addTo(map);
            btn.classList.add("active");
        }
    });
}

async function loadChantiers() {
    try {
        const base = window.__RTC_API_BASE__ || "http://127.0.0.1:8000";
        const res = await fetch(`${base}/api/geojson/chantiers`);
        const data = await res.json();

        // Leaflet ignore les features à geometry:null, mais on filtre explicitement
        const localized = (data.features || []).filter(f => f.geometry !== null);

        chantierLayer = L.geoJSON(
            { type: "FeatureCollection", features: localized },
            {
                pointToLayer(feature, latlng) {
                    const etat = (feature.properties.etat || "").toLowerCase();
                    const fill = etat.includes("valid") ? "#22c55e" : "#f59e0b";
                    return L.circleMarker(latlng, {
                        radius: 7,
                        fillColor: fill,
                        color: "#0a0e14",
                        weight: 1.5,
                        opacity: 1,
                        fillOpacity: 0.9,
                    });
                },
                onEachFeature(feature, layer) {
                    const p = feature.properties;
                    const etat = p.etat || "-";
                    const etatColor = etat.toLowerCase().includes("valid") ? "#22c55e" : "#f59e0b";
                    layer.bindPopup(
                        `<div style="font-size:0.78rem;min-width:210px">
                            <div style="color:#888;font-size:0.63rem;margin-bottom:4px">${p.num_op || ""}</div>
                            <div style="font-weight:600;margin-bottom:8px;line-height:1.35">${p.libelle || "-"}</div>
                            <div style="display:flex;justify-content:space-between;gap:8px;margin-bottom:3px">
                                <span style="color:#888">État</span>
                                <strong style="color:${etatColor}">${etat}</strong>
                            </div>
                            <div style="display:flex;justify-content:space-between;gap:8px;margin-bottom:3px">
                                <span style="color:#888">Début</span>
                                <strong>${p.date_debut || "-"}</strong>
                            </div>
                            <div style="display:flex;justify-content:space-between;gap:8px">
                                <span style="color:#888">Fin</span>
                                <strong>${p.date_fin || "-"}</strong>
                            </div>
                        </div>`,
                        { className: "dark-popup" }
                    );
                },
            }
        ).addTo(map);
    } catch (e) {
        console.error("Erreur chargement chantiers", e);
    }
}

// -- Tooltip -----------------------------------------------
const tooltip = document.getElementById("map-tooltip");

function showTooltip(e, p) {
    document.getElementById("tt-id").textContent = p.id || "";
    document.getElementById("tt-adr").textContent = p.adr || "-";
    document.getElementById("tt-mat").textContent = p.mat || "-";
    document.getElementById("tt-diam").textContent = p.diam ? `${p.diam} mm` : "-";
    document.getElementById("tt-long").textContent = p.long ? `${p.long} m` : "-";
    const crit = p.crit;
    if (crit != null) {
        document.getElementById("tt-crit-val").textContent = `${crit.toFixed(1)}%`;
        const fill = document.getElementById("tt-fill");
        fill.style.width = `${Math.min(crit, 100)}%`;
        fill.style.background = crit >= 70 ? "#ef4444" : crit >= 40 ? "#f97316" : "#00d4aa";
    } else {
        document.getElementById("tt-crit-val").textContent = "-";
        document.getElementById("tt-fill").style.width = "0%";
    }
    tooltip.style.display = "block";
    moveTooltip(e);
}

function moveTooltip(e) {
    if (!tooltip || tooltip.style.display === "none") return;
    const rect = document.getElementById("map").getBoundingClientRect();
    let x = e.originalEvent.clientX - rect.left + 14;
    let y = e.originalEvent.clientY - rect.top - 20;
    if (x + 240 > rect.width) x -= 260;
    if (y + 200 > rect.height) y -= 200;
    tooltip.style.left = `${x}px`;
    tooltip.style.top = `${y}px`;
}

function hideTooltip() { tooltip.style.display = "none"; }

// -- Popup d'action (clic sur canalisation) ----------------
function showPipePopup(e, p) {
    const popup = document.getElementById("pipe-popup");
    if (!popup) return;

    document.getElementById("pp-id").textContent = p.id || "";
    const detailLink = document.getElementById("pp-detail");
    detailLink.href = p.adr ? `index.html?adresse=${encodeURIComponent(p.adr)}` : "#";

    popup.style.display = "flex";

    const rect = document.getElementById("map").getBoundingClientRect();
    let x = e.originalEvent.clientX - rect.left + 12;
    let y = e.originalEvent.clientY - rect.top - 12;
    if (x + 200 > rect.width) x -= 210;
    if (y + 90 > rect.height) y -= 100;
    popup.style.left = x + "px";
    popup.style.top = y + "px";
}

function hidePipePopup() {
    const popup = document.getElementById("pipe-popup");
    if (popup) popup.style.display = "none";
}

function initPipePopup() {
    map.on("click", () => hidePipePopup());
    map.on("mousemove", e => moveTooltip(e));

    document.getElementById("pp-plan")?.addEventListener("click", () => {
        if (currentClickPipe && window.ajouterAuPlan) {
            window.ajouterAuPlan(currentClickPipe);
            updatePlanNavCount();
        }
        hidePipePopup();
    });
}

function updatePlanNavCount() {
    const el = document.getElementById("plan-nav-count");
    if (!el) return;
    try {
        const items = JSON.parse(localStorage.getItem("rtc_plan_travaux") || "[]");
        el.textContent = items.length > 0 ? `(${items.length})` : "";
    } catch { el.textContent = ""; }
}

