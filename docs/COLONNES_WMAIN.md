# Description des colonnes wMain.shp (conduites)

Ce document décrit le **sens probable** de chaque colonne du shapefile wMain, **inféré à partir de l’analyse des données** (valeurs uniques, répartitions, min/max). À utiliser comme référence pour la table SQLite `conduites`.

**Note :** Dans les données, **COMMUNE** et **INSEE** contiennent tous deux le **code commune (5 chiffres)** (ex. 06042, 06046). Le nom de commune (ex. NICE) n’apparaît pas dans wMain ; pour joindre avec Operations/chantiers (IdCommune = nom), il faudra une table de correspondance code INSEE ↔ nom.

---

## Identifiants et localisation

| Colonne | Type observé | Description probable | Exemples / valeurs |
|--------|---------------|----------------------|--------------------|
| **FACILITYID** | TEXT | Identifiant unique du tronçon (clé primaire) | wMain_06042-00254, wMain_06088-28872 |
| **OBJECTID** | NUMERIC | Identifiant interne (non unique : 1 à 3719, réutilisé) | 1, 227, 3719 |
| **COMMUNE** | TEXT | **Code commune INSEE (5 chiffres)** | 06042, 06046, 06088 |
| **INSEE** | TEXT | **Code commune INSEE** (identique à COMMUNE dans les données) | 06042, 06046 |
| **ADRESSE** | TEXT | Voie ou lieu (libellé) | Rue Droite, Chemin de la Colle Germaine |
| **IDADRESS** | TEXT | Identifiant adresse (code) | 06042AA0049, 06088AG0616 |
| **SECTORISAT** | TEXT | Secteur de distribution / zone | CLANS / VILLAGE, COLOMARS / BEGUDE_M7 |
| **UDI** | TEXT | Unité de distribution (secteur de gestion) | CLANS VILLAGE, POLONIA, BS CENTRE |

---

## Caractéristiques physiques de la conduite

| Colonne | Type observé | Description probable | Exemples / valeurs |
|--------|---------------|----------------------|--------------------|
| **DIAMETER** | REAL | Diamètre nominal (mm) | 0–1800, moyenne ~146 |
| **DIAMEXT** | REAL | Diamètre extérieur (mm) | 0–1800, peu renseigné |
| **DN** | REAL | Diamètre nominal (mm), variante ou doublon | 0–1800, moyenne ~154 |
| **longueur** | REAL | Longueur du tronçon (m) | 0,02 – 6101 m |
| **SHAPE_Leng** | REAL | Longueur géométrique (m), ≈ longueur | idem |
| **MATERIAL** | TEXT | Matériau | PE, Fd (fonte ductile?), F (fonte?) — 27 valeurs |
| **JOINT** | TEXT | Type de joint | Automatique, Verrouillé, Soudé, Bonna, Mécanique |
| **LONGSYS** | REAL | Longueur système (?), m | 0 – 6101 |

---

## Pose et historique

| Colonne | Type observé | Description probable | Exemples / valeurs |
|--------|---------------|----------------------|--------------------|
| **INSTALLDAT** | TEXT | Date de pose (datetime) | 1987/01/01, 1970/01/01, 2018/05/01 |
| **PERIODE_PO** | TEXT | Période de pose (fourchette) | 1945-1985, Années 1980s, Avant 1945 |
| **PRECISIOND** | TEXT | Précision / source de l’info **diamètre** | Levé topo, Récolement, Info agent, Déduction |
| **PRECISIONM** | TEXT | Précision / source **matériau** | Levé topo, Récolement, Par importation |
| **PRECISIONI** | TEXT | Précision / source **date de pose** | Par déduction, Fiabilité incertaine, D'après plan de récolement |
| **PRECISLOCA** | TEXT | Précision de la localisation | Levé topo, Récolement, Plan papier, Détection de réseaux |
| **TECHNIQUE_** | TEXT | Technique de pose | Tranchée, Hors sol, Tubage, Galerie, Fourreau |
| **TYPE_POSE** | NUMERIC | Code type de pose (0–4) | 0, 1, 2, 3, 4 |
| **EMPLACEMEN** | TEXT | Emplacement de la conduite | Chaussée, Trottoir (24 valeurs) |
| **LITDEPOSE** | TEXT | Lit de pose | Gravier concassé, Aucun, Autres (très peu renseigné) |
| **TYPE_SOL** | TEXT | Type de sol | perimetre centre ancien, Argile, Roche |
| **ETAT_SOL** | TEXT | État du sol | Humide (1 seule valeur) |

---

## Eau et fonction

| Colonne | Type observé | Description probable | Exemples / valeurs |
|--------|---------------|----------------------|--------------------|
| **WATERTYPE** | TEXT | Type d’eau | Potable, Raw (brute), Non renseigné, Eau Brute (REUT), Treated, Storm |
| **FONCTION** | TEXT | Rôle hydraulique du tronçon | Distribution gravitaire, Transport, Refoulement-distribution, Adduction, Vidange, Bypass, Irrigation |
| **DOMAINE** | TEXT | Domaine (public / privé) | INC (inconnu?), PU (public?), PR (privé?), PU CHEZ PR, Public, Privé |
| **CONTRAT** | TEXT | Contrat / gestion | EAU D'AZUR, DSP SIEVI, EX-CRDV, La Régie Eau d'Azur |
| **OSSATURE** | TEXT | Niveau du réseau | Réseau principal, Réseau secondaire, Réseau tertiaire |

---

## Pression et exploitation

| Colonne | Type observé | Description probable | Exemples / valeurs |
|--------|---------------|----------------------|--------------------|
| **PRESSION** | REAL | Pression nominale (bar?) | 0, 10, 12, 12.5, 16, 20, 25 |
| **PRESSIONAV** | REAL | Pression moyenne (bar?) | -2.28 – 47, moyenne ~7 |
| **ETAGPRESSI** | TEXT | Étage / pression (référence) | Olive_160_160_0, 227, 143 |
| **REGULATEUR** | TEXT | Régulateur / poste associé | Rohière Village, Reg_271 |
| **PROTECATHO** | TEXT | Protection cathodique (poste / zone) | Eze Village, PS COMBES ZP 10 - RP |
| **ENVIR_ELEC** | TEXT | Environnement électrique | Protection cathodique, Inconnu, Autre |

---

## Protection et dépôt

| Colonne | Type observé | Description probable | Exemples / valeurs |
|--------|---------------|----------------------|--------------------|
| **PROTECT_IN** | TEXT | Protection intérieure | (vide dans les données) |
| **PROTECT_EX** | TEXT | Protection extérieure | Autre, Bitumeux |
| **PROTECT_CA** | REAL | Protection cathodique (0/1) | 0, 1 |
| **DEPOT** | TEXT | Dépôt / couche (code?) | 2, 5, 3, 4, Inconnu, Absent |
| **CORROSION** | REAL | Indicateur corrosion (0) | 0 (très peu renseigné) |

---

## Gestion et traçabilité

| Colonne | Type observé | Description probable | Exemples / valeurs |
|--------|---------------|----------------------|--------------------|
| **NUM_OP** | TEXT | Numéro d’opération / chantier | 1713, T_2411_7, 955 |
| **LASTUPDATE** | TEXT | Dernière mise à jour (datetime) | 2022/04/19 09:40:30 |
| **LASTEDITOR** | TEXT | Dernier éditeur (compte) | REA\REA0103, REA\rea0372 |
| **SAISIE** | TEXT | Date de saisie (datetime) | 2018/10/18 15:34:49 |
| **MAJ** | TEXT | Référence de mise à jour | MAJ0500, 059_28, Veolia-aout7 |
| **MAJREFGEOM** | TEXT | Référence de maj géométrie | ddr060103_0423RoquebilliereV3 |
| **DATEMAJGEO** | TEXT | Date de maj géométrie | (1 valeur) |
| **DATEMAJH** | TEXT | Date de maj (?), datetime | 2022/03/17 11:05:26 |
| **OWNEDBY** | NUMERIC | Code propriétaire (1, 2, 3, 4, -1, -2) | 1, 4, -2, -1, 2, 3 |
| **MAINTBY** | NUMERIC | Code maintenu par (entier) | 9, 13, -1, 12, 2, 16 |
| **ENABLED** | REAL | Actif (0/1) | 0, 1 |
| **ACTIVEFLAG** | REAL | Indicateur actif (0/1) | 0, 1 |
| **TRANSMISS** | TEXT | Transmissible (?), Yes/No | Yes, No |
| **CONVENTION** | TEXT | Convention particulière | Digue SMIAGE |

---

## Sensibilité et trafic

| Colonne | Type observé | Description probable | Exemples / valeurs |
|--------|---------------|----------------------|--------------------|
| **SENSIBILIT** | REAL | Sensibilité (0/1), ex. zone sensible | 0, 1 |
| **TRAFIC** | TEXT | Trafic routier (libellé) | Important, Modéré, Faible, Nul, Inconnu |
| **Traffic** | TEXT | Trafic (catégorie détaillée) | traffic moyen - Voie de desserte, traffic fort - Voie de liaison, traffic intense - Voie structurante, traffic faible - Autres |
| **COTE_TN** | REAL | Cote TN (niveau?) en m | 0 – 836 (peu renseigné) |
| **PROFONDEUR** | REAL | Profondeur (m), peut être négative | -80 – 190 |

---

## Indicateurs calculés / métiers

| Colonne | Type observé | Description probable | Exemples / valeurs |
|--------|---------------|----------------------|--------------------|
| **dense** | TEXT | Densité du réseau (zone) | Forte densité, Faible densité |
| **ValoPat** | REAL | Valorisation patrimoniale (€?) | 13.5 – 8e6 |
| **Vetuste** | REAL | Indice de vétusté | 4 – 2.4e6 |
| **nbFuites** | INTEGER | Nombre de fuites (sur le tronçon ou zone) | 0 – 27 |
| **nbAbo** | INTEGER | Nombre d’abonnés (en aval?) | 0 – 839 |
| **sumConso** | REAL | Somme des consommations (m³?) | 0 – 214490 |
| **DEM_EAU_LS** | REAL | Demande en eau (?) | 0 – 6.45 |
| **CATEGORIE_** | REAL | Catégorie (1–9), ex. priorité ou classe | 1, 2, …, 9 |
| **CLASSE_DIC** | TEXT | Classe (dictionnaire) | A, B, C |
| **PrioMerlin** | TEXT | Priorité Merlin (âge / renouvellement) | supérieur à 50 ans, entre 20 et 50 ans, entre 10 et 19 ans, < 10 ans |
| **TXcasse** | TEXT | **Taux / niveau de casse (qualitatif)** | Négligeable, Faible, Moyen, Important, Très important |
| **VALEUR_NEU** | REAL | Valeur à neuf (€?) | 0 – 360 |
| **NB_BRANCHE** | INTEGER | Nombre de branchements | 0 – 56 |
| **NOMCANAUX** | TEXT | Nom du canal / synoptique | Feeder_SADLR_2, FEEDERS RD, SYNOPTIQUE LIT |
| **PROSP_RENO** | REAL | Prospect rénovation (0) | 0 |
| **FABRICANT** | TEXT | Fabricant | Inconnu, RAZEL BEC |
| **COMMENTA** | TEXT | Commentaire libre | SUR L AV VERDUN..., MIXTE, Peut servir de vidange |
| **COMMENTA_D** | TEXT | Commentaire (autre) | VonRoll Hydro, Perte de Signal GNSS |
| **SYMBOLOGIE** | TEXT | Code symbole (couleur / style carte) | 160_160_0, 128_0_128 |
| **AGENCE** | NUMERIC | Code agence (0–3) | 0, 1, 2, 3 |

---

## Géométrie et altitude

| Colonne | Type observé | Description probable | Exemples / valeurs |
|--------|---------------|----------------------|--------------------|
| **Altimetrie** | TEXT | Liste des altitudes (points de la ligne?) | [682.92, 679.79, ...], tableaux de flottants |
| **Prediction** | TEXT | Référence prédiction (FACILITYID?) | wMain_06059-00945 (parfois = FACILITYID) |
| **Predicti_1** | TEXT | Classe prédiction (0/1) | 0, 1 |
| **geometry** | geometry | Géométrie (ligne) | WKT / GeoJSON en base |

---

## Comment régénérer cette description

Exécuter le script d’analyse des données :

```bash
python python/row-data/describe_wmain_columns.py
```

Il affiche pour chaque colonne : non-null, nombre de valeurs uniques, min/max ou exemples, et répartition pour les champs à faible cardinalité.
