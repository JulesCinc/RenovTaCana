"""
RenovTaCana — Backend FastAPI
Base SQLite avec vraies données Métropole Nice Côte d'Azur
"""

from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import sqlite3, os, re
import unicodedata

app = FastAPI(title="RenovTaCana API", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

DB_PATH = os.path.join(os.path.dirname(__file__), "sqlite", "renovtacana.db")


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.create_function("normalize_text", 1, normalize_text)
    return conn


def normalize_text(value):
    if value is None:
        return ""
    text = str(value).strip().lower()
    text = unicodedata.normalize("NFD", text)
    text = "".join(ch for ch in text if unicodedata.category(ch) != "Mn")
    text = re.sub(r"[^a-z0-9\s]", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


# ── CANALISATIONS ─────────────────────────────────────────
ALLOWED_SORT_COLS = {
    "facilityid", "adresse", "materiau", "diametre", "longueur",
    "annee_pose", "nb_fuites", "criticite", "anciennete", "score_priorite"
}

@app.get("/api/canalisations")
def get_canalisations(
    adresse:    str   = Query(default=""),
    commune:    str   = Query(default=""),
    materiau:   str   = Query(default=""),
    anciennete: str   = Query(default=""),
    statut:     str   = Query(default=""),
    search:     str   = Query(default=""),
    crit_min:   float = Query(default=0),
    crit_max:   float = Query(default=100),
    sort_col:   str   = Query(default="score_priorite"),
    sort_dir:   str   = Query(default="desc"),
    limit:      int   = Query(default=100),
    offset:     int   = Query(default=0),
):
    conn = get_db()
    cur  = conn.cursor()

    filters = ["1=1"]
    params  = []

    if adresse:
        filters.append("""
            (
                normalize_text(adresse) LIKE '%' || normalize_text(?) || '%'
                OR normalize_text(adresse || ' ' || COALESCE(commune, '')) LIKE '%' || normalize_text(?) || '%'
            )
        """)
        params.extend([adresse, adresse])
    if commune:
        filters.append("normalize_text(commune) LIKE '%' || normalize_text(?) || '%'")
        params.append(commune)
    if materiau:
        filters.append("materiau = ?")
        params.append(materiau)
    if anciennete:
        filters.append("anciennete = ?")
        params.append(anciennete)
    if search:
        filters.append("LOWER(facilityid) LIKE LOWER(?)")
        params.append(f"%{search}%")
    if statut == "critique":
        filters.append("criticite >= 70")
    elif statut == "attention":
        filters.append("criticite >= 40 AND criticite < 70")
    elif statut == "bon":
        filters.append("(criticite < 40 OR criticite IS NULL)")

    filters.append("(criticite IS NULL OR (criticite >= ? AND criticite <= ?))")
    params += [crit_min, crit_max]

    where = " AND ".join(filters)
    col = sort_col if sort_col in ALLOWED_SORT_COLS else "score_priorite"
    direction = "DESC" if sort_dir == "desc" else "ASC"

    cur.execute(f"SELECT COUNT(*) FROM canalisations WHERE {where}", params)
    total = cur.fetchone()[0]

    cur.execute(f"""
        SELECT facilityid, adresse, commune, materiau, diametre, longueur,
               annee_pose, nb_fuites, vetuste, categorie, anciennete,
               densite, criticite, score_priorite
        FROM canalisations
        WHERE {where}
        ORDER BY {col} {direction} NULLS LAST
        LIMIT ? OFFSET ?
    """, params + [limit, offset])

    rows = [dict(r) for r in cur.fetchall()]
    conn.close()
    return {"total": total, "offset": offset, "limit": limit, "canalisations": rows}


@app.get("/api/adresses/suggestions")
def get_adresse_suggestions(
    q: str = Query(default=""),
    limit: int = Query(default=5, ge=1, le=10),
):
    normalized_query = normalize_text(q)
    if len(normalized_query) < 2:
        return {"query": q, "suggestions": []}

    conn = get_db()
    cur = conn.cursor()

    cur.execute("""
        WITH base AS (
            SELECT
                adresse,
                commune,
                COUNT(*) AS nb,
                normalize_text(adresse) AS n_adresse,
                normalize_text(COALESCE(commune, '')) AS n_commune,
                normalize_text(adresse || ' ' || COALESCE(commune, '')) AS n_full
            FROM canalisations
            WHERE adresse != ''
            GROUP BY adresse, commune
        ),
        q AS (
            SELECT normalize_text(?) AS nq
        ),
        scored AS (
            SELECT
                b.adresse,
                b.commune,
                b.nb,
                CASE
                    WHEN b.n_adresse = q.nq OR b.n_full = q.nq THEN 0
                    WHEN b.n_adresse LIKE q.nq || '%' THEN 1
                    WHEN b.n_full LIKE q.nq || '%' THEN 2
                    WHEN INSTR(b.n_adresse, ' ' || q.nq) > 0 THEN 3
                    WHEN INSTR(b.n_full, ' ' || q.nq) > 0 THEN 4
                    WHEN INSTR(b.n_adresse, q.nq) > 0 THEN 5
                    WHEN INSTR(b.n_full, q.nq) > 0 THEN 6
                    ELSE 9
                END AS score,
                CASE
                    WHEN INSTR(b.n_adresse, q.nq) = 0 THEN 9999
                    ELSE INSTR(b.n_adresse, q.nq)
                END AS pos
            FROM base b
            CROSS JOIN q
            WHERE b.n_full LIKE '%' || q.nq || '%'
               OR b.n_adresse LIKE '%' || q.nq || '%'
               OR b.n_commune LIKE '%' || q.nq || '%'
        )
        SELECT adresse, commune, nb
        FROM scored
        ORDER BY score ASC, pos ASC, LENGTH(adresse) ASC, nb DESC
        LIMIT ?
    """, (q, limit))

    suggestions = []
    for row in cur.fetchall():
        adresse = row["adresse"] or ""
        commune = row["commune"] or ""
        full_label = f"{adresse}, {commune}" if commune else adresse
        suggestions.append({
            "adresse": adresse,
            "commune": commune,
            "label": full_label,
            "count": row["nb"],
        })

    conn.close()
    return {"query": q, "suggestions": suggestions}


# ── DASHBOARD ─────────────────────────────────────────────
@app.get("/api/dashboard")
def get_dashboard():
    conn = get_db()
    cur  = conn.cursor()

    cur.execute("SELECT COUNT(*), SUM(longueur)/1000, AVG(criticite), SUM(nb_fuites) FROM canalisations")
    r = cur.fetchone()
    total, km, moy_crit, total_fuites = r[0], round(r[1] or 0,1), round(r[2] or 0,1), int(r[3] or 0)

    cur.execute("SELECT COUNT(*) FROM canalisations WHERE criticite >= 70")
    critiques = cur.fetchone()[0]
    cur.execute("SELECT COUNT(*) FROM canalisations WHERE criticite >= 40 AND criticite < 70")
    attention = cur.fetchone()[0]
    cur.execute("SELECT COUNT(*) FROM canalisations WHERE criticite < 40 AND criticite IS NOT NULL")
    bon = cur.fetchone()[0]
    cur.execute("SELECT COUNT(*) FROM canalisations WHERE criticite IS NULL")
    non_eval = cur.fetchone()[0]

    cur.execute("SELECT COUNT(*) FROM chantiers")
    nb_chantiers = cur.fetchone()[0]
    cur.execute("SELECT COUNT(*) FROM chantiers WHERE etat='Planifié'")
    planifies = cur.fetchone()[0]
    cur.execute("SELECT COUNT(*) FROM chantiers WHERE etat='Validé en planification'")
    valides = cur.fetchone()[0]

    # Matériaux
    cur.execute("""
        SELECT materiau, COUNT(*) as n, ROUND(AVG(criticite),1) as moy
        FROM canalisations WHERE materiau != ''
        GROUP BY materiau ORDER BY n DESC LIMIT 8
    """)
    materiaux = [{"nom": r[0], "count": r[1], "crit_moy": r[2]} for r in cur.fetchall()]

    # Années de pose
    cur.execute("""
        SELECT
            CASE
                WHEN annee_pose < 1950 THEN 'Avant 1950'
                WHEN annee_pose < 1970 THEN '1950–1969'
                WHEN annee_pose < 1990 THEN '1970–1989'
                WHEN annee_pose < 2000 THEN '1990–1999'
                WHEN annee_pose < 2010 THEN '2000–2009'
                WHEN annee_pose IS NOT NULL THEN '2010+'
                ELSE 'Inconnue'
            END as periode,
            COUNT(*) as n,
            ROUND(AVG(criticite),1) as moy_crit
        FROM canalisations GROUP BY periode ORDER BY periode
    """)
    annees = [{"periode": r[0], "count": r[1], "crit_moy": r[2]} for r in cur.fetchall()]

    # Top 15 rues prioritaires
    cur.execute("""
        SELECT adresse, commune,
               COUNT(*) as nb, ROUND(AVG(criticite),1) as crit_moy,
               ROUND(MAX(score_priorite),1) as score_max,
               SUM(nb_fuites) as fuites, ROUND(SUM(longueur),0) as longueur
        FROM canalisations
        WHERE adresse != '' AND criticite IS NOT NULL
        GROUP BY adresse, commune
        ORDER BY score_max DESC LIMIT 15
    """)
    top_rues = [{"adresse": r[0], "commune": r[1], "nb": r[2],
                 "crit_moy": r[3], "score": r[4], "fuites": r[5], "longueur": r[6]}
                for r in cur.fetchall()]

    # Chantiers par état
    cur.execute("SELECT etat, COUNT(*) FROM chantiers GROUP BY etat")
    chantiers_etat = [{"etat": r[0], "count": r[1]} for r in cur.fetchall()]

    conn.close()
    return {
        "total_canalisations": total, "km_total": km,
        "criticite_moyenne": moy_crit, "total_fuites": total_fuites,
        "critiques": critiques, "attention": attention, "bon": bon, "non_eval": non_eval,
        "nb_chantiers": nb_chantiers, "planifies": planifies, "valides": valides,
        "materiaux": materiaux, "annees": annees,
        "top_rues": top_rues, "chantiers_etat": chantiers_etat,
    }


# ── TOP RUES PRIORITAIRES (plan de travaux) ───────────────
@app.get("/api/plan-travaux")
def get_plan_travaux(
    commune: str = Query(default=""),
    limit:   int = Query(default=50),
    offset:  int = Query(default=0),
):
    conn = get_db()
    cur  = conn.cursor()
    filters = ["adresse != ''", "criticite IS NOT NULL"]
    params  = []
    if commune:
        filters.append("LOWER(commune) LIKE LOWER(?)")
        params.append(f"%{commune}%")
    where = " AND ".join(filters)

    cur.execute(f"""
        SELECT COUNT(DISTINCT adresse || commune) FROM (
            SELECT adresse, commune FROM canalisations WHERE {where}
        )
    """, params)
    total = cur.fetchone()[0]

    cur.execute(f"""
        SELECT adresse, commune,
               COUNT(*) as nb_canalisations,
               ROUND(AVG(criticite),1) as crit_moy,
               ROUND(MAX(score_priorite),1) as score_max,
               CAST(SUM(nb_fuites) AS INTEGER) as total_fuites,
               ROUND(SUM(longueur),0) as longueur_tot,
               GROUP_CONCAT(DISTINCT materiau) as materiaux,
               MIN(annee_pose) as plus_ancienne
        FROM canalisations
        WHERE {where}
        GROUP BY adresse, commune
        ORDER BY score_max DESC
        LIMIT ? OFFSET ?
    """, params + [limit, offset])

    rows = [dict(r) for r in cur.fetchall()]
    conn.close()
    return {"total": total, "offset": offset, "limit": limit, "rues": rows}


# ── CANALISATIONS PAR IDs (zone carte) ────────────────────
from typing import List

@app.post("/api/canalisations/zone")
def get_canalisations_zone(payload: dict):
    ids    = payload.get("ids", [])
    limit  = int(payload.get("limit", 100))
    offset = int(payload.get("offset", 0))

    if not ids:
        return {"total": 0, "canalisations": []}

    conn = get_db()
    cur  = conn.cursor()
    ph   = ",".join("?" * len(ids))

    cur.execute(f"SELECT COUNT(*) FROM canalisations WHERE facilityid IN ({ph})", ids)
    total = cur.fetchone()[0]

    cur.execute(f"""
        SELECT facilityid, adresse, commune, materiau, diametre, longueur,
               annee_pose, nb_fuites, vetuste, categorie, anciennete,
               densite, criticite, score_priorite
        FROM canalisations
        WHERE facilityid IN ({ph})
        ORDER BY score_priorite DESC NULLS LAST
        LIMIT ? OFFSET ?
    """, ids + [limit, offset])

    rows = [dict(r) for r in cur.fetchall()]
    conn.close()
    return {"total": total, "offset": offset, "limit": limit, "canalisations": rows}


# ── STATS GLOBALES ────────────────────────────────────────
@app.get("/api/stats")
def get_stats():
    conn = get_db()
    cur  = conn.cursor()

    cur.execute("SELECT COUNT(*) FROM canalisations")
    total = cur.fetchone()[0]

    cur.execute("SELECT AVG(criticite) FROM canalisations WHERE criticite IS NOT NULL")
    moy_crit = round(cur.fetchone()[0] or 0, 1)

    cur.execute("SELECT COUNT(*) FROM canalisations WHERE criticite >= 70")
    critiques = cur.fetchone()[0]

    cur.execute("SELECT COUNT(*) FROM canalisations WHERE criticite >= 40 AND criticite < 70")
    attention = cur.fetchone()[0]

    cur.execute("SELECT SUM(longueur)/1000 FROM canalisations WHERE longueur IS NOT NULL")
    km_total = round(cur.fetchone()[0] or 0, 1)

    cur.execute("SELECT COUNT(*) FROM chantiers")
    nb_chantiers = cur.fetchone()[0]

    cur.execute("SELECT COUNT(*) FROM chantiers WHERE etat = 'Planifié'")
    chantiers_planifies = cur.fetchone()[0]

    cur.execute("SELECT materiau, COUNT(*) as n FROM canalisations WHERE materiau != '' GROUP BY materiau ORDER BY n DESC LIMIT 6")
    materiaux = [{"nom": r[0], "count": r[1]} for r in cur.fetchall()]

    cur.execute("""
        SELECT
            CASE
                WHEN criticite >= 70 THEN 'Critique'
                WHEN criticite >= 40 THEN 'Attention'
                WHEN criticite IS NOT NULL THEN 'Bon état'
                ELSE 'Non évalué'
            END as niveau,
            COUNT(*) as n
        FROM canalisations
        GROUP BY niveau
    """)
    repartition = [{"niveau": r[0], "count": r[1]} for r in cur.fetchall()]

    conn.close()
    return {
        "total_canalisations": total,
        "km_total": km_total,
        "criticite_moyenne": moy_crit,
        "critiques": critiques,
        "attention": attention,
        "nb_chantiers": nb_chantiers,
        "chantiers_planifies": chantiers_planifies,
        "materiaux": materiaux,
        "repartition_criticite": repartition,
    }


# ── STATS PAR ADRESSE ─────────────────────────────────────
@app.get("/api/stats/adresse")
def get_stats_adresse(adresse: str = Query(default="")):
    if not adresse:
        return {}
    conn = get_db()
    cur  = conn.cursor()

    cur.execute("""
        SELECT COUNT(*), AVG(criticite), SUM(longueur), MAX(criticite),
               COUNT(CASE WHEN criticite >= 70 THEN 1 END),
               SUM(nb_fuites)
        FROM canalisations
        WHERE
            normalize_text(adresse) LIKE '%' || normalize_text(?) || '%'
            OR normalize_text(adresse || ' ' || COALESCE(commune, '')) LIKE '%' || normalize_text(?) || '%'
    """, (adresse, adresse))
    r = cur.fetchone()
    conn.close()

    return {
        "nb_canalisations": r[0],
        "criticite_moyenne": round(r[1] or 0, 1),
        "longueur_totale": round(r[2] or 0, 1),
        "criticite_max": round(r[3] or 0, 1),
        "critiques": r[4] or 0,
        "nb_fuites_total": int(r[5] or 0),
    }


# ── CHANTIERS ─────────────────────────────────────────────
@app.get("/api/chantiers")
def get_chantiers(
    commune: str = Query(default=""),
    etat:    str = Query(default=""),
    limit:   int = Query(default=100),
    offset:  int = Query(default=0),
):
    conn = get_db()
    cur  = conn.cursor()
    filters = ["1=1"]
    params  = []
    if commune:
        filters.append("LOWER(commune) LIKE LOWER(?)")
        params.append(f"%{commune}%")
    if etat:
        filters.append("etat = ?")
        params.append(etat)
    where = " AND ".join(filters)

    cur.execute(f"SELECT COUNT(*) FROM chantiers WHERE {where}", params)
    total = cur.fetchone()[0]

    cur.execute(f"""
        SELECT num_op, etat, date_debut, date_fin, commune, libelle
        FROM chantiers WHERE {where}
        ORDER BY date_debut ASC
        LIMIT ? OFFSET ?
    """, params + [limit, offset])
    rows = [dict(r) for r in cur.fetchall()]
    conn.close()
    return {"total": total, "offset": offset, "limit": limit, "chantiers": rows}


# ── OPERATIONS ────────────────────────────────────────────
@app.get("/api/operations")
def get_operations(
    commune: str = Query(default=""),
    limit:   int = Query(default=100),
    offset:  int = Query(default=0),
):
    conn = get_db()
    cur  = conn.cursor()
    filters = ["1=1"]
    params  = []
    if commune:
        filters.append("LOWER(commune) LIKE LOWER(?)")
        params.append(f"%{commune}%")
    where = " AND ".join(filters)

    cur.execute(f"SELECT COUNT(*) FROM operations WHERE {where}", params)
    total = cur.fetchone()[0]

    cur.execute(f"""
        SELECT id_projet, titre, commune, localisation, type_op, demandeur, annee, cpi
        FROM operations WHERE {where}
        ORDER BY id_projet ASC
        LIMIT ? OFFSET ?
    """, params + [limit, offset])
    rows = [dict(r) for r in cur.fetchall()]
    conn.close()
    return {"total": total, "offset": offset, "limit": limit, "operations": rows}


# ── VALEURS DISTINCTES pour filtres ──────────────────────
@app.get("/api/filtres")
def get_filtres():
    conn = get_db()
    cur  = conn.cursor()
    cur.execute("SELECT DISTINCT materiau FROM canalisations WHERE materiau != '' ORDER BY materiau")
    materiaux = [r[0] for r in cur.fetchall()]
    cur.execute("SELECT DISTINCT commune FROM canalisations WHERE commune != '' ORDER BY commune")
    communes = [r[0] for r in cur.fetchall()]
    cur.execute("SELECT DISTINCT anciennete FROM canalisations WHERE anciennete != '' ORDER BY anciennete")
    anciennetes = [r[0] for r in cur.fetchall()]
    conn.close()
    return {"materiaux": materiaux, "communes": communes, "anciennetes": anciennetes}


# ── Fichiers statiques ─────────────────────────────────────
from fastapi.responses import FileResponse, Response
import gzip as gz_lib

@app.get("/api/geojson/canalisations")
def get_geojson_canalisations():
    """Sert le GeoJSON compressé gzip directement"""
    path = os.path.join(os.path.dirname(__file__), "assets/data/canalisations.geojson.gz")
    with open(path, 'rb') as f:
        content = f.read()
    return Response(
        content=content,
        media_type="application/json",
        headers={"Content-Encoding": "gzip", "Cache-Control": "public, max-age=3600"}
    )

app.mount("/", StaticFiles(directory=".", html=True), name="static")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
