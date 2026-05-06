/**
 * mini-map.js - Mini heatmap sur page index
 */
(function () {
    function geoJsonCanalisationsUrl() {
        return (window.__RTC_API_BASE__ || "http://127.0.0.1:8000") + "/api/geojson/canalisations";
    }

    let miniMap = null;
    let miniLayer = null;
    let baseTileLayer = null;

    document.addEventListener("DOMContentLoaded", initMiniMap);

    async function initMiniMap() {
        const mapEl = document.getElementById("mini-map");
        if (!mapEl || typeof L === "undefined") return;

        miniMap = L.map("mini-map", {
            center: [43.705, 7.265],
            zoom: 12,
            zoomControl: false,
            attributionControl: false,
            // Laisse le scroll de la page prioritaire sur la mini-carte.
            scrollWheelZoom: false,
        });

        applyMiniMapTheme();
        observeThemeChanges();

        try {
            const res = await fetch(geoJsonCanalisationsUrl());
            const data = await res.json();
            const features = data.features || [];
            renderFeatures(features);
        } catch (e) {}
    }

    function renderFeatures(features) {
        if (miniLayer) miniMap.removeLayer(miniLayer);
        miniLayer = L.geoJSON({ type: "FeatureCollection", features }, {
            style: f => getLineStyle(f.properties?.crit),
            onEachFeature: function (feature, layer) {
                const p = feature?.properties || {};
                const adr = p.adr;
                const mat = p.mat || "—";
                const diam = p.diam != null ? `${p.diam} mm` : "—";
                const longu = p.long != null ? `${p.long} m` : "—";
                const crit = p.crit != null ? `${Number(p.crit).toFixed(1)}%` : "—";

                const tip = `
                    <div style="font-family:monospace;font-size:11px;line-height:1.35;min-width:190px">
                        <div style="color:#9fb4c8;margin-bottom:4px">${escapeHtml(adr || "Adresse inconnue")}</div>
                        <div><span style="color:#6f8699">Materiau:</span> ${escapeHtml(mat)}</div>
                        <div><span style="color:#6f8699">Diametre:</span> ${diam}</div>
                        <div><span style="color:#6f8699">Longueur:</span> ${longu}</div>
                        <div><span style="color:#6f8699">Criticite:</span> ${crit}</div>
                    </div>
                `;

                layer.bindTooltip(tip, {
                    sticky: true,
                    direction: "top",
                    opacity: 0.95,
                });

                layer.on("click", function () {
                    if (!adr) return;
                    window.location.href = `index.html?adresse=${encodeURIComponent(adr)}`;
                });
            },
        }).addTo(miniMap);

        // Keep a fixed Nice-area framing instead of auto-zooming on each load.
    }

    function applyMiniMapTheme() {
        const dark = document.body.classList.contains("theme-dark");
        const tileUrl = dark
            ? "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
            : "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png";

        if (baseTileLayer) miniMap.removeLayer(baseTileLayer);
        baseTileLayer = L.tileLayer(tileUrl, {
            subdomains: "abcd",
            maxZoom: 20,
        }).addTo(miniMap);
    }

    function observeThemeChanges() {
        const observer = new MutationObserver(() => applyMiniMapTheme());
        observer.observe(document.body, {
            attributes: true,
            attributeFilter: ["class"],
        });
    }

    function getLineStyle(crit) {
        if (crit == null) return { color: "#475569", weight: 1.2, opacity: 0.45 };
        if (crit >= 70) return { color: "#ef4444", weight: 2, opacity: 0.9 };
        if (crit >= 40) return { color: "#f97316", weight: 1.8, opacity: 0.85 };
        if (crit >= 20) return { color: "#eab308", weight: 1.6, opacity: 0.75 };
        if (crit >= 10) return { color: "#84cc16", weight: 1.4, opacity: 0.7 };
        return { color: "#00d4aa", weight: 1.2, opacity: 0.65 };
    }

    function escapeHtml(str) {
        return String(str)
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#39;");
    }
})();
