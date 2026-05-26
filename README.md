# RenovTaCana · **version V2.1**

Prototype hébergé en ligne : **https://k2vm-163.mde.epf.fr**

Projet **RenovTaCana** (Eau d’Azur). Cette branche correspond à la **V2.1** : consolider les fonctionnalités (carte, tableau d’adresses, tableau de bord, API) et livrer un **plan de travaux opérationnel**.

---

## État des fonctionnalités (V2.1)

### Fonctionnel

- **Carte interactive** (heatmap / Leaflet) : affichage des canalisations, chantiers et couches géographiques.
- **Tableau d'adresses** (`index.html`) : parcours, recherche, filtres et export des adresses.
- **Tableau de bord** (`dashboard.html`) : visualisation des indicateurs clés.
- **API FastAPI** : endpoints complets (canalisations, chantiers, opérations, adresses, etc.).
- **Mini-map** sur la page adresses.
- **Calcul du score de priorité** : le script de calcul est opérationnel et applique les poids définis par les clients.
- **Recherche / suggestions** : barre de recherche avec auto-complétion via l'API.

### En cours / à venir

| Fonctionnalité | Statut | Cible |
|---|---|---|
| Affichage du score de priorité dans la web app (tâches) | Non implémenté | **V2.2** |
| Optimisation du temps de chargement de la carte (données trop volumineuses) | En cours | **V2.2** |

---

## Arborescence 

```
.
├── script/
│   ├── main.py                 ← Point d’entrée FastAPI (`uvicorn script.main:app`)
│   ├── utils.py
│   ├── router/
│   └── database/
│       ├── build-sqlite/
│       │   └── build_sqlite_database.py  ← Génère `database/renovTaCana.db`
│       └── row-data/                      ← Scripts d’exploration des données brutes
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
│   └── data/                   ← Assets front legacy (anciens GeoJSON statiques)
│
├── data/                       ← Données sources brutes (xlsx/csv/shp)
│   └── data.zip                ← Archive versionnée à extraire localement
│
└── database/
    ├── renovTaCana.db          ← Base SQLite active utilisée par l’API
    ├── outdated/               ← Archives auto des anciennes bases
    └── MCD.md                  ← MCD de la base active
```

---

## Lancer l’app

Sous **Windows** : exécuter **`demarrer-web-app.bat`** (double-clic, ou `.\demarrer-web-app.bat` dans PowerShell). Ce script lance **uvicorn** sur **`http://127.0.0.1:8000`** et ouvre le navigateur. **Il n’est utilisable que sous Windows** (fichier `.bat`).

Autres OS ou lancement manuel : à la racine du dépôt, `python -m uvicorn script.main:app --reload`. Puis ouvrir **`http://127.0.0.1:8000/`** dans le navigateur. La base d’URL API est gérée dans **`js/config.js`**.

## Prochaines étapes (V2.2)

- **Afficher le score de priorité** dans la web app (pages tâches / adresses).
- **Optimiser le temps de chargement de la carte** (allègement des données géographiques, chargement progressif ou simplification des géométries).
- Compléter le document de suivi de projet, avec product backlog, suivi des sprints et jalonage.

## Association des tâches

```mermaid
flowchart LR
    T[Tâche Jalon 3<br/>Créer le script de calcul du score de priorité] --> A[Assigné à : Jules CINC]
    U1[Tâche Jalon 3<br/>Raccourcir les délais de chargement<br/>reste à optimiser chantiers et opérations] --> U[Assigné à : Ulysse LONG]
    U2[Tâche Jalon 3<br/>Optimiser affichage des adresses sur index.html] --> U
    U3[Tâche Jalon 3<br/>Adresse des opérations même processus que chantiers] --> U
    N1[Tâche Jalon 3<br/>Compléter le document de suivi de projet] --> N[Assigné à : Nicolas DEMARS]
    O1[Tâche Jalon 3<br/>Ajouter un bouton map sur index.html pour la mini heatmap] --> O[Assigné à : Oscar HUNAUT]
```

---
