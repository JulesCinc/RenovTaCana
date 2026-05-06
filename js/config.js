/**
 * URL de base de l’API FastAPI (uvicorn), par défaut http://127.0.0.1:8000.
 *
 * - Page servie par uvicorn (port 8000) → même origine.
 * - Page ouverte en file:// ou servie sur un autre port → l’API reste sur http://127.0.0.1:8000.
 */
window.__RTC_API_BASE__ = (function () {
    try {
        const pr = window.location.protocol;
        if (pr === "file:" || pr === "blob:") return "http://127.0.0.1:8000";
        // Seul le serveur FastAPI sert l’app sur le port 8000 avec les routes /api
        if (window.location.port === "8000") return window.location.origin;
        return "http://127.0.0.1:8000";
    } catch (_) {
        return "http://127.0.0.1:8000";
    }
})();
