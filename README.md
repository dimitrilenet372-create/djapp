# Le bac

Une page web pour nettoyer tes playlists SoundCloud : elle les affiche comme dans une app de musique, retire les doublons, relie les versions d'un même titre (original, remix, edit, bootleg), compare ou fusionne deux playlists, les range par style, puis recrée la version propre sur ton compte.

Tout tourne dans le navigateur, sans serveur : c'est une page statique, faite pour GitHub Pages.

## Mettre en ligne sur GitHub Pages

1. Crée un dépôt GitHub et envoie-y le contenu de ce dossier (`index.html` doit être à la racine).
2. Dans le dépôt : **Settings**, puis **Pages**.
3. Source : **Deploy from a branch**, branche `main`, dossier `/ (root)`, puis **Save**.
4. Après une minute, la page est disponible à `https://TON-COMPTE.github.io/NOM-DU-DEPOT/`.

Pour l'essayer en local : `npx serve .` puis ouvre l'adresse affichée. Les modules JavaScript ne se chargent pas en double-cliquant sur `index.html`.

## Utilisation

L'écran ressemble à une app de musique : un bouton **Ajouter une playlist**, et dessous tes playlists en pochettes.

1. **Ajouter.** Le bouton ouvre deux étapes : glisse le favori **Ajouter à Le bac** dans ta barre de favoris (une seule fois), puis ouvre ta playlist sur soundcloud.com et clique dessus. Elle arrive dans l'app avec ses pochettes. Le favori lit aussi un titre seul et ta page **Likes** (profil, onglet Likes) : tes titres aimés deviennent une playlist « Likes de … », jusqu'à plusieurs milliers de titres. Sinon, tu peux coller des titres ou importer un fichier.
2. **Entrer dans une playlist.** Les doublons sont barrés et marqués. **Retirer N doublons** les enlève d'un clic (le premier exemplaire est gardé), avec un bouton Annuler. Le × retire un titre, le nom se modifie au clic. Les remix, edits et bootlegs d'un même titre sont reliés par un badge : ce ne sont pas des doublons.
3. **Comparer ou fusionner.** Sur l'accueil, le rond en haut à droite d'une pochette sélectionne une playlist. Avec deux choisies : **Comparer** (en commun, seulement dans l'une, seulement dans l'autre) ou **Fusionner** (une nouvelle playlist sans doublons). Les originales ne changent pas.
4. **Ranger par style** découpe une playlist en playlists de même style (house, techno, drum & bass…), pratique pour préparer des sets.
5. **Recréer sur SoundCloud.** Voir ci-dessous. **Exporter en CSV** garde aussi une copie de la liste.

Les playlists restent dans ton navigateur : rien n'est envoyé à un serveur.

## Écouter et enchaîner

- **Lecteur.** Clique sur la pochette d'un titre pour l'écouter : un lecteur apparaît en bas (précédent, pause, suivant) et enchaîne les titres de la playlist, doublons exceptés. C'est le lecteur officiel de SoundCloud : il ne joue que les titres que leurs artistes autorisent hors de SoundCloud. Pour les autres, ouvre le titre sur SoundCloud (lien dans le lecteur). Un titre sans lien ni identifiant SoundCloud n'a pas de bouton d'écoute.
- **Idées d'enchaînement.** Dans le lecteur, ce bouton liste les autres versions du titre écouté (original, remix, edit) trouvées dans toutes tes playlists, avec un lien pour chercher ses remixes sur SoundCloud, puis les titres de la même playlist au même style. Le tempo n'est utilisé que s'il est indiqué (SoundCloud ne le fournit pas toujours) ; la tonalité n'est pas disponible. **Jouer ensuite** place le titre juste après celui en cours.

## Recréer une playlist sur SoundCloud

1. Dans la playlist, clique sur **Recréer sur SoundCloud** : l'app copie les titres et affiche les étapes.
2. Une seule fois, glisse le bouton vert **Envoyer à SoundCloud** dans ta barre de favoris.
3. Ouvre soundcloud.com, connecté à ton compte, et clique sur le favori. Il demande confirmation, puis crée une playlist **privée** au nom de la playlist, et indique le nombre de titres réellement ajoutés.

Le navigateur peut demander l'autorisation de lire le presse-papiers : accepte, ou colle le texte dans la boîte qui s'ouvre. Les titres arrivent par leur identifiant SoundCloud (connu quand la playlist a été ajoutée avec le favori) ou, à défaut, par leur lien ; un titre sans lien est ignoré. SoundCloud limite une playlist à 500 titres : au-delà, elle est découpée en « Nom (1) », « Nom (2) »…

Ce favori utilise la session ouverte sur soundcloud.com et le fonctionnement interne du site, pas l'API officielle. Il n'a été testé que contre une simulation de SoundCloud : si le nombre de titres annoncé est inférieur à ce qui est attendu, ou si une erreur s'affiche, note le message.

## Formats acceptés

- **Texte** : un titre par ligne, `Artiste - Titre`. Champs facultatifs séparés par `|` : genre, BPM, lien SoundCloud.
  `Daft Punk - One More Time | House | 123 | https://soundcloud.com/...`
- **CSV** : colonnes `Titre`, `Artiste`, `Genre`, `BPM`, `Lien`, `Origine` (l'export de l'outil se réimporte tel quel).
- **JSON** : un objet par titre avec `title`, `uploader`, `genre`, `tags`, `duration`, `webpage_url`.

Pour lire une playlist SoundCloud avec le genre de chaque titre, installe [yt-dlp](https://github.com/yt-dlp/yt-dlp) et lance :

```
yt-dlp --print "%(.{title,uploader,genre,tags,duration,webpage_url})j" "LIEN_DE_LA_PLAYLIST" > playlist1.json
```

Puis importe `playlist1.json` dans la carte de la playlist.

## Limites actuelles

- Le style vient du genre renseigné sur SoundCloud, puis des tags et des mots du titre. Sans genre, le rangement est approximatif : déplace les titres à la main ou importe un fichier avec les genres.
- Le favori s'appuie sur le fonctionnement interne du site SoundCloud, pas sur son API officielle : il peut cesser de marcher si SoundCloud change. Les autres méthodes (texte, fichier) restent possibles. Il a été testé contre une simulation de SoundCloud, pas encore sur le vrai site.
- Un lien de playlist collé dans l'app n'est pas lu : un navigateur ne peut pas interroger SoundCloud depuis une autre page.
- Pas encore de suggestions de nouveaux sons, ni de BPM ou de tonalité.

## Suite prévue

1. **Découverte** : recherche de titres par genre et plage de BPM via l'API SoundCloud, classés par proximité avec tes playlists.
2. **Envoi officiel vers SoundCloud** : remplacer le favori d'envoi par l'API officielle. Il faut un abonnement Artist Pro pour obtenir les identifiants, et probablement une petite fonction serverless gratuite (Cloudflare Workers, par exemple), car une page statique ne peut pas garder un secret d'application.
3. **Matching DJ** : BPM et tonalité (roue Camelot) pour proposer des enchaînements.

## Développement

```
npm install
npm test
```

- `js/core.js` : lecture des données, doublons, versions, styles, exports (aucune dépendance au navigateur)
- `js/library.js` : playlists, nettoyage, fusion, comparaison, rangement par style, versions et enchaînements, enregistrement
- `js/bookmarklet.js` : code des deux favoris (import et envoi vers SoundCloud)
- `js/app.js` : interface
- `test/` : tests de la logique et de l'interface (jsdom)
