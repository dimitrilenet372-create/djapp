// Le favori est exécuté contre un faux SoundCloud : même code que celui du favori réel.
import test from 'node:test';
import assert from 'node:assert/strict';
import { extractor, bookmarkletCode, bookmarkletHref, pusher, pusherCode, pusherHref } from '../js/bookmarklet.js';
import * as core from '../js/core.js';

const APP = 'https://exemple.github.io/djapp/';

function fakeWin({ hostname = 'soundcloud.com', pathname = '/moi/sets/ma-playlist', hydration, resources = [], responses }) {
  const calls = [];
  const notes = [];
  const win = {
    __sc_hydration: hydration,
    location: { hostname, origin: `https://${hostname}`, pathname, href: '' },
    document: {
      body: { appendChild() {} },
      createElement: () => ({
        style: {},
        remove() {},
        set textContent(v) { notes.push(v); },
      }),
    },
    performance: { getEntriesByType: () => resources },
    setTimeout: () => 0,
    btoa,
    open(url, target) { win.opened = { url, target }; return {}; },
    async fetch(url) {
      calls.push(url);
      const u = new URL(url);
      const path = u.pathname.slice(1);
      const body = responses(path, u.searchParams);
      return { ok: body !== null, status: body === null ? 404 : 200, json: async () => body };
    },
  };
  return { win, calls, notes };
}

const full = (id, over = {}) => ({
  id, kind: 'track', title: `Titre ${id}`, genre: 'House', tag_list: 'house "deep house" techno',
  duration: 245000, permalink_url: `https://soundcloud.com/a/t${id}`, user: { username: 'uploader' }, ...over,
});

test('playlist : titres détaillés + lots de titres manquants, ordre conservé', async () => {
  const stubs = Array.from({ length: 120 }, (_, i) => ({ id: 100 + i, kind: 'track' }));
  const { win, calls } = fakeWin({
    hydration: [{ hydratable: 'apiClient', data: { id: 'CID123' } }],
    responses: (path, q) => {
      if (path === 'resolve') {
        assert.equal(q.get('url'), 'https://soundcloud.com/moi/sets/ma-playlist');
        return { kind: 'playlist', title: 'Ma playlist é', tracks: [full(1, { publisher_metadata: { artist: 'Vrai Artiste' } }), ...stubs] };
      }
      if (path === 'tracks') {
        const ids = q.get('ids').split(',').map(Number);
        assert.ok(ids.length <= 50);
        return ids.reverse().map((id) => full(id, { title: `Stub ${id}`, genre: '' }));
      }
      return null;
    },
  });
  await extractor(win, APP);
  assert.ok(calls.every((c) => c.includes('client_id=CID123')));
  assert.equal(calls.filter((c) => c.includes('/tracks?')).length, 3); // 120 titres = 3 lots de 50 max
  assert.equal(win.opened.target, 'lebac');
  assert.ok(win.opened.url.startsWith(APP + '#import='));

  const imp = core.decodeImport(win.opened.url.slice(APP.length - 1 + 0).replace(/^.*?(#import=)/, '$1'));
  assert.equal(imp.name, 'Ma playlist é');
  assert.equal(imp.tracks.length, 121);
  assert.equal(imp.tracks[0].uploader, 'Vrai Artiste');
  assert.deepEqual(imp.tracks[0].tags, ['house', 'deep house', 'techno']);
  assert.equal(imp.tracks[0].duration, 245);
  assert.equal(imp.tracks[0].id, 1, "l'identifiant SoundCloud est transmis");
  assert.equal(imp.tracks[1].title, 'Stub 100'); // l'ordre de la playlist est conservé
  assert.equal(imp.tracks[120].title, 'Stub 219');

  const parsed = core.parseEntries(imp.tracks, 'X');
  assert.equal(parsed.length, 121);
  assert.equal(parsed[0].artist, 'Vrai Artiste');
  assert.equal(parsed[0].genre, 'House');
});

test('identifiant retrouvé dans les requêtes déjà faites par la page', async () => {
  const { win, calls } = fakeWin({
    hydration: undefined,
    resources: [{ name: 'https://api-v2.soundcloud.com/me?x=1&client_id=ABC999&y=2' }],
    pathname: '/artiste/un-titre',
    responses: (path) => (path === 'resolve' ? full(7) : null),
  });
  await extractor(win, APP);
  assert.ok(calls[0].includes('client_id=ABC999'));
  const imp = core.decodeImport('#' + win.opened.url.split('#')[1]);
  assert.equal(imp.tracks.length, 1);
  assert.equal(imp.name, 'Titre 7');
});

test('messages clairs : mauvais site, pas d\'identifiant, erreur SoundCloud, page non supportée', async () => {
  let r = fakeWin({ hostname: 'example.com', hydration: [], responses: () => null });
  await extractor(r.win, APP);
  assert.match(r.notes.at(-1), /ouvre une playlist sur soundcloud\.com/);
  assert.equal(r.win.opened, undefined);

  r = fakeWin({ hydration: [], responses: () => null });
  await extractor(r.win, APP);
  assert.match(r.notes.at(-1), /identifiant de page introuvable/);

  r = fakeWin({ hydration: [{ hydratable: 'apiClient', data: { id: 'C' } }], responses: () => null });
  await extractor(r.win, APP);
  assert.match(r.notes.at(-1), /SoundCloud a répondu 404/);

  r = fakeWin({ hydration: [{ hydratable: 'apiClient', data: { id: 'C' } }], responses: () => ({ kind: 'user' }) });
  await extractor(r.win, APP);
  assert.match(r.notes.at(-1), /ni une playlist, ni un titre, ni une page Likes/);

  r = fakeWin({ hydration: [{ hydratable: 'apiClient', data: { id: 'C' } }], responses: () => ({ kind: 'playlist', title: 'Vide', tracks: [] }) });
  await extractor(r.win, APP);
  assert.match(r.notes.at(-1), /aucun titre trouvé/);
});

test('décodeur : refuse les adresses invalides', () => {
  assert.equal(core.decodeImport(''), null);
  assert.equal(core.decodeImport('#import=@@@'), null);
  assert.equal(core.decodeImport('#import=' + btoa('pas du json')), null);
  assert.equal(core.decodeImport('#autre=1'), null);
});

test('le code du favori est du JavaScript valide, sur une seule adresse javascript:', () => {
  const code = bookmarkletCode(APP);
  assert.doesNotThrow(() => new Function(code));
  assert.ok(code.startsWith('void (async function extractor'));
  const href = bookmarkletHref(APP);
  assert.ok(href.startsWith('javascript:'));
  assert.ok(!/\s/.test(href), 'aucune espace brute');
  assert.equal(decodeURIComponent(href.slice('javascript:'.length)), code);
  assert.ok(href.length < 20000, `longueur ${href.length}`);
});

// --------------------------------------------------------------------------- //
// Favori « Envoyer à SoundCloud »
// --------------------------------------------------------------------------- //
const payload = (lists) => 'LEBAC1:' + JSON.stringify({ v: 1, lists });

/** Faux SoundCloud : `mode` décide quelle forme de requête il accepte pour remplir une playlist. */
function pushWin({ clipboard = '', prompt = '', confirm = true, cookie = 'a=1; oauth_token=2-123%2Fabc; b=2', mode = 'post', resolve = {} } = {}) {
  const calls = [];
  const notes = [];
  const playlists = new Map();
  let nextId = 900;
  const win = {
    __sc_hydration: [{ hydratable: 'apiClient', data: { id: 'CID9' } }],
    location: { hostname: 'soundcloud.com', origin: 'https://soundcloud.com', pathname: '/', href: '' },
    document: {
      cookie,
      body: { appendChild() {} },
      createElement: () => ({ style: {}, remove() {}, set textContent(v) { notes.push(v); } }),
    },
    navigator: { clipboard: { readText: async () => { if (clipboard === null) throw new Error('refusé'); return clipboard; } } },
    prompt: (m) => { win.prompted = m; return prompt; },
    confirm: (m) => { win.confirmed = m; return confirm; },
    performance: { getEntriesByType: () => [] },
    setTimeout: () => 0,
    async fetch(url, init = {}) {
      const u = new URL(url);
      const path = u.pathname.slice(1);
      const body = init.body ? JSON.parse(init.body) : undefined;
      calls.push({ method: init.method || 'GET', path, body, auth: init.headers && init.headers.Authorization, cid: u.searchParams.get('client_id') });
      const res = (status, json) => ({ ok: status < 300, status, text: async () => JSON.stringify(json) });
      if (path === 'resolve') {
        const id = resolve[u.searchParams.get('url')];
        return id ? res(200, { kind: 'track', id }) : res(404, {});
      }
      if (init.method === 'POST' && path === 'playlists') {
        const ids = body.playlist.tracks;
        const pl = { id: nextId++, title: body.playlist.title, sharing: body.playlist.sharing, tracks: mode === 'post' ? (ids || []).map((id) => ({ id })) : [] };
        playlists.set(pl.id, pl);
        return res(200, pl);
      }
      if (init.method === 'PUT' && path.startsWith('playlists/')) {
        const pl = playlists.get(Number(path.split('/')[1]));
        const ids = body.tracks || (body.playlist && body.playlist.tracks);
        const okForm = (mode === 'put' && body.playlist && typeof ids[0] === 'number') || (mode === 'put-flat' && body.tracks);
        if (!pl || !okForm) return res(422, { error: 'nope' });
        pl.tracks = ids.map((id) => ({ id }));
        return res(200, pl);
      }
      return res(404, {});
    },
  };
  return { win, calls, notes, playlists };
}

test('envoi : crée une playlist privée par bac, avec le jeton de la session', async () => {
  const { win, calls, notes, playlists } = pushWin({
    clipboard: payload([{ name: 'House', items: [11, 12, 13] }, { name: 'Techno', items: [21, 22] }]),
  });
  await pusher(win);
  const posts = calls.filter((c) => c.method === 'POST');
  assert.equal(posts.length, 2);
  assert.deepEqual(posts[0].body, { playlist: { title: 'House', sharing: 'private', tracks: [11, 12, 13] } });
  assert.ok(calls.every((c) => c.auth === 'OAuth 2-123/abc' && c.cid === 'CID9'), 'jeton décodé, identifiant de page');
  assert.equal(playlists.size, 2);
  assert.match(win.confirmed, /2 playlists PRIVÉES.*5 titres/s);
  assert.match(notes.at(-1), /House : 3 titres ✓/);
  assert.match(notes.at(-1), /Techno : 2 titres ✓/);
});

test('envoi : si la création ignore les titres, une mise à jour les ajoute', async () => {
  for (const mode of ['put', 'put-flat']) {
    const { win, calls, notes } = pushWin({ mode, clipboard: payload([{ name: 'Mix', items: [1, 2, 3] }]) });
    await pusher(win);
    assert.ok(calls.some((c) => c.method === 'PUT'), mode);
    assert.match(notes.at(-1), /Mix : 3 titres ✓/, mode);
  }
});

test('envoi : un échec de remplissage est annoncé, pas masqué', async () => {
  const { win, notes } = pushWin({ mode: 'rien', clipboard: payload([{ name: 'Mix', items: [1, 2, 3] }]) });
  await pusher(win);
  assert.match(notes.at(-1), /Mix : seulement 0 \/ 3 titres/);
});

test('envoi : les liens sont convertis en identifiants, les illisibles écartés', async () => {
  const { win, calls, notes } = pushWin({
    clipboard: payload([{ name: 'Liens', items: [5, 'https://soundcloud.com/a/un', 'https://soundcloud.com/a/inconnu'] }]),
    resolve: { 'https://soundcloud.com/a/un': 77 },
  });
  await pusher(win);
  assert.deepEqual(calls.find((c) => c.method === 'POST').body.playlist.tracks, [5, 77]);
  assert.match(notes.at(-1), /Liens : 2 titres ✓/);
});

test('envoi : plus de 500 titres, la playlist est découpée', async () => {
  const items = Array.from({ length: 1100 }, (_, i) => i + 1);
  const { win, calls } = pushWin({ clipboard: payload([{ name: 'Gros', items }]) });
  await pusher(win);
  const posts = calls.filter((c) => c.method === 'POST');
  assert.deepEqual(posts.map((p) => [p.body.playlist.title, p.body.playlist.tracks.length]), [['Gros (1)', 500], ['Gros (2)', 500], ['Gros (3)', 100]]);
});

test('envoi : presse-papiers refusé ou vide, la boîte de collage prend le relais', async () => {
  const { win, calls } = pushWin({ clipboard: null, prompt: payload([{ name: 'Collé', items: [1] }]) });
  await pusher(win);
  assert.match(win.prompted, /colle ici/);
  assert.equal(calls.filter((c) => c.method === 'POST').length, 1);
});

test('envoi : messages clairs et aucune création sans accord ni connexion', async () => {
  let r = pushWin({ clipboard: 'autre chose', prompt: '' });
  await pusher(r.win);
  assert.match(r.notes.at(-1), /Copier pour SoundCloud/);
  assert.equal(r.calls.length, 0);

  r = pushWin({ clipboard: payload([{ name: 'X', items: [1] }]), confirm: false });
  await pusher(r.win);
  assert.match(r.notes.at(-1), /annulé/);
  assert.equal(r.calls.length, 0);

  r = pushWin({ clipboard: payload([{ name: 'X', items: [1] }]), cookie: 'a=1' });
  await pusher(r.win);
  assert.match(r.notes.at(-1), /pas connecté/);
  assert.equal(r.calls.length, 0);

  r = pushWin({ clipboard: 'LEBAC1:{pas du json' });
  r.win.prompt = () => '';
  await pusher(r.win);
  assert.match(r.notes.at(-1), /pas lisible/);

  r = pushWin({ clipboard: payload([{ name: 'X', items: [1] }]) });
  r.win.location.hostname = 'example.com';
  await pusher(r.win);
  assert.match(r.notes.at(-1), /ouvre soundcloud\.com/);
});

test('charge utile de l\'app : identifiant sinon lien, le reste est écarté', () => {
  const t = (over) => core.makeTrack({ title: 'T', ...over });
  const out = core.soundcloudPayload([
    { name: 'A', tracks: [t({ scid: 42 }), t({ url: 'https://soundcloud.com/x/y' }), t({}), t({ url: 'https://soundcloud.com/x/sets/pl' }), t({ url: 'https://autre.com/x' })] },
    { name: 'Vide', tracks: [t({})] },
  ]);
  assert.equal(out.lists, 1);
  assert.equal(out.tracks, 2);
  assert.equal(out.skipped, 4);
  assert.deepEqual(JSON.parse(out.text.slice(7)).lists, [{ name: 'A', items: [42, 'https://soundcloud.com/x/y'] }]);
});

test('identifiant : repris des entrées JSON et du CSV, et ré-exporté', () => {
  const [a, b] = core.parseEntries([{ title: 'A - B', id: 123 }, { title: 'C - D', id: '456' }, { title: 'E - F', id: 'abc' }]);
  assert.equal(a.scid, 123);
  assert.equal(b.scid, 456);
  const csv = core.tracksToCsv([{ name: 'P', tracks: [a] }]);
  assert.match(csv, /ID SoundCloud/);
  const back = core.parseAny(csv);
  assert.equal(back[0].scid, 123);
});

test('le code du second favori est valide, sur une seule adresse', () => {
  const code = pusherCode();
  assert.doesNotThrow(() => new Function(code));
  const href = pusherHref();
  assert.ok(!/\s/.test(href));
  assert.equal(decodeURIComponent(href.slice('javascript:'.length)), code);
  assert.ok(href.length < 30000, `longueur ${href.length}`);
});

test('pochettes : réduites à leur identifiant, celle de la playlist et celles des titres', async () => {
  const { win } = fakeWin({
    hydration: [{ hydratable: 'apiClient', data: { id: 'C' } }],
    responses: (path) =>
      path === 'resolve'
        ? {
            kind: 'playlist', title: 'Avec pochettes', artwork_url: 'https://i1.sndcdn.com/artworks-PL-xyz-large.jpg',
            tracks: [
              full(1, { artwork_url: 'https://i1.sndcdn.com/artworks-T1-aaa-large.jpg' }),
              full(2, { artwork_url: null, user: { username: 'u', avatar_url: 'https://i1.sndcdn.com/avatars-AV-bbb-large.jpg' } }),
              full(3, { artwork_url: 'https://evil.example/x.jpg' }),
            ],
          }
        : null,
  });
  await extractor(win, APP);
  const imp = core.decodeImport('#' + win.opened.url.split('#')[1]);
  assert.equal(imp.art, 'artworks-PL-xyz');
  assert.deepEqual(imp.tracks.map((t) => t.art), ['artworks-T1-aaa', 'avatars-AV-bbb', '']);
  const parsed = core.parseEntries(imp.tracks, 'X');
  assert.equal(parsed[0].art, 'artworks-T1-aaa');
  assert.equal(parsed[0].scid, 1);
});

test('page Likes : toutes les pages de likes sont suivies, nom et titres repris', async () => {
  const mk = (from, n) => Array.from({ length: n }, (_, i) => ({ kind: 'like', track: full(from + i) }));
  const { win, calls } = fakeWin({
    pathname: '/dj-test/likes',
    hydration: [{ hydratable: 'apiClient', data: { id: 'CIDL' } }],
    responses: (path, q) => {
      if (path === 'resolve') {
        assert.equal(q.get('url'), 'https://soundcloud.com/dj-test');
        return { kind: 'user', id: 77, username: 'DJ Test' };
      }
      if (path === 'users/77/track_likes') {
        const off = Number(q.get('offset') || 0);
        if (off === 0) return { collection: mk(1, 100), next_href: 'https://api-v2.soundcloud.com/users/77/track_likes?offset=100&limit=100' };
        if (off === 100) return { collection: [...mk(101, 40), { kind: 'like', playlist: { id: 5 } }], next_href: null };
      }
      return null;
    },
  });
  await extractor(win, APP);
  const likeCalls = calls.filter((c) => c.includes('/track_likes'));
  assert.equal(likeCalls.length, 2);
  assert.ok(likeCalls.every((c) => c.includes('client_id=CIDL')));
  const imp = core.decodeImport('#' + win.opened.url.split('#')[1]);
  assert.equal(imp.name, 'Likes de DJ Test');
  assert.equal(imp.tracks.length, 140, 'les likes de playlists sont ignorés');
  assert.equal(imp.tracks[139].id, 140);
  assert.equal(imp.art, '');
});

test('page Likes de la personne connectée : /me avec son jeton', async () => {
  let auth = null;
  const { win } = fakeWin({
    pathname: '/you/likes',
    hydration: [{ hydratable: 'apiClient', data: { id: 'C' } }],
    responses: (path) => (path === 'users/9/track_likes' ? { collection: [{ track: full(1) }], next_href: null } : null),
  });
  win.document.cookie = 'x=1; oauth_token=2-5-abc';
  const base = win.fetch;
  win.fetch = async (url, init) => {
    if (new URL(url).pathname === '/me') {
      auth = init && init.headers && init.headers.Authorization;
      return { ok: true, status: 200, json: async () => ({ kind: 'user', id: 9, username: 'Moi' }) };
    }
    return base(url, init);
  };
  await extractor(win, APP);
  assert.equal(auth, 'OAuth 2-5-abc');
  assert.equal(core.decodeImport('#' + win.opened.url.split('#')[1]).name, 'Likes de Moi');

  const r = fakeWin({ pathname: '/you/likes', hydration: [{ hydratable: 'apiClient', data: { id: 'C' } }], responses: () => null });
  await extractor(r.win, APP);
  assert.match(r.notes.at(-1), /pas connecté/);
});
