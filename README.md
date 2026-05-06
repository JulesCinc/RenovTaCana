# RenovTaCana · **version V2.0**

Prototype hébergé en ligne : **https://k2vm-163.mde.epf.fr/pages/index.html**

Projet **RenovTaCana** (Eau d’Azur). Cette branche correspond à la **V2.0** : relier les fonctionnalités (carte, tableau d’adresses, tableau de bord, API) dans des **pages utilisables** et une navigation cohérente.

---

## Arborescence 

```
.
├── main.py                     ← Point d’entrée FastAPI (`uvicorn main:app`)
├── requirements.txt
├── README.md
├── demarrer-web-app.bat        ← Lancement Windows (voir « Lancer l’app »)
│
├── index.html                  ← Hub résultats / adresses (liens vers carte & dashboard)
├── carte.html                  ← Carte interactive (heatmap / Leaflet)
├── dashboard.html              ← Tableau de bord
│
├── css/
│   ├── style.css               ← Styles communs
│   ├── adresses.css            ← index.html (parcours adresses)
│   ├── carte.css               ← carte.html
│   └── dashboard.css           ← dashboard.html
│
├── js/
│   ├── config.js               ← Base d’URL API / `__RTC_API_BASE__`
│   ├── search.js               ← Barre de recherche / suggestions API
│   ├── index.js                ← Logique page index (paramètres URL, export, etc.)
│   ├── carte.js
│   ├── dashboard.js
│   ├── mini-map.js
│   └── theme.js
│
├── assets/
│   ├── images/                 ← logos, visuels (ex. logo_entreprise.png)
│   └── data/                   ← Jeux de données côté front (ex. GeoJSON)
│
└── sqlite/                     ← Base SQLite locale (ex. renovTaCana.db)
```

---

## Lancer l’app

Sous **Windows** : exécuter **`demarrer-web-app.bat`** (double-clic, ou `.\demarrer-web-app.bat` dans PowerShell). Ce script lance **uvicorn** sur **`http://127.0.0.1:8000`** et ouvre le navigateur. **Il n’est utilisable que sous Windows** (fichier `.bat`).

Autres OS ou lancement manuel : à la racine du dépôt, `python -m uvicorn main:app --reload`. Puis ouvrir **`http://127.0.0.1:8000/`** dans le navigateur. La base d’URL API est gérée dans **`js/config.js`**.

---
