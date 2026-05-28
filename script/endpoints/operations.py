from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from database import get_db


router = APIRouter(prefix="/api", tags=["Operations"])


class OperationAdresseUpdate(BaseModel):
    operation_rowid: int
    adresse: str


@router.get("/operations")
def get_operations(
    commune: str = Query(default=""),
    search: str = Query(default=""),
    only_missing_adresse: bool = Query(default=False),
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

    if search:
        filters.append("(CAST(id_projet AS TEXT) LIKE ? OR LOWER(COALESCE(localisation,'')) LIKE LOWER(?))")
        params.extend([f"%{search}%", f"%{search}%"])

    if only_missing_adresse:
        filters.append("(localisation IS NULL OR TRIM(localisation) = '')")

    where = " AND ".join(filters)

    cur.execute("SELECT COUNT(*) FROM operations WHERE (localisation IS NULL OR TRIM(localisation) = '')")
    missing_count = cur.fetchone()[0]

    cur.execute(f"SELECT COUNT(*) FROM operations WHERE {where}", params)
    total = cur.fetchone()[0]

    cur.execute(
        f"""
        SELECT rowid AS operation_rowid, id_projet, titre, commune, localisation, type_op, demandeur, annee, cpi
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
        "missing_count": missing_count,
        "operations": rows,
    }


@router.patch("/operations/adresse")
def update_operation_adresse(payload: OperationAdresseUpdate):
    operation_rowid = int(payload.operation_rowid)
    adresse = (payload.adresse or "").strip()
    if operation_rowid <= 0:
        raise HTTPException(status_code=400, detail="operation_rowid invalide")
    if not adresse:
        raise HTTPException(status_code=400, detail="adresse manquante")

    conn = get_db()
    cur = conn.cursor()
    try:
        cur.execute(
            """
            UPDATE operations
            SET localisation = ?
            WHERE rowid = ?
            """,
            (adresse, operation_rowid),
        )
        updated = cur.rowcount
        if updated <= 0:
            raise HTTPException(status_code=404, detail="Aucune operation trouvee pour cet operation_rowid")
        conn.commit()
    finally:
        conn.close()

    return {"ok": True, "updated": updated, "operation_rowid": operation_rowid, "adresse": adresse}