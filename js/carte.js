/**
 * carte.js - Carte interactive Leaflet
 * Canalisations + sélection de zone
 */

function geoJsonCanalisationsUrl() {
    return (window.__RTC_API_BASE__ || "http://127.0.0.1:8000") + "/api/geojson/segmentation";
}

let map, geoLayer, drawLayer, selectRectangle;
let baseTileLayer = null;
let allFeatures = [];
const CRIT_FILTER_KEYS = ["critique", "attention", "bon"];
/** Vide ou les 3 clés = afficher tout (équivalent « Tous ») */
let activeCritFilters = new Set();
let zoneModeActive = false;
let suppressMapClickClear = false;
/** Glisser pour rectangle ; clic simple (sans déplacement) = effacer */
let zoneDrag = null;
let zonePreviewRect = null;
const ZONE_DRAG_THRESHOLD_PX = 6;
let lastRenderToken = 0;
/** Leaflet.Draw ne transmet pas ctrlKey sur draw:created — suivi clavier/souris */
const zoneModifiers = { ctrl: false, meta: false, alt: false };

/** Sélection pour le plan de travaux : facilityid → données canalisation */
const selectedPipes = new Map();
const pipeLayersById = new Map();

const SELECTED_LINE_STYLE = { color: "#00d4aa", weight: 5, opacity: 1 };
const PLAN_SUBMIT_LABEL_BASE = "Ajouter au plan de travaux";

let chantierLayer = null;
let chantiersLoaded = false;
const CANA_CACHE_DB = "rtc_map_cache";
const CANA_CACHE_STORE = "geojson";
const CANA_CACHE_KEY = "segmentation_v2";
const CANA_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24h

// -- Init --------------------------------------------------
document.addEventListener("DOMContentLoaded", async function () {
    initMap();
    await loadCanalisations();
    initFilters();
    initSearch();
    initZoneModifierTracking();
    initZoneSelect();
    initChantierToggle();
    initPlanSelection();
    initCarteHelp();
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
            updateMapCountDisplay(allFeatures.length);
            document.getElementById("map-loading").style.display = "none";
            if (hasFreshCache) return;
        }

        const res = await fetch(geoJsonCanalisationsUrl());
        const data = await res.json();
        allFeatures = data.features || [];
        renderLayer(allFeatures);
        updateMapCountDisplay(allFeatures.length);
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

function propsToPlanData(p) {
    return {
        facilityid: p.id,
        id: p.id,
        adresse: p.adr,
        adr: p.adr,
        materiau: p.mat,
        mat: p.mat,
        diametre: p.diam,
        diam: p.diam,
        longueur: p.long,
        long: p.long,
        criticite: p.crit,
        crit: p.crit,
    };
}

function getPipeLayerStyle(p) {
    if (selectedPipes.has(p.id)) return { ...SELECTED_LINE_STYLE };
    return getLineStyle(p.crit);
}

function renderLayer(features) {
    const renderToken = ++lastRenderToken;
    pipeLayersById.clear();
    if (geoLayer) map.removeLayer(geoLayer);
    geoLayer = L.geoJSON(null, {
        renderer: L.canvas(),
        style: f => getPipeLayerStyle(f.properties),
        onEachFeature: function (feature, layer) {
            const p = feature.properties;
            if (p.id) {
                if (!pipeLayersById.has(p.id)) pipeLayersById.set(p.id, []);
                pipeLayersById.get(p.id).push(layer);
            }
            layer.on("mouseover", e => {
                if (!selectedPipes.has(p.id)) layer.setStyle({ weight: 5, opacity: 1 });
                showTooltip(e, p);
            });
            layer.on("mouseout", () => {
                if (!selectedPipes.has(p.id) && geoLayer) geoLayer.resetStyle(layer);
                hideTooltip();
            });
            layer.on("click", e => {
                if (zoneModeActive) return;
                L.DomEvent.stopPropagation(e);
                togglePipeSelection(p);
                hideTooltip();
            });
            layer.on("dblclick", e => {
                L.DomEvent.stopPropagation(e);
                if (p.adr) window.location.href = `index.html?adresse=${encodeURIComponent(p.adr)}`;
            });
        }
    }).addTo(map);

    const chunkSize = 1000;
    let index = 0;

    function addChunk() {
        if (renderToken !== lastRenderToken) return;
        const chunk = features.slice(index, index + chunkSize);
        if (chunk.length) {
            geoLayer.addData(chunk);
            index += chunkSize;
            requestAnimationFrame(addChunk);
        } else {
            refreshAllSelectionStyles();
        }
    }

    requestAnimationFrame(addChunk);
}

function togglePipeSelection(p) {
    const id = p?.id;
    if (!id) return;
    if (selectedPipes.has(id)) {
        selectedPipes.delete(id);
        (pipeLayersById.get(id) || []).forEach(l => { if (geoLayer) geoLayer.resetStyle(l); });
    } else {
        selectedPipes.set(id, propsToPlanData(p));
        (pipeLayersById.get(id) || []).forEach(l => { l.setStyle(SELECTED_LINE_STYLE); });
    }
    syncZoneSessionStorage();
    updateCartePlanSubmitButton();
    updateMapCountDisplay();
}

function addFeaturesToSelection(features) {
    let added = 0;
    features.forEach(f => {
        const p = f.properties;
        if (!p?.id) return;
        if (!selectedPipes.has(p.id)) added += 1;
        selectedPipes.set(p.id, propsToPlanData(p));
    });
    syncZoneSessionStorage();
    updateCartePlanSubmitButton();
    updateMapCountDisplay();
    return added;
}

function removeFeaturesFromSelection(features) {
    features.forEach(f => {
        const id = f.properties?.id;
        if (!id || !selectedPipes.has(id)) return;
        selectedPipes.delete(id);
        (pipeLayersById.get(id) || []).forEach(l => { if (geoLayer) geoLayer.resetStyle(l); });
    });
    syncZoneSessionStorage();
    updateCartePlanSubmitButton();
    updateMapCountDisplay();
}

function getFeaturesInBounds(bounds) {
    return allFeatures.filter(f => {
        if (!featureMatchesCritFilters(f)) return false;
        const coords = f.geometry?.coordinates;
        if (!coords?.length) return false;
        return coords.some(pt => bounds.contains(L.latLng(pt[1], pt[0])));
    });
}

function clearMapSelection() {
    selectedPipes.clear();
    drawLayer?.clearLayers();
    document.getElementById("zone-panel").style.display = "none";
    syncZoneSessionStorage();
    refreshAllSelectionStyles();
    updateCartePlanSubmitButton();
    updateMapCountDisplay();
}

function syncZoneSessionStorage() {
    const ids = [...selectedPipes.keys()];
    sessionStorage.setItem("zone_ids", JSON.stringify(ids));
    sessionStorage.setItem("zone_count", String(ids.length));
    const link = document.getElementById("zone-voir-adresses");
    if (link) link.href = ids.length ? "index.html?zone=1" : "#";
}

function updateMapCountDisplay(filteredCount) {
    const el = document.getElementById("map-count");
    if (!el) return;
    if (typeof filteredCount === "string") {
        el.textContent = filteredCount;
        return;
    }
    if (selectedPipes.size > 0) {
        const n = selectedPipes.size;
        el.textContent = `${n.toLocaleString("fr-FR")} sélectionnée${n > 1 ? "s" : ""}`;
        return;
    }
    if (filteredCount != null) {
        el.textContent = `${filteredCount.toLocaleString("fr-FR")} canalisations`;
    }
}

function getZoneRectStyle(subtractive = false) {
    return subtractive
        ? { color: "#ef4444", weight: 2, fillOpacity: 0.08, dashArray: "6 4" }
        : { color: "#00d4aa", weight: 2, fillOpacity: 0.08, dashArray: "6 4" };
}

function removeZonePreview() {
    if (zonePreviewRect) {
        map.removeLayer(zonePreviewRect);
        zonePreviewRect = null;
    }
}

function finishZoneDrag(endLatLng) {
    if (!zoneDrag) return;
    if (zoneDrag.onFeature) {
        zoneDrag = null;
        removeZonePreview();
        return;
    }

    const { moved, start, mode } = zoneDrag;
    zoneDrag = null;
    removeZonePreview();

    if (moved && endLatLng) {
        suppressMapClickClear = true;
        setTimeout(() => { suppressMapClickClear = false; }, 0);

        const bounds = L.latLngBounds(start, endLatLng);
        const subtractive = mode === "subtract";
        if (mode === "replace") drawLayer.clearLayers();
        drawLayer.addLayer(L.rectangle(bounds, getZoneRectStyle(subtractive)));
        applyZoneSelection(bounds, mode);
    } else if (selectedPipes.size > 0) {
        clearMapSelection();
    }
}

function setMapNavigationEnabled(enabled) {
    if (!map) return;
    if (enabled) {
        map.dragging?.enable();
        map.doubleClickZoom?.enable();
        map.boxZoom?.enable();
        if (map.tap) map.tap.enable();
    } else {
        map.dragging?.disable();
        map.doubleClickZoom?.disable();
        map.boxZoom?.disable();
        if (map.tap) map.tap.disable();
    }
}

function setZoneMode(active) {
    zoneModeActive = active;
    unbindZonePointerListeners();
    zoneDrag = null;
    removeZonePreview();
    document.getElementById("toggle-select")?.classList.toggle("active", active);
    document.getElementById("map")?.classList.toggle("map--zone-mode", active);
    setMapNavigationEnabled(!active);
    if (!active) drawLayer?.clearLayers();
    updateMapCountDisplay();
}

function applyZoneSelection(bounds, mode) {
    const inside = getFeaturesInBounds(bounds);

    if (mode === "replace") {
        selectedPipes.clear();
        addFeaturesToSelection(inside);
    } else if (mode === "subtract") {
        removeFeaturesFromSelection(inside);
    } else {
        addFeaturesToSelection(inside);
    }

    applyFilter({ fitBounds: false });

    if (!inside.length && !selectedPipes.size) {
        document.getElementById("zone-panel").style.display = "none";
        return;
    }

    updateZonePanel(inside, mode);
}

function updateZonePanel(lastZoneFeatures, mode) {
    const zoneTotal = lastZoneFeatures.length;
    const selectedTotal = selectedPipes.size;
    const crits = lastZoneFeatures.filter(f => (f.properties.crit ?? 0) >= 70).length;
    const critVals = lastZoneFeatures.filter(f => f.properties.crit != null);
    const critMoy = critVals.length
        ? critVals.reduce((s, f) => s + f.properties.crit, 0) / critVals.length
        : 0;

    document.getElementById("zone-stats").innerHTML = `
        <div class="zone-stat">
            <div class="zone-stat__val">${zoneTotal}</div>
            <div class="zone-stat__label">Dans le rectangle</div>
        </div>
        <div class="zone-stat">
            <div class="zone-stat__val" style="color:var(--c-danger)">${crits}</div>
            <div class="zone-stat__label">Critiques</div>
        </div>
        <div class="zone-stat">
            <div class="zone-stat__val">${selectedTotal}</div>
            <div class="zone-stat__label">Sélection totale</div>
        </div>
    `;

    const modeLabel =
        mode === "add" ? "ajoutées" : mode === "subtract" ? "retirées" : "sélectionnées";
    document.getElementById("zone-title").textContent =
        zoneTotal > 0
            ? `${zoneTotal} canalisation${zoneTotal > 1 ? "s" : ""} ${modeLabel}`
            : "Aucune canalisation dans le rectangle";
    document.getElementById("zone-panel").style.display = "block";
    updateMapCountDisplay();
}

function refreshAllSelectionStyles() {
    pipeLayersById.forEach((layers, id) => {
        layers.forEach(layer => {
            if (selectedPipes.has(id)) layer.setStyle(SELECTED_LINE_STYLE);
            else if (geoLayer) geoLayer.resetStyle(layer);
        });
    });
}

function getLineStyle(crit) {
    if (crit == null) return { color: "#475569", weight: 1.5, opacity: 0.5 };
    if (crit >= 70) return { color: "#ef4444", weight: 3, opacity: 0.9 };
    if (crit >= 40) return { color: "#f97316", weight: 2.5, opacity: 0.85 };
    if (crit >= 20) return { color: "#eab308", weight: 2, opacity: 0.75 };
    if (crit >= 10) return { color: "#84cc16", weight: 1.8, opacity: 0.7 };
    return { color: "#00d4aa", weight: 1.5, opacity: 0.65 };
}

function syncZoneModifiersFromEvent(e) {
    if (!e) return;
    zoneModifiers.ctrl = Boolean(e.ctrlKey);
    zoneModifiers.meta = Boolean(e.metaKey);
    zoneModifiers.alt = Boolean(e.altKey);
}

/** replace | add (Ctrl) | subtract (Alt) */
function getZoneSelectionMode() {
    if (zoneModifiers.alt) return "subtract";
    if (zoneModifiers.ctrl || zoneModifiers.meta) return "add";
    return "replace";
}

function initZoneModifierTracking() {
    document.addEventListener("keydown", e => {
        syncZoneModifiersFromEvent(e);
        if (zoneModeActive) updateMapCountDisplay();
    });
    document.addEventListener("keyup", e => {
        syncZoneModifiersFromEvent(e);
        if (zoneModeActive) updateMapCountDisplay();
    });
    document.addEventListener("mousedown", syncZoneModifiersFromEvent, true);
    document.addEventListener("mouseup", syncZoneModifiersFromEvent, true);
    window.addEventListener("blur", () => {
        zoneModifiers.ctrl = false;
        zoneModifiers.meta = false;
        zoneModifiers.alt = false;
    });
}

function onZonePointerMove(e) {
    if (!zoneDrag || zoneDrag.onFeature || !zoneModeActive) return;
    const latlng = map.mouseEventToLatLng(e);
    zoneDrag.lastLatLng = latlng;
    const point = map.latLngToContainerPoint(latlng);
    const dist = point.distanceTo(zoneDrag.startPoint);
    if (dist < ZONE_DRAG_THRESHOLD_PX) return;

    zoneDrag.moved = true;
    const bounds = L.latLngBounds(zoneDrag.start, latlng);
    const style = getZoneRectStyle(zoneDrag.mode === "subtract");
    if (!zonePreviewRect) {
        zonePreviewRect = L.rectangle(bounds, style).addTo(map);
    } else {
        zonePreviewRect.setBounds(bounds);
        zonePreviewRect.setStyle(style);
    }
}

function unbindZonePointerListeners() {
    document.removeEventListener("mousemove", onZonePointerMove);
    document.removeEventListener("mouseup", onZonePointerUp);
}

function onZonePointerUp(e) {
    unbindZonePointerListeners();
    if (!zoneDrag || !zoneModeActive) return;
    const endLatLng = zoneDrag.lastLatLng || map.mouseEventToLatLng(e);
    finishZoneDrag(endLatLng);
}

function onZonePointerDown(e) {
    if (!zoneModeActive || e.button !== 0) return;
    if (e.target.closest(".leaflet-control")) return;

    syncZoneModifiersFromEvent(e);
    zoneDrag = {
        start: map.mouseEventToLatLng(e),
        startPoint: map.mouseEventToContainerPoint(e),
        moved: false,
        onFeature: false,
        mode: getZoneSelectionMode(),
    };

    document.addEventListener("mousemove", onZonePointerMove);
    document.addEventListener("mouseup", onZonePointerUp);
    L.DomEvent.preventDefault(e);
    L.DomEvent.stopPropagation(e);
}

// -- Sélection de zone (style Photoshop) -------------------
function initZoneSelect() {
    drawLayer = new L.FeatureGroup().addTo(map);

    document.getElementById("toggle-select")?.addEventListener("click", () => {
        setZoneMode(!zoneModeActive);
    });

    map.getContainer().addEventListener("mousedown", onZonePointerDown);

    document.getElementById("zone-close")?.addEventListener("click", function () {
        document.getElementById("zone-panel").style.display = "none";
        drawLayer.clearLayers();
    });
}

// -- Filtres rapides (cumulables) --------------------------
function isShowingAllCritFilters() {
    return activeCritFilters.size === 0 || activeCritFilters.size === CRIT_FILTER_KEYS.length;
}

function featureMatchesCritFilters(f) {
    if (isShowingAllCritFilters()) return true;
    const c = f.properties.crit ?? 0;
    if (activeCritFilters.has("critique") && c >= 70) return true;
    if (activeCritFilters.has("attention") && c >= 40 && c < 70) return true;
    if (activeCritFilters.has("bon") && c < 40) return true;
    return false;
}

function syncCritFilterButtons() {
    const showAll = isShowingAllCritFilters();
    document.querySelectorAll(".map-filter-btn").forEach(btn => {
        const key = btn.dataset.filter;
        if (key === "all") {
            btn.classList.toggle("active", showAll);
        } else {
            btn.classList.toggle("active", showAll || activeCritFilters.has(key));
        }
    });
}

function onCritFilterClick(filterKey) {
    if (filterKey === "all") {
        activeCritFilters.clear();
    } else if (isShowingAllCritFilters()) {
        activeCritFilters.clear();
        activeCritFilters.add(filterKey);
    } else if (activeCritFilters.has(filterKey)) {
        activeCritFilters.delete(filterKey);
        if (activeCritFilters.size === 0) activeCritFilters.clear();
    } else {
        activeCritFilters.add(filterKey);
        if (activeCritFilters.size === CRIT_FILTER_KEYS.length) activeCritFilters.clear();
    }
    syncCritFilterButtons();
    applyFilter();
}

function initFilters() {
    document.querySelectorAll(".map-filter-btn").forEach(btn => {
        btn.addEventListener("click", () => onCritFilterClick(btn.dataset.filter));
    });
    syncCritFilterButtons();
}

function applyFilter(options = {}) {
    const filtered = allFeatures.filter(featureMatchesCritFilters);
    renderLayer(filtered);
    updateMapCountDisplay(filtered.length);
    const shouldFit = options.fitBounds !== false && filtered.length > 0 && geoLayer && !selectedPipes.size;
    if (shouldFit) map.fitBounds(geoLayer.getBounds(), { padding: [20, 20] });
}

// -- Recherche ---------------------------------------------
function initSearch() {
    const form = document.getElementById("search-form");
    if (!form) return;

    form.addEventListener("submit", function (e) {
        e.preventDefault();
        const rawQuery = form.querySelector(".search-bar__input").value.trim();
        const query = rawQuery.toLowerCase();
        if (!query) return;

        // Accepte "Adresse, Commune" en plus de "Adresse" seule.
        const queryNoCity = query.split(",")[0].trim();

        const matches = allFeatures.filter(f =>
            f.properties.adr?.toLowerCase().includes(query)
            || (queryNoCity && f.properties.adr?.toLowerCase().includes(queryNoCity))
        );

        if (matches.length > 0) {
            renderLayer(matches);
            document.getElementById("map-count").textContent =
                `${matches.length} résultat${matches.length > 1 ? "s" : ""} pour "${rawQuery}"`;
            if (geoLayer) map.fitBounds(geoLayer.getBounds(), { padding: [40, 40] });
        } else {
            window.location.href = `index.html?adresse=${encodeURIComponent(rawQuery)}`;
        }
    });

    form.querySelector(".search-bar__clear-button")?.addEventListener("click", function () {
        renderLayer(allFeatures);
        document.getElementById("map-count").textContent =
            `${allFeatures.length.toLocaleString("fr-FR")} canalisations`;
        activeCritFilters.clear();
        syncCritFilterButtons();
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
    document.getElementById("tt-long").textContent = p.long != null
        ? `${Number(p.long).toFixed(1)} m`
        : "-";
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

// -- Sélection plan de travaux -----------------------------
function getCartePlanSubmitLabel(count = selectedPipes.size) {
    if (count <= 0) return PLAN_SUBMIT_LABEL_BASE;
    const word = count === 1 ? "canalisation" : "canalisations";
    return `${PLAN_SUBMIT_LABEL_BASE} (${count.toLocaleString("fr-FR")} ${word})`;
}

function updateCartePlanSubmitButton() {
    const btn = document.getElementById("carte-plan-submit");
    if (!btn) return;
    const count = selectedPipes.size;
    btn.classList.toggle("is-visible", count > 0);
    btn.hidden = count === 0;
    btn.textContent = getCartePlanSubmitLabel(count);
}

function commitSelectionToPlan() {
    if (!selectedPipes.size) return;
    const items = [...selectedPipes.values()];
    window.ajouterPlusieursAuPlan?.(items, { silent: true });
    localStorage.setItem("rtc_plan_ui_mode", "active");
    selectedPipes.clear();
    updateCartePlanSubmitButton();
    updatePlanNavCount();
    window.location.href = "plan-travaux.html";
}

function initPlanSelection() {
    map.on("mousemove", e => moveTooltip(e));
    map.on("click", () => {
        if (suppressMapClickClear || zoneModeActive) return;
        if (selectedPipes.size > 0) clearMapSelection();
    });
    document.addEventListener("keydown", e => {
        if (e.key !== "Escape") return;
        if (document.getElementById("carte-help")?.getAttribute("aria-hidden") === "false") return;
        if (selectedPipes.size > 0) clearMapSelection();
    });
    updateCartePlanSubmitButton();
    document.getElementById("carte-plan-submit")?.addEventListener("click", commitSelectionToPlan);
}

function initCarteHelp() {
    const modal = document.getElementById("carte-help");
    const openBtn = document.getElementById("carte-help-open");
    const backdrop = document.getElementById("carte-help-backdrop");
    if (!modal || !openBtn) return;

    const closeBtns = modal.querySelectorAll("#carte-help-close, #carte-help-close-footer");

    function isOpen() {
        return modal.getAttribute("aria-hidden") === "false";
    }

    function openHelp() {
        modal.setAttribute("aria-hidden", "false");
        document.body.classList.add("carte-help-open");
        closeBtns[0]?.focus();
    }

    function closeHelp() {
        modal.setAttribute("aria-hidden", "true");
        document.body.classList.remove("carte-help-open");
        openBtn.focus();
    }

    openBtn.addEventListener("click", openHelp);
    backdrop?.addEventListener("click", closeHelp);
    closeBtns.forEach(btn => btn.addEventListener("click", closeHelp));

    document.addEventListener("keydown", e => {
        if (e.key === "Escape" && isOpen()) {
            e.preventDefault();
            closeHelp();
        }
    });
}

