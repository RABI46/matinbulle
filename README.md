# Matinbulle

Maquette web du réveil et de la routine matinale pensés pour le TDAH : trois écrans (réveil, routine, widgets), un fond qui glisse de la nuit à l'aube puis passe au jour après le réveil, une jauge de temps à trois niveaux et un arrêt par maintien de 1,5 s.

HTML, CSS et JavaScript sans build ni dépendance : `index.html`, `styles.css`, `app.js`, `logic.js`, `sounds.js`.

## Lancer en local

```bash
python3 -m http.server 8000
```

Puis ouvrir <http://localhost:8000>.

Rien à installer : pas de `npm install`, pas d'étape de compilation. Les scripts sont des modules ES (`type="module"`), donc il faut passer par un serveur HTTP — ouvrir `index.html` directement en `file://` ne chargerait rien.

## Vérifier

```bash
node check.mjs
```

Attendu : `checks ok — 41 tokens, ratios mesurés`, code de sortie 0. Node 18 ou plus, aucun paquet à installer.

`check.mjs` couvre trois familles de vérifications :

- **Logique** (`logic.js`, `sounds.js`) : jour de la semaine, prochain réveil (heure déjà passée, liste de jours vide), formats de durée, six étapes de routine = 31 min, vingt sonneries aux identifiants uniques dont aucune note ne dépasse la durée annoncée, rampé d'aube à cinq paliers sur 12 min avec interpolation continue et plafond, et les trois niveaux de temps (≥ 15 min « Large », 5–15 « On accélère », < 5 « C'est l'heure »).
- **Ratios WCAG AA** : le script relit les tokens de `styles.css`, recalcule le contraste de chaque paire texte/fond réellement utilisée et échoue dès qu'un ratio descend sous son seuil (texte principal de nuit ≥ 14:1, texte de jour ≥ 15:1, libellé du bouton principal ≥ 4,5:1, niveaux de temps ≥ 5,5:1, barres ≥ 3:1…). Changer une couleur sans revérifier casse donc le check.
- **Garde-fous du geste d'arrêt** : bouton de maintien présent, aucune étoile à toucher (`class="stars"` interdit), `HOLD_MS = 1500` dans `app.js`, et l'écran « Tu es debout. » avec une seule action, « Je suis levé ».

## Tokens couleur

Extrait de `:root` dans `styles.css` (la liste complète, 41 tokens, est dans le fichier) :

| token | valeur | usage |
| --- | --- | --- |
| `--nuit-900` | `#14181D` | fond de nuit |
| `--nuit-800` | `#1B2026` | carte de nuit |
| `--aube-800` | `#5A3A29` | palier 9 min, widget Défi |
| `--aube-700` | `#6E4630` | dernier palier d'aube |
| `--ambre-400` | `#F2C078` | heure et accents de nuit |
| `--creme-nuit` | `#F4E9DE` | texte de nuit |
| `--jour-50` | `#FBF6EE` | fond de jour |
| `--carte` | `#FFFCF7` | carte de jour |
| `--encre-900` | `#241F1B` | texte de jour |
| `--action-jour` | `#C2410C` | seule couleur d'action, jour |
| `--action-nuit` | `#F2A24E` | seule couleur d'action, nuit |
| `--temps-large` | `#33543E` | niveau « Large » |
| `--temps-presse` | `#6B4A08` | niveau « On accélère » |
| `--temps-partir` | `#8C3A26` | niveau « C'est l'heure » |
| `--temps-large-nuit` | `#7FB08D` | « Large » sur fond nuit |
| `--temps-presse-nuit` | `#E3B24B` | « On accélère » sur fond nuit |
| `--temps-partir-nuit` | `#F08A6A` | « C'est l'heure » sur fond nuit |

Un niveau de temps est toujours doublé d'un mot : la couleur ne porte jamais l'information seule.
