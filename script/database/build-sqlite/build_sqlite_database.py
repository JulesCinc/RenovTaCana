"""
Script RenovTaCana : construit la base SQLite applicative complete.

Tables generees :
- conduites (source shapefiles + enrichissements)
- canalisations (schema API historique)
- chantiers (depuis data/chantiers.xlsx)
- operations (depuis data/Operations.xlsx)

A executer depuis la racine du projet :
python script/database/build-sqlite/build_sqlite_database.py
"""
import os
import re
import shutil
import sqlite3
import unicodedata
from datetime import datetime

# Racine du projet (au-dessus de script/database/build-sqlite/)
BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
DATA_DIR = os.path.join(BASE_DIR, "data")
PIPE_RANKING_CSV = os.path.join(DATA_DIR, "pipe_ranking_v1_clear.csv")
CHANTIERS_XLSX = os.path.join(DATA_DIR, "chantiers.xlsx")
OPERATIONS_XLSX = os.path.join(DATA_DIR, "Operations.xlsx")
OUT_DB = os.path.join(BASE_DIR, "database", "renovTaCana.db")
OUTDATED_DIR = os.path.join(BASE_DIR, "database", "outdated")


# Liste des colonnes CONDUITES (ordre et types pour CREATE TABLE)
CONDUITES_COLUMNS = [
    ("FACILITYID", "TEXT PRIMARY KEY"),
    ("abandoned", "INTEGER NOT NULL"),
    ("longueur", "REAL"),
    ("COMMUNE", "TEXT"),
    ("INSEE", "TEXT"),
    ("UDI", "TEXT"),
    ("NUM_OP", "TEXT"),
    ("OBJECTID", "INTEGER"),
    ("DIAMETER", "REAL"),
    ("DIAMEXT", "REAL"),
    ("PRECISIOND", "TEXT"),
    ("MATERIAL", "TEXT"),
    ("PRECISIONM", "TEXT"),
    ("INSTALLDAT", "TEXT"),
    ("PRECISIONI", "TEXT"),
    ("PERIODE_PO", "TEXT"),
    ("WATERTYPE", "TEXT"),
    ("DOMAINE", "TEXT"),
    ("FONCTION", "TEXT"),
    ("SENSIBILIT", "TEXT"),
    ("PRESSION", "TEXT"),
    ("OSSATURE", "TEXT"),
    ("CONTRAT", "TEXT"),
    ("ADRESSE", "TEXT"),
    ("COTE_TN", "REAL"),
    ("PROFONDEUR", "REAL"),
    ("JOINT", "TEXT"),
    ("EMPLACEMEN", "TEXT"),
    ("LITDEPOSE", "TEXT"),
    ("TYPE_SOL", "TEXT"),
    ("ETAT_SOL", "TEXT"),
    ("TRAFIC", "TEXT"),
    ("ENVIR_ELEC", "TEXT"),
    ("NB_BRANCHE", "INTEGER"),
    ("FABRICANT", "TEXT"),
    ("TECHNIQUE_", "TEXT"),
    ("PROTECT_IN", "TEXT"),
    ("PROTECT_EX", "TEXT"),
    ("PROTECT_CA", "TEXT"),
    ("DEPOT", "TEXT"),
    ("CORROSION", "TEXT"),
    ("VALEUR_NEU", "REAL"),
    ("TRANSMISS", "TEXT"),
    ("LASTUPDATE", "TEXT"),
    ("LASTEDITOR", "TEXT"),
    ("ENABLED", "TEXT"),
    ("ACTIVEFLAG", "TEXT"),
    ("OWNEDBY", "TEXT"),
    ("MAINTBY", "TEXT"),
    ("LONGSYS", "REAL"),
    ("COMMENTA", "TEXT"),
    ("MAJ", "TEXT"),
    ("ETAGPRESSI", "TEXT"),
    ("IDADRESS", "TEXT"),
    ("SECTORISAT", "TEXT"),
    ("PRECISLOCA", "TEXT"),
    ("CLASSE_DIC", "TEXT"),
    ("NOMCANAUX", "TEXT"),
    ("SAISIE", "TEXT"),
    ("SYMBOLOGIE", "TEXT"),
    ("TYPE_POSE", "TEXT"),
    ("DN", "TEXT"),
    ("PROTECATHO", "TEXT"),
    ("REGULATEUR", "TEXT"),
    ("AGENCE", "TEXT"),
    ("COMMENTA_D", "TEXT"),
    ("PROSP_RENO", "TEXT"),
    ("MAJREFGEOM", "TEXT"),
    ("DATEMAJGEO", "TEXT"),
    ("CONVENTION", "TEXT"),
    ("DATEMAJH", "TEXT"),
    ("SHAPE_Leng", "REAL"),
    ("dense", "TEXT"),
    ("ValoPat", "REAL"),
    ("Vetuste", "TEXT"),
    ("nbFuites", "INTEGER"),
    ("nbAbo", "INTEGER"),
    ("sumConso", "REAL"),
    ("PRESSIONAV", "REAL"),
    ("DEM_EAU_LS", "REAL"),
    ("CATEGORIE_", "TEXT"),
    ("Traffic", "TEXT"),
    ("PrioMerlin", "TEXT"),
    ("TXcasse", "REAL"),
    ("Altimetrie", "TEXT"),
    ("Prediction", "REAL"),
    ("Predicti_1", "REAL"),
    ("ABANDATE", "TEXT"),
    ("HS_CAUSE", "TEXT"),
    ("CAUSECOM", "TEXT"),
    ("FACILITYKE", "TEXT"),
    ("LINETYPE", "TEXT"),
    # REVIEW :
    # ajout des coordonnées lat/lon pour permettre l'affichage
    # des conduites sur la heatmap côté frontend.
    # Le centroïde est utilisé pour représenter chaque tronçon.
    ("lat", "REAL"),
    ("lon", "REAL"),
    ("geometry", "TEXT"),
]
COL_NAMES = [c[0] for c in CONDUITES_COLUMNS]


def _to_wkt(geom):
    if geom is None or (hasattr(geom, "is_empty") and geom.is_empty):
        return None
    return geom.wkt if hasattr(geom, "wkt") else None


def normalize_text(value):
    if value is None:
        return ""
    text = str(value).strip().lower()
    text = unicodedata.normalize("NFD", text)
    text = "".join(ch for ch in text if unicodedata.category(ch) != "Mn")
    text = re.sub(r"[^a-z0-9]+", "", text)
    return text


def find_first_file(root_dir, target_name):
    for root, _, files in os.walk(root_dir):
        for filename in files:
            if filename.lower() == target_name.lower():
                return os.path.join(root, filename)
    return None


def archive_existing_db(db_path, archive_dir):
    """Archive la base existante dans database/outdated avec timestamp de derniere modif."""
    if not os.path.exists(db_path):
        return

    os.makedirs(archive_dir, exist_ok=True)
    mtime = datetime.fromtimestamp(os.path.getmtime(db_path)).strftime("%Y%m%d_%H%M%S")
    archived_name = f"renovTaCana_{mtime}.db"
    archived_path = os.path.join(archive_dir, archived_name)

    # Evite collision si plusieurs archives partagent le meme timestamp.
    suffix = 1
    while os.path.exists(archived_path):
        archived_path = os.path.join(archive_dir, f"renovTaCana_{mtime}_{suffix}.db")
        suffix += 1

    shutil.move(db_path, archived_path)
    print("Ancienne base archivee:", archived_path)


def main():
    import geopandas as gpd
    import pandas as pd
    import numpy as np

    os.makedirs(os.path.dirname(OUT_DB), exist_ok=True)

    wmain_shp = find_first_file(DATA_DIR, "wMain.shp")
    wabandoned_shp = find_first_file(DATA_DIR, "wAbandonedLine.shp")
    if not wmain_shp:
        print("Fichier introuvable: wMain.shp sous", DATA_DIR)
        return 1
    if not wabandoned_shp:
        print("Fichier introuvable: wAbandonedLine.shp sous", DATA_DIR)
        return 1

    print("Lecture wMain...")
    gdf_main = gpd.read_file(wmain_shp)
    print("Lecture wAbandonedLine...")
    gdf_ab = gpd.read_file(wabandoned_shp)

    # --- wMain -> DataFrame CONDUITES ---
    df_main = gdf_main.copy()
    df_main["abandoned"] = 0
    if "longueur" not in df_main.columns:
        df_main["longueur"] = df_main.get("SHAPE_Leng")
    # Conversion géométrie
    df_main["geometry"] = gdf_main.geometry.apply(_to_wkt)
    # Coordonnées pour la heatmap (centroïde)
    df_main["lat"] = gdf_main.geometry.centroid.y
    df_main["lon"] = gdf_main.geometry.centroid.x
    df_main = df_main.reindex(columns=COL_NAMES)

    # --- wAbandonedLine -> DataFrame CONDUITES ---
    df_ab = gdf_ab.copy()
    df_ab["abandoned"] = 1
    df_ab["geometry"] = gdf_ab.geometry.apply(_to_wkt)
    # Coordonnées pour la heatmap
    df_ab["lat"] = gdf_ab.geometry.centroid.y
    df_ab["lon"] = gdf_ab.geometry.centroid.x

    df_ab = df_ab.rename(columns={"DEPOSE": "DEPOT"})
    df_ab = df_ab.reindex(columns=COL_NAMES)

    # --- Gestion des doublons ---
    # Règle : un seul enregistrement par FACILITYID (clé primaire). En cas de conflit, on garde
    # 1) la ligne "en service" (wMain) plutôt qu'abandonnée ;
    # 2) parmi les doublons, celle dont le risque de casse est le plus élevé (probabilite_casse ou TXcasse).
    n_main = len(df_main)
    n_ab = len(df_ab)
    dup_main = df_main["FACILITYID"].duplicated().sum()
    dup_ab = df_ab["FACILITYID"].duplicated().sum()
    common_id = set(df_main["FACILITYID"].dropna()) & set(df_ab["FACILITYID"].dropna())

    df = pd.concat([df_main, df_ab], ignore_index=True)
    n_before = len(df)

    # Colonne "_risk" pour tri des doublons : ON UTILISE probabilite_casse (pipe_ranking) LORSQU'ELLE EST
    # PRESENTE ; à défaut seulement on se base sur TXcasse (wMain, catégoriel : Négligeable, Faible, etc.).
    if os.path.exists(PIPE_RANKING_CSV):
        pr = pd.read_csv(PIPE_RANKING_CSV, usecols=["FACILITYID", "probabilite_casse"])
        pr = pr.drop_duplicates(subset=["FACILITYID"], keep="first")
        df = df.merge(pr[["FACILITYID", "probabilite_casse"]], on="FACILITYID", how="left", suffixes=("", "_pr"))
        if "probabilite_casse_pr" in df.columns:
            df["probabilite_casse"] = df["probabilite_casse_pr"].fillna(df["probabilite_casse"])
            df = df.drop(columns=["probabilite_casse_pr"])
    if "probabilite_casse" not in df.columns:
        df["probabilite_casse"] = np.nan
    # Risque numérique : priorité à probabilite_casse ; si absente, score dérivé de TXcasse (texte)
    tx_to_score = {
        "Négligeable": 0.0, "Negligeable": 0.0,
        "Faible": 0.25,
        "Moyen": 0.5,
        "Important": 0.75,
        "Très important": 1.0, "Tres important": 1.0,
    }
    tx_raw = df.get("TXcasse", pd.Series(np.nan, index=df.index))
    tx_score = tx_raw.map(tx_to_score) if tx_raw.dtype == object else pd.Series(np.nan, index=df.index)
    df["_risk"] = df["probabilite_casse"].fillna(tx_score)
    df = df.sort_values(by=["abandoned", "_risk"], ascending=[True, False], na_position="last")
    df = df.drop(columns=["_risk"], errors="ignore")
    if "probabilite_casse" in df.columns and "probabilite_casse" not in COL_NAMES:
        df = df.drop(columns=["probabilite_casse"], errors="ignore")
    df = df.drop_duplicates(subset=["FACILITYID"], keep="first")
    n_after = len(df)
    n_dropped = n_before - n_after

    if dup_main > 0 or dup_ab > 0 or common_id or n_dropped > 0:
        print("Doublons traites (ligne conservee = risque de casse le plus eleve) :")
        if dup_main > 0:
            print(f"  - wMain : {dup_main} lignes en doublon (FACILITYID) -> 1 conservee par ID (max risque)")
        if dup_ab > 0:
            print(f"  - wAbandonedLine : {dup_ab} lignes en doublon (FACILITYID) -> 1 conservee par ID (max risque)")
        if common_id:
            print(f"  - FACILITYID presents dans les deux jeux : {len(common_id)} -> conservee la ligne wMain (en service)")
        if n_dropped > 0:
            print(f"  - Total lignes supprimees par dedoublonnage : {n_dropped}")

    print("Creation de la base SQLite:", OUT_DB)
    os.makedirs(os.path.dirname(OUT_DB), exist_ok=True)
    archive_existing_db(OUT_DB, OUTDATED_DIR)
    conn = sqlite3.connect(OUT_DB)
    cur = conn.cursor()

    col_defs = ", ".join(f'"{c[0]}" {c[1]}' for c in CONDUITES_COLUMNS)
    cur.execute(f'CREATE TABLE IF NOT EXISTS conduites ({col_defs})')
    # REVIEW :
    # création d'index pour accélérer les requêtes utilisées par le backend
    # (filtrage par commune, recherche de conduite, statut abandonné)
    cur.execute("CREATE INDEX IF NOT EXISTS idx_facilityid ON conduites(FACILITYID)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_commune ON conduites(COMMUNE)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_abandoned ON conduites(abandoned)")

    # Insert par batch avec executemany
    placeholders = ", ".join(["?" for _ in COL_NAMES])
    cols = ", ".join(f'"{c}"' for c in COL_NAMES)
    sql = f"INSERT OR REPLACE INTO conduites ({cols}) VALUES ({placeholders})"
    rows = df[COL_NAMES].replace({np.nan: None}).to_numpy().tolist()
    cur.executemany(sql, rows)

    # --- Table canalisations (schema API historique) ---
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS canalisations (
            facilityid      TEXT PRIMARY KEY,
            adresse         TEXT,
            commune         TEXT,
            commune_insee   INTEGER,
            materiau        TEXT,
            diametre        REAL,
            longueur        REAL,
            annee_pose      INTEGER,
            nb_fuites       INTEGER,
            vetuste         REAL,
            categorie       INTEGER,
            anciennete      TEXT,
            densite         TEXT,
            criticite       REAL,
            score_priorite  REAL
        )
        """
    )

    tx_to_score = {
        "Négligeable": 5.0,
        "Negligeable": 5.0,
        "Faible": 25.0,
        "Moyen": 50.0,
        "Important": 75.0,
        "Très important": 95.0,
        "Tres important": 95.0,
    }

    df_can = df.copy()
    install_year = pd.to_numeric(df_can["INSTALLDAT"], errors="coerce")
    pred = pd.to_numeric(df_can["Predicti_1"], errors="coerce")
    tx_score = df_can["TXcasse"].map(tx_to_score) if "TXcasse" in df_can.columns else np.nan
    criticite = pred.mul(100.0).fillna(tx_score)
    score_priorite = criticite.fillna(0.0)

    can_df = pd.DataFrame(
        {
            "facilityid": df_can["FACILITYID"],
            "adresse": df_can["ADRESSE"],
            "commune": df_can["COMMUNE"],
            "commune_insee": pd.to_numeric(df_can["INSEE"], errors="coerce"),
            "materiau": df_can["MATERIAL"],
            "diametre": pd.to_numeric(df_can["DIAMETER"], errors="coerce"),
            "longueur": pd.to_numeric(df_can["longueur"], errors="coerce"),
            "annee_pose": install_year,
            "nb_fuites": pd.to_numeric(df_can["nbFuites"], errors="coerce"),
            "vetuste": pd.to_numeric(df_can["Vetuste"], errors="coerce"),
            "categorie": pd.to_numeric(df_can["CATEGORIE_"], errors="coerce"),
            "anciennete": df_can["PERIODE_PO"],
            "densite": df_can["dense"],
            "criticite": criticite,
            "score_priorite": score_priorite,
        }
    )

    can_cols = list(can_df.columns)
    can_placeholders = ", ".join(["?" for _ in can_cols])
    can_sql = f"INSERT OR REPLACE INTO canalisations ({', '.join(can_cols)}) VALUES ({can_placeholders})"
    can_rows = can_df.replace({np.nan: None}).to_numpy().tolist()
    cur.executemany(can_sql, can_rows)

    # --- Table chantiers depuis Excel ---
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS chantiers (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            num_op      TEXT,
            etat        TEXT,
            date_debut  TEXT,
            date_fin    TEXT,
            commune     TEXT,
            libelle     TEXT,
            page        INTEGER
        )
        """
    )
    if os.path.exists(CHANTIERS_XLSX):
        ch_df = pd.read_excel(CHANTIERS_XLSX, sheet_name=0)
        header_map = {c: normalize_text(c) for c in ch_df.columns}
        rev = {v: k for k, v in header_map.items()}
        mapped = pd.DataFrame(
            {
                "num_op": ch_df[rev.get("nchantieroperation")] if rev.get("nchantieroperation") else None,
                "etat": ch_df[rev.get("etat")] if rev.get("etat") else None,
                "date_debut": ch_df[rev.get("debut")] if rev.get("debut") else None,
                "date_fin": ch_df[rev.get("fin")] if rev.get("fin") else None,
                "commune": ch_df[rev.get("commune")] if rev.get("commune") else None,
                "libelle": ch_df[rev.get("libelle")] if rev.get("libelle") else None,
                "page": pd.to_numeric(ch_df[rev.get("page")], errors="coerce") if rev.get("page") else None,
            }
        )
        mapped = mapped.where(pd.notnull(mapped), None)
        cur.executemany(
            "INSERT INTO chantiers (num_op, etat, date_debut, date_fin, commune, libelle, page) VALUES (?, ?, ?, ?, ?, ?, ?)",
            mapped.to_records(index=False).tolist(),
        )
    else:
        print("Attention: fichier manquant", CHANTIERS_XLSX)

    # --- Table operations depuis Excel ---
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS operations (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            id_projet       INTEGER,
            titre           TEXT,
            commune         TEXT,
            localisation    TEXT,
            type_op         TEXT,
            demandeur       TEXT,
            annee           TEXT,
            cpi             TEXT
        )
        """
    )
    if os.path.exists(OPERATIONS_XLSX):
        op_df = pd.read_excel(OPERATIONS_XLSX, sheet_name=0)
        header_map = {c: normalize_text(c) for c in op_df.columns}
        rev = {v: k for k, v in header_map.items()}
        mapped = pd.DataFrame(
            {
                "id_projet": pd.to_numeric(op_df[rev.get("idprojet")], errors="coerce") if rev.get("idprojet") else None,
                "titre": op_df[rev.get("titre")] if rev.get("titre") else op_df[rev.get("projettitre")] if rev.get("projettitre") else None,
                "commune": op_df[rev.get("idcommune")] if rev.get("idcommune") else None,
                "localisation": op_df[rev.get("localisation")] if rev.get("localisation") else None,
                "type_op": op_df[rev.get("operationtype1")] if rev.get("operationtype1") else None,
                "demandeur": op_df[rev.get("demandeur1")] if rev.get("demandeur1") else None,
                "annee": op_df[rev.get("operationannee")] if rev.get("operationannee") else None,
                "cpi": op_df[rev.get("cpi")] if rev.get("cpi") else None,
            }
        )
        mapped = mapped.where(pd.notnull(mapped), None)
        cur.executemany(
            "INSERT INTO operations (id_projet, titre, commune, localisation, type_op, demandeur, annee, cpi) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            mapped.to_records(index=False).tolist(),
        )
    else:
        print("Attention: fichier manquant", OPERATIONS_XLSX)

    conn.commit()
    cur.execute("SELECT COUNT(*) FROM conduites")
    n_conduites = cur.fetchone()[0]
    cur.execute("SELECT COUNT(*) FROM canalisations")
    n_canalisations = cur.fetchone()[0]
    cur.execute("SELECT COUNT(*) FROM chantiers")
    n_chantiers = cur.fetchone()[0]
    cur.execute("SELECT COUNT(*) FROM operations")
    n_operations = cur.fetchone()[0]
    conn.close()

    print("Tables generees: conduites, canalisations, chantiers, operations.")
    print("Base SQLite prete pour utilisation backend / frontend.")
    print(f"  conduites: {n_conduites}")
    print(f"  canalisations: {n_canalisations}")
    print(f"  chantiers: {n_chantiers}")
    print(f"  operations: {n_operations}")
    return 0


if __name__ == "__main__":
    exit(main())
