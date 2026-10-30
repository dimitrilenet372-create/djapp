# Le bac

Une page web pour ranger tes playlists SoundCloud : elle fusionne plusieurs playlists, retire les doublons, relie les versions d'un même titre (original, remix, edit, bootleg) et regroupe tout par style dans des bacs que tu réorganises à la souris.

Tout tourne dans le navigateur, sans serveur : c'est une page statique, faite pour GitHub Pages.

## Mettre en ligne sur GitHub Pages

1. Crée un dépôt GitHub et envoie-y le contenu de ce dossier (`index.html` doit être à la racine).
2. Dans le dépôt : **Settings**, puis **Pages**.
3. Source : **Deploy from a branch**, branche `main`, dossier `/ (root)`, puis **Save**.
4. Après une minute, la page est disponible à `https://TON-COMPTE.github.io/NOM-DU-DEPOT/`.

Pour l'essayer en local : `npx serve .` puis ouvre l'adresse affichée. Les modules JavaScript ne se chargent pas en double-cliquant sur `index.html`.

## Utilisation

1. Ajoute tes playlists : avec le favori **Ajouter à Le bac** depuis SoundCloud (voir plus bas), en collant des titres, ou en important un fichier. Le bouton **Essayer avec un exemple** montre le résultat tout de suite. Les playlists ajoutées restent dans ton navigateur ; **Tout effacer** repart de zéro.
2. Clique sur **Ranger mes playlists**.
3. Réorganise :
   - clique sur des titres pour les sélectionner, puis choisis un bac dans la barre du bas ;
   - ou glisse-les d'un bac à l'autre (ou sur « Nouveau bac ») ;
   - renomme un bac en cliquant sur son nom.
4. Onglet **Doublons** : garde un titre retiré par erreur. Onglet **Versions** : réunis un titre et ses remixes dans le même bac.
5. Exporte en ZIP (une liste par bac, le CSV complet, les doublons retirés) ou en CSV.

## Ajouter une playlist en un clic

1. Sur la page de l'app, glisse le bouton jaune **Ajouter à Le bac** dans ta barre de favoris (Ctrl+Maj+B pour l'afficher). Si le glisser ne marche pas, clique sur **Copier le code du favori**, crée un favori à la main et colle le code à la place de l'adresse.
2. Ouvre une playlist (ou un titre) sur soundcloud.com et clique sur le favori.
3. Un bandeau bleu indique la progression, puis l'app s'ouvre avec la playlist ajoutée. Recommence avec une autre playlist : elle s'ajoute dans le même onglet.

Le favori lit les titres, genres, tags et liens que la page SoundCloud charge déjà, puis les envoie à l'app dans l'adresse (`#import=…`) : rien ne passe par un serveur.

## Recréer tes bacs sur SoundCloud

1. Glisse aussi le bouton vert **Envoyer à SoundCloud** dans ta barre de favoris.
2. Range tes playlists dans l'app, puis clique sur **Copier pour SoundCloud** (ou **Envoyer ce bac** dans un bac).
3. Ouvre soundcloud.com, connecté à ton compte, et clique sur le favori. Il demande confirmation, puis crée une playlist **privée** par bac, au nom du bac, et indique pour chacune le nombre de titres réellement ajoutés.

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

1. **Découverte** : recherche de titres par genre et plage de BPM via l'API SoundCloud, classés par proximité avec tes bacs.
2. **Envoi officiel vers SoundCloud** : remplacer le favori d'envoi par l'API officielle. Il faut un abonnement Artist Pro pour obtenir les identifiants, et probablement une petite fonction serverless gratuite (Cloudflare Workers, par exemple), car une page statique ne peut pas garder un secret d'application.
3. **Matching DJ** : BPM et tonalité (roue Camelot) pour proposer des enchaînements.

## Développement

```
npm install
npm test
```

- `js/core.js` : lecture des données, doublons, versions, styles, exports (aucune dépendance au navigateur)
- `js/zip.js` : création du ZIP
- `js/bookmarklet.js` : code des deux favoris (import et envoi vers SoundCloud)
- `js/app.js` : interface
- `test/` : tests de la logique et de l'interface (jsdom)
