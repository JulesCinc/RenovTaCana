document.addEventListener("DOMContentLoaded", function () {
    const searchBars = document.querySelectorAll(".search-bar");

    searchBars.forEach(function (bar) {
        const input = bar.querySelector(".search-bar__input");
        const clearButton = bar.querySelector(".search-bar__clear-button");

        if (!input || !clearButton) {
            return;
        }

        clearButton.addEventListener("click", function (event) {
            event.preventDefault();
            event.stopPropagation();

            input.value = "";
            input.focus();
        });
    });
});