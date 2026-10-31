import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as SY from '../js/sync.js';

const cfg = { t: 'ghp_abcdefghijklmnopqrstuvwxyz0123456789', g: 'a1b2c3d4e5f60718' };

test('le lien de synchro se relit à l\'identique', () => {
  const link = SY.syncLink('https://x.github.io/djapp/', cfg);
  assert.match(link, /^https:\/\/x\.github\.io\/djapp\/#sync=[A-Za-z0-9_-]+$/);
  assert.deepEqual(SY.decodeSyncLink(link.slice(link.indexOf('#'))), cfg);
});

test('un lien abîmé ou étranger n\'est pas une synchro', () => {
  for (const h of ['', '#', '#import=abc', '#sync=', '#sync=%%%', '#sync=' + Buffer.from('{"t":"x","g":"y"}').toString('base64url'), '#sync=' + Buffer.from('pas du json').toString('base64url')]) {
    assert.equal(SY.decodeSyncLink(h), null, h);
  }
});

function fakeGithub() {
  const calls = [];
  let content = null;
  const f = async (url, init = {}) => {
    calls.push({ url, method: init.method || 'GET', auth: init.headers?.Authorization });
    const ok = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) });
    if (init.headers?.Authorization !== `Bearer ${cfg.t}`) return { ok: false, status: 401 };
    if (url.endsWith('/gists') && init.method === 'POST') {
      const body = JSON.parse(init.body);
      assert.equal(body.public, false, 'le Gist est privé');
      content = body.files['lebac.json'].content;
      return ok({ id: cfg.g });
    }
    if (url.endsWith(`/gists/${cfg.g}`) && init.method === 'PATCH') {
      content = JSON.parse(init.body).files['lebac.json'].content;
      return ok({});
    }
    if (url.endsWith(`/gists/${cfg.g}`)) return ok({ files: content == null ? {} : { 'lebac.json': { content } } });
    return { ok: false, status: 404 };
  };
  return { f, calls, get content() { return content; }, set content(v) { content = v; } };
}

test('créer, relire et mettre à jour le Gist', async () => {
  const gh = fakeGithub();
  const store = SY.gistStore(cfg.t, gh.f);
  assert.equal(await store.create('{"v":2}'), cfg.g);
  assert.equal(await store.read(cfg.g), '{"v":2}');
  await store.write(cfg.g, '{"v":2,"updated":5}');
  assert.equal(await store.read(cfg.g), '{"v":2,"updated":5}');
  assert.ok(gh.calls.every((c) => c.url.startsWith('https://api.github.com/')));
});

test('un fichier trop gros est relu en entier par son adresse brute', async () => {
  const f = async (url) =>
    url.includes('/gists/')
      ? { ok: true, status: 200, json: async () => ({ files: { 'lebac.json': { truncated: true, raw_url: 'https://gist.githubusercontent.com/raw', content: 'coupé' } } }) }
      : { ok: true, status: 200, text: async () => 'complet' };
  assert.equal(await SY.gistStore(cfg.t, f).read(cfg.g), 'complet');
});

test('erreurs lisibles : clé refusée, Gist absent, pas de réseau', async () => {
  const gh = fakeGithub();
  await assert.rejects(SY.gistStore('mauvaise', gh.f).read(cfg.g), (e) => e instanceof SY.SyncError && e.status === 401 && /clé/.test(e.message));
  await assert.rejects(SY.gistStore(cfg.t, gh.f).read('inconnu'), (e) => e.status === 404 && /introuvable/.test(e.message));
  const offline = async () => { throw new TypeError('Failed to fetch'); };
  await assert.rejects(SY.gistStore(cfg.t, offline).read(cfg.g), (e) => /connexion/.test(e.message));
});

test('heure du document et fusion de deux bibliothèques', () => {
  assert.equal(SY.stampOf('{"v":2,"updated":42}'), 42);
  assert.equal(SY.stampOf('{"v":2}'), 0);
  assert.equal(SY.stampOf('pas du json'), 0);
  assert.equal(JSON.parse(SY.withStamp('{"v":2,"playlists":[]}', 9)).updated, 9);
  const merged = SY.mergeLibs([{ id: 'a', name: 'local' }, { id: 'b' }], [{ id: 'a', name: 'distante' }, { id: 'c' }]);
  assert.deepEqual(merged.map((p) => p.id), ['a', 'b', 'c']);
  assert.equal(merged[0].name, 'local');
});
