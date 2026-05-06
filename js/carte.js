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

// -- Init --------------------------------------------------
document.addEventListener("DOMContentLoaded", async function () {
    initMap();
    await loadCanalisations();
    initFilters();
    initSearch();
    initZoneSelect();
});

// -- Carte Leaflet -----------------------------------------
function initMap() {
    map = L.map("map", {
        center: [43.705, 7.265],
        zoom: 13,
        zoomControl: false,
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
            "Chargement des 55 524 canalisationsâ€¦";
        const res = await fetch(geoJsonCanalisationsUrl());
        const data = await res.json();
        allFeatures = data.features || [];
        renderLayer(allFeatures);
        document.getElementById("map-count").textContent =
            `${allFeatures.length.toLocaleString("fr-FR")} canalisations`;
        document.getElementById("map-loading").style.display = "none";
    } catch (e) {
        document.getElementById("map-loading").innerHTML =
            `<span style="color:var(--c-danger)">âš ï¸ Erreur chargement des données</span>`;
    }
}

function renderLayer(features) {
    if (geoLayer) map.removeLayer(geoLayer);
    geoLayer = L.geoJSON({ type: "FeatureCollection", features }, {
        style: f => getLineStyle(f.properties.crit),
        onEachFeature: function (feature, layer) {
            const p = feature.properties;
            layer.on("mouseover", e => { layer.setStyle({ weight: 5, opacity: 1 }); showTooltip(e, p); });
            layer.on("mousemove", e => moveTooltip(e));
            layer.on("mouseout", () => { if (!selectMode) geoLayer.resetStyle(layer); hideTooltip(); });
            layer.on("click", () => {
                if (selectMode) return;
                if (p.adr) window.location.href = `index.html?adresse=${encodeURIComponent(p.adr)}`;
            });
        }
    }).addTo(map);
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
            document.getElementById("map-count").textContent = "Dessinez un rectangleâ€¦";
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
    const rect = document.getElementById("map").getBoundingClientRect();
    let x = e.originalEvent.clientX - rect.left + 14;
    let y = e.originalEvent.clientY - rect.top - 20;
    if (x + 240 > rect.width) x -= 260;
    if (y + 200 > rect.height) y -= 200;
    tooltip.style.left = `${x}px`;
    tooltip.style.top = `${y}px`;
}

function hideTooltip() { tooltip.style.display = "none"; }

