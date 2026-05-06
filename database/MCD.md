# MCD - Base `renovTaCana.db`

Ce document decrit le modele conceptuel de donnees de `database/renovTaCana.db`.

## Vue d'ensemble

Tables metier presentes :

- `conduites`
- `canalisations`
- `chantiers`
- `operations`

## Diagramme MCD (Mermaid)

```mermaid
erDiagram
    CONDUITES {
        TEXT FACILITYID PK
        INTEGER abandoned
        REAL longueur
        TEXT COMMUNE
        TEXT NUM_OP
        REAL DIAMETER
        TEXT MATERIAL
        TEXT ADRESSE
        REAL Predicti_1
        TEXT TXcasse
        REAL lat
        REAL lon
        TEXT geometry
    }

    CANALISATIONS {
        TEXT facilityid PK
        TEXT adresse
        TEXT commune
        INTEGER commune_insee
        TEXT materiau
        REAL diametre
        REAL longueur
        INTEGER annee_pose
        INTEGER nb_fuites
        REAL vetuste
        INTEGER categorie
        TEXT anciennete
        TEXT densite
        REAL criticite
        REAL score_priorite
    }

    CHANTIERS {
        INTEGER id PK
        TEXT num_op
        TEXT etat
        TEXT date_debut
        TEXT date_fin
        TEXT commune
        TEXT libelle
        INTEGER page
    }

    OPERATIONS {
        INTEGER id PK
        INTEGER id_projet
        TEXT titre
        TEXT commune
        TEXT localisation
        TEXT type_op
        TEXT demandeur
        TEXT annee
        TEXT cpi
    }

    CONDUITES }o--|| CANALISATIONS : "FACILITYID -> facilityid (logique)"
    CHANTIERS }o--o{ CANALISATIONS : "num_op (metier)"
    OPERATIONS }o--o{ CHANTIERS : "id_projet / num_op (metier)"
```

## Notes

- Les liens affiches sont des **relations metier** (logiques) ; ils ne sont pas declares en cles etrangeres SQL dans la base actuelle.
- `conduites` est la table source enrichie (SIG/ETL).
- `canalisations`, `chantiers`, `operations` correspondent au schema applicatif utilise par les routes API historiques.

## Liste exhaustive des colonnes de `conduites`

- `FACILITYID` (PK)
- `abandoned`
- `longueur`
- `COMMUNE`
- `INSEE`
- `UDI`
- `NUM_OP`
- `OBJECTID`
- `DIAMETER`
- `DIAMEXT`
- `PRECISIOND`
- `MATERIAL`
- `PRECISIONM`
- `INSTALLDAT`
- `PRECISIONI`
- `PERIODE_PO`
- `WATERTYPE`
- `DOMAINE`
- `FONCTION`
- `SENSIBILIT`
- `PRESSION`
- `OSSATURE`
- `CONTRAT`
- `ADRESSE`
- `COTE_TN`
- `PROFONDEUR`
- `JOINT`
- `EMPLACEMEN`
- `LITDEPOSE`
- `TYPE_SOL`
- `ETAT_SOL`
- `TRAFIC`
- `ENVIR_ELEC`
- `NB_BRANCHE`
- `FABRICANT`
- `TECHNIQUE_`
- `PROTECT_IN`
- `PROTECT_EX`
- `PROTECT_CA`
- `DEPOT`
- `CORROSION`
- `VALEUR_NEU`
- `TRANSMISS`
- `LASTUPDATE`
- `LASTEDITOR`
- `ENABLED`
- `ACTIVEFLAG`
- `OWNEDBY`
- `MAINTBY`
- `LONGSYS`
- `COMMENTA`
- `MAJ`
- `ETAGPRESSI`
- `IDADRESS`
- `SECTORISAT`
- `PRECISLOCA`
- `CLASSE_DIC`
- `NOMCANAUX`
- `SAISIE`
- `SYMBOLOGIE`
- `TYPE_POSE`
- `DN`
- `PROTECATHO`
- `REGULATEUR`
- `AGENCE`
- `COMMENTA_D`
- `PROSP_RENO`
- `MAJREFGEOM`
- `DATEMAJGEO`
- `CONVENTION`
- `DATEMAJH`
- `SHAPE_Leng`
- `dense`
- `ValoPat`
- `Vetuste`
- `nbFuites`
- `nbAbo`
- `sumConso`
- `PRESSIONAV`
- `DEM_EAU_LS`
- `CATEGORIE_`
- `Traffic`
- `PrioMerlin`
- `TXcasse`
- `Altimetrie`
- `Prediction`
- `Predicti_1`
- `ABANDATE`
- `HS_CAUSE`
- `CAUSECOM`
- `FACILITYKE`
- `LINETYPE`
- `lat`
- `lon`
- `geometry`
