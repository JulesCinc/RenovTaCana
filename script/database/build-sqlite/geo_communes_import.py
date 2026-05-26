"""
Import des communes depuis le dump MySQL `data/geo_localisation.sql`.

On alimente la table SQLite `communes` :
- code_insee : extrait de `url_villedereve` (pattern villedereve.fr/ville/XXXXX-)
- nom_standard : colonne `nom_standard` du dump
- codes_postaux : texte brut de la colonne `codes_postaux` (souvent plusieurs CP séparés par des virgules)

Le champ `codes_postaux` sert de référence métier (mapping nom <-> CP) ; la clé technique côté app
reste le code INSEE (colonne `commune` / INSEE des canalisations).
"""
import re
import sys

INSEE_VILLEDEREVE = re.compile(r"villedereve\.fr/ville/(\d{5})(?:[-/?#\"']|$)", re.IGNORECASE)


def _tqdm(iterable, **kwargs):
    kwargs.setdefault("disable", not sys.stdout.isatty())
    try:
        from tqdm import tqdm as _tq

        return _tq(iterable, **kwargs)
    except ImportError:
        return iterable


def _parse_mysql_string(blob, start):
    """Lit une chaîne SQL entre quotes simples à partir de blob[start] == \"'\"."""
    if start >= len(blob) or blob[start] != "'":
        return None, start
    i = start + 1
    out = []
    while i < len(blob):
        c = blob[i]
        if c == "\\" and i + 1 < len(blob):
            out.append(blob[i + 1])
            i += 2
            continue
        if c == "'" and i + 1 < len(blob) and blob[i + 1] == "'":
            out.append("'")
            i += 2
            continue
        if c == "'":
            return "".join(out), i + 1
        out.append(c)
        i += 1
    return None, start


def _parse_mysql_value(blob, i):
    while i < len(blob) and blob[i].isspace():
        i += 1
    if i >= len(blob):
        return None, i
    if blob[i] == "'":
        return _parse_mysql_string(blob, i)
    if blob[i : i + 4].upper() == "NULL" and (i + 4 >= len(blob) or not (blob[i + 4].isalnum() or blob[i + 4] == "_")):
        return None, i + 4
    j = i
    while j < len(blob) and blob[j] not in ",)":
        j += 1
    raw = blob[i:j].strip()
    if not raw:
        return None, j
    if "." in raw:
        try:
            return float(raw), j
        except ValueError:
            return raw, j
    try:
        return int(raw), j
    except ValueError:
        return raw, j


def _parse_mysql_tuple_inner(inner):
    """inner = contenu entre parenthèses d'un tuple VALUES."""
    values = []
    i = 0
    while i < len(inner):
        while i < len(inner) and inner[i].isspace():
            i += 1
        if i >= len(inner):
            break
        v, ni = _parse_mysql_value(inner, i)
        values.append(v)
        i = ni
        while i < len(inner) and inner[i].isspace():
            i += 1
        if i < len(inner) and inner[i] == ",":
            i += 1
    return values


def _extract_row_fields(values):
    """Retourne (nom_standard, codes_postaux, url_villedereve) ou None."""
    if len(values) < 18:
        return None
    nom = values[1]
    codes_postaux = values[12]
    url_vd = values[17]
    if not isinstance(nom, str) or not nom.strip():
        return None
    if not isinstance(codes_postaux, str):
        codes_postaux = "" if codes_postaux is None else str(codes_postaux)
    if not isinstance(url_vd, str):
        url_vd = ""
    return nom.strip(), codes_postaux.strip(), url_vd.strip()


def iter_communes_from_geo_sql_lines(lines):
    """Itère sur (code_insee, nom_standard, codes_postaux) pour chaque ligne de VALUES reconnue."""
    in_geo_insert = False
    for line in lines:
        s = line.strip()
        if "INSERT INTO `geo_localisation`" in line and "VALUES" in line:
            in_geo_insert = True
            continue
        if not in_geo_insert:
            continue
        if s.startswith("INSERT INTO"):
            in_geo_insert = "geo_localisation" in s
            continue
        if s.startswith("--") or not s.startswith("("):
            if s.startswith("ALTER") or s.startswith("COMMIT"):
                in_geo_insert = False
            continue
        if s.endswith("),"):
            inner = s[1:-2]
        elif s.endswith(");"):
            inner = s[1:-2]
        elif s.endswith(")"):
            inner = s[1:-1]
        else:
            continue
        try:
            values = _parse_mysql_tuple_inner(inner)
        except Exception:
            continue
        extracted = _extract_row_fields(values)
        if not extracted:
            continue
        nom_standard, codes_postaux, url_vd = extracted
        m = INSEE_VILLEDEREVE.search(url_vd)
        if not m:
            continue
        code_insee = m.group(1)
        yield code_insee, nom_standard, codes_postaux


def import_communes_from_geo_sql(conn, sql_path):
    """
    Crée / remplit `communes` depuis le fichier SQL.
    Retourne le nombre de lignes insérées.
    """
    cur = conn.cursor()
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS communes (
            code_insee TEXT PRIMARY KEY,
            nom_standard TEXT NOT NULL,
            codes_postaux TEXT
        )
        """
    )
    cur.execute("DELETE FROM communes")
    batch = []
    n = 0
    with open(sql_path, encoding="utf-8", errors="replace") as f:
        for code_insee, nom_standard, codes_postaux in _tqdm(
            iter_communes_from_geo_sql_lines(f),
            desc="Import communes (SQL)",
            unit="lig",
            mininterval=0.2,
        ):
            batch.append((code_insee, nom_standard, codes_postaux or None))
            n += 1
            if len(batch) >= 500:
                cur.executemany(
                    "INSERT OR REPLACE INTO communes (code_insee, nom_standard, codes_postaux) VALUES (?,?,?)",
                    batch,
                )
                batch.clear()
    if batch:
        cur.executemany(
            "INSERT OR REPLACE INTO communes (code_insee, nom_standard, codes_postaux) VALUES (?,?,?)",
            batch,
        )
    cur.execute("CREATE INDEX IF NOT EXISTS idx_communes_nom ON communes(nom_standard)")
    return n
