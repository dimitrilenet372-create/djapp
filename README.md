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

1. Colle tes titres dans une carte de playlist, ou importe un fichier. Le bouton **Essayer avec un exemple** montre le résultat tout de suite.
2. Clique sur **Ranger mes playlists**.
3. Réorganise :
   - clique sur des titres pour les sélectionner, puis choisis un bac dans la barre du bas ;
   - ou glisse-les d'un bac à l'autre (ou sur « Nouveau bac ») ;
   - renomme un bac en cliquant sur son nom.
4. Onglet **Doublons** : garde un titre retiré par erreur. Onglet **Versions** : réunis un titre et ses remixes dans le même bac.
5. Exporte en ZIP (une liste par bac, le CSV complet, les doublons retirés) ou en CSV.

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
- Les liens de playlist ne sont pas lus directement : un navigateur ne peut pas lire SoundCloud sans passer par leur API.
- Pas encore de suggestions de nouveaux sons, de BPM ni de tonalité, ni d'envoi vers SoundCloud.

## Suite prévue

1. **Découverte** : recherche de titres par genre et plage de BPM via l'API SoundCloud, classés par proximité avec tes bacs.
2. **Envoi vers SoundCloud** : création des playlists via l'API. Il faut un abonnement Artist Pro pour obtenir les identifiants, et probablement une petite fonction serverless gratuite (Cloudflare Workers, par exemple), car une page statique ne peut pas garder un secret d'application.
3. **Matching DJ** : BPM et tonalité (roue Camelot) pour proposer des enchaînements.

## Développement

```
npm install
npm test
```

- `js/core.js` : lecture des données, doublons, versions, styles, exports (aucune dépendance au navigateur)
- `js/zip.js` : création du ZIP
- `js/app.js` : interface
- `test/` : tests de la logique et de l'interface (jsdom)
