"""Exploration rapide des données SIG et pipe_ranking."""
import os

# Chemins relatifs à l'emplacement du script (exécutable depuis n'importe où) (exécutable depuis n'importe où)
_SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
_ROOT_DIR = os.path.dirname(os.path.dirname(os.path.dirname(_SCRIPT_DIR)))
_DATA_DIR = os.path.join(_ROOT_DIR, "data")

try:
    import geopandas as gpd
    HAS_GEOPANDAS = True
except ImportError:
    HAS_GEOPANDAS = False

def main():
    if HAS_GEOPANDAS:
        # wMain
        wmain_path = os.path.join(_DATA_DIR, "conduites", "wMain.shp")
        if not os.path.exists(wmain_path):
            print("Fichier non trouvé:", wmain_path)
            return
        g = gpd.read_file(wmain_path)
        print("=== wMain.shp ===")
        print("CRS:", g.crs)
        print("Colonnes:", list(g.columns))
        print("Nombre de tronçons:", len(g))
        print("Exemple (première ligne, attributs):")
        for c in g.columns:
            if c != "geometry":
                print(f"  {c}: {g.iloc[0][c]}")
        print()

        g2 = gpd.read_file(os.path.join(_DATA_DIR, "Abandonned_Lines", "wAbandonedLine.shp"))
        print("=== wAbandonedLine.shp ===")
        print("CRS:", g2.crs)
        print("Colonnes:", list(g2.columns))
        print("Nombre de tronçons:", len(g2))
        if len(g2) > 0:
            for c in g2.columns:
                if c != "geometry":
                    print(f"  {c}: {g2.iloc[0][c]}")
    else:
        print("geopandas non installé, skip shapefiles")

    try:
        import pandas as pd
        pr_path = os.path.join(_DATA_DIR, "pipe_ranking_v1_clear.csv")
        if not os.path.exists(pr_path):
            print("Fichier non trouvé:", pr_path)
            return
        pr = pd.read_csv(pr_path)
        print("\n=== pipe_ranking_v1_clear.csv ===")
        print("Colonnes:", list(pr.columns))
        print("Lignes:", len(pr))
        print("Doublons FACILITYID:", pr["FACILITYID"].duplicated().sum())
        print("Stats probabilite_casse:", pr["probabilite_casse"].describe())
        print("Stats longueur:", pr["longueur"].describe())
    except Exception as e:
        print("\n(pandas non disponible pour les stats CSV:", e, ")")

if __name__ == "__main__":
    main()
