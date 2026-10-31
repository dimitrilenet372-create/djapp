import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeTrack } from '../js/core.js';
import { lookupTrack, bestMatch, readSong, isAltVersion, KeyLookupError } from '../js/keys.js';

const tr = (artist, title) => makeTrack({ artist, title });
const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });

test('lecture d\'une fiche : Camelot si présent, sinon la note, tempo borné', () => {
  assert.deepEqual(readSong({ camelot: '8A', tempo: '124' }), { key: '8A', bpm: 124 });
  assert.deepEqual(readSong({ key_of: 'F♯m', tempo: '99,5' }), { key: '11A', bpm: 99.5 });
  assert.deepEqual(readSong({ key_of: 'C', tempo: '999' }), { key: '8B', bpm: null });
  assert.deepEqual(readSong(null), { key: null, bpm: null });
});

test('les remixes et edits sont écartés, les originaux non', () => {
  assert.equal(isAltVersion('Opus (Original Mix)'), false);
  assert.equal(isAltVersion('Opus'), false);
  assert.equal(isAltVersion('Opus (Extended Mix)'), false);
  assert.equal(isAltVersion('Opus (Charlotte Remix)'), true);
  assert.equal(isAltVersion('Opus (VIP)'), true);
  assert.equal(isAltVersion('Opus [Bootleg]'), true);
});

test('la correspondance exige le même titre et le même artiste', () => {
  const t = tr('Eric Prydz', 'Opus (Original Mix)');
  const results = [
    { id: '1', title: 'Opus', artist: { name: 'Autre Artiste' } },
    { id: '2', title: 'Opus Two', artist: { name: 'Eric Prydz' } },
    { id: '3', title: 'Opus', artist: { name: 'Eric Prydz' } },
  ];
  assert.equal(bestMatch(results, t).id, '3');
  assert.equal(bestMatch(results.slice(0, 2), t), null);
  assert.equal(bestMatch([], t), null);
});

test('recherche complète : fiche trouvée dans les résultats, ou ouverte à part', async () => {
  const calls = [];
  const f = async (url) => {
    const u = new URL(url);
    calls.push(u.pathname);
    assert.equal(u.searchParams.get('api_key'), 'CLE');
    if (u.pathname === '/search/') return json({ search: [{ id: 'abc', title: 'Opus', artist: { name: 'Eric Prydz' } }] });
    if (u.pathname === '/song/') return json({ song: { id: 'abc', title: 'Opus', tempo: '126', key_of: 'Am', artist: { name: 'Eric Prydz' } } });
    return json({}, 404);
  };
  const r = await lookupTrack(f, 'CLE', tr('Eric Prydz', 'Opus (Original Mix)'));
  assert.deepEqual(r, { key: '8A', bpm: 126, status: 'found' });
  assert.deepEqual(calls, ['/search/', '/song/']);
  const direct = async () => json({ search: [{ id: 'z', title: 'Opus', camelot: '9A', tempo: 128, artist: { name: 'Eric Prydz' } }] });
  assert.equal((await lookupTrack(direct, 'CLE', tr('Eric Prydz', 'Opus'))).key, '9A');
});

test('rien trouvé, remix ignoré sans appel réseau', async () => {
  let n = 0;
  const f = async () => { n++; return json({ search: [] }); };
  assert.equal((await lookupTrack(f, 'CLE', tr('A', 'Inconnu'))).status, 'none');
  const before = n;
  assert.equal((await lookupTrack(f, 'CLE', tr('A', 'Titre (Moi Remix)'))).status, 'skipped');
  assert.equal(n, before);
});

test('erreurs : clé refusée, limite, réseau coupé sont fatales et lisibles', async () => {
  const t = tr('A', 'Titre');
  await assert.rejects(lookupTrack(async () => json({}, 401), 'x', t), (e) => e instanceof KeyLookupError && e.fatal && /clé/.test(e.message));
  await assert.rejects(lookupTrack(async () => json({}, 429), 'x', t), (e) => e.fatal && /limite/.test(e.message));
  await assert.rejects(lookupTrack(async () => { throw new TypeError('Failed to fetch'); }, 'x', t), (e) => e.fatal && /joindre/.test(e.message));
  await assert.rejects(lookupTrack(async () => json({}, 500), 'x', t), (e) => !e.fatal);
});

test('le titre cherché est débarrassé des mentions qui ne sont pas dans la base', async () => {
  const { searchTitle } = await import('../js/keys.js');
  assert.equal(searchTitle('Opus (Original Mix)'), 'Opus');
  assert.equal(searchTitle('Opus [Free Download]'), 'Opus');
  assert.equal(searchTitle('Opus (Extended Mix) (Free DL)'), 'Opus');
  assert.equal(searchTitle('Opus'), 'Opus');
  assert.equal(searchTitle('Hold On (feat. Someone)'), 'Hold On (feat. Someone)');
  assert.equal(searchTitle('(Original Mix)'), '(Original Mix)', 'jamais de requête vide');
});

test('le favori « Copier les liens » de la liste à récupérer est branché', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
  for (const act of ['copy-get', 'keys-go', 'keys-stop', 'keys-change']) {
    const used = src.includes(`data-act="${act}"`);
    const handled = src.includes(`act === '${act}'`);
    assert.ok(used && handled, `action ${act} : bouton ${used}, traitement ${handled}`);
  }
});
