import os
import sqlite3
from typing import Optional

import pandas as pd

# Chemin vers la base SQLite (depuis le dossier python/)
DB_PATH = os.path.normpath(
    os.path.join(os.path.dirname(__file__), os.pardir, "sqlite", "renovTaCana.db")
)

# Paramètres de sortie pandas
pd.set_option("display.max_columns", None)
pd.set_option("display.width", None)

# --- Criticité basée sur TXcasse ---
CRITICALITY_MAP = {
    "Négligeable": 0.0,
    "Negligeable": 0.0,
    "Faible": 0.25,
    "Moyen": 0.5,
    "Important": 0.75,
    "Très important": 1.0,
    "Tres important": 1.0,
}


def tx_to_score(tx: Optional[str]) -> float:
    if not isinstance(tx, str):
        return 0.0
    return CRITICALITY_MAP.get(tx.strip(), 0.0)


def is_in_work(
    row: pd.Series,
) -> bool:  # Retourne True si la ligne est déjà en cours de travaux.
    num_op = row.get("NUM_OP")
    return pd.notna(num_op) and str(num_op).strip() != ""


def build_plan(df: pd.DataFrame) -> pd.DataFrame:
    plan_df = df.copy()
    plan_df["critic_score"] = (
        plan_df["TXcasse"].apply(tx_to_score) if "TXcasse" in plan_df else 0.0
    )
    plan_df["in_work"] = plan_df.apply(is_in_work, axis=1)
    plan_df["priority_score"] = (
        plan_df["critic_score"] + plan_df["in_work"].astype(float) * 0.5  # pondération
    )
    return plan_df.sort_values(
        by=["in_work", "priority_score"], ascending=[False, False]
    )


def main():
    query = """
    SELECT
      FACILITYID,
      COMMUNE,
      ADRESSE,
      NUM_OP,
      TXcasse
    FROM conduites
    """

    with sqlite3.connect(DB_PATH) as con:
        df = pd.read_sql_query(query, con)

    plan_df = build_plan(df)

    print("Planification des travaux (top 20 priorités)")
    cols = [
        "FACILITYID",
        "COMMUNE",
        "ADRESSE",
        "NUM_OP",
        "TXcasse",
        "critic_score",
        "in_work",
        "priority_score",
    ]
    print(plan_df[cols].head(20).to_string(index=False))


if __name__ == "__main__":
    main()
