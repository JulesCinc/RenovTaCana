# Segmentation des canalisations

Documentation des scripts de préparation des tronçons de **250 m** et de conversion des géométries pour l’affichage carte.

---

## Segmentation (`segment_pipes.py`)

Script : [`script/database/row-data/segment_pipes.py`](../script/database/row-data/segment_pipes.py)

Il sert à découper les canalisations trop longues en tronçons de **250 m maximum** et à enregistrer le résultat dans la base SQLite, dans une table dédiée : **`segmentation`**.

La segmentation est faite sur la géométrie réelle du tuyau, pas seulement sur une valeur de longueur. Les calculs de longueur sont effectués en mètres, avec un système de coordonnées métrique (**EPSG:2154** par défaut).

### Régénération complète

```bash
python script/database/row-data/segment_pipes.py --db database/renovTaCana.db --force-recompute
```

### Schéma de la table `segmentation`

| Colonne | Description |
|---|---|
| `id` | Identifiant unique du segment |
| `pipe_id_original` | Identifiant de la canalisation d’origine |
| `segment_index` | Ordre du segment dans la canalisation |
| `segment_length` | Longueur réelle du segment en mètres |
| `geometry` | Géométrie WKT du segment |
| `created_at` | Date de création du segment |

### Comportement des options

- **Sans** `--force-recompute` : le script évite de recréer les segments déjà existants pour les mêmes canalisations.
- **Avec** `--force-recompute` : vide la table `segmentation` puis recalcule toute la segmentation.

### Évolutions prévues (V2.2+)

- Ajouter une route API en lecture seule, par exemple `GET /api/segmentation`, pour renvoyer les segments au format GeoJSON ;
- Afficher ces segments dans `plan-travaux.html` ou sur la carte comme une couche dédiée ;
- Utiliser `pipe_id_original` pour garder le lien avec la canalisation source ;
- Remplacer progressivement l’affichage des longues canalisations par l’affichage des segments dans le plan de travaux.

---

## Conversion EPSG:2154 → EPSG:4326

Script : [`script/database/row-data/convert_epsg2154_to_epsg4326.py`](../script/database/row-data/convert_epsg2154_to_epsg4326.py)

Convertit des géométries WKT stockées en Lambert‑93 (EPSG:2154) vers WGS84 (EPSG:4326). Utile pour l’affichage sur **Leaflet**, qui attend des coordonnées `[longitude, latitude]`.

### Exemple d’usage

```bash
python script/database/row-data/convert_epsg2154_to_epsg4326.py \
    --db database/renovTaCana.db \
    --table segmentation \
    --source-column geometry \
    --output-column geometry_4326
```

### Options principales

| Option | Description |
|---|---|
| `--sqlite-path`, `--db` | Chemin vers la base SQLite (défaut : `database/renovTaCana.db`) |
| `--table` | Nom de la table (défaut : `segmentation`) |
| `--id-column` | Colonne id (défaut : `id`) |
| `--source-column` | Colonne source WKT (défaut : `geometry`) |
| `--output-column` | Colonne cible WKT converti (défaut : `geometry_4326`) |
| `--force-recompute` | Force le recalcul même si la colonne de sortie est déjà remplie |
| `--dry-run` | N’écrit pas en base ; simulation + résumé |
| `--batch-size` | Taille des lots d’update (défaut : 1000) |
| `--rounding-precision` | Précision d’arrondi des coordonnées (défaut : 8) |

### Comportement

- Crée la colonne de sortie si elle est absente.
- Utilise **pyproj** et **shapely** pour projeter et convertir les WKT.
- En cas d’erreurs sur certaines lignes, le traitement continue et des exemples d’erreurs sont collectés.

### Prérequis

- `pyproj` et `shapely` (voir [`requirements.txt`](../requirements.txt)).

### Conseils

- Lancer d’abord avec `--dry-run` pour vérifier le nombre d’enregistrements à traiter.
- La colonne `geometry_4326` contient le WKT en EPSG:4326 ; convertir en GeoJSON pour l’utiliser dans Leaflet.
