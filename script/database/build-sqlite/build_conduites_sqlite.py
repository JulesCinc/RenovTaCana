"""
Script RenovTaCana : crée une base SQLite contenant la table CONDUITES
(unification wMain = en service, wAbandonedLine = abandonnées, clé abandoned 0/1).
À exécuter depuis la racine du projet : python script/database/build-sqlite/build_conduites_sqlite.py
"""
import os
import sqlite3
import shutil
from datetime import datetime

# Racine du projet (au-dessus de script/database/build-sqlite/)
BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
DATA_DIR = os.path.join(BASE_DIR, "data")
WMAIN_SHP = os.path.join(DATA_DIR, "conduites", "wMain.shp")
WABANDONED_SHP = os.path.join(DATA_DIR, "Abandonned_Lines", "wAbandonedLine.shp")
PIPE_RANKING_CSV = os.path.join(DATA_DIR, "pipe_ranking_v1_clear.csv")
# Base créée dans le dossier database/ sous le nom renovTaCana.db
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

    if not os.path.exists(WMAIN_SHP):
        print("Fichier introuvable:", WMAIN_SHP)
        return 1
    if not os.path.exists(WABANDONED_SHP):
        print("Fichier introuvable:", WABANDONED_SHP)
        return 1

    print("Lecture wMain...")
    gdf_main = gpd.read_file(WMAIN_SHP)
    print("Lecture wAbandonedLine...")
    gdf_ab = gpd.read_file(WABANDONED_SHP)

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
    ab_map = {
        "FACILITYID": "FACILITYID",
        "longueur": "SHAPE_Leng",
        "COMMUNE": "COMMUNE",
        "NUM_OP": "NUM_OP",
        "DIAMETER": "DIAMETER",
        "MATERIAL": "MATERIAL",
        "INSTALLDAT": "INSTALLDAT",
        "WATERTYPE": "WATERTYPE",
        "FONCTION": "FONCTION",
        "LASTUPDATE": "LASTUPDATE",
        "LASTEDITOR": "LASTEDITOR",
        "SAISIE": "SAISIE",
        "MAINTBY": "MAINTBY",
        "DEPOT": "DEPOSE",
        "SHAPE_Leng": "SHAPE_Leng",
        "ABANDATE": "ABANDATE",
        "HS_CAUSE": "HS_CAUSE",
        "CAUSECOM": "CAUSECOM",
        "FACILITYKE": "FACILITYKE",
        "LINETYPE": "LINETYPE",
    }
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

    print("Création de la base SQLite:", OUT_DB)
    # REVIEW :
    # on s'assure que le dossier database existe avant de créer la base
    # sinon sqlite3.connect peut échouer si le dossier n'existe pas
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

    conn.commit()
    cur.execute("SELECT COUNT(*) FROM conduites")
    n = cur.fetchone()[0]
    cur.execute("SELECT COUNT(*) FROM conduites WHERE abandoned = 0")
    n0 = cur.fetchone()[0]
    cur.execute("SELECT COUNT(*) FROM conduites WHERE abandoned = 1")
    n1 = cur.fetchone()[0]
    conn.close()

    print("Table 'conduites' créée.")
    print("Base SQLite prête pour utilisation backend / heatmap.")
    print(f"  Total: {n} lignes (en service: {n0}, abandonnées: {n1})")
    return 0


if __name__ == "__main__":
    exit(main())
