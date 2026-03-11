document.addEventListener("DOMContentLoaded", function () {

    const params = new URLSearchParams(window.location.search);
    const adresse = params.get("adresse");

    if (adresse) {

        const titre = document.getElementById("adresse-titre");
        const input = document.querySelector(".search-bar__input");

        if (titre) {
            titre.textContent = adresse;
        }

        if (input) {
            input.value = adresse;
        }

    }

});