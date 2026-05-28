let dbVersions = [];

const historyBody = document.getElementById("db-history-body");
const toast = document.getElementById("database-toast");
const activeDbStats = document.getElementById("active-db-stats");
const rollbackModal = document.getElementById("rollback-modal");
const rollbackBackdrop = document.getElementById("rollback-backdrop");
const rollbackMessage = document.getElementById("rollback-message");
const rollbackCancel = document.getElementById("rollback-cancel");
const rollbackConfirm = document.getElementById("rollback-confirm");
const importModal = document.getElementById("import-modal");
const importBackdrop = document.getElementById("import-backdrop");
const importMessage = document.getElementById("import-message");
const importDetails = document.getElementById("import-details");
const importClose = document.getElementById("import-close");
const errorModal = document.getElementById("error-modal");
const errorBackdrop = document.getElementById("error-backdrop");
const errorMessage = document.getElementById("error-message");
const errorClose = document.getElementById("error-close");
const loadingOverlay = document.getElementById("loading-overlay");
let pendingRollbackIndex = null;

function escapeHtml(value) {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;");
}

function formatSize(sizeBytes) {
    const mb = sizeBytes / (1024 * 1024);
    return `${mb.toFixed(2)} Mo`;
}

function inferVersionFromFilename(filename, index) {
    const match = filename.match(/(\d{8})_(\d{6})/);
    if (match) {
        const date = `${match[1].slice(6, 8)}/${match[1].slice(4, 6)}/${match[1].slice(0, 4)}`;
        return `Archive ${date}`;
    }
    return `Archive ${index + 1}`;
}

function isAllowedDataFile(filename) {
    const lowerName = filename.toLowerCase();
    const allowedExt = [".xlsx", ".xls", ".csv"];
    return allowedExt.some((ext) => lowerName.endsWith(ext));
}

function renderHistory() {
    if (!dbVersions.length) {
        historyBody.innerHTML = `
            <tr>
                <td colspan="6">Aucune archive trouvée.</td>
            </tr>
        `;
        return;
    }

    historyBody.innerHTML = dbVersions.map((item, index) => {
        const infos = `${item.counts.canalisations} canalisations, ${item.counts.chantiers} chantiers, ${item.counts.operations} operations`;
        return `
            <tr>
                <td>${escapeHtml(item.version)}</td>
                <td><code>${escapeHtml(item.filename)}</code></td>
                <td>${escapeHtml(item.date)}</td>
                <td>${escapeHtml(item.summary)}</td>
                <td>${escapeHtml(infos)}</td>
                <td>
                    <button class="db-btn db-btn--rollback" data-action="rollback" data-index="${index}">Rollback</button>
                </td>
            </tr>
        `;
    }).join("");
}

let toastTimeout = null;
function showToast(message) {
    toast.textContent = message;
    toast.classList.add("is-visible");
    window.clearTimeout(toastTimeout);
    toastTimeout = window.setTimeout(() => {
        toast.classList.remove("is-visible");
    }, 2200);
}

function handleRollback(index) {
    const target = dbVersions[index];
    if (!target) return;
    pendingRollbackIndex = index;
    rollbackMessage.textContent = `Etes-vous sur de vouloir revenir a cette archive du ${target.date} ?`;
    rollbackModal.setAttribute("aria-hidden", "false");
}

function closeRollbackModal() {
    rollbackModal.setAttribute("aria-hidden", "true");
    pendingRollbackIndex = null;
}

function openImportModal(payload, entityLabel) {
    const inserted = Number(payload.inserted || 0);
    importMessage.textContent = `Confirmation: ${inserted} ${entityLabel} importes.`;
    if (inserted === 0) {
        importMessage.textContent = `Confirmation: 0 ${entityLabel} importes (aucune nouvelle ligne).`;
    }
    importDetails.textContent = "";
    importModal.setAttribute("aria-hidden", "false");
}

function closeImportModal() {
    importModal.setAttribute("aria-hidden", "true");
}

function openErrorModal(message) {
    errorMessage.textContent = message;
    errorModal.setAttribute("aria-hidden", "false");
}

function closeErrorModal() {
    errorModal.setAttribute("aria-hidden", "true");
}

function setLoading(isLoading) {
    document.body.classList.toggle("database-is-loading", isLoading);
    if (loadingOverlay) {
        loadingOverlay.setAttribute("aria-hidden", isLoading ? "false" : "true");
    }
}

async function confirmRollback() {
    if (pendingRollbackIndex === null) return;
    const target = dbVersions[pendingRollbackIndex];
    if (!target) return;

    rollbackConfirm.disabled = true;
    rollbackConfirm.textContent = "Confirmation...";
    try {
        const response = await fetch("/api/database/rollback", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ filename: target.filename })
        });

        const payload = await response.json();
        if (!response.ok) {
            throw new Error(payload.detail || `HTTP ${response.status}`);
        }

        closeRollbackModal();
        showToast(`Rollback effectue vers ${target.filename}.`);
        await loadOutdatedDatabases();
    } catch (error) {
        openErrorModal(`Rollback impossible: ${error.message}`);
    } finally {
        rollbackConfirm.disabled = false;
        rollbackConfirm.textContent = "Confirmer";
    }
}

function bindHistoryEvents() {
    historyBody.addEventListener("click", (event) => {
        const target = event.target.closest("button[data-action]");
        if (!target) return;

        const index = Number(target.dataset.index);
        if (target.dataset.action === "rollback") handleRollback(index);
    });
}

function bindDropzones() {
    const cards = document.querySelectorAll(".drop-card");

    cards.forEach((card) => {
        const input = card.querySelector('input[type="file"]');
        const zone = card.querySelector(".dropzone");
        const status = card.querySelector(".drop-card__status");
        const expected = (card.dataset.requiredName || "").toLowerCase();

        const setStatus = (message, kind) => {
            status.textContent = message;
            card.classList.remove("is-valid", "is-invalid");
            if (kind) card.classList.add(kind);
        };

        const uploadChantiersFile = async (file) => {
            const formData = new FormData();
            formData.append("file", file, file.name);

            setLoading(true);
            try {
                const response = await fetch("/api/database/import/chantiers", {
                    method: "POST",
                    body: formData
                });
                const payload = await response.json();
                if (!response.ok) {
                    throw new Error(payload.detail || `HTTP ${response.status}`);
                }

                setStatus(`Importe (${file.name})`, "is-valid");
                openImportModal(payload, "chantiers");
                await loadOutdatedDatabases();
            } catch (error) {
                setStatus("Echec import", "is-invalid");
                openErrorModal(`Import chantiers impossible: ${error.message}`);
            } finally {
                setLoading(false);
            }
        };

        const uploadOperationsFile = async (file) => {
            const formData = new FormData();
            formData.append("file", file, file.name);

            setLoading(true);
            try {
                const response = await fetch("/api/database/import/operations", {
                    method: "POST",
                    body: formData
                });
                const payload = await response.json();
                if (!response.ok) {
                    throw new Error(payload.detail || `HTTP ${response.status}`);
                }

                setStatus(`Importe (${file.name})`, "is-valid");
                openImportModal(payload, "operations");
                await loadOutdatedDatabases();
            } catch (error) {
                setStatus("Echec import", "is-invalid");
                openErrorModal(`Import operations impossible: ${error.message}`);
            } finally {
                setLoading(false);
            }
        };

        const uploadPipeRankingFile = async (file) => {
            const formData = new FormData();
            formData.append("file", file, file.name);

            setLoading(true);
            try {
                const response = await fetch("/api/database/import/pipe-ranking", {
                    method: "POST",
                    body: formData
                });
                const payload = await response.json();
                if (!response.ok) {
                    throw new Error(payload.detail || `HTTP ${response.status}`);
                }

                setStatus(`Importe (${file.name})`, "is-valid");
                if (Number(payload.inserted || 0) === 0 && Number(payload.skipped_unknown_facilityid || 0) > 0) {
                    openErrorModal(
                        `Import pipe ranking impossible: ${payload.skipped_unknown_facilityid} FACILITYID du fichier sont inconnus dans la base active.`
                    );
                } else {
                    openImportModal(payload, "pipe ranking");
                }
                await loadOutdatedDatabases();
            } catch (error) {
                setStatus("Echec import", "is-invalid");
                openErrorModal(`Import pipe ranking impossible: ${error.message}`);
            } finally {
                setLoading(false);
            }
        };

        const evaluateFile = (file) => {
            if (!file) return;
            const lowerName = file.name.toLowerCase();
            const isPipeRankingTarget = expected === "pipe_ranking.xlsx";
            const looksLikePipeRanking = lowerName.includes("pipe_ranking") && (lowerName.endsWith(".xlsx") || lowerName.endsWith(".xls") || lowerName.endsWith(".csv"));
            if (isAllowedDataFile(file.name) || (isPipeRankingTarget && looksLikePipeRanking)) {
                if (expected === "chantiers.xlsx") {
                    uploadChantiersFile(file);
                } else if (expected === "operations.xlsx") {
                    uploadOperationsFile(file);
                } else if (expected === "pipe_ranking.xlsx") {
                    uploadPipeRankingFile(file);
                } else {
                    setStatus(`Pret (${file.name})`, "is-valid");
                    showToast(`${file.name} charge dans l'interface.`);
                }
            } else {
                setStatus(`Nom attendu: ${expected}`, "is-invalid");
                openErrorModal(`Fichier invalide pour ${expected}.`);
            }
        };

        input.addEventListener("change", () => {
            const selectedFile = input.files && input.files[0];
            evaluateFile(selectedFile);
            // Permet de re-selectionner le meme fichier ensuite.
            input.value = "";
        });

        zone.addEventListener("dragover", (event) => {
            event.preventDefault();
            zone.classList.add("is-over");
        });

        zone.addEventListener("dragleave", () => {
            zone.classList.remove("is-over");
        });

        zone.addEventListener("drop", (event) => {
            event.preventDefault();
            zone.classList.remove("is-over");
            const file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
            evaluateFile(file);
        });
    });
}

function mapApiItemToVersion(item, index) {
    const dateValue = item.modified_at_display || item.modified_at || "Date inconnue";
    return {
        version: inferVersionFromFilename(item.filename || "", index),
        filename: item.filename || "inconnu.db",
        date: dateValue,
        summary: `Base archivee (${formatSize(item.size_bytes || 0)}).`,
        modifiedTs: Number(item.archive_ts || item.modified_ts || 0),
        counts: {
            canalisations: Number(item.counts?.canalisations || 0),
            chantiers: Number(item.counts?.chantiers || 0),
            operations: Number(item.counts?.operations || 0)
        }
    };
}

async function loadOutdatedDatabases() {
    historyBody.innerHTML = `
        <tr>
            <td colspan="6">Chargement des bases outdated...</td>
        </tr>
    `;

    try {
        const response = await fetch("/api/database/outdated");
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const payload = await response.json();
        const items = Array.isArray(payload.items) ? payload.items : [];
        dbVersions = items.map(mapApiItemToVersion);
        dbVersions.sort((a, b) => b.modifiedTs - a.modifiedTs);
        const activeCounts = payload.active_counts || {};
        activeDbStats.textContent = `${Number(activeCounts.canalisations || 0)} canalisations, ${Number(activeCounts.chantiers || 0)} chantiers, ${Number(activeCounts.operations || 0)} operations`;
        renderHistory();
    } catch (error) {
        historyBody.innerHTML = `
            <tr>
                <td colspan="6">Impossible de charger l'historique (${escapeHtml(error.message)}).</td>
            </tr>
        `;
        activeDbStats.textContent = "Impossible de charger les donnees de la base active.";
        openErrorModal("Erreur de chargement des bases outdated.");
    }
}

bindHistoryEvents();
bindDropzones();
loadOutdatedDatabases();

rollbackCancel.addEventListener("click", closeRollbackModal);
rollbackBackdrop.addEventListener("click", closeRollbackModal);
rollbackConfirm.addEventListener("click", confirmRollback);
importClose.addEventListener("click", closeImportModal);
importBackdrop.addEventListener("click", closeImportModal);
errorClose.addEventListener("click", closeErrorModal);
errorBackdrop.addEventListener("click", closeErrorModal);
document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && rollbackModal.getAttribute("aria-hidden") === "false") {
        closeRollbackModal();
    }
    if (event.key === "Escape" && importModal.getAttribute("aria-hidden") === "false") {
        closeImportModal();
    }
    if (event.key === "Escape" && errorModal.getAttribute("aria-hidden") === "false") {
        closeErrorModal();
    }
});
