"""Résolution des libellés commune (code INSEE) depuis la table locale `communes`."""


def normalize_commune_code(value):
    code = str(value or "").strip()
    if not code:
        return ""
    if code.isdigit() and len(code) == 4:
        return f"0{code}"
    return code


def commune_names_for_codes(cur, codes):
    """Retourne { code_insee -> nom_standard } pour les codes demandés."""
    uniq = []
    seen = set()
    for raw in codes or []:
        c = normalize_commune_code(raw)
        if not c or not c.isdigit() or len(c) != 5 or c in seen:
            continue
        seen.add(c)
        uniq.append(c)
    if not uniq:
        return {}
    placeholders = ",".join("?" * len(uniq))
    cur.execute(
        f"SELECT code_insee, nom_standard FROM communes WHERE code_insee IN ({placeholders})",
        uniq,
    )
    return {str(r[0]): str(r[1]) for r in cur.fetchall() if r[0] and r[1]}


def enrich_rows_commune_display(cur, rows):
    """Ajoute `commune_display` à chaque ligne dict ayant une clé `commune`."""
    codes = [r.get("commune") for r in rows if isinstance(r, dict)]
    names = commune_names_for_codes(cur, codes)
    for row in rows:
        if not isinstance(row, dict):
            continue
        raw = row.get("commune")
        code = normalize_commune_code(raw)
        if not code:
            row["commune_display"] = ""
        elif not code.isdigit():
            row["commune_display"] = str(raw or "").strip() or code
        else:
            row["commune_display"] = names.get(code) or code
    return rows


def commune_display_value(cur, raw_value):
    """Libellé pour un seul code commune (INSEE ou texte libre)."""
    code = normalize_commune_code(raw_value)
    if not code:
        return ""
    if not code.isdigit():
        return code
    cur.execute("SELECT nom_standard FROM communes WHERE code_insee = ?", (code,))
    row = cur.fetchone()
    if row and row[0]:
        return str(row[0]).strip()
    return code
