# Scripts `row-data` – Exploration des données brutes

Ce dossier contient des scripts d’**exploration et de documentation** des données sources du projet RenovTaCana (shapefiles, CSV, Excel). Ils ne modifient pas les données ; ils servent à inspecter les schémas, comparer les sources et vérifier la cohérence.

---

## Prérequis et exécution

- **Emplacement** : les scripts résolvent les chemins depuis leur fichier (`__file__`) et sont exécutables depuis n'importe où ; ils détectent la racine du projet puis le dossier `row-data/`.
- **Dossier de données** : `row-data/` à la racine du projet (ex. `row-data/conduites/wMain.shp`, `row-data/pipe_ranking_v1_clear.csv`).
- **Dépendances** : `pandas`, `geopandas`, `openpyxl`. Pour la comparaison des longueurs dans `explore_all_data.py`, `dbfread` est optionnel mais utile.

Exemples d'exécution :

```bash
# Depuis la racine du projet
python python/row-data/read_schema.py
python python/row-data/describe_wmain_columns.py
python python/row-data/describe_wabandonedline_columns.py

# Depuis le dossier des scripts
cd python/row-data
python read_schema.py
python explore_all_data.py
python explore_data.py
python describe_wmain_columns.py
python describe_wabandonedline_columns.py
```

---

## 1. `read_schema.py`

**Objectif** : lister les **colonnes (schémas)** de tous les fichiers de données pour la documentation, **sans charger les géométries** ni tout le contenu.

**Ce qu’il fait :**

- **CSV** (`data/pipe_ranking_v1_clear.csv`) : lit la première ligne et affiche les noms de colonnes.
- **Shapefiles** : parcourt tous les `.dbf` sous `data/` et lit les noms des champs directement dans l’en-tête du fichier DBF (pas besoin de GeoPandas). Affiche pour chaque shapefile le chemin du `.dbf`, le nom logique (sans extension) et la liste des colonnes.
- **Excel** (`Operations.xlsx`, `chantiers.xlsx`) : avec `openpyxl`, lit la première ligne de chaque feuille (en-têtes) et affiche le nom de la feuille et la liste des colonnes.

**Utilité** : obtenir rapidement une vue d’ensemble des champs disponibles dans chaque source (notamment pour rédiger ou mettre à jour `docs/SCHEMA_DONNEES.md` ou pour préparer un ETL).

---

## 2. `explore_all_data.py`

**Objectif** : **exploration plus complète** : comparer des champs entre sources et lister les schémas de tous les shapefiles et Excel.

**Ce qu’il fait :**

1. **Comparaison des longueurs wMain vs pipe_ranking**  
   Pour chaque `FACILITYID` présent dans les deux sources, compare la valeur de `longueur` (CSV pipe_ranking vs DBF wMain). Affiche le nombre de tronçons en commun, combien ont la même longueur (tolérance 0,01 m) et un échantillon des différences éventuelles. Nécessite le module **dbfread** pour lire le DBF ; sinon un message indique d’installer `dbfread`.

2. **Tous les shapefiles**  
   Parcourt tous les `.dbf` sous `data/`, lit les noms des champs (comme `read_schema.py`) et affiche pour chaque fichier le chemin, le nom logique et la liste des colonnes (éventuellement tronquée si nombreuses).

3. **Fichiers Excel**  
   Même principe que `read_schema.py` : première ligne de chaque feuille de `Operations.xlsx` et `chantiers.xlsx` pour afficher les en-têtes.

**Utilité** : vérifier la cohérence des données (ex. longueurs identiques entre pipe_ranking et wMain), et avoir une vue consolidée des schémas pour la doc ou l’intégration en base.

---

## 3. `explore_data.py`

**Objectif** : **exploration rapide** des données SIG et du CSV pipe_ranking en chargeant les fichiers avec **GeoPandas** et **Pandas**.

**Ce qu’il fait :**

- Si **GeoPandas** est disponible :
  - Charge `data/conduites/wMain.shp` : affiche le CRS, la liste des colonnes, le nombre de tronçons et un exemple d’attributs (première ligne, sans la géométrie).
  - Charge `data/Abandonned_Lines/wAbandonedLine.shp` : même type d’informations.
- Si **Pandas** est disponible : charge `data/pipe_ranking_v1_clear.csv` et affiche les colonnes, le nombre de lignes, le nombre de doublons sur `FACILITYID`, et des statistiques descriptives sur `probabilite_casse` et `longueur`.

Si GeoPandas n’est pas installé, les shapefiles sont ignorés et un message l’indique.

**Utilité** : vérifier rapidement que les shapefiles se chargent correctement, voir un exemple d’enregistrement et les stats du CSV (notamment pour la criticité et la longueur).

---

## 4. `describe_wmain_columns.py` et `describe_wabandonedline_columns.py`

**Objectif :** analyser chaque colonne du shapefile (non-null, uniques, min/max ou exemples, répartition) pour **en déduire le sens** et alimenter la documentation.

- **describe_wmain_columns.py** : wMain.shp (conduites en service). Sortie utilisée pour [docs/COLONNES_WMAIN.md](../../docs/COLONNES_WMAIN.md).
- **describe_wabandonedline_columns.py** : wAbandonedLine.shp (conduites abandonnées). Sortie utilisée pour [docs/COLONNES_WABANDONEDLINE.md](../../docs/COLONNES_WABANDONEDLINE.md).

**Utilité :** documenter précisément les colonnes (identifiants, diamètre, matériau, dates, cause d’abandon, etc.) pour la table SQLite et les analyses.

---

## Résumé

| Script                            | Données lues                    | Sortie principale                                      |
|-----------------------------------|----------------------------------|--------------------------------------------------------|
| `read_schema.py`                  | CSV, tous les .dbf, Excel       | Liste des colonnes de chaque fichier                  |
| `explore_all_data.py`             | CSV, wMain.dbf, tous les .dbf, Excel | Comparaison longueur wMain/pipe_ranking + schémas   |
| `explore_data.py`                 | wMain.shp, wAbandonedLine.shp, CSV | CRS, colonnes, effectifs, exemple ligne, stats CSV  |
| `describe_wmain_columns.py`       | wMain.shp                       | Stats par colonne → doc COLONNES_WMAIN.md             |
| `describe_wabandonedline_columns.py` | wAbandonedLine.shp           | Stats par colonne → doc COLONNES_WABANDONEDLINE.md    |

Ces scripts sont **en lecture seule** et servent à la compréhension des données et à la préparation de la base SQL (voir `python/build-sqlite/`).
