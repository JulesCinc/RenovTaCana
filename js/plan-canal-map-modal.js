/**
 * Mini heatmap en modale — plan de travaux (une canalisation).
 */
(function () {
    const SEGMENT_FACILITY_RE = /^(.+?) \((\d+\/\d+)\)$/;

    let map = null;
    let geoLayer = null;
    let baseTileLayer = null;
    let themeObserver = null;

    function apiBase() {
        return (window.__RTC_API_BASE__ || "http://127.0.0.1:8000") + "/api";
    }

    function resolveGeoFacilityId(facilityid) {
        const fid = String(facilityid || "").trim();
        const match = SEGMENT_FACILITY_RE.exec(fid);
        return match ? match[1].trim() : fid;
    }

    function getLineStyle(crit, highlighted = false) {
        if (highlighted) {
            return { color: "#38bdf8", weight: 5, opacity: 1 };
        }
        if (crit == null) return { color: "#475569", weight: 3, opacity: 0.85 };
        if (crit >= 70) return { color: "#ef4444", weight: 4, opacity: 0.95 };
        if (crit >= 40) return { color: "#f97316", weight: 3.6, opacity: 0.9 };
        if (crit >= 20) return { color: "#eab308", weight: 3.2, opacity: 0.85 };
        if (crit >= 10) return { color: "#84cc16", weight: 3, opacity: 0.8 };
        return { color: "#00d4aa", weight: 2.8, opacity: 0.75 };
    }

    function applyMapTheme() {
        if (!map) return;
        const dark = document.body.classList.contains("theme-dark");
        const tileUrl = dark
            ? "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
            : "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png";
        if (baseTileLayer) map.removeLayer(baseTileLayer);
        baseTileLayer = L.tileLayer(tileUrl, { subdomains: "abcd", maxZoom: 20 }).addTo(map);
    }

    function ensureMap() {
        const el = document.getElementById("plan-canal-mini-map");
        if (!el || typeof L === "undefined") return false;
        if (map) return true;

        map = L.map(el, {
            center: [43.705, 7.265],
            zoom: 13,
            zoomControl: true,
            attributionControl: false,
            scrollWheelZoom: true,
            preferCanvas: true,
        });
        applyMapTheme();
        if (!themeObserver) {
            themeObserver = new MutationObserver(() => applyMapTheme());
            themeObserver.observe(document.body, { attributes: true, attributeFilter: ["class"] });
        }
        return true;
    }

    function clearGeoLayer() {
        if (geoLayer && map) {
            map.removeLayer(geoLayer);
            geoLayer = null;
        }
    }

    function closePlanCanalMapModal() {
        const modal = document.getElementById("plan-canal-map-modal");
        if (!modal) return;
        modal.setAttribute("aria-hidden", "true");
        modal.classList.remove("is-open");
        document.body.classList.remove("plan-canal-map-open");
        clearGeoLayer();
    }

    async function openPlanCanalMapModal(item) {
        const modal = document.getElementById("plan-canal-map-modal");
        const titleEl = document.getElementById("plan-canal-map-title");
        const subtitleEl = document.getElementById("plan-canal-map-subtitle");
        const statusEl = document.getElementById("plan-canal-map-status");
        if (!modal || !item) return;

        const geoId = resolveGeoFacilityId(item.facilityid);
        if (titleEl) titleEl.textContent = item.facilityid || "Canalisation";
        if (subtitleEl) {
            const parts = [item.adresse, item.materiau !== "—" ? item.materiau : null].filter(Boolean);
            subtitleEl.textContent = parts.join(" · ") || geoId;
        }
        if (statusEl) statusEl.textContent = "Chargement de la géométrie…";

        modal.setAttribute("aria-hidden", "false");
        modal.classList.add("is-open");
        document.body.classList.add("plan-canal-map-open");

        if (!ensureMap()) {
            if (statusEl) {
                statusEl.textContent = "Carte indisponible (Leaflet non chargé).";
            }
            return;
        }

        clearGeoLayer();
        setTimeout(() => map?.invalidateSize(), 80);

        try {
            const res = await fetch(
                `${apiBase()}/geojson/canalisations/${encodeURIComponent(geoId)}`
            );
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            const features = data.features || [];
            if (!features.length) throw new Error("empty");

            const crit = item.criticite ?? features[0]?.properties?.crit ?? null;
            geoLayer = L.geoJSON(
                { type: "FeatureCollection", features },
                {
                    style: () => getLineStyle(crit, true),
                }
            ).addTo(map);

            const bounds = geoLayer.getBounds();
            if (bounds.isValid()) {
                map.fitBounds(bounds, { padding: [48, 48], maxZoom: 18, animate: false });
            }
            if (statusEl) {
                const seg = SEGMENT_FACILITY_RE.exec(String(item.facilityid || ""));
                statusEl.textContent = seg
                    ? `Tracé de la canalisation d'origine (${geoId}) — tronçon ${seg[2]}`
                    : "";
            }
        } catch {
            if (statusEl) {
                statusEl.textContent = "Impossible d'afficher le tracé de cette canalisation (géométrie absente ou API indisponible).";
            }
        }

        setTimeout(() => map?.invalidateSize(), 120);
    }

    function initPlanCanalMapModal() {
        const modal = document.getElementById("plan-canal-map-modal");
        if (!modal || modal.dataset.bound === "1") return;
        modal.dataset.bound = "1";

        document.getElementById("plan-canal-map-backdrop")?.addEventListener("click", closePlanCanalMapModal);
        document.getElementById("plan-canal-map-close")?.addEventListener("click", closePlanCanalMapModal);
        document.addEventListener("keydown", e => {
            if (e.key === "Escape" && modal.getAttribute("aria-hidden") === "false") {
                closePlanCanalMapModal();
            }
        });
    }

    window.openPlanCanalMapModal = openPlanCanalMapModal;
    window.closePlanCanalMapModal = closePlanCanalMapModal;

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initPlanCanalMapModal);
    } else {
        initPlanCanalMapModal();
    }
})();
