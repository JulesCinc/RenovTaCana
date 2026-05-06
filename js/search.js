/**
 * search.js - Logique barre de recherche + suggestions intelligentes
 * RenovTaCana
 */
document.addEventListener("DOMContentLoaded", function () {
    const API = window.__RTC_API_BASE__ || "http://127.0.0.1:8000";
    const searchBars = document.querySelectorAll(".search-bar");

    searchBars.forEach(function (bar) {
        const input = bar.querySelector(".search-bar__input");
        const clearBtn = bar.querySelector(".search-bar__clear-button");
        const suggestionBox = createSuggestionBox();

        let suggestions = [];
        let activeIndex = -1;
        let debounceId = null;

        if (!input) return;

        bar.classList.add("search-bar--suggest");
        bar.appendChild(suggestionBox);

        if (clearBtn) {
            clearBtn.addEventListener("click", function (e) {
                e.preventDefault();
                e.stopPropagation();
                input.value = "";
                input.focus();
                toggleClearBtn(clearBtn, false);
                hideSuggestions(suggestionBox);
            });
        }

        input.addEventListener("input", function () {
            if (clearBtn) toggleClearBtn(clearBtn, input.value.length > 0);
            activeIndex = -1;
            clearTimeout(debounceId);

            debounceId = setTimeout(async () => {
                const query = input.value.trim();
                if (query.length < 2) {
                    suggestions = [];
                    hideSuggestions(suggestionBox);
                    return;
                }

                suggestions = await fetchSuggestions(API, query);
                renderSuggestions(suggestionBox, suggestions, input, selectSuggestion);
            }, 160);
        });

        input.addEventListener("keydown", function (e) {
            if (!isSuggestionOpen(suggestionBox) || !suggestions.length) return;

            if (e.key === "ArrowDown") {
                e.preventDefault();
                activeIndex = (activeIndex + 1) % suggestions.length;
                updateActiveSuggestion(suggestionBox, activeIndex);
            } else if (e.key === "ArrowUp") {
                e.preventDefault();
                activeIndex = (activeIndex - 1 + suggestions.length) % suggestions.length;
                updateActiveSuggestion(suggestionBox, activeIndex);
            } else if (e.key === "Enter") {
                if (activeIndex >= 0 && activeIndex < suggestions.length) {
                    e.preventDefault();
                    selectSuggestion(suggestions[activeIndex], input, suggestionBox);
                    const form = input.closest("form");
                    if (form) form.requestSubmit();
                }
            } else if (e.key === "Escape") {
                hideSuggestions(suggestionBox);
            }
        });

        input.addEventListener("focus", function () {
            if (suggestions.length) {
                renderSuggestions(suggestionBox, suggestions, input, selectSuggestion);
            }
        });

        document.addEventListener("click", function (e) {
            if (!bar.contains(e.target)) hideSuggestions(suggestionBox);
        });

        if (clearBtn) toggleClearBtn(clearBtn, input.value.length > 0);
    });

    function toggleClearBtn(btn, show) {
        btn.style.opacity = show ? "1" : "0";
        btn.style.pointerEvents = show ? "auto" : "none";
    }

    function createSuggestionBox() {
        const box = document.createElement("div");
        box.className = "search-suggest";
        return box;
    }

    function isSuggestionOpen(box) {
        return box.classList.contains("search-suggest--open");
    }

    function hideSuggestions(box) {
        box.classList.remove("search-suggest--open");
        box.innerHTML = "";
    }

    function showSuggestions(box) {
        box.classList.add("search-suggest--open");
    }

    function renderSuggestions(box, data, input, onSelect) {
        if (!data.length) {
            hideSuggestions(box);
            return;
        }

        box.innerHTML = data.map((item, idx) => `
            <button type="button" class="search-suggest__item" data-idx="${idx}">
                <span class="search-suggest__main">${escapeHtml(item.adresse)}</span>
                <span class="search-suggest__sub">${escapeHtml(item.commune || "")}</span>
            </button>
        `).join("");

        showSuggestions(box);

        box.querySelectorAll(".search-suggest__item").forEach(btn => {
            btn.addEventListener("click", function () {
                const idx = Number(btn.dataset.idx);
                const item = data[idx];
                if (!item) return;

                onSelect(item, input, box);
                const form = input.closest("form");
                if (form) form.requestSubmit();
            });
        });
    }

    function updateActiveSuggestion(box, idxActive) {
        box.querySelectorAll(".search-suggest__item").forEach((el, idx) => {
            const isActive = idx === idxActive;
            el.classList.toggle("search-suggest__item--active", isActive);
            if (isActive) el.scrollIntoView({ block: "nearest" });
        });
    }

    function selectSuggestion(item, input, box) {
        input.value = item.label || item.adresse || "";
        hideSuggestions(box);
    }

    async function fetchSuggestions(apiBase, query) {
        try {
            const res = await fetch(`${apiBase}/api/adresses/suggestions?q=${encodeURIComponent(query)}&limit=5`);
            if (!res.ok) return [];
            const json = await res.json();
            return Array.isArray(json.suggestions) ? json.suggestions : [];
        } catch (e) {
            return [];
        }
    }

    function escapeHtml(str) {
        return String(str)
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#39;");
    }
});
