# WikiMasters — Prix du marché (extension Chrome)

Affiche le prix **Dernier** (et moyenne, min/max, nombre de ventes) directement sous chaque
carte de wiki-masters.com, et permet de **trier par prix**.

## Installation

1. Décompresse `wikimasters-prix.zip` quelque part de permanent (l'extension est chargée depuis
   ce dossier, pas copiée).
2. `chrome://extensions` → active **Mode développeur** (en haut à droite).
3. **Charger l'extension non empaquetée** → sélectionne le dossier `wikimasters-prix`.
4. Recharge `wiki-masters.com`.

Pas d'icône fournie : Chrome affichera la lettre par défaut dans la barre d'outils. Clique
dessus pour ouvrir les réglages.

## Ce que ça fait

**Badges sous les cartes** — sur `/collection`, `/marketplace`, `/global-collection` et toute
autre grille de cartes :

```
◈ 39    ~25    10–75    15 v.
dernier moyenne min–max  ventes
```

Chaque badge a une infobulle (date de la dernière vente, rareté prise en compte, etc.).
Chaque métrique s'active/se désactive indépendamment dans les réglages.
Une carte sans vente enregistrée affiche `—` et part en fin de tri.

**Tri** — barre d'outils au-dessus de la grille : `Défaut | Dernier | Moyenne | Min | Max | Ventes`
plus un bouton ↓/↑.

- Sur n'importe quelle page : réordonne les cartes affichées (via `order` CSS, sans toucher au
  DOM de React).
- Sur `/collection` : bouton **Vue liste** → tableau trié sur **toute la collection** (les ~590
  cartes, pas seulement les 50 de la page), avec recherche, filtre par rareté, option « masquer
  les cartes sans vente », et une ligne dépliable par carte affichant ses 10 dernières ventes.

Quand la carte n'a pas de conteneur à elle (cartes posées directement dans une rangée flex,
comme dans le détail d'un échange), le badge passe **en superposition en haut de l'image**, sous
la pastille de rareté — jamais sur le titre ni sur la ligne ATK/DEF. Dans ce mode il n'affiche
que le dernier prix, le reste étant dans l'infobulle (décochable : « Superposition : prix seul »).

**Pages sans barre de tri** — sur `/trades`, `/pulls` et `/profile`, les prix s'affichent mais la
barre de tri n'apparaît pas (ces pages n'ont pas de grille à trier). La liste est en haut de
`src/main.js` (`NO_TOOLBAR_ROUTES`).

**Page Échanges** — dans la liste, les cartes sont des pastilles compactes : le dernier prix est
ajouté dedans (`SR · Thann │◈ 25`), le titre complet étant lu dans l'attribut `title` de la
pastille, donc les titres tronqués à l'écran sont quand même résolus. Et chaque lot de cartes
reçoit un **total** sous lui — `Total ◈ 139` face à `Total ◈ 950` — dans la liste comme dans le
détail de l'échange. Les **pièces** jointes à une offre (`3 wb`) sont ajoutées au total du côté
où elles sont posées, et détaillées : `Total ◈ 23 · dont 3 en pièces`. Les cartes sans vente
enregistrée sont comptées à part (`· 1 sans prix`) plutôt que comme des zéros.

**Cache** — les prix sont stockés dans `chrome.storage.local` (12 h par défaut, réglable). Le
premier chargement complet prend 1 à 3 min (une requête par carte, 5 en parallèle) ; ensuite
c'est instantané. Le bouton `⟳` force un rechargement.

## Réglages (popup)

| Réglage | Effet |
|---|---|
| Badges sur les cartes | coupe l'affichage sans désinstaller |
| Dernier / Moyenne / Min-Max / Ventes | chaque métrique séparément |
| Badge sous la carte | décoché = badge toujours superposé sur l'image |
| Superposition : prix seul | en superposition, n'affiche que le dernier prix (reste dans l'infobulle) |
| Raretés | `de la carte` (défaut, = ce que vaut *ta* copie) ou `toutes` |
| Précharger toute la collection | lance le chargement complet dès l'ouverture de `/collection` |
| Cache (heures) | fraîcheur des prix |
| Requêtes // | 1 à 8 ; baisse-le si le site te limite |
| Vider le cache des prix | remet tout à zéro |

## Comment ça marche (et pourquoi comme ça)

- **Prix** : `GET /api/marketplace/cards/{cardId}/sales` renvoie tout l'historique des ventes
  d'une carte avec la rareté de chaque vente. Les stats affichées sont recalculées côté
  extension, filtrées sur la rareté — ça reproduit exactement les chiffres du panneau
  « Marché » du site (vérifié : *Julien Cazarre* → dernier 39, moy. 25, min 10, max 75, 15 ventes).
- **Collection** : `GET /api/my-collection?page=N&sort=name`. Deux pièges contournés :
  `page` est **indexé à 0**, et sans `sort` explicite l'ordre est instable — des lignes sautent
  d'une page à l'autre. `sort=name` (valeur non reconnue → tri alphabétique) donne un ordre
  total stable, et les lignes sont dédoublonnées par id.
- **Cartes hors collection** (marché, toutes les cartes) : l'id n'est pas dans le DOM. Le titre
  affiché est résolu en id via la table publique `cards` de Supabase, par lots de 40, avec la clé
  anonyme publique lue dans le bundle du site. Résultat mis en cache.
- **Détection des cartes** : remontée depuis chaque `<h3>` jusqu'au premier ancêtre contenant la
  pastille de rareté. Aucune classe Tailwind générée n'est utilisée comme sélecteur, donc un
  changement de style côté site ne casse rien.
- **Détection de la grille** (pour placer la barre de tri et réordonner) : l'ancêtre qui a le plus
  d'enfants directs contenant une carte. Remonter « tant qu'il n'y a qu'un enfant » ne marchait
  pas sur le marché, où chaque tuile est doublée d'un bloc enchère — la barre finissait insérée
  *dans* la grille, à la place d'une carte.

## Limites connues

- Le tri « global » n'existe que sur `/collection` (c'est la seule page dont l'extension peut
  récupérer l'intégralité du contenu). Ailleurs, le tri porte sur les cartes visibles.
- La vue liste ne peut pas ouvrir la fiche native d'une carte (c'est un état interne React) ;
  elle propose à la place les 10 dernières ventes en place et un lien vers l'article Wikipédia.
- `total` renvoyé par l'API est incohérent (540 annoncé, 590 lignes réelles) — l'extension ne s'y
  fie pas et pagine jusqu'à la page vide.
- Si le site ajoute un vrai tri `sort=name`, l'ordre de pagination changera (mais restera stable).
- Les appels de l'extension sont authentifiés par ton cookie de session, comme le site lui-même.
  Rien ne sort vers un serveur tiers.

## Structure

```
manifest.json
src/settings.js    réglages + utilitaires de format
src/cache.js       cache prix + dictionnaire titre→carte
src/api.js         API du site, Supabase, stats, pool de requêtes
src/badges.js      détection des cartes, badges, tri de la grille
src/sortview.js    barre d'outils + vue liste
src/main.js        orchestration, observation du DOM, navigation SPA
src/styles.css
popup/             réglages
```
