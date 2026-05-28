import fs from "fs";
import { execSync } from "child_process";

const sourcePath = process.argv[2];
const src = sourcePath
    ? fs.readFileSync(sourcePath, "utf8")
    : execSync("git show HEAD:js/index.js", { encoding: "utf8" });

const labelsStart = src.indexOf("const DETAIL_LABELS");
const bk = src.indexOf("const BOOLEAN_KEYS");
const labelsEnd = src.indexOf("\n]);", bk) + 4;
const funcStart = src.indexOf("function renderDetailSection(");

if (labelsStart < 0 || bk < 0 || labelsEnd < 4 || funcStart < 0) {
    console.error("markers not found", { labelsStart, bk, labelsEnd, funcStart });
    process.exit(1);
}

const labelsBlock = src.slice(labelsStart, labelsEnd);
const funcBlock = src.slice(funcStart);

const header = `/**
 * Modale détail canalisation — partagée (index, plan de travaux).
 */
(function () {
    const SEGMENT_FACILITY_RE = /^(.+?) \\((\\d+\\/\\d+)\\)$/;
    const COPY_PAYLOADS = new Map();
    let copyPayloadSeq = 0;

`;

const footer = `
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
                \`\${apiBase()}/api/canalisations/\${encodeURIComponent(fetchId)}\`
            );
            if (!res.ok) throw new Error("detail fetch failed");
            const detail = await res.json();

            const communeName = detail.canalisation?.commune_display
                || detail.conduite?.COMMUNE_DISPLAY
                || detail.canalisation?.commune
                || detail.conduite?.COMMUNE
                || "";
            const adresseTitle = detail.adresse || "Canalisation";
            title.textContent = communeName ? \`\${adresseTitle}, \${communeName}\` : adresseTitle;
            subtitle.textContent = displayId || detail.facilityid || fetchId;

            const segmentNote = segmentMatch
                ? \`<p class="detail-modal__segment-note">Tronçon planifié <strong>\${escapeHtml(segmentMatch[2])}</strong> — données de la canalisation d'origine <code>\${escapeHtml(fetchId)}</code>.</p>\`
                : "";

            body.innerHTML = segmentNote + [
                renderDetailSection("Canalisation (API)", detail.canalisation || {}),
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
`;

fs.writeFileSync("js/canalisation-detail-modal.js", header + labelsBlock + "\n\n" + funcBlock + "\n" + footer);
console.log("ok", fs.statSync("js/canalisation-detail-modal.js").size);
