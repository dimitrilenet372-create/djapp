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

1. **Ajouter.** Le bouton ouvre deux étapes : glisse le favori **Ajouter à Le bac** dans ta barre de favoris (une seule fois), puis ouvre ta playlist sur soundcloud.com et clique dessus. Elle arrive dans l'app avec ses pochettes. Le favori lit aussi un titre seul, la page « Sons similaires » d'un titre et ta page **Likes** (profil, onglet Likes) : tes titres aimés deviennent une playlist « Likes de … », jusqu'à plusieurs milliers de titres. Sinon, tu peux coller des titres ou importer un fichier.
2. **Entrer dans une playlist.** Les doublons sont barrés et marqués. **Retirer N doublons** les enlève d'un clic (le premier exemplaire est gardé), avec un bouton Annuler. Le × retire un titre, le nom se modifie au clic. Les remix, edits et bootlegs d'un même titre sont reliés par un badge : ce ne sont pas des doublons.
3. **Comparer ou fusionner.** Sur l'accueil, le rond en haut à droite d'une pochette sélectionne une playlist. Avec deux choisies : **Comparer** (en commun, seulement dans l'une, seulement dans l'autre) ou **Fusionner** (une nouvelle playlist sans doublons). Les originales ne changent pas.
4. **Ranger par style** découpe une playlist en playlists de même style (house, techno, drum & bass…), pratique pour préparer des sets.
5. **Recréer sur SoundCloud.** Voir ci-dessous. **Exporter en CSV** garde aussi une copie de la liste.

Les playlists restent dans ton navigateur : rien n'est envoyé à un serveur.

## Sur le téléphone (synchro)

Les playlists sont gardées dans le navigateur de chaque appareil. Pour les retrouver ailleurs, clique sur **Sur mon téléphone** (sous les onglets, ou en bas de page) :

1. Crée une clé GitHub (le lien prérempli coche déjà « gist ») et colle-la dans la fenêtre. L'app crée un **Gist privé** à ton nom qui contient ta bibliothèque.
2. Copie le lien affiché et ouvre-le sur le téléphone, une fois. Les playlists apparaissent.
3. Ensuite, tout changement fait d'un côté arrive de l'autre : à l'ouverture de la page, au retour sur l'onglet, et quelques secondes après chaque modification.

Le lien contient ta clé : ne le partage pas. Pour arrêter, **Arrêter la synchro sur cet appareil** (les playlists restent). Si les deux appareils changent la même chose en même temps, ce qui existe d'un côté et pas de l'autre est conservé, donc une playlist supprimée peut revenir. L'ajout d'une playlist par le favori reste à faire sur l'ordinateur (soundcloud.com) : le téléphone sert à retrouver, écouter et ordonner.

## Tonalité et BPM sur chaque ligne

SoundCloud ne donne la tonalité et le tempo que si l'artiste les a écrits. Pour les autres, l'app les cherche toute seule dans [GetSongBPM](https://getsongbpm.com), une base gratuite : dès qu'une playlist est ajoutée ou ouverte, les lignes se remplissent (« … » pendant la recherche, puis par exemple `8A` et `126 BPM`).

Il faut une seule chose, une fois : une **clé gratuite**, à demander sur getsongbpm.com/api (elle arrive par e-mail) et à coller dans l'app. Avec la synchro « Sur mon téléphone », la clé suit sur le téléphone.

- Les remixes et edits sont ignorés (leur tonalité peut différer de l'original), et les valeurs que tu as déjà saisies ne sont jamais écrasées.
- Les tonalités trouvées ont une bordure en pointillés : à vérifier à l'oreille.
- Les morceaux récents ou peu connus manquent souvent dans la base : clique sur **+ clé** pour les saisir.
- Le bouton **Trouver les tonalités** relance la recherche à la main et permet d'annuler le résultat.

## Titres à récupérer

Quand l'artiste propose un titre en téléchargement gratuit ou avec un lien d'achat, la ligne porte une pastille **Gratuit** ou **Achat**, et le bouton **Titres à récupérer** de la playlist liste ces titres avec leurs liens (et copie tous les liens d'un coup). Une fois les fichiers sur ton ordinateur, tu les mixes dans Mixxx, Serato ou rekordbox, y compris en soirée. C'est l'artiste qui décide : certains demandent de le suivre ou de passer par sa page avant d'ouvrir le téléchargement.

## Playlists et sets

L'accueil a deux onglets : **Playlists** (tes playlists) et **Sets DJ** (les playlists ordonnées pour le DJ, repérées par une pastille SET). Un set créé s'ouvre dans son onglet ; une playlist passe dans **Sets DJ** dès que tu l'ordonne pour DJer.

## Créer un set DJ

1. Sur l'accueil, choisis deux playlists (ou plus) avec le bouton **Choisir**, puis **Créer un set DJ**.
2. L'app les réunit sans doublons et met les titres dans un ordre qui s'enchaîne : on part du premier titre, puis on prend à chaque fois celui qui se mixe le mieux avec le précédent. Une version d'un titre (remix, edit) se place juste à côté de l'original.
3. Entre chaque titre, une ligne dit pourquoi ils vont ensemble (même style, style voisin, tempo proche) et signale en orange **À préparer** les vrais changements de style ou de tempo, là où il faut préparer la transition.
4. Les titres qui ne vont avec aucun autre (par exemple un seul rap dans une sélection house et techno) sont mis dans une playlist **À part**, pour ne pas casser le set. Rien n'est supprimé.
5. Ajuste à la main avec ▲ et ▼, ou clique sur **Réordonner le set**. **Ordonner pour DJer** fait la même chose sur une playlist ordinaire. Puis **Recréer sur SoundCloud** pour garder l'ordre sur ton compte.

Ce qui sert à juger : le style (genre SoundCloud, tags, titre), le tempo et la **tonalité** quand ils sont connus. La tonalité s'écrit en code Camelot (8A = la mineur, 8B = do majeur), comme dans Serato, rekordbox et Mixed In Key : deux titres se mixent bien quand leurs cases sont les mêmes, voisines (8A et 9A) ou relatives (8A et 8B). Chaque enchaînement du set le dit (« tonalités voisines », « à surveiller », « s'opposent »).

D'où viennent les tonalités : le favori reprend celle que l'artiste a indiquée sur SoundCloud (champ de tonalité, tags, début de la description, par exemple « Camelot 8A » ou « key: Am »). SoundCloud ne la renseigne pas toujours : sinon clique sur **+ clé** sous un titre pour la saisir (8A, Am, F# minor…), avec le tempo. L'app n'analyse pas l'audio : ni SoundCloud ni le navigateur ne lui donnent le son. Pour une analyse automatique, passe tes fichiers dans Mixxx, Serato ou Mixed In Key, puis reporte les valeurs ici.

## Écouter et enchaîner

- **Lecteur.** Clique sur un titre (n'importe où sur sa ligne) pour l'écouter : un lecteur apparaît en bas (précédent, pause, suivant) et enchaîne les titres de la playlist, doublons exceptés. C'est le lecteur officiel de SoundCloud : il ne joue que les titres que leurs artistes autorisent hors de SoundCloud. Pour les autres, ouvre le titre sur SoundCloud (lien dans le lecteur). Un titre sans lien ni identifiant SoundCloud n'a pas de bouton d'écoute.
- **Idées d'enchaînement.** Dans le lecteur, ce bouton liste les autres versions du titre écouté (original, remix, edit) trouvées dans toutes tes playlists, avec un lien pour chercher ses remixes sur SoundCloud, puis les titres de la même playlist au même style. Le tempo n'est utilisé que s'il est indiqué (SoundCloud ne le fournit pas toujours) ; la tonalité n'est pas disponible. **Jouer ensuite** place le titre juste après celui en cours.

## Recréer une playlist sur SoundCloud

1. Dans la playlist, clique sur **Recréer sur SoundCloud** : l'app copie les titres et affiche les étapes.
2. Une seule fois, glisse le bouton vert **Envoyer à SoundCloud** dans ta barre de favoris.
3. Ouvre soundcloud.com, connecté à ton compte, et clique sur le favori. Il demande confirmation, puis crée une playlist **privée** au nom de la playlist, et indique le nombre de titres réellement ajoutés.

Le navigateur peut demander l'autorisation de lire le presse-papiers : accepte, ou colle le texte dans la boîte qui s'ouvre. Les titres arrivent par leur identifiant SoundCloud (connu quand la playlist a été ajoutée avec le favori) ou, à défaut, par leur lien ; un titre sans lien est ignoré. SoundCloud limite une playlist à 500 titres : au-delà, elle est découpée en « Nom (1) », « Nom (2) »…

Ce favori utilise la session ouverte sur soundcloud.com et le fonctionnement interne du site, pas l'API officielle. Il n'a été testé que contre une simulation de SoundCloud : si le nombre de titres annoncé est inférieur à ce qui est attendu, ou si une erreur s'affiche, note le message.

## Exporter vers Serato DJ

Serato lit SoundCloud seulement avec l'abonnement SoundCloud Go+. Sans lui, Serato joue les fichiers audio de l'ordinateur : **Exporter pour Serato** (dans une playlist ou un set) les retrouve et prépare une crate.

1. **Choisir le dossier** de musique. Rien n'est envoyé : l'app lit seulement les noms des fichiers (`Artiste - Titre.mp3`, sous-dossiers compris).
2. **Coller son chemin complet** (`C:\Users\Moi\Music`), que le navigateur ne connaît pas. Il est retenu pour la fois suivante.
3. **Télécharger la crate Serato** et ranger le fichier `.crate` dans le dossier indiqué (`…\Music\_Serato_\Subcrates` ; pour un autre disque, `D:\_Serato_\Subcrates`), puis relancer Serato. La crate garde l'ordre de la playlist. **ou en M3U** sert pour Rekordbox, Traktor, VirtualDJ ou djay.

Les titres sans fichier sont listés avec des liens pour les récupérer (SoundCloud si l'artiste autorise le téléchargement, Beatport, Bandcamp). Un remix ne prend pas le fichier de l'original. La crate suit le format lu par Serato (vérifié avec la bibliothèque serato-tools), pas encore testée dans Serato lui-même.

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
- `js/serato.js` : fichiers audio retrouvés, crate Serato et M3U
- `js/app.js` : interface
- `test/` : tests de la logique et de l'interface (jsdom)
