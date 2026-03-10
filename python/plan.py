import sqlite3
import pandas as pd

con = sqlite3.connect("renov-ta-cana.db")
cur = con.cursor()
query = cur.execute("SELECT * from table1")
df = pd.read_sql_query(query, con)

"""
def plan(table1,table2)
    groupby ou agg pour comparer les canalisations
    calculer une moyenne en fonctions des critères
    sort les resulstats
    hop la dans une liste
    return de la liste
"""
