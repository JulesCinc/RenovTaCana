# Score de priorité

Documentation du calcul du **score de priorité** (`score_priorite`) appliqué à chaque canalisation, et de son utilisation dans l’application (plan de travaux, tableaux, imports).

---

## Rôle dans le projet

Le score de priorité sert à **classer les canalisations et les rues** pour l’édition du plan de travaux (V2.2). Il part de la **criticité** (indicateur métier déjà présent en base, souvent issu du classement « pipe ranking ») et y ajoute des **bonus contextuels** liés aux chantiers et opérations sur la même adresse.

Le résultat est **persisté** dans la colonne `canalisations.score_priorite`. Il n’est pas recalculé à chaque requête API : il faut lancer un calcul explicite (voir ci‑dessous).

---

## Formule générale

Pour toute canalisation ayant une `criticite` renseignée :

```
score_priorite = (criticite × 0,8) + bonus
```

| Élément | Valeur | Commentaire |
|---|---|---|
| Poids criticité | **0,8** (80 %) | Part fixe du score, définie avec le client |
| Bonus chantier + opération | **+0,2** | Chantier actif **et** opération récente sur l’adresse |
| Bonus chantier seul | **+0,1** | Chantier actif sans opération récente |
| Bonus opération seule | **+0,1** | Opération récente sans chantier actif |
| Aucun bonus | **0** | Criticité seule : `criticite × 0,8` |

Les bonus ne se cumulent pas au‑delà de **+0,2** : le `CASE` SQL applique la branche la plus favorable une seule fois.

**Exemples** (criticité en %) :

| Criticité | Contexte | Calcul | Score |
|---:|---|---:|---:|
| 80 | Aucun bonus | 80 × 0,8 | **64,0** |
| 80 | Chantier actif | 64 + 0,1 | **64,1** |
| 80 | Opération année en cours | 64 + 0,1 | **64,1** |
| 80 | Chantier actif + opération | 64 + 0,2 | **64,2** |
| 95 | Chantier + opération | 76 + 0,2 | **76,2** |

Si `criticite` est `NULL`, `score_priorite` est mis à `NULL` (canalisation non priorisable).

---

## Conditions des bonus

La logique est implémentée dans [`script/priority_score.py`](../script/priority_score.py) (expression SQL `CASE`). L’adresse de la canalisation doit être **non vide** pour qu’un bonus s’applique.

### Chantier actif (+0,1 ou partie du +0,2)

Un chantier est pris en compte si **toutes** les conditions suivantes sont vraies :

1. **Même adresse** : `chantiers.adresse = canalisations.adresse` (égalité stricte).
2. **État ouvert** : `etat` différent de `Terminé` et `Annulé`.
3. **Période compatible avec « en cours »** :
   - `date_debut <= aujourd’hui` **et** `date_fin >= aujourd’hui`, **ou**
   - `date_debut <= aujourd’hui` (chantier démarré même si la date de fin est absente ou passée).

### Opération récente (+0,1 ou partie du +0,2)

Une opération est prise en compte si :

1. **Même localisation** : `operations.localisation = canalisations.adresse`.
2. **Année courante ou future** : `operations.annee >= année en cours` (comparaison sur le texte de l’année, format attendu : année sur 4 chiffres).

### Ordre d’évaluation SQL

Le moteur teste les cas dans cet ordre (le premier qui correspond gagne) :

1. Chantier actif **et** opération récente → `criticite × 0,8 + 0,2`
2. Chantier actif seul → `criticite × 0,8 + 0,1`
3. Opération récente seule → `criticite × 0,8 + 0,1`
4. Sinon → `criticite × 0,8`

---

## Lancer le calcul

### Interface

Page **Base de données** (`database.html`) : bouton de calcul du score de priorité → appel `POST /api/database/compute-priority`.

### API

Endpoint : [`script/endpoints/database/compute_priority.py`](../script/endpoints/database/compute_priority.py)

```http
POST /api/database/compute-priority
```

**Comportement :**

1. Copie de la base active dans `database/outdated/` (archive horodatée).
2. `UPDATE` de toutes les lignes avec `criticite IS NOT NULL` via l’expression `priority_score_sql()`.
3. `score_priorite = NULL` pour les lignes sans criticité.

**Réponse type :**

```json
{
  "updated": 34088,
  "archive": "renovTaCana_20260528_143022.db",
  "message": "Score de priorité calculé pour 34088 canalisations."
}
```

Recalculer après : import de chantiers/opérations, mise à jour des adresses, ou modification des criticités.

---

## Utilisation dans l’application

| Zone | Usage |
|---|---|
| **`index.html`** | Colonne « Score de priorité », tri et filtre « priorité inconnue » |
| **`dashboard.html` / plan de travaux** | `GET /api/plan-travaux` : agrégation par rue (`AVG(score_priorite)`), tri décroissant ; indicateur `priority_scores_computed` si au moins un score en base |
| **Import pipe ranking** | Peut aligner `criticite` et `score_priorite` sur la valeur importée (avant ou en complément du calcul bonus) |

Tant qu’aucun calcul n’a été lancé (`score_priorite` NULL partout), le plan de travaux affiche un message invitant à lancer le calcul depuis la page base de données.

---

## Fichiers sources

| Fichier | Rôle |
|---|---|
| [`script/priority_score.py`](../script/priority_score.py) | Expression SQL du score (poids et bonus) |
| [`script/endpoints/database/compute_priority.py`](../script/endpoints/database/compute_priority.py) | Endpoint de mise à jour en masse |
| [`database/MCD.md`](../database/MCD.md) | Colonne `score_priorite` sur `canalisations` |

---

## Limites et évolutions possibles

- **Correspondance d’adresse** : bonus basés sur l’égalité exacte des chaînes `adresse` / `localisation`. Des libellés différents pour la même voie ne déclenchent pas de bonus.
- **Poids figés en SQL** : modifier 0,8 / 0,1 / 0,2 implique d’éditer `priority_score.py` puis de relancer `compute-priority`.
- **Segmentation 250 m** : le score reste au niveau **canalisation** ; l’agrégation par tronçons pour le plan de travaux est une évolution distincte (voir [segmentation.md](segmentation.md)).
