# Description des colonnes wAbandonedLine.shp (conduites abandonnées)

Ce document décrit le **sens probable** de chaque colonne du shapefile wAbandonedLine (lignes abandonnées / hors service), **inféré à partir de l’analyse des données**. Ces champs sont repris dans la table SQLite `conduites` avec `abandoned = 1` ; les colonnes spécifiques aux abandonnées (ABANDATE, HS_CAUSE, etc.) sont NULL pour les conduites en service.

**Source :** `row-data/Abandonned_Lines/wAbandonedLine.shp` — **10 952 lignes** (tronçons déjà retirés du réseau).

---

## Identifiants

| Colonne | Type observé | Description probable | Exemples / valeurs |
|--------|---------------|----------------------|--------------------|
| **FACILITYID** | TEXT | Identifiant du tronçon abandonné (format différent de wMain) | CanAband_9006, CanAband_10316 — 10 919 valeurs uniques (quelques doublons possibles) |
| **FACILITYKE** | TEXT | Clé unique (1 par ligne) | CanAband_8445, CanAband_9756 — 10 952 uniques |

---

## Localisation

| Colonne | Type observé | Description probable | Exemples / valeurs |
|--------|---------------|----------------------|--------------------|
| **COMMUNE** | TEXT | **Code commune INSEE (5 chiffres)** | 06027, 06013, 06120 — 49 communes |

---

## Caractéristiques physiques

| Colonne | Type observé | Description probable | Exemples / valeurs |
|--------|---------------|----------------------|--------------------|
| **DIAMETER** | REAL | Diamètre nominal (mm) | 0 – 1800, moyenne ~125 |
| **MATERIAL** | TEXT | Matériau de la conduite abandonnée | F (fonte), A (acier?), Fd (fonte ductile), Fg, PE, Inc (inconnu), PVC, PEHD, Mp, FdV, B, C, Ac, VP — 22 valeurs |
| **SHAPE_Leng** | REAL | Longueur géométrique du tronçon (m) | 0,01 – 3641 m, moyenne ~54 |

---

## Dates : pose et abandon

| Colonne | Type observé | Description probable | Exemples / valeurs |
|--------|---------------|----------------------|--------------------|
| **INSTALLDAT** | TEXT | Date de pose (datetime, ISO) | 1960-01-01T00:00:00+00:00, 1956-01-01… — 416 valeurs |
| **ABANDATE** | TEXT | **Date d’abandon** (datetime, ISO) | 2020-12-11T00:00:00+00:00, 2022-11-10… — 1639 valeurs |
| **SAISIE** | TEXT | Date de saisie dans le SIG | 2021/05/14 14:53:53, 2022/12/14… |

---

## Cause et type d’abandon

| Colonne | Type observé | Description probable | Exemples / valeurs |
|--------|---------------|----------------------|--------------------|
| **HS_CAUSE** | TEXT | **Cause hors service** (motif d’abandon) | RENOUVELLEMENT (fréquent), et ~257 libellés distincts — à analyser selon besoins |
| **CAUSECOM** | TEXT | Commentaire complémentaire sur la cause | RENOUVELLEMENT, Fuite, très mauvais état, Extension / Maillage, 06088D-27, MAJ2078… (souvent vide) |
| **LINETYPE** | TEXT | Type de ligne abandonnée | Tronçon, X, Piquage Incendie, Tronçon fuyards, Branchement, Abonné, Continuous, Vidage, CANALISATION, Câble de télédistribution… — 20 valeurs, souvent vide |

---

## Fonction et eau (avant abandon)

| Colonne | Type observé | Description probable | Exemples / valeurs |
|--------|---------------|----------------------|--------------------|
| **WATERTYPE** | TEXT | Type d’eau (historique) | Potable (majorité), Raw (brute), Non renseigné |
| **FONCTION** | TEXT | Rôle hydraulique avant abandon | Distribution gravitaire, Transport, Adduction, Refoulement-distribution, Vidange, Bypass… — souvent vide |

---

## Gestion et traçabilité

| Colonne | Type observé | Description probable | Exemples / valeurs |
|--------|---------------|----------------------|--------------------|
| **NUM_OP** | TEXT | Numéro d’opération / chantier lié | 514_1, E_2595_1, 1892_2 — 716 valeurs |
| **LASTUPDATE** | TEXT | Dernière mise à jour (datetime) | 2023/11/06 10:05:38 |
| **LASTEDITOR** | TEXT | Dernier éditeur (compte) | REA\REA0603 (majorité), REA\REA0815, REA\REA0481… |
| **MAINTBY** | NUMERIC | Code « maintenu par » (entier) | 2, 9, 12, 17 |

---

## Dépôt physique (conduite déposée ou non)

| Colonne | Type observé | Description probable | Exemples / valeurs |
|--------|---------------|----------------------|--------------------|
| **DEPOSE** | REAL | **Indicateur dépôt** (0 / 1 / 2) — conduite physiquement déposée ou non | 0, 1, 2 — à clarifier (ex. 0 = non déposée, 1 = déposée, 2 = à déposer?) |

**Note :** Dans la table SQLite unifiée `conduites`, ce champ est renommé **DEPOT** pour harmoniser avec wMain (colonne DEPOT).

---

## Géométrie

| Colonne | Type observé | Description probable |
|--------|---------------|----------------------|
| **geometry** | geometry | Ligne (LineString) du tronçon abandonné — exportée en WKT/texte en base |

---

## Correspondance avec la table `conduites`

En base SQLite, les lignes issues de wAbandonedLine ont :
- **abandoned = 1**
- **FACILITYID** = celui de wAbandonedLine (format `CanAband_xxxx`)
- **DEPOT** = valeur de **DEPOSE** (renommage)
- **ABANDATE**, **HS_CAUSE**, **CAUSECOM**, **FACILITYKE**, **LINETYPE** renseignés ; les colonnes purement wMain (longueur, UDI, INSEE, etc.) sont NULL ou issues du schéma commun quand présentes.

---

## Perte de données par rapport aux conduites en service

Le shapefile wAbandonedLine ne contient **pas** les nombreuses colonnes présentes dans wMain (localisation fine, précisions, pression, indicateurs métiers, etc.). Dans la table SQLite unifiée `conduites`, pour les lignes avec **abandoned = 1**, toutes ces colonnes sont donc **NULL**.

**Liste détaillée des colonnes manquantes pour les conduites abandonnées :** voir [SCHEMA_DONNEES.md](SCHEMA_DONNEES.md) — section 6.2, sous-section « Colonnes absentes pour les conduites abandonnées ».

---

## Régénérer cette description

```bash
python python/row-data/describe_wabandonedline_columns.py
```
