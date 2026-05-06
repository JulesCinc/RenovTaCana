from fastapi import APIRouter, Query

from database import get_db


router = APIRouter(prefix="/api", tags=["Operations"])


@router.get("/operations")
def get_operations(
    commune: str = Query(default=""),
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

    where = " AND ".join(filters)

    cur.execute(f"SELECT COUNT(*) FROM operations WHERE {where}", params)
    total = cur.fetchone()[0]

    cur.execute(
        f"""
        SELECT id_projet, titre, commune, localisation, type_op, demandeur, annee, cpi
        FROM operations
        WHERE {where}
        ORDER BY id_projet ASC
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
        "operations": rows,
    }