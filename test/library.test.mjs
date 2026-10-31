import test from 'node:test';
import assert from 'node:assert/strict';
import * as core from '../js/core.js';
import * as L from '../js/library.js';

const tr = (label, extra = {}) => {
  const [artist, title] = label.split(' - ');
  return core.makeTrack({ artist, title, ...extra });
};
const pl = (name, labels, art = '') => L.newPlaylist(name, labels.map((l) => (typeof l === 'string' ? tr(l) : l)), art);

test('nettoyage : le premier exemplaire est gardé, les doublons sont repérés sans toucher la playlist', () => {
  const a = tr('Fisher - Losing It');
  const b = tr('Chris Lake - Turn Off The Lights');
  const c = tr('Fisher - Losing It (Original Mix)');
  const d = tr('fisher - losing it');
  const tracks = [a, b, c, d];
  const dups = L.findDuplicates(tracks);
  assert.deepEqual([...dups.keys()].sort(), [c.id, d.id].sort());
  assert.equal(dups.get(c.id).kept.id, a.id);
  assert.equal(tracks.length, 4, 'la liste reçue est intacte');
  const { kept, removed } = L.cleanTracks(tracks);
  assert.deepEqual(kept.map((t) => t.id), [a.id, b.id]);
  assert.equal(removed.length, 2);
});

test('les versions (remix, edit) ne sont pas des doublons', () => {
  const tracks = [tr('Moi - Un titre'), tr('Moi - Un titre (Autre Remix)'), tr('Moi - Un titre (Club Edit)')];
  assert.equal(L.findDuplicates(tracks).size, 0);
});

test('fusion : une seule liste sans doublons, nom et pochette repris', () => {
  const a = pl('A', ['X - Un', 'Y - Deux'], 'artworks-1');
  const b = pl('B', ['X - Un (Original Mix)', 'Z - Trois']);
  const m = L.mergePlaylists([a, b], 'A + B');
  assert.equal(m.playlist.name, 'A + B');
  assert.equal(m.playlist.art, 'artworks-1');
  assert.equal(m.total, 4);
  assert.equal(m.removed, 1);
  assert.deepEqual(m.playlist.tracks.map(core.labelOf), ['X - Un', 'Y - Deux', 'Z - Trois']);
  assert.equal(a.tracks.length, 2, 'les playlists d\'origine ne changent pas');
});

test('comparaison : en commun, seulement dans A, seulement dans B', () => {
  const a = pl('A', ['X - Un', 'Y - Deux', 'W - Quatre']);
  const b = pl('B', ['X - Un (Free Download)', 'Z - Trois', 'Z - Trois']);
  const r = L.comparePlaylists(a, b);
  assert.equal(r.common.length, 1);
  assert.equal(r.common[0].a.title, 'Un');
  assert.equal(r.common[0].b.title, 'Un (Free Download)');
  assert.deepEqual(r.onlyA.map((t) => t.title), ['Deux', 'Quatre']);
  assert.deepEqual(r.onlyB.map((t) => t.title), ['Trois'], 'un doublon dans B ne compte pas deux fois');
});

test('comparaison : deux playlists identiques n\'ont rien de propre', () => {
  const a = pl('A', ['X - Un', 'Y - Deux']);
  const b = pl('B', ['X - Un', 'Y - Deux']);
  const r = L.comparePlaylists(a, b);
  assert.equal(r.common.length, 2);
  assert.equal(r.onlyA.length + r.onlyB.length, 0);
});

test('rangement par style : de nouvelles playlists, la source reste intacte', () => {
  const house = Array.from({ length: 6 }, (_, i) => tr(`DJ ${i} - House ${i}`, { genre: 'House' }));
  const techno = Array.from({ length: 6 }, (_, i) => tr(`DJ T${i} - Techno ${i}`, { genre: 'Techno' }));
  const src = pl('Mix', [...house, ...techno]);
  const parts = L.splitByStyle(src, 5);
  assert.equal(parts.length, 2);
  assert.ok(parts.every((p) => p.name.startsWith('Mix · ') && p.tracks.length === 6));
  assert.equal(src.tracks.length, 12);
  assert.ok(parts.flatMap((p) => p.tracks).every((t) => src.tracks.includes(t)), 'les mêmes titres, pas des copies');
});

test('noms uniques, durée et pochettes', () => {
  const lib = [pl('Soirée', []), pl('Soirée (2)', [])];
  assert.equal(L.uniqueName(lib, 'Soirée'), 'Soirée (3)');
  assert.equal(L.uniqueName(lib, 'Autre'), 'Autre');
  assert.equal(L.formatDuration(245), '4:05');
  assert.equal(L.formatDuration(3725), '1 h 02');
  assert.equal(L.artUrl('artworks-000-abc'), 'https://i1.sndcdn.com/artworks-000-abc-t200x200.jpg');
  assert.equal(L.artUrl('x" onerror="y'), '', 'identifiant suspect refusé');
  const withArt = (n) => Array.from({ length: n }, (_, i) => tr(`A${i} - T${i}`, { art: `a${i}` }));
  assert.deepEqual(L.coverArts(pl('P', withArt(6))), ['a0', 'a1', 'a2', 'a3']);
  assert.deepEqual(L.coverArts(pl('P', withArt(2))), ['a0'], 'moins de quatre pochettes : une seule');
  assert.deepEqual(L.coverArts(pl('P', withArt(6), 'own')), ['own']);
});

test('enregistrement : aller-retour, pochette et identifiant conservés, texte abîmé ignoré', () => {
  const t = tr('Fisher - Losing It', { scid: 42, art: 'artworks-9', genre: 'Tech House', duration: 200, url: 'https://soundcloud.com/f/l' });
  const lib = [pl('Ma liste', [t], 'cover-1')];
  const back = L.deserialize(L.serialize(lib));
  assert.equal(back.length, 1);
  assert.equal(back[0].name, 'Ma liste');
  assert.equal(back[0].art, 'cover-1');
  assert.equal(back[0].tracks[0].scid, 42);
  assert.equal(back[0].tracks[0].art, 'artworks-9');
  assert.equal(back[0].tracks[0].artist, 'Fisher');
  assert.deepEqual(L.deserialize('pas du json'), []);
  assert.deepEqual(L.deserialize(null), []);
  assert.deepEqual(L.deserialize('{"v":1,"playlists":[]}'), []);
});

test('DJ : versions retrouvées dans toute la bibliothèque, sans les doublons exacts', () => {
  const orig = tr('Eric Prydz - Pjanoo');
  const remix = tr('Eric Prydz - Pjanoo (Club Edit)');
  const dupOfOrig = tr('Eric Prydz - Pjanoo');
  const other = tr('Autre - Truc');
  const a = pl('A', [orig, other]);
  const b = pl('B', [remix, dupOfOrig]);
  const r = L.relatedTracks([a, b], a, orig);
  assert.equal(r.versions.length, 1);
  assert.equal(r.versions[0].track.id, remix.id);
  assert.equal(r.versions[0].playlist.name, 'B');
  assert.match(r.versions[0].label, /edit/i);
  // depuis le remix, on retrouve l'original en premier
  const back = L.relatedTracks([a, b], b, remix);
  assert.equal(back.versions[0].track.id, orig.id);
  assert.equal(back.versions[0].label, 'Original');
});

test('DJ : même style dans la playlist, tempo proche quand il est connu', () => {
  const t = (n, bpm, genre = 'House') => tr(`DJ ${n} - Morceau ${n}`, { genre, bpm });
  const cur = t('cur', 124);
  const near = t('near', 126);
  const far = t('far', 140);
  const noBpm = t('nobpm', null);
  const techno = t('techno', 124, 'Techno');
  const p = pl('P', [cur, near, far, noBpm, techno]);
  const r = L.relatedTracks([p], p, cur);
  assert.equal(r.style, 'House');
  assert.equal(r.tempoKnown, true);
  assert.deepEqual(r.similar.map((s) => s.track.id), [near.id, noBpm.id], 'trop loin et autre style écartés');
  assert.equal(r.similar[0].tempo, true);
  assert.equal(r.similar[1].tempo, false);
  // sans tempo sur le titre courant, on ne filtre pas sur le tempo
  const cur2 = t('cur2', null);
  const p2 = pl('P2', [cur2, near, far]);
  assert.equal(L.relatedTracks([p2], p2, cur2).similar.length, 2);
  // style inconnu : aucune suggestion
  const unk = tr('Z - Titre sans style');
  const p3 = pl('P3', [unk, near]);
  assert.equal(L.relatedTracks([p3], p3, unk).similar.length, 0);
});
