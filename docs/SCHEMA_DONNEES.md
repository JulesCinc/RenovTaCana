# Schéma des données – RenovTaCana

Document de référence pour la conception de la base SQL (SQLite) : **vision globale des données**, **colonnes par fichier** et **liens entre fichiers**.

---

## 1. Comprendre les « formats » : un shapefile = un jeu de données

Un **shapefile** est un seul jeu de données stocké dans **plusieurs fichiers** (même nom, extensions différentes). Il faut les garder ensemble dans le même dossier.

| Extension | Rôle |
|-----------|------|
| `.shp` | Géométries (lignes, points, polygones) |
| `.dbf` | Attributs (colonnes) — **c’est celui qu’on lit pour le schéma** |
| `.shx` | Index géométrie ↔ enregistrement |
| `.prj` | Système de coordonnées (ici : Lambert 93) |
| `.cpg` / `.qmd` | Encodage / métadonnées QGIS |

**Donc** : `wMain.shp` + `wMain.dbf` + `wMain.shx` + … = **un seul tableau** « wMain » (conduites). Il n’y a pas « plein de formats wMain », mais **un jeu wMain** décrit par plusieurs fichiers.

---

## 2. Inventaire global des données

### 2.1 Arborescence des sources

```
data/
├── pipe_ranking_v1_clear.csv          # Criticité (probabilité de casse, longueur)
├── Operations.xlsx                    # Opérations / projets
├── chantiers.xlsx                     # Chantiers (planification)
├── conduites/
│   ├── wMain.*                        # Réseau principal (toutes canalisations)
│   ├── UDI_Littoral/
│   │   ├── wMain_UDI_Littoral.*       # Même schéma que wMain, sous-ensemble Littoral
│   │   └── UDI_Littoral_2.*           # Couche « secteurs » (polygones), schéma différent
│   └── UDI_Moyen_Pays/
│       ├── wMain_UDI_Moyen_Pays.*     # Même schéma que wMain, sous-ensemble Moyen Pays
│       └── UDI_Moyen_Pays.*           # Couche « secteurs » (polygones)
└── Abandonned_Lines/
    ├── wAbandonedLine.*               # Canalisations abandonnées (réseau historique)
    ├── wAbandonedLine_UDI_Littoral.*  # Idem, extrait Littoral
    ├── wAbandonedLine_UDI_Moyen_Pays.*
    └── Couches SIG pour Yvan/         # Copies / variantes des couches ci-dessus
```

### 2.2 Rôle de chaque source (résumé)

| Source | Type | Rôle | Lien principal |
|--------|------|------|----------------|
| **wMain** | Shapefile (lignes) | Réseau de canalisations en service | Table centrale (FACILITYID) |
| **wMain_UDI_Littoral** | Idem | Sous-ensemble géographique (UDI Littoral) | Même schéma que wMain |
| **wMain_UDI_Moyen_Pays** | Idem | Sous-ensemble géographique (UDI Moyen Pays) | Même schéma que wMain |
| **UDI_Littoral_2** / **UDI_Moyen_Pays** | Shapefile (polygones) | Secteurs / zones (pas des conduites) | Secteur, pas FACILITYID |
| **wAbandonedLine** (+ variantes UDI) | Shapefile (lignes) | Canalisations déjà supprimées | FACILITYID (historique) |
| **pipe_ranking_v1_clear.csv** | CSV | Criticité par tronçon | FACILITYID → wMain |
| **Operations.xlsx** | Excel | Opérations / projets | IdCommune → COMMUNE (wMain) |
| **chantiers.xlsx** | Excel | Chantiers (début, fin, commune) | Commune → COMMUNE (wMain) |

---

## 3. Clarifications : réponses à vos questions

### 3.1 Pourquoi wMain a ~55 000 lignes et pipe_ranking beaucoup moins ? (et ce n’est pas à cause des abandonnées)

- **wMain** = **toutes** les canalisations **encore en service** dans le SIG (55 524 tronçons).
- **Abandonnées** = tronçons **déjà supprimés** du réseau ; ils sont dans **wAbandonedLine**, **pas** dans wMain. Donc les 55k de wMain ne contiennent pas les abandonnées.
- **pipe_ranking** = seulement les tronçons pour lesquels les étudiants précédents ont **calculé une criticité** (probabilité de casse). Ce travail n’a pas été fait sur tout le réseau, seulement sur **une partie** (28 894 tronçons).

Donc : **moins de lignes dans pipe_ranking** = sous-ensemble du réseau où la criticité a été calculée, **pas** parce que des tronçons auraient été “retirés” (les abandonnées sont dans un autre fichier).

Résumé :  
wMain (55k) = réseau actuel.  
pipe_ranking (~29k) = sous-ensemble avec score de criticité.  
Abandonnées = autre couche (historique), pas dans wMain.

---

### 3.2 Que signifie UDI ?

**UDI** = **Unité de Distribution** (ou Unité de Gestion) : découpage du réseau en zones de gestion (secteurs, quartiers, villages, etc.).

Dans **wMain**, la colonne **UDI** contient des valeurs comme :
- `BS CENTRE`, `BS OUEST`, `POLONIA`, `AURON`, noms de villages (`ROQUEBILLIERE VILLAGE`, `ISOLA 2000`), etc.
- Beaucoup de conduites ont **UDI vide** (environ 40 500 sur 55 524).

Donc **UDI** dans wMain = découpage fin (secteur / zone opérationnelle). Ce n’est **pas** la même chose que les noms de dossiers « Littoral » et « Moyen Pays », qui sont deux **grandes zones géographiques** (voir ci‑dessous).

---

### 3.3 Variantes UDI : mêmes données ou pas ? Littoral + Moyen Pays = wMain ?

- **Même schéma** = mêmes colonnes (FACILITYID, longueur, UDI, etc.).
- **Pas les mêmes lignes** : ce sont des **extraits** (sous-ensembles) du réseau.

**Littoral** et **Moyen Pays** sont deux **zones géographiques** (deux polygones sur la carte). Les fichiers :

- **wMain_UDI_Littoral** ≈ 4 065 conduites dont la **géométrie est à l’intérieur** du polygone « Littoral ».
- **wMain_UDI_Moyen_Pays** ≈ 4 106 conduites dont la **géométrie est à l’intérieur** du polygone « Moyen Pays ».

Donc :
- **wMain_UDI_Littoral + wMain_UDI_Moyen_Pays ≈ 8 171 lignes**, pas 55 000.
- **Ce n’est pas** Littoral + Moyen Pays = wMain. Ces deux zones ne couvrent qu’une **partie** du réseau (environ 8k tronçons). Le reste (~47k) est ailleurs (autres secteurs, ou hors de ces deux polygones).

En base SQL : une seule table **conduites** (issue de wMain) suffit ; Littoral / Moyen Pays = **filtres** (par intersection avec les polygones ou par attribut si un jour un champ « zone Littoral/Moyen Pays » est renseigné).

---

### 3.4 Critère pour être dans « Littoral » ou « Moyen Pays »

Le critère est **spatial** : une conduite est dans **Littoral** (resp. **Moyen Pays**) si sa **ligne** (géométrie) est **à l’intérieur** du polygone qui définit la zone Littoral (resp. Moyen Pays).  
Ce n’est **pas** un filtre sur la colonne UDI de wMain (où on trouve BS CENTRE, villages, etc.). Les deux couches polygonales qui définissent ces zones sont **UDI_Littoral_2** et **UDI_Moyen_Pays** (voir 3.5).

---

### 3.5 À quoi servent concrètement les UDI_XXX_2 (UDI_Littoral_2, UDI_Moyen_Pays) ?

Ce sont des **couches de polygones** (pas des conduites) :

- **UDI_Littoral_2** = le(s) polygone(s) qui délimitent la zone **Littoral** (côte).
- **UDI_Moyen_Pays** = le(s) polygone(s) qui délimitent la zone **Moyen Pays** (arrière-pays).

**Colonnes :** OBJECTID, **Secteur**, Shape_Leng, Shape_Area.

**Usage concret :**
- **Cartographie** : afficher les limites des zones Littoral / Moyen Pays.
- **Filtrage spatial** : « quelles conduites sont dans le Littoral ? » → intersection entre wMain et le polygone UDI_Littoral_2.
- **Agrégation** : statistiques ou indicateurs par zone (Littoral vs Moyen Pays).

En base SQL : on peut stocker ces polygones dans une table **secteurs** (ou **zones_udi**) et faire les jointures par intersection géométrique (ou après prétraitement : attribut « zone » sur chaque conduite).

---

### 3.6 Synthèse

| Question | Réponse courte |
|----------|----------------|
| wMain 55k vs pipe_ranking ~29k ? | pipe_ranking = sous-ensemble avec criticité calculée ; pas lié aux abandonnées. |
| UDI ? | Unité de distribution = secteur de gestion (colonne dans wMain ; valeurs type BS CENTRE, villages…). |
| Variantes UDI = mêmes données ? | Même **structure** (schéma), **données différentes** (extraits par zone géographique). |
| Littoral + Moyen Pays = wMain ? | **Non.** Littoral + Moyen Pays ≈ 8k ; wMain = 55k. |
| Critère Littoral / Moyen Pays ? | **Spatial** : conduite **dans** le polygone Littoral ou Moyen Pays. |
| Rôle des UDI_XXX_2 ? | **Définir** les polygones des zones Littoral et Moyen Pays (limites, filtrage, carto). |

---

## 4. Longueur : wMain vs pipe_ranking

**Question :** Les longueurs dans wMain sont-elles les mêmes que dans pipe_ranking ?

**Réponse :** **Oui.** Pour tous les `FACILITYID` présents dans les deux sources (28 894 tronçons), les valeurs de **longueur** sont **identiques** (à 0,01 m près).

- **wMain** : 55 524 enregistrements (toutes les conduites).
- **pipe_ranking** : 28 894 `FACILITYID` uniques (sous-ensemble avec criticité).
- Donc on peut utiliser **une seule** colonne `longueur` en base (ex. celle de wMain, ou de pipe_ranking pour les tronçons rankés).

---

## 5. Colonnes et liens par fichier

### 5.1 `data/pipe_ranking_v1_clear.csv`

| Colonne | Rôle |
|---------|------|
| **FACILITYID** | Identifiant tronçon (clé vers wMain) |
| **probabilite_casse** | Criticité [0–1] |
| **longueur** | Longueur (m) — identique à wMain pour les mêmes FACILITYID |

**Liens :**  
- `FACILITYID` → **wMain.FACILITYID** (table centrale).

---

### 5.2 `data/conduites/wMain.shp` (et variantes UDI : wMain_UDI_Littoral, wMain_UDI_Moyen_Pays)

**Colonnes** (schéma commun à wMain, wMain_UDI_Littoral, wMain_UDI_Moyen_Pays) :

FACILITYID, DIAMETER, DIAMEXT, PRECISIOND, MATERIAL, PRECISIONM, INSTALLDAT, PRECISIONI, PERIODE_PO, WATERTYPE, DOMAINE, FONCTION, SENSIBILIT, PRESSION, OSSATURE, CONTRAT, NUM_OP, **COMMUNE**, ADRESSE, COTE_TN, PROFONDEUR, JOINT, EMPLACEMEN, LITDEPOSE, TYPE_SOL, ETAT_SOL, TRAFIC, ENVIR_ELEC, NB_BRANCHE, FABRICANT, TECHNIQUE_, PROTECT_IN, PROTECT_EX, PROTECT_CA, DEPOT, CORROSION, VALEUR_NEU, TRANSMISS, LASTUPDATE, LASTEDITOR, ENABLED, ACTIVEFLAG, OWNEDBY, MAINTBY, LONGSYS, COMMENTA, MAJ, ETAGPRESSI, IDADRESS, **INSEE**, SECTORISAT, PRECISLOCA, CLASSE_DIC, NOMCANAUX, SAISIE, SYMBOLOGIE, **UDI**, TYPE_POSE, DN, PROTECATHO, REGULATEUR, AGENCE, COMMENTA_D, PROSP_RENO, MAJREFGEOM, DATEMAJGEO, CONVENTION, DATEMAJH, SHAPE_Leng, **longueur**, OBJECTID, dense, ValoPat, Vetuste, nbFuites, nbAbo, sumConso, PRESSIONAV, DEM_EAU_LS, CATEGORIE_, Traffic, PrioMerlin, TXcasse, Altimetrie, Prediction, Predicti_1 + *geometry*.

**Description détaillée (sens des colonnes, inféré des données) :** voir [COLONNES_WMAIN.md](COLONNES_WMAIN.md).

**Liens :**  
- **FACILITYID** ↔ pipe_ranking ; **COMMUNE** / **INSEE** / **UDI** pour lien avec Operations et chantiers (commune, secteur).

---

### 5.3 `data/conduites/UDI_Littoral/UDI_Littoral_2` et `UDI_Moyen_Pays/UDI_Moyen_Pays` (couches secteurs)

**Colonnes :** OBJECTID, **Secteur**, Shape_Leng, Shape_Area.

Ce ne sont **pas** des conduites mais des **polygones de secteurs**. Pas de FACILITYID. Lien possible via **Secteur** ou localisation avec les conduites (UDI, zone).

---

### 5.4 `data/Abandonned_Lines/wAbandonedLine.shp` (et variantes UDI)

**Colonnes :** LINETYPE, INSTALLDAT, ABANDATE, HS_CAUSE, MATERIAL, DIAMETER, **FACILITYID**, LASTUPDATE, LASTEDITOR, SAISIE, DEPOSE, COMMUNE, NUM_OP, WATERTYPE, MAINTBY, FONCTION, CAUSECOM, FACILITYKE, SHAPE_Leng.

**Description détaillée (sens des colonnes, inférée des données) :** voir [COLONNES_WABANDONEDLINE.md](COLONNES_WABANDONEDLINE.md).

**Liens :**  
- **FACILITYID** : même identifiant que pour wMain (tronçons qui ont été abandonnés, donc plus dans wMain). Utile pour exclure de la priorisation ou pour l’historique.

---

### 5.5 `data/Operations.xlsx` (feuille Sheet1)

| Colonne | Rôle supposé | Ce qu’on observe |
|---------|----------------|------------------|
| **1ère (sans nom)** | Inconnu | Entiers (60, 265, 303, 348…) ; 167 valeurs uniques. Probable clé interne ou numéro de ligne d’un autre système. **À clarifier avec Eau d’Azur.** |
| **Id1** | Identifiant opération | Entiers (22734, 28830, 22372…) ; **une valeur par ligne** → identifiant unique de l’**opération**. |
| **IdProjet** | Identifiant projet | Entiers (482, 1110, 809, 886…) ; **plusieurs opérations peuvent avoir le même IdProjet** → un **projet** regroupe plusieurs opérations. Format différent du « N° chantier » dans chantiers.xlsx (ex. 2021015197). Lien IdProjet ↔ chantiers à confirmer. |
| Projet_Titre | Intitulé projet | — |
| **IdCommune** | Commune | Nom de commune (ex. NICE, TOURRETTE-LEVENS). |
| Localisation | Lieu (texte) | — |
| Titre | Intitulé opération | — |
| Operation_Type1 | Type d’opération | — |
| Demandeur1 | Demandeur | — |
| Operation_Annee | Année | — |
| CPI | — | — |

**Liens à utiliser en base :**  
- **IdCommune** → wMain.**COMMUNE** (ou table commune) pour rattacher les opérations au territoire / aux conduites par commune.  
- **IdProjet** → à croiser avec chantiers (si un champ « projet » ou « n° chantier » existe).

---

### 5.6 `data/chantiers.xlsx` (feuille Sheet1)

| Colonne | Rôle supposé |
|---------|----------------|
| **N° chantier / opération** | Identifiant chantier — lien possible avec Operations (IdProjet / Id1) |
| État | État du chantier |
| Début | Date début |
| Fin | Date fin |
| **Commune** | Lien vers wMain.**COMMUNE** |
| Libellé | Intitulé |
| page | Référence |

**Liens à utiliser en base :**  
- **Commune** → wMain.**COMMUNE** (même logique qu’Operations).  
- **N° chantier / opération** ↔ **Operations.IdProjet** ou **Id1** (à confirmer en ouvrant les données).

---

## 6. Schéma relationnel cible (SQL / SQLite)

### 6.1 Choix : une table CONDUITES avec les abandonnées

Pour avoir **toutes les conduites** (en service + abandonnées) dans un même modèle et pouvoir filtrer facilement (ex. « ne pas prioriser les abandonnées »), on utilise **une seule table CONDUITES** alimentée par **wMain** et **wAbandonedLine**, avec une clé booléenne **`abandoned`** :

- **`abandoned = 0`** (FALSE) : conduite encore en service (source wMain).
- **`abandoned = 1`** (TRUE) : conduite abandonnée (source wAbandonedLine).

Les lignes issues de wAbandonedLine n’ont pas les mêmes attributs que wMain (ex. ABANDATE, HS_CAUSE présents ; beaucoup de champs wMain absents). Donc en base : colonnes communes + colonnes spécifiques aux abandonnées (nullable pour les conduites en service).

---

### 6.2 Table CONDUITES (toutes les clés et colonnes)

Table unifiée : **wMain** + **wAbandonedLine**. Clé primaire : **FACILITYID**. Clé logique : **abandoned**.

| Colonne | Type | Source | Note |
|---------|------|--------|------|
| **FACILITYID** | TEXT | wMain / wAbandonedLine | **PK** — identifiant unique du tronçon |
| **abandoned** | INTEGER (0/1) | dérivé | **Clé logique** — 0 = en service (wMain), 1 = abandonnée (wAbandonedLine) |
| **longueur** | REAL | wMain / wAbandonedLine | Longueur (m) ; wAbandonedLine utilise SHAPE_Leng si pas de `longueur` |
| **COMMUNE** | TEXT | wMain / wAbandonedLine | Lien territoire (Operations, chantiers) |
| **INSEE** | TEXT | wMain | Code commune (souvent vide pour abandonnées) |
| **UDI** | TEXT | wMain | Unité de distribution (souvent vide pour abandonnées) |
| **NUM_OP** | TEXT | wMain / wAbandonedLine | Numéro d’opération |
| **OBJECTID** | INTEGER | wMain | Identifiant interne (souvent NULL pour abandonnées) |
| DIAMETER | REAL | wMain / wAbandonedLine | Diamètre |
| DIAMEXT | REAL | wMain | Diamètre extérieur |
| PRECISIOND | TEXT | wMain | |
| MATERIAL | TEXT | wMain / wAbandonedLine | Matériau |
| PRECISIONM | TEXT | wMain | |
| INSTALLDAT | TEXT | wMain / wAbandonedLine | Date de pose |
| PRECISIONI | TEXT | wMain | |
| PERIODE_PO | TEXT | wMain | |
| WATERTYPE | TEXT | wMain / wAbandonedLine | Type d’eau |
| DOMAINE | TEXT | wMain | |
| FONCTION | TEXT | wMain / wAbandonedLine | |
| SENSIBILIT | TEXT | wMain | |
| PRESSION | TEXT | wMain | |
| OSSATURE | TEXT | wMain | |
| CONTRAT | TEXT | wMain | |
| ADRESSE | TEXT | wMain | |
| COTE_TN | REAL | wMain | |
| PROFONDEUR | REAL | wMain | |
| JOINT | TEXT | wMain | |
| EMPLACEMEN | TEXT | wMain | |
| LITDEPOSE | TEXT | wMain | |
| TYPE_SOL | TEXT | wMain | |
| ETAT_SOL | TEXT | wMain | |
| TRAFIC | TEXT | wMain | |
| ENVIR_ELEC | TEXT | wMain | |
| NB_BRANCHE | INTEGER | wMain | |
| FABRICANT | TEXT | wMain | |
| TECHNIQUE_ | TEXT | wMain | |
| PROTECT_IN | TEXT | wMain | |
| PROTECT_EX | TEXT | wMain | |
| PROTECT_CA | TEXT | wMain | |
| DEPOT | TEXT | wMain / wAbandonedLine | (DEPOSE dans wAbandonedLine) |
| CORROSION | TEXT | wMain | |
| VALEUR_NEU | REAL | wMain | |
| TRANSMISS | TEXT | wMain | |
| LASTUPDATE | TEXT | wMain / wAbandonedLine | |
| LASTEDITOR | TEXT | wMain / wAbandonedLine | |
| ENABLED | TEXT | wMain | |
| ACTIVEFLAG | TEXT | wMain | |
| OWNEDBY | TEXT | wMain | |
| MAINTBY | TEXT | wMain / wAbandonedLine | |
| LONGSYS | REAL | wMain | |
| COMMENTA | TEXT | wMain | |
| MAJ | TEXT | wMain | |
| ETAGPRESSI | TEXT | wMain | |
| IDADRESS | TEXT | wMain | |
| SECTORISAT | TEXT | wMain | |
| PRECISLOCA | TEXT | wMain | |
| CLASSE_DIC | TEXT | wMain | |
| NOMCANAUX | TEXT | wMain | |
| SAISIE | TEXT | wMain / wAbandonedLine | |
| SYMBOLOGIE | TEXT | wMain | |
| TYPE_POSE | TEXT | wMain | |
| DN | TEXT | wMain | |
| PROTECATHO | TEXT | wMain | |
| REGULATEUR | TEXT | wMain | |
| AGENCE | TEXT | wMain | |
| COMMENTA_D | TEXT | wMain | |
| PROSP_RENO | TEXT | wMain | |
| MAJREFGEOM | TEXT | wMain | |
| DATEMAJGEO | TEXT | wMain | |
| CONVENTION | TEXT | wMain | |
| DATEMAJH | TEXT | wMain | |
| SHAPE_Leng | REAL | wMain / wAbandonedLine | Longueur géométrique |
| dense | TEXT | wMain | |
| ValoPat | REAL | wMain | |
| Vetuste | TEXT | wMain | |
| nbFuites | INTEGER | wMain | |
| nbAbo | INTEGER | wMain | |
| sumConso | REAL | wMain | |
| PRESSIONAV | REAL | wMain | |
| DEM_EAU_LS | REAL | wMain | |
| CATEGORIE_ | TEXT | wMain | |
| Traffic | TEXT | wMain | |
| PrioMerlin | TEXT | wMain | |
| TXcasse | REAL | wMain | |
| Altimetrie | TEXT | wMain | |
| Prediction | REAL | wMain | |
| Predicti_1 | REAL | wMain | |
| **ABANDATE** | TEXT | wAbandonedLine | Date d’abandon — **NULL** si en service |
| **HS_CAUSE** | TEXT | wAbandonedLine | Cause hors service — **NULL** si en service |
| **CAUSECOM** | TEXT | wAbandonedLine | Commentaire cause — **NULL** si en service |
| **FACILITYKE** | TEXT | wAbandonedLine | Clé facility — **NULL** si en service |
| **LINETYPE** | TEXT | wAbandonedLine | Type de ligne — **NULL** si en service |
| **geometry** | BLOB/TEXT | wMain / wAbandonedLine | Géométrie (WKT ou GeoJSON selon implémentation) |

#### Colonnes absentes pour les conduites abandonnées (perte d’information par rapport au réseau en service)

Pour les lignes avec **`abandoned = 1`** (source wAbandonedLine), le shapefile ne fournit **pas** les champs suivants. Ces colonnes sont donc **toujours NULL** pour les conduites abandonnées ; il y a une **perte de données** par rapport aux conduites en service (wMain).

| Colonnes manquantes (NULL si `abandoned = 1`) | Rôle (pour les conduites en service) |
|---------------------------------------------|-------------------------------------|
| **longueur** | Longueur (m) — wAbandonedLine a seulement SHAPE_Leng ; le script pourrait la recopier, sinon NULL. |
| **INSEE** | Code commune INSEE |
| **UDI** | Unité de distribution |
| **OBJECTID** | Identifiant interne |
| **DIAMEXT** | Diamètre extérieur |
| **PRECISIOND**, **PRECISIONM**, **PRECISIONI** | Précision / source (diamètre, matériau, date de pose) |
| **PERIODE_PO** | Période de pose |
| **DOMAINE** | Domaine (public / privé) |
| **SENSIBILIT** | Zone sensible (0/1) |
| **PRESSION**, **OSSATURE**, **CONTRAT** | Pression, niveau de réseau, contrat |
| **ADRESSE**, **IDADRESS** | Adresse / libellé, identifiant adresse |
| **COTE_TN**, **PROFONDEUR** | Cote TN, profondeur |
| **JOINT**, **EMPLACEMEN**, **LITDEPOSE** | Type de joint, emplacement, lit de pose |
| **TYPE_SOL**, **ETAT_SOL** | Type et état du sol |
| **TRAFIC**, **Traffic**, **ENVIR_ELEC** | Trafic routier, environnement électrique |
| **NB_BRANCHE** | Nombre de branchements |
| **FABRICANT**, **TECHNIQUE_** | Fabricant, technique de pose |
| **PROTECT_IN**, **PROTECT_EX**, **PROTECT_CA** | Protections (intérieure, extérieure, cathodique) |
| **CORROSION**, **VALEUR_NEU**, **TRANSMISS** | Corrosion, valeur à neuf, transmissible |
| **ENABLED**, **ACTIVEFLAG**, **OWNEDBY** | Actif, indicateur actif, propriétaire |
| **LONGSYS** | Longueur système |
| **COMMENTA**, **MAJ**, **ETAGPRESSI** | Commentaire, référence MAJ, étage pression |
| **SECTORISAT**, **PRECISLOCA** | Sectorisation, précision localisation |
| **CLASSE_DIC**, **NOMCANAUX** | Classe, nom canal / synoptique |
| **SYMBOLOGIE**, **TYPE_POSE**, **DN** | Symbole carte, type de pose, diamètre nominal |
| **PROTECATHO**, **REGULATEUR**, **AGENCE** | Protection cathodique, régulateur, agence |
| **COMMENTA_D**, **PROSP_RENO** | Commentaire, prospect rénovation |
| **MAJREFGEOM**, **DATEMAJGEO**, **CONVENTION**, **DATEMAJH** | Références et dates de maj géométrie / convention |
| **dense** | Densité (forte / faible) |
| **ValoPat**, **Vetuste** | Valorisation patrimoniale, vétusté |
| **nbFuites**, **nbAbo**, **sumConso** | Nombre de fuites, abonnés, somme consommations |
| **PRESSIONAV**, **DEM_EAU_LS** | Pression moyenne, demande eau |
| **CATEGORIE_** | Catégorie (1–9) |
| **PrioMerlin**, **TXcasse** | Priorité Merlin, niveau de casse (qualitatif) |
| **Altimetrie**, **Prediction**, **Predicti_1** | Altimétrie, prédiction |

**Colonnes effectivement renseignées pour les abandonnées :** FACILITYID, abandoned, COMMUNE, NUM_OP, DIAMETER, MATERIAL, INSTALLDAT, WATERTYPE, FONCTION, LASTUPDATE, LASTEDITOR, SAISIE, MAINTBY, DEPOT, SHAPE_Leng, ABANDATE, HS_CAUSE, CAUSECOM, FACILITYKE, LINETYPE, **geometry**.  

Les **coordonnées** des conduites abandonnées sont bien disponibles : elles sont portées par la géométrie (ligne, LineString) dans la colonne **geometry** (stockée en WKT en base), comme pour les conduites en service. Il n’y a donc pas de perte de géolocalisation pour les abandonnées.

**Contraintes :**  
- `FACILITYID` unique (PK).  
- `abandoned IN (0, 1)`.  
- Pour priorisation / carte « réseau actuel » : `WHERE abandoned = 0`.  
- Pour historique : `WHERE abandoned = 1` ou pas de filtre.

**Doublons dans les jeux sources (wMain / wAbandonedLine) :**  
Lors de la construction de la table SQLite (`python/build-sqlite/build_conduites_sqlite.py`), on impose **une seule ligne par FACILITYID** (clé primaire). En cas de doublon, on conserve **la ligne dont le risque de casse est le plus élevé** (priorité à la criticité pour la priorisation des rénovations). Comportement :

| Cas | Traitement |
|-----|------------|
| **Même FACILITYID plusieurs fois dans wMain** | Une seule ligne conservée : celle avec le **risque de casse le plus élevé** (`probabilite_casse` du pipe_ranking si dispo, sinon `TXcasse`). |
| **Même FACILITYID plusieurs fois dans wAbandonedLine** | Une seule ligne conservée (risque max si disponible, sinon première). |
| **FACILITYID présent à la fois dans wMain et wAbandonedLine** | La ligne **wMain** (en service, `abandoned = 0`) est conservée ; la ligne abandonnée est ignorée. Parmi plusieurs lignes wMain, celle au risque le plus élevé est gardée. |

Le script fusionne le CSV `pipe_ranking_v1_clear.csv` pour disposer de `probabilite_casse` ; à défaut, il utilise la colonne `TXcasse` de wMain. Tri : d’abord `abandoned` (0 avant 1), puis risque décroissant. Le script affiche en sortie le nombre de doublons détectés et de lignes supprimées.

---

### 6.3 Table PIPE_RANKING

| Colonne | Type | Note |
|---------|------|------|
| **FACILITYID** | TEXT | **PK**, FK vers CONDUITES (conduites en service en général) |
| **probabilite_casse** | REAL | Criticité [0–1] |
| **longueur** | REAL | Redondant avec CONDUITES.longueur (optionnel) |

Jointure : `PIPE_RANKING.FACILITYID = CONDUITES.FACILITYID` (et en pratique `CONDUITES.abandoned = 0` pour les tronçons rankés).

---

### 6.4 Tables OPERATIONS et CHANTIERS

À compléter lorsque le lien avec les conduites (et entre projet et opérations) sera clarifié. Pour l’instant, lien prévu par **COMMUNE** (IdCommune / Commune) vers **CONDUITES.COMMUNE**.

---

## 7. Synthèse des clés de jointure

| Table A | Table B | Clé |
|---------|---------|-----|
| PIPE_RANKING | CONDUITES | **FACILITYID** (conduites en service : `abandoned = 0`) |
| OPERATIONS | CONDUITES (par territoire) | **IdCommune** → **COMMUNE** |
| CHANTIERS | CONDUITES (par territoire) | **Commune** → **COMMUNE** |
| OPERATIONS | CHANTIERS | **IdProjet** ↔ **N° chantier / opération** (à valider) |

*Les abandonnées sont dans CONDUITES avec `abandoned = 1` ; plus de table ABANDONNEES séparée.*

---

### 7.1 Lien Conduites ↔ Opérations / Chantiers : ce qu’on a vraiment

**Oui, on a un lien**, mais **au niveau commune**, pas au niveau du tronçon individuel (FACILITYID).

| Lien | Type | Clé | Exemple |
|------|------|-----|--------|
| **Opérations → Conduites** | Oui (par territoire) | **IdCommune** (Operations) = **COMMUNE** (CONDUITES) | Opération à « NICE » → toutes les conduites dont COMMUNE = NICE |
| **Chantiers → Conduites** | Oui (par territoire) | **Commune** (chantiers) = **COMMUNE** (CONDUITES) | Chantier « Saint-Blaise » → toutes les conduites de Saint-Blaise |

Donc : une opération ou un chantier est rattaché à **un ensemble de conduites** (celles de la même commune). On ne dispose **pas**, dans les Excel, d’un identifiant de tronçon (FACILITYID) ou d’un numéro d’opération qui pointerait vers une conduite précise.  
La table CONDUITES contient un champ **NUM_OP** (ex. 1024, 1421) ; les identifiants dans Operations (Id1, IdProjet) ont un format différent. Un lien éventuel NUM_OP ↔ opération reste à **confirmer avec Eau d’Azur** ou en croisant les données.

---

### 7.2 Que sont concrètement les opérations et les chantiers ? Précision géographique

**Définitions (d’après les données) :**

- **Opérations** (Operations.xlsx) : projets ou interventions du réseau (ex. « déplacement de réseau », « restructuration »). Champs : Id1, IdProjet, **IdCommune**, **Localisation** (texte, ex. « Voie Ernest Lairolle et George Bidault »), Titre, type d’opération, demandeur, année. Une opération = un projet sur une **zone/localisation** donnée, à l’échelle d’une commune.
- **Chantiers** (chantiers.xlsx) : planification de travaux dans le temps. Champs : N° chantier/opération, État, **Début**, **Fin**, **Commune**, **Libellé** (ex. « Saint Blaise Place de l’Eglise », « BD Théodore Roosevelt - Rénovation éclairage public »), page. Un chantier = une tranche de travaux planifiée, avec une commune et un libellé descriptif (lieu ou thème).

**Problème : lien par commune peu précis**

Avec les données actuelles, le seul lien géographique exploitable entre chantiers/opérations et conduites est la **commune**. Cela signifie « toutes les conduites de la commune » et non « les conduites concernées par ce chantier / cette opération ». Pour votre objectif (priorisation, plan de rénovation), c’est effectivement **trop peu précis**.

**Ce qu’il manque dans les Excel pour être plus précis :**

| Besoin | Présent dans les Excel ? |
|--------|---------------------------|
| **Coordonnées** (XY ou lat/lon) du chantier ou de l’opération | **Non** — pas de champ coordonnées. |
| **Quartier / secteur** (ex. code ou libellé) | **Non** — pas de champ quartier ou secteur. |
| **Adresse ou lieu** plus fin que la commune | **Partiel** — **Localisation** (Operations) et **Libellé** (chantiers) donnent une description textuelle (voie, place, etc.) mais pas de coordonnées ni de code quartier. |

**Côté wMain (conduites)** : on dispose de **COMMUNE**, **ADRESSE**, **INSEE**, **UDI** (secteur de gestion), **SECTORISAT** — donc une conduite peut être rattachée à une adresse, un UDI, un secteur. Mais les chantiers/opérations n’ont pas de champ « quartier » ou « UDI » à croiser directement.

**Pistes pour améliorer la précision (à demander / faire) :**

1. **Demander à Eau d’Azur** :  
   - **Coordonnées** des chantiers ou des opérations (point ou zone), ou  
   - Un champ **quartier / secteur / UDI** (ou code adresse) dans les Excel, pour faire une jointure avec wMain (UDI, ADRESSE, SECTORISAT, etc.).

2. **Geocodage** : à partir de **Commune + Localisation** (Operations) ou **Commune + Libellé** (chantiers), faire du géocodage (adresse → coordonnées) puis, en base, rapprocher par proximité spatiale avec les conduites (intersection ou distance). Possible mais à valider (qualité des libellés, coût API).

3. **Appariement texte** : tenter de faire correspondre **Localisation / Libellé** avec **ADRESSE** (wMain) dans la même commune. Fragile (formats différents, fautes de frappe) mais peut donner des pistes sans données supplémentaires.

**En base SQL** : tant qu’on n’a pas coordonnées ou quartier/secteur côté chantiers/opérations, la jointure reste **par commune**. Dès qu’Eau d’Azur fournit des coordonnées ou un code quartier/secteur/UDI, on pourra ajouter une table ou des colonnes dédiées et faire un lien plus précis (par point, par polygone secteur, ou par UDI). Pour un lien direct « cette opération concerne ce tronçon », il faudrait soit un champ commun (à identifier), soit une table de liaison fournie par le client.

---

### 7.3 Lien coordonnées (Lambert) et adresse (reverse geocoding)

**Oui**, on peut faire le lien entre les coordonnées des conduites (géométrie en **Lambert 93**, EPSG:2154) et une **adresse** (libellé de voie, code postal, commune). C’est le **reverse geocoding** : (X, Y) → adresse.

**Principe :**

1. **Reprojection** : les APIs d’adresse utilisent en général **WGS84** (lat/lon). Il faut donc convertir Lambert 93 → WGS84 (avec **pyproj** ou GeoPandas : `gdf.to_crs(4326)`).
2. **Point à interroger** : pour une conduite (ligne), on prend par exemple le **centroïde** de la géométrie ou le **premier sommet** de la ligne, puis on le convertit en (latitude, longitude).
3. **Appel API** : envoi (lat, lon) à un service de reverse geocoding ; la réponse contient l’adresse (voie, numéro, code postal, commune, etc.).

**Services utilisables (gratuits, adaptés à la France) :**

| Service | URL / usage | Remarque |
|--------|-------------|----------|
| **BAN (Base Adresse Nationale)** | `GET https://api-adresse.data.gouv.fr/reverse/?lon=<lon>&lat=<lat>` | Données officielles françaises, pas de clé API. Idéal pour la France. |
| **Nominatim (OpenStreetMap)** | `GET https://nominatim.openstreetmap.org/reverse?lat=...&lon=...` | Mondial, gratuit ; respecter la politique d’usage (voir ci‑dessous). |

**Limites d’usage (à jour au moment de la rédaction) :**

| Service | Gratuit ? | Limite principale | Au‑delà |
|--------|-----------|-------------------|--------|
| **BAN** (api-adresse.data.gouv.fr) | Oui | **50 requêtes / seconde / adresse IP** | HTTP 429 (Too Many Requests), retry après 5 s. Pas de plafond journalier indiqué pour un usage standard. |
| **Nominatim** (nominatim.openstreetmap.org) | Oui | **1 requête / seconde** maximum (politique stricte) ; usage « bulk » (grand volume) déconseillé | Blocage / bannissement possible. Obligation : **User-Agent** ou **Referer** identifiant l’application, **attribution** OSM, **cache** des résultats en bulk. Une seule machine, un seul thread pour du reverse geocoding en masse. |

**BAN :** pour des volumes très importants, une levée de limite peut être demandée (contact IGN / Géoplateforme). L’API BAN historique est progressivement migrée vers la Géoplateforme (geoservices.ign.fr) ; vérifier les URLs et conditions à date.

**Nominatim :** pour de gros volumes, la fondation OSM recommande d’installer sa propre instance Nominatim ou d’utiliser un fournisseur commercial. Voir [Usage Policy](https://operations.osmfoundation.org/policies/nominatim/).

**Exemple de chaîne (Python) :**  
Lire la géométrie WKT d’une conduite → la convertir en objet Shapely/GeoPandas en Lambert 93 → reprojeter en WGS84 → extraire (lon, lat) du centroïde → requête HTTP vers l’API BAN → parser le JSON pour récupérer `label` (adresse complète), `postcode`, `city`, etc. On peut ensuite stocker l’adresse obtenue dans une colonne dérivée ou une table dédiée.

**Limites :** précision dépendant du fond de plan (BAN = adresses cadastrées / livraison), délai et quotas si on interroge en masse (mieux vaut batch + cache). Pour des lignes longues, le centroïde peut être éloigné de l’adresse « physique » ; on peut aussi tester plusieurs points le long de la ligne et garder la meilleure réponse.

---

## 8. Rappel : découvrir / mettre à jour les liens

- **Longueur** : déjà vérifiée (identique wMain / pipe_ranking sur les FACILITYID communs).  
- **UDI** : wMain_UDI_* = même schéma que wMain (extraits) ; UDI_*_2 / UDI_Moyen_Pays = couches secteurs (Secteur, Shape_Area).  
- **Operations / Chantiers** : colonnes documentées ; liens proposés via **Commune**. Pour affiner (ex. lien opération ↔ tronçon précis), ouvrir les fichiers et croiser des exemples (IdProjet, N° chantier, NUM_OP dans wMain, etc.).

Pour régénérer la liste des colonnes (notamment après évolution des fichiers) :  
`python python/read_schema.py` (avec `openpyxl` et accès aux `.dbf`).

---

## 9. Visualisation cartographique

**Oui** : avec les données actuelles on peut afficher polygones (secteurs UDI), conduites et abandonnées sur une carte. Tous les shapefiles ont un fichier **.prj** (Lambert 93), donc les géométries sont géoréférencées.

### Options

| Outil | Usage |
|-------|--------|
| **QGIS** | Ouvrir directement les `.shp` (Fichier → Ouvrir). Idéal pour explorer et composer des cartes. |
| **Python (GeoPandas + Matplotlib)** | Charger les shapefiles, afficher avec `gdf.plot()`. Voir `python/visualiser_carte.py`. |
| **Web (Leaflet / Folium)** | GeoPandas peut exporter en GeoJSON ; à utiliser dans une carte interactive (web app). |

### Script fourni

Le script `python/visualiser_carte.py` trace les polygones **Littoral** et **Moyen Pays** et un échantillon des conduites, puis enregistre une image dans `docs/carte_exemple.png`.  
Commande : `python python/visualiser_carte.py` (après `pip install geopandas matplotlib`).

### GeoPandas, export GeoJSON et web app

- **GeoPandas** est une librairie **Python** : elle sert à lire les shapefiles (`.shp`), les manipuler et les exporter (GeoJSON, etc.). Elle s’utilise côté **script / backend**, pas dans le navigateur.

- **Export GeoJSON une seule fois ?**  
  Oui, si les **données sources (shapefiles) ne changent pas** : vous faites **un export** shapefiles → GeoJSON (ou shapefiles → base SQLite avec géométrie), et la web app consomme uniquement le GeoJSON (ou la base). Vous n’avez pas besoin de ré-exporter tant que les shapefiles ne sont pas mis à jour.

- **Quand refaire un export ?**  
  Dès qu’**Eau d’Azur met à jour** les shapefiles (nouveaux tronçons, abandonnées, secteurs), il faut **rejouer** l’export (ou un script ETL) pour que la carte et la base restent à jour. On peut donc prévoir un script d’import/export à lancer à chaque nouvelle livraison de données.

- **Rôle dans la web app** :  
  - Soit la web app **ne fait jamais tourner GeoPandas** : vous exportez une fois (ou périodiquement) en GeoJSON (ou vous remplissez une base SQLite avec les géométries), et le front affiche ces données.  
  - Soit le **backend** utilise GeoPandas pour générer du GeoJSON à la volée (utile si les shapefiles sont rechargés souvent).  
  En pratique, un **export initial** (ou après chaque mise à jour des données) suffit souvent ; la web app lit ensuite uniquement le GeoJSON ou la base.
