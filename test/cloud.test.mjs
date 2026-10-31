import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCloud, chunkText, hashOf, explain } from '../js/cloud.js';
import * as L from '../js/library.js';
import { makeTrack } from '../js/core.js';

const sleep = (ms = 8) => new Promise((r) => setTimeout(r, ms));

/** Faux Firestore partagé par plusieurs appareils : mêmes règles de notification que le vrai (l'auteur est notifié aussi). */
function fakeServer() {
  const playlists = new Map(); // uid -> Map(id -> fields)
  const parts = new Map(); // `${uid}/${id}-${i}` -> data
  const watchers = new Set();
  const meta = new Map();
  const list = (uid) => [...(playlists.get(uid) || new Map())].map(([id, f]) => ({ id, ...f }));
  const notify = (uid) => watchers.forEach((w) => w.uid === uid && setTimeout(() => w.cb(list(uid), false), 0));
  return {
    playlists, parts, meta,
    backend(user, { failWith = null } = {}) {
      let cb = () => {};
      return {
        async onUser(fn) { cb = fn; setTimeout(() => fn(user.current), 0); return () => {}; },
        async signIn() { user.current = { uid: user.uid, name: 'Dimitri', email: 'd@x.fr' }; cb(user.current); },
        async signOut() { user.current = null; cb(null); },
        async getUserMeta(uid) { if (failWith) throw failWith; return meta.get(uid) || {}; },
        async setUserMeta(uid, o) { meta.set(uid, { ...(meta.get(uid) || {}), ...o }); },
        async watchPlaylists(uid, fn) { const w = { uid, cb: fn }; watchers.add(w); setTimeout(() => fn(list(uid), false), 0); return () => watchers.delete(w); },
        async readParts(uid, id, n) { return Array.from({ length: n }, (_, i) => parts.get(`${uid}/${id}-${i}`) ?? '').join(''); },
        async writePlaylist(uid, m, ps, prev = 0) {
          if (failWith) throw failWith;
          ps.forEach((d, i) => parts.set(`${uid}/${m.id}-${i}`, d));
          for (let i = ps.length; i < prev; i++) parts.delete(`${uid}/${m.id}-${i}`);
          const { id, ...f } = m;
          if (!playlists.has(uid)) playlists.set(uid, new Map());
          playlists.get(uid).set(id, f);
          notify(uid);
        },
        async deletePlaylist(uid, id, n) {
          playlists.get(uid)?.delete(id);
          for (let i = 0; i < n; i++) parts.delete(`${uid}/${id}-${i}`);
          notify(uid);
        },
      };
    },
  };
}

function device(server, uid = 'u1', opts = {}) {
  const user = { uid, current: null };
  const store = {};
  const dev = { lib: [], statuses: [], metas: [] };
  dev.cloud = createCloud({
    backend: server.backend(user, opts),
    getLib: () => dev.lib,
    setLib: (lib) => { dev.lib = lib; },
    pack: (pl) => L.serialize([pl]),
    unpack: (text) => L.deserialize(text)[0] || null,
    loadKnown: (u) => JSON.parse(JSON.stringify(store[u] || {})),
    saveKnown: (u, k) => { store[u] = JSON.parse(JSON.stringify(k)); },
    onStatus: (s) => dev.statuses.push(s),
    onMeta: (m) => dev.metas.push(m),
    delay: 5,
  });
  dev.user = user;
  dev.settle = async () => { for (let i = 0; i < 4; i++) { await sleep(); await dev.cloud.idle(); } };
  dev.names = () => dev.lib.map((p) => p.name).sort();
  return dev;
}
const mk = (name, n = 3) => L.newPlaylist(name, Array.from({ length: n }, (_, i) => makeTrack({ artist: `A${i}`, title: `${name} titre ${i}` })));

test('un premier appareil envoie ses playlists, un second les reçoit', async () => {
  const srv = fakeServer();
  const a = device(srv);
  a.lib = [mk('Soirée'), mk('Chill', 5)];
  a.user.current = { uid: 'u1', name: 'D', email: 'd@x.fr' };
  await a.cloud.start(); await a.settle();
  assert.equal(srv.playlists.get('u1').size, 2);

  const b = device(srv);
  b.user.current = { uid: 'u1', name: 'D', email: 'd@x.fr' };
  await b.cloud.start(); await b.settle();
  assert.deepEqual(b.names(), ['Chill', 'Soirée']);
  assert.equal(b.lib.find((p) => p.name === 'Chill').tracks.length, 5);
});

test('une modification ici arrive là-bas, et inversement', async () => {
  const srv = fakeServer();
  const a = device(srv); const b = device(srv);
  a.lib = [mk('Soirée')];
  for (const d of [a, b]) { d.user.current = { uid: 'u1', name: 'D', email: '' }; await d.cloud.start(); }
  await a.settle(); await b.settle();
  assert.equal(b.lib.length, 1);

  b.lib = b.lib.map((p) => ({ ...p, name: 'Soirée été', tracks: p.tracks.slice(0, 2) }));
  b.cloud.localChanged(); await b.settle(); await a.settle();
  assert.equal(a.lib[0].name, 'Soirée été');
  assert.equal(a.lib[0].tracks.length, 2);
  assert.equal(a.lib[0].id, b.lib[0].id);
});

test('une playlist supprimée ici disparaît là-bas ; une nouvelle ici apparaît là-bas', async () => {
  const srv = fakeServer();
  const a = device(srv); const b = device(srv);
  a.lib = [mk('Un'), mk('Deux')];
  for (const d of [a, b]) { d.user.current = { uid: 'u1', name: 'D', email: '' }; await d.cloud.start(); }
  await a.settle(); await b.settle();
  a.lib = a.lib.filter((p) => p.name !== 'Un'); a.lib.push(mk('Trois'));
  a.cloud.localChanged(); await a.settle(); await b.settle();
  assert.deepEqual(b.names(), ['Deux', 'Trois']);
  assert.equal(srv.playlists.get('u1').size, 2);
  assert.equal([...srv.parts.keys()].filter((k) => k.includes('/' + a.lib[0].id) ).length >= 1, true);
});

test('modification des deux côtés en même temps : celle de l\'appareil qui l\'a faite est gardée, puis tout converge', async () => {
  const srv = fakeServer();
  const a = device(srv); const b = device(srv);
  a.lib = [mk('Soirée')];
  for (const d of [a, b]) { d.user.current = { uid: 'u1', name: 'D', email: '' }; await d.cloud.start(); }
  await a.settle(); await b.settle();
  a.lib = a.lib.map((p) => ({ ...p, name: 'Version A' }));
  b.lib = b.lib.map((p) => ({ ...p, name: 'Version B' }));
  a.cloud.localChanged(); b.cloud.localChanged();
  await a.settle(); await b.settle(); await a.settle(); await b.settle();
  assert.equal(a.lib[0].name, b.lib[0].name, 'les deux appareils finissent d\'accord');
  assert.match(a.lib[0].name, /^Version [AB]$/);
});

test('une grosse playlist est découpée en morceaux et relue en entier', async () => {
  const srv = fakeServer();
  const a = device(srv); const b = device(srv);
  const big = L.newPlaylist('Likes', Array.from({ length: 4000 }, (_, i) => makeTrack({ artist: `Artiste ${i}`, title: `Un titre assez long pour peser dans le document numéro ${i}`, genre: 'House' })));
  a.lib = [big];
  for (const d of [a, b]) { d.user.current = { uid: 'u1', name: 'D', email: '' }; await d.cloud.start(); }
  await a.settle(); await b.settle();
  const meta = [...srv.playlists.get('u1').values()][0];
  assert.ok(meta.parts > 1, `${meta.parts} morceaux`);
  assert.equal(b.lib[0].tracks.length, 4000);
  assert.equal(b.lib[0].tracks[3999].title, big.tracks[3999].title);
});

test('chunkText et hashOf', () => {
  assert.deepEqual(chunkText(''), ['']);
  assert.equal(chunkText('x'.repeat(600_000)).length, 3);
  assert.equal(chunkText('x'.repeat(600_000)).join('').length, 600_000);
  assert.equal(hashOf('abc'), hashOf('abc'));
  assert.notEqual(hashOf('abc'), hashOf('abd'));
});

test('erreurs expliquées : règles refusées, domaine non autorisé, réseau', async () => {
  assert.match(explain({ code: 'permission-denied' }), /règles/);
  assert.match(explain({ code: 'auth/unauthorized-domain' }), /Domaines autorisés/);
  assert.match(explain({ code: 'auth/popup-blocked' }), /fenêtre/);
  assert.match(explain({ code: 'unavailable' }), /connexion/);
  assert.match(explain(new Error('autre')), /autre/);

  const srv = fakeServer();
  const a = device(srv, 'u1', { failWith: { code: 'permission-denied' } });
  a.lib = [mk('Soirée')];
  a.user.current = { uid: 'u1', name: 'D', email: '' };
  await a.cloud.start(); await a.settle();
  assert.match(a.cloud.status().error, /règles/);
  assert.equal(a.lib.length, 1, 'rien n\'est perdu en local');
});

test('déconnexion : la bibliothèque locale reste ; la clé GetSongBPM suit le compte', async () => {
  const srv = fakeServer();
  const a = device(srv);
  a.lib = [mk('Soirée')];
  a.user.current = { uid: 'u1', name: 'D', email: '' };
  await a.cloud.start(); await a.settle();
  a.cloud.setMeta({ gsb: 'CLE12345' }); await sleep();
  assert.equal(srv.meta.get('u1').gsb, 'CLE12345');
  await a.cloud.signOut(); await a.settle();
  assert.equal(a.cloud.status().user, null);
  assert.equal(a.lib.length, 1);
  const b = device(srv);
  b.user.current = { uid: 'u1', name: 'D', email: '' };
  await b.cloud.start(); await b.settle();
  assert.equal(b.metas.at(-1).gsb, 'CLE12345');
});
