// Le favori est exécuté contre un faux SoundCloud : même code que celui du favori réel.
import test from 'node:test';
import assert from 'node:assert/strict';
import { extractor, bookmarkletCode, bookmarkletHref } from '../js/bookmarklet.js';
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
  assert.match(r.notes.at(-1), /ni une playlist ni un titre/);

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
  assert.ok(href.length < 8000, `longueur ${href.length}`);
});
