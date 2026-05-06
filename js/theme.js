(function () {
  const KEY = "rtc_theme";

  function getSavedTheme() {
    const saved = localStorage.getItem(KEY);
    return saved === "dark" ? "dark" : "light";
  }

  function applyTheme(theme) {
    document.body.classList.toggle("theme-dark", theme === "dark");
    localStorage.setItem(KEY, theme);
    updateButtons(theme);
  }

  function updateButtons(theme) {
    const label = theme === "dark" ? "Mode clair" : "Mode sombre";
    document.querySelectorAll(".theme-toggle").forEach((btn) => {
      btn.textContent = label;
      btn.setAttribute("aria-label", label);
      btn.dataset.theme = theme;
    });
  }

  function toggleTheme() {
    const current = document.body.classList.contains("theme-dark") ? "dark" : "light";
    applyTheme(current === "dark" ? "light" : "dark");
  }

  document.addEventListener("DOMContentLoaded", function () {
    applyTheme(getSavedTheme());
    document.querySelectorAll(".theme-toggle").forEach((btn) => {
      btn.addEventListener("click", toggleTheme);
    });
  });
})();
