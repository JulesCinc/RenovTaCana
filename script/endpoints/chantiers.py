from fastapi import APIRouter, Query

from database import get_db


router = APIRouter(prefix="/api", tags=["Chantiers"])


@router.get("/chantiers")
def get_chantiers(
    commune: str = Query(default=""),
    etat: str = Query(default=""),
    limit: int = Query(default=100),
    offset: int = Query(default=0),
):
    conn = get_db()
    cur = conn.cursor()

    filters = ["1=1"]
    params = []

    if commune:
        filters.append("LOWER(commune) LIKE LOWER(?)")
        params.append(f"%{commune}%")

    if etat:
        filters.append("etat = ?")
        params.append(etat)

    where = " AND ".join(filters)

    cur.execute(f"SELECT COUNT(*) FROM chantiers WHERE {where}", params)
    total = cur.fetchone()[0]

    cur.execute(
        f"""
        SELECT num_op, etat, date_debut, date_fin, commune, libelle
        FROM chantiers
        WHERE {where}
        ORDER BY date_debut ASC
        LIMIT ? OFFSET ?
        """,
        params + [limit, offset],
    )

    rows = [dict(r) for r in cur.fetchall()]
    conn.close()

    return {
        "total": total,
        "offset": offset,
        "limit": limit,
        "chantiers": rows,
    }