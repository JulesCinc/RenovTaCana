/**
 * mini-map.js - Mini heatmap sur page index
 */
(function () {
    const MINI_GEO_CACHE_VER = 2;
    const MINI_GEO_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h
    const MINI_GEO_CACHE_KEY = `rtc_mini_v${MINI_GEO_CACHE_VER}_geojson_canalisations`;
    const MINI_GEO_DB = "rtc_mini_map_cache";
    const MINI_GEO_STORE = "geojson";

    function openMiniGeoDb() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(MINI_GEO_DB, 1);
            req.onupgradeneeded = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains(MINI_GEO_STORE)) {
                    db.createObjectStore(MINI_GEO_STORE);
                }
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }

    async function readMiniGeoCache() {
        if (!("indexedDB" in window)) return null;
        try {
            const db = await openMiniGeoDb();
            const tx = db.transaction(MINI_GEO_STORE, "readonly");
            const store = tx.objectStore(MINI_GEO_STORE);
            const value = await new Promise((resolve, reject) => {
                const req = store.get(MINI_GEO_CACHE_KEY);
                req.onsuccess = () => resolve(req.result || null);
                req.onerror = () => reject(req.error);
            });
            db.close();
            if (!value || typeof value.t !== "number" || !value.payload) return null;
            if (Date.now() - value.t > MINI_GEO_CACHE_TTL_MS) return null;
            if (!Array.isArray(value.payload.features)) return null;
            return value;
        } catch (_) {
            return null;
        }
    }

    async function writeMiniGeoCache(payload) {
        if (!("indexedDB" in window)) return;
        try {
            const db = await openMiniGeoDb();
            const tx = db.transaction(MINI_GEO_STORE, "readwrite");
            tx.objectStore(MINI_GEO_STORE).put({ t: Date.now(), payload }, MINI_GEO_CACHE_KEY);
            await new Promise((resolve, reject) => {
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error);
                tx.onabort = () => reject(tx.error);
            });
            db.close();
        } catch (_) {
            // ignore cache write errors
        }
    }

    /** Empreinte legere pour eviter un second `renderFeatures` (tres couteux) si l'API renvoie le meme jeu. */
    function miniGeoFeaturesSig(features) {
        if (!features?.length) return "0";
        const n = features.length;
        let h = 2166136261 >>> 0;
        h ^= n;
        h = Math.imul(h, 16777619) >>> 0;
        const step = Math.max(1, Math.floor(n / 800));
        for (let i = 0; i < n; i += step) {
            const id = String(features[i]?.properties?.id ?? "");
            for (let j = 0; j < id.length; j++) {
                h ^= id.charCodeAt(j);
                h = Math.imul(h, 16777619) >>> 0;
            }
        }
        return `${n}:${h.toString(16)}`;
    }

    function geoJsonCanalisationsUrl() {
        return (window.__RTC_API_BASE__ || "http://127.0.0.1:8000") + "/api/geojson/canalisations";
    }

    let miniMap = null;
    let miniLayer = null;
    let baseTileLayer = null;
    let highlightedLayer = null;

    document.addEventListener("DOMContentLoaded", initMiniMap);

    async function initMiniMap() {
        const mapEl = document.getElementById("mini-map");
        if (!mapEl || typeof L === "undefined") return;

        miniMap = L.map("mini-map", {
            center: [43.705, 7.265],
            zoom: 12,
            zoomControl: false,
            attributionControl: false,
            scrollWheelZoom: false,
            preferCanvas: true,
        });

        mapEl.addEventListener("mouseenter", () => miniMap.scrollWheelZoom.enable());
        mapEl.addEventListener("mouseleave", () => miniMap.scrollWheelZoom.disable());

        applyMiniMapTheme();
        observeThemeChanges();

        const cached = await readMiniGeoCache();
        let showedCache = false;
        if (cached?.payload?.features?.length) {
            renderFeatures(cached.payload.features);
            showedCache = true;
            await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
            return;
        }

        try {
            const res = await fetch(geoJsonCanalisationsUrl());
            if (!res.ok) throw new Error(String(res.status));
            const data = await res.json();
            const features = data.features || [];
            const cachedFeats = showedCache && cached?.payload?.features ? cached.payload.features : null;
            const unchanged = cachedFeats
                && miniGeoFeaturesSig(features) === miniGeoFeaturesSig(cachedFeats);
            if (!unchanged) {
                await writeMiniGeoCache({
                    type: data.type || "FeatureCollection",
                    features,
                });
                renderFeatures(features);
            }
        } catch (_) {
            // Pas de cache et erreur reseau: mini-carte vide.
        }
    }

    function resetHighlight() {
        if (!highlightedLayer) return;
        try {
            highlightedLayer.setStyle(getLineStyle(highlightedLayer.feature?.properties?.crit));
        } catch (_) {}
        highlightedLayer = null;
    }

    function renderFeatures(features) {
        if (miniLayer) miniMap.removeLayer(miniLayer);
        highlightedLayer = null;
        miniLayer = L.geoJSON({ type: "FeatureCollection", features }, {
            style: f => getLineStyle(f.properties?.crit),
            onEachFeature: function (feature, layer) {
                const p = feature?.properties || {};
                const adr = p.adr;
                const mat = p.mat || "-";
                const diam = p.diam != null ? `${p.diam} mm` : "-";
                const longu = p.long != null ? `${p.long} m` : "-";
                const crit = p.crit != null ? `${Number(p.crit).toFixed(1)}%` : "-";

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
                    window.dispatchEvent(new CustomEvent("rtc:mini-map-address-select", {
                        detail: { adresse: adr }
                    }));
                });
            },
        }).addTo(miniMap);
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

    window.rtcMiniMapFocus = function (facilityid) {
        if (!miniLayer || !miniMap) return { ok: false, adresse: "" };

        let found = null;
        miniLayer.eachLayer(function (layer) {
            if (layer.feature?.properties?.id === facilityid) found = layer;
        });
        if (!found) return { ok: false, adresse: "" };

        resetHighlight();
        highlightedLayer = found;
        found.setStyle({ color: "#38bdf8", weight: 5, opacity: 1 });

        try {
            miniMap.fitBounds(found.getBounds(), { padding: [40, 40], maxZoom: 17, animate: true });
        } catch (_) {}

        const adresse = String(found.feature?.properties?.adr || "").trim();
        return { ok: true, adresse };
    };

    function escapeHtml(str) {
        return String(str)
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#39;");
    }
})();
