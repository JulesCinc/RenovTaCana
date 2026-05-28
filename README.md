# RenovTaCana · **version V2.2**

Prototype hébergé en ligne : **https://k2vm-163.mde.epf.fr**

Projet **RenovTaCana** (Eau d’Azur). Cette branche correspond a la **V2.2**, version qui sera delivree pour l'avant-dernier sprint.
L'objectif principal est l'**edition d'un plan de travaux**, en s'appuyant sur le **score de priorite** calcule lors du sprint precedent.

---

## Etat des fonctionnalites (V2.2)

### Fonctionnel

- **Carte interactive** (heatmap / Leaflet) : affichage des canalisations, chantiers et couches geographiques.
- **Tableau d'adresses** (`index.html`) : parcours, recherche, filtres et export des adresses.
- **Tableau de bord** (`dashboard.html`) : visualisation des indicateurs cles.
- **Page base de donnees** (`database.html`) : import des fichiers source (xlsx/csv), historique des versions, rollback.
- **API FastAPI** : endpoints complets (canalisations, chantiers, opérations, adresses, etc.).
- **Mini-map** sur la page adresses.
- **Calcul du score de priorite** : le script de calcul est operationnel et applique les poids definis avec le client.
- **Score de priorite pris en compte** dans l'edition du plan de travaux (base de la priorisation des interventions).
- **Recherche / suggestions** : barre de recherche avec auto-completion via l'API.

### En cours / a venir

| Fonctionnalite | Statut | Cible |
|---|---|---|
| Page "plan de travaux" | En cours | **V2.2** |
| Decoupage des canalisations > 250 m en troncons de 250 m | En cours | **V2.2** |
| Affichage des troncons de 250 m sur la carte | En cours | **V2.2** |
| Prise en compte des chantiers dans le calcul du score de priorite | En cours | **V2.2** |
| Historique et mise a jour de la base de donnees | Fait | **V2.2** |
| Mise a jour des informations des chantiers (adresses manquantes) | Fait | **V2.2** |
| Mise a jour des informations des operations (adresses manquantes) | Fait | **V2.2** |

---

## Arborescence

```
.
├── .gitignore
├── script/
│   ├── main.py                 ← Point d’entrée FastAPI (`uvicorn script.main:app`)
│   ├── utils.py
│   ├── endpoints/
│   │   ├── canalisations.py    ← `/api/canalisations`, `/api/canalisations/{facilityid}`, `/api/canalisations/zone`, `/api/adresses/suggestions`
│   │   ├── chantiers.py        ← `/api/chantiers`, `/api/chantiers/adresse`
│   │   ├── operations.py       ← `/api/operations`, `/api/operations/adresse`
│   │   ├── stats.py            ← `/api/stats`, `/api/stats/adresse`
│   │   ├── dashboard.py        ← `/api/dashboard`
│   │   ├── filtres.py          ← `/api/filtres`
│   │   ├── dashboard.py        ← `/api/dashboard`, `/api/plan-travaux` (lecture score_priorite)
│   │   ├── database/
│   │   │   └── compute_priority.py ← `POST /api/database/compute-priority`
│   │   ├── geojson.py          ← `/api/geojson/chantiers`, `/api/geojson/canalisations`
│   │   ├── database/
│   │   │   ├── database_versions.py   ← `/api/database/outdated`
│   │   │   ├── rollback.py            ← `/api/database/rollback`
│   │   │   ├── import_chantiers.py    ← `/api/database/import/chantiers`
│   │   │   ├── import_operations.py   ← `/api/database/import/operations`
│   │   │   └── import_pipe_ranking.py ← `/api/database/import/pipe-ranking`
│   │   └── __init__.py
│   └── database/
│       ├── build-sqlite/
│       │   └── build_sqlite_database.py  ← Genere `database/renovTaCana.db`
│       └── row-data/                      ← Scripts d’exploration des donnees brutes
├── database.py                 ← Connexion SQLite (`get_db`)
├── requirements.txt
├── README.md
├── demarrer-web-app.bat        ← Lancement Windows (voir « Lancer l’app »)
│
├── index.html                  ← Hub resultats / adresses (liens vers carte, dashboard, plan de travaux)
├── carte.html                  ← Carte interactive (heatmap / Leaflet)
├── dashboard.html              ← Tableau de bord
├── plan-travaux.html           ← Page plan de travaux
├── database.html               ← Gestion des imports et de l’historique de la base
│
├── css/
│   ├── style.css               ← Styles communs
│   ├── adresses.css            ← index.html (parcours adresses, filtres chantiers/operations, modales)
│   ├── carte.css               ← carte.html
│   ├── dashboard.css           ← dashboard.html
│   ├── plan-travaux.css        ← plan-travaux.html
│   └── database.css            ← database.html
│
├── js/
│   ├── config.js               ← Base d’URL API / `__RTC_API_BASE__`
│   ├── search.js               ← Barre de recherche / suggestions API
│   ├── index.js                ← Logique page index (filtres, pagination, modales, mise a jour d'adresse)
│   ├── carte.js
│   ├── dashboard.js
│   ├── plan-travaux.js
│   ├── mini-map.js
│   ├── database.js
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

## Segmentation des canalisations

Un script de preparation de donnees est utilise :

`script/database/row-data/segment_pipes.py`

Il sert a decouper les canalisations trop longues en troncons de **250 m maximum** et a enregistrer le resultat dans la base SQLite, dans une table dediee :

`segmentation`

La segmentation est faite sur la geometrie reelle du tuyau, pas seulement sur une valeur de longueur. Les calculs de longueur sont effectues en metres, avec un systeme de coordonnees metrique (`EPSG:2154` par defaut).

Commande de regeneration complete :

```bash
python script/database/row-data/segment_pipes.py --db database/renovTaCana.db --force-recompute
```

La table `segmentation` contient notamment :

- `id` : identifiant unique du segment
- `pipe_id_original` : identifiant de la canalisation d'origine
- `segment_index` : ordre du segment dans la canalisation
- `segment_length` : longueur reelle du segment en metres
- `geometry` : geometrie WKT du segment
- `created_at` : date de creation du segment

Sans `--force-recompute`, le script evite de recreer les segments deja existants pour les memes canalisations. Avec `--force-recompute`, il vide la table `segmentation` puis recalcule toute la segmentation proprement.

Adaptation future possible :

- ajouter une route API en lecture seule, par exemple `GET /api/segmentation`, pour renvoyer les segments au format GeoJSON ;
- afficher ces segments dans `plan-travaux.html` ou sur la carte comme une couche dediee ;
- utiliser `pipe_id_original` pour garder le lien avec la canalisation source ;
- remplacer progressivement l'affichage des longues canalisations par l'affichage des segments dans le plan de travaux.

## Conversion des géométries EPSG:2154 → EPSG:4326

Un script permet de convertir des géométries WKT stockées en Lambert‑93 (EPSG:2154) vers WGS84 (EPSG:4326). Ceci est utile pour l'affichage sur Leaflet qui attend des coordonnées en format [longitude, latitude].

Script : `script/database/row-data/convert_epsg2154_to_epsg4326.py` ([voir le fichier](script/database/row-data/convert_epsg2154_to_epsg4326.py)).

Usage exemple :

```bash
python script/database/row-data/convert_epsg2154_to_epsg4326.py \
    --db database/renovTaCana.db \
    --table segmentation \
    --source-column geometry \
    --output-column geometry_4326
```

Options principales :
- `--sqlite-path, --db` : chemin vers la base SQLite (défaut : `database/renovTaCana.db`).
- `--table` : nom de la table (défaut : `segmentation`).
- `--id-column` : colonne id (défaut : `id`).
- `--source-column` : colonne source contenant le WKT (défaut : `geometry`).
- `--output-column` : colonne cible pour le WKT converti (défaut : `geometry_4326`).
- `--force-recompute` : force le recalcul même si la colonne de sortie est déjà remplie.
- `--dry-run` : n'écrit pas en base, exécute une simulation et affiche un résumé.
- `--batch-size` : taille des lots d'update (par défaut 1000).
- `--rounding-precision` : précision d'arrondi pour les coordonnées (défaut 8).

Comportement :
- Le script crée la colonne de sortie si elle est absente.
- Il utilise `pyproj` et `shapely` pour projeter et convertir les WKT.
- En cas d'erreurs sur certaines lignes, le traitement continue et des exemples d'erreurs sont collectés.

Pré-requis :
- Installer `pyproj` et `shapely` (voir `requirements.txt`).

Conseils :
- Lancer d'abord avec `--dry-run` pour vérifier le nombre d'enregistrements à traiter.
- La colonne `geometry_4326` contient le WKT en EPSG:4326 ; convertir en GeoJSON pour l'utiliser dans Leaflet.

## Prochaines etapes (V2.2)

- **Livrer la page "plan de travaux"** pour l'avant-dernier sprint.
- **Garantir l'utilisation du score de priorite** dans la priorisation des interventions.
- **Finaliser l'integration donnees/metier** (chantiers, travaux, historique de base).

## Repartition des taches (V2.2)

```mermaid
flowchart LR
    N1[Decoupage des canalisations > 250 m<br/>en sections de 250 m] --> N[Nicolas Demars]
    E1[Creation de la page<br/>plan de travaux] --> E[Etienne GIRARD]
    J1[Prise en compte des chantiers<br/>dans le calcul du score de priorite] --> J[Jules]
    O1[Affichage des troncons de 250 m<br/>sur la carte] --> O[Oscar]
    U1[Historique de base de donnees] --> U[Ulysse]
    U2[Mise a jour de la base de donnees] --> U
    U3[Mise a jour des informations des chantiers<br/>adresses manquantes] --> U
    U4[Idem pour travaux] --> U
```

---
