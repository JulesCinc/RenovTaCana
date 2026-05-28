"""Expression SQL du score de priorité (canalisations)."""


def priority_score_sql() -> str:
    """Score par canalisation : criticite * 0.8 + bonus chantier/opération."""
    return """
    CASE
        WHEN adresse IS NOT NULL AND adresse != ''
             AND EXISTS (
                SELECT 1 FROM chantiers c
                WHERE c.adresse = canalisations.adresse
                  AND c.etat NOT IN ('Terminé', 'Annulé')
                  AND (
                      (c.date_debut <= date('now') AND c.date_fin >= date('now'))
                      OR c.date_debut <= date('now')
                  )
             )
             AND EXISTS (
                SELECT 1 FROM operations o
                WHERE o.localisation = canalisations.adresse
                  AND o.annee >= strftime('%Y', 'now')
             )
        THEN (criticite * 0.8) + 0.2
        WHEN adresse IS NOT NULL AND adresse != ''
             AND EXISTS (
                SELECT 1 FROM chantiers c
                WHERE c.adresse = canalisations.adresse
                  AND c.etat NOT IN ('Terminé', 'Annulé')
                  AND (
                      (c.date_debut <= date('now') AND c.date_fin >= date('now'))
                      OR c.date_debut <= date('now')
                  )
             )
        THEN (criticite * 0.8) + 0.1
        WHEN adresse IS NOT NULL AND adresse != ''
             AND EXISTS (
                SELECT 1 FROM operations o
                WHERE o.localisation = canalisations.adresse
                  AND o.annee >= strftime('%Y', 'now')
             )
        THEN (criticite * 0.8) + 0.1
        ELSE criticite * 0.8
    END
    """
