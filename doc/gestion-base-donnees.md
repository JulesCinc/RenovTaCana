# Gestion de la base de données

Cette page sert à **mettre à jour les données** utilisées par RenovTaCana (carte, tableau d’adresses, tableau de bord, plan de travaux) **sans refaire toute la base à la main**.

Elle est accessible depuis le menu principal : **Base de données** (`database.html`).

---

## À quoi sert cette page ?

RenovTaCana s’appuie sur une base locale qui contient notamment :

- les **canalisations** et leur niveau de criticité ;
- les **chantiers** en cours ou planifiés ;
- les **opérations** liées au réseau.

La page **Gestion de la base de données** permet de :

1. **Importer** des fichiers fournis par le métier (Excel ou CSV) pour enrichir ou actualiser ces informations.
2. **Recalculer le score de priorité** du parc, afin que le plan de travaux et les classements reflètent la situation à jour.
3. **Consulter l’historique** des sauvegardes automatiques et, si besoin, **revenir en arrière** à une version antérieure.

En résumé : c’est l’espace d’**administration des données** du prototype, pensé pour les mises à jour régulières entre deux livraisons.

---

## Ce que vous voyez en ouvrant la page

### Synthèse de la base active

En haut de la page, un rappel indique combien de **canalisations**, **chantiers** et **opérations** sont actuellement enregistrés. Cela permet de vérifier rapidement que la base répond bien après un import ou un retour arrière.

### Calcul du score de priorité

Un bouton dédié lance le **recalcul du score de priorité** pour l’ensemble des canalisations concernées.

**Pourquoi c’est important :** le score combine la criticité du tuyau avec le contexte local (chantier actif sur l’adresse, opération récente, etc.). Sans ce calcul, le **plan de travaux** ne peut pas classer correctement les rues par priorité.

**Quand le lancer :**

- après un import de **chantiers** ou d’**opérations** ;
- après une mise à jour des **criticités** (pipe ranking) si vous souhaitez que les bonus chantier / opération soient appliqués (voir [Score de priorité](score-priorite.md)).

Un message confirme la fin du calcul et le nombre de canalisations traitées.

### Trois zones d’import

Chaque zone correspond à un type de fichier métier. Vous pouvez **déposer le fichier** dans la zone ou **cliquer** pour le sélectionner.

| Fichier attendu | Ce que l’import apporte |
|---|---|
| **chantiers.xlsx** | Ajoute de **nouveaux chantiers** (numéro d’opération, commune, libellé, dates, état, adresse si disponible). Les lignes déjà identiques en base ne sont pas dupliquées. |
| **operations.xlsx** | Ajoute de **nouvelles opérations** (titre, commune, localisation, type, demandeur, année, etc.). Là encore, les doublons sont ignorés. |
| **pipe_ranking.xlsx** | Met à jour la **criticité** (et le score affiché) des canalisations **déjà présentes**, à partir du classement / probabilité de casse. Les identifiants de canalisations inconnus sont ignorés. |

Après chaque import réussi, un message indique **combien de lignes ont été ajoutées ou mises à jour**. En cas de problème (fichier vide, colonnes manquantes, aucune canalisation reconnue pour le pipe ranking), un message d’erreur explique la situation.

**Formats acceptés :** Excel (`.xlsx`, `.xls`) ou CSV.

> **Note :** l’import de pipe ranking met à jour la criticité issue du classement. Pour intégrer les **bonus** liés aux chantiers et opérations dans le score affiché sur le plan de travaux, pensez à lancer ensuite le **calcul du score de priorité**.

### Historique des versions

Chaque fois que la base est modifiée de façon significative (import ou calcul de priorité), une **copie de sauvegarde** est enregistrée automatiquement.

Le tableau en bas de page liste ces versions avec :

- la **date** ;
- la **taille** du fichier ;
- le **nombre** de canalisations, chantiers et opérations à ce moment-là.

Cela permet de comparer l’état de la base avant et après une manipulation.

### Revenir en arrière (rollback)

Si une mise à jour ne convient pas, vous pouvez **restaurer une version antérieure** via le bouton **Rollback** sur la ligne choisie.

- La version sélectionnée redevient la **base active**.
- Les sauvegardes **plus récentes** que celle-ci sont supprimées : l’opération est **définitive** pour ces versions.

Une fenêtre de confirmation rappelle ces points avant validation.

---

## Comment utiliser la page au quotidien

Un enchaînement courant :

1. Importer les fichiers métier reçus (chantiers, opérations, pipe ranking selon les besoins).
2. Lancer le **calcul du score de priorité** si des chantiers, opérations ou criticités ont changé.
3. Vérifier les compteurs en haut de page, puis contrôler le **plan de travaux** ou le **tableau de bord**.
4. En cas d’erreur ou de mauvais fichier, utiliser l’**historique** pour revenir à la sauvegarde précédente.

La base active est le fichier **`database/renovTaCana.db`** ; les anciennes versions se trouvent dans **`database/outdated/`**. Vous n’avez en principe pas besoin d’ouvrir ces fichiers à la main : tout passe par cette interface, tant que l’application est démarrée (voir [README](../README.md), section *Lancer l’app*).

---

## Limites à connaître

- Cette page **met à jour** une base déjà construite ; elle ne remplace pas la **création initiale** de la base à partir des données sources (shapefiles, etc.).
- Les imports **ajoutent** des chantiers et opérations ou **mettent à jour** des criticités existantes : ils ne remplacent pas tout le contenu des tables en un clic.
- Le **rollback** restaure une sauvegarde complète : toute modification faite après la date choisie est perdue pour les versions plus récentes.

Pour le détail du **score de priorité** (formule, bonus), voir [score-priorite.md](score-priorite.md).
