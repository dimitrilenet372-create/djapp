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

// --------------------------------------------------------------------------- //
// Set DJ
// --------------------------------------------------------------------------- //
const dj = (n, genre, extra = {}) => tr(`DJ ${n} - Morceau ${n}`, { genre, ...extra });

test('set : les styles voisins se suivent, les sauts de style sont signalés', () => {
  const h1 = dj('h1', 'House'); const h2 = dj('h2', 'House'); const t1 = dj('t1', 'Techno'); const t2 = dj('t2', 'Techno');
  const d1 = dj('d1', 'Drum & Bass'); const d2 = dj('d2', 'Drum & Bass');
  // mélangés exprès
  const { ordered, weak } = L.buildSet([h1, d1, t1, h2, d2, t2], { keepAll: true });
  const styles = ordered.map((t) => core.detectStyle(t));
  const changes = styles.filter((s, i) => i && s !== styles[i - 1]).length;
  assert.equal(changes, 2, `trois blocs de style seulement : ${styles}`);
  assert.equal(ordered[0].id, h1.id, 'on part du premier titre');
  assert.ok(weak <= 1, 'un seul vrai saut : de la techno à la drum & bass');
  const trans = L.transitionsOf(ordered);
  assert.equal(trans.length, 5);
  assert.ok(trans.some((t) => t.tone === 'weak' && /changement de style/.test(t.label)));
  assert.ok(trans.some((t) => t.tone === 'good' && /même style/.test(t.label)));
});

test('set : une version se place juste à côté de son titre', () => {
  const a = tr('Eric Prydz - Pjanoo', { genre: 'House' });
  const b = dj('b', 'House');
  const c = dj('c', 'House');
  const a2 = tr('Eric Prydz - Pjanoo (Club Edit)', { genre: 'House' });
  const { ordered } = L.buildSet([a, b, c, a2], { keepAll: true });
  assert.equal(Math.abs(ordered.indexOf(a) - ordered.indexOf(a2)), 1);
  const t = L.transitionsOf(ordered);
  assert.ok(t.some((x) => x.label === 'versions du même titre' && x.tone === 'good'));
});

test('set : le tempo est utilisé quand il est connu, moitié/double reconnu', () => {
  const x = dj('x', 'House', { bpm: 124 });
  const near = dj('near', 'House', { bpm: 125 });
  const adjust = dj('adj', 'House', { bpm: 130 });
  const half = dj('half', 'House', { bpm: 62 });
  const far = dj('far', 'House', { bpm: 150 });
  const label = (a, b) => L.transitionsOf([a, b])[0];
  assert.match(label(x, near).label, /tempo proche \(124 → 125 BPM\)/);
  assert.match(label(x, adjust).label, /tempo à ajuster/);
  assert.match(label(x, half).label, /moitié\/double/);
  assert.equal(label(x, far).tone, 'weak');
  assert.match(label(x, far).label, /écart de tempo/);
  // le plus proche passe en premier
  const { ordered } = L.buildSet([x, far, near], { keepAll: true });
  assert.deepEqual(ordered.map((t) => t.id), [x.id, near.id, far.id]);
});

test('set : les titres isolés sont mis de côté, sauf si on garde tout', () => {
  const house = [dj('1', 'House'), dj('2', 'House'), dj('3', 'House')];
  const techno = [dj('4', 'Techno'), dj('5', 'Techno')];
  const lonely = dj('rap', 'Hip-hop & Rap');
  const unknown = dj('inconnu', '');
  const set = L.buildSet([...house, lonely, ...techno, unknown]);
  assert.deepEqual(set.aside.map((t) => t.id), [lonely.id]);
  assert.equal(set.ordered.length, 6);
  assert.ok(set.ordered.includes(unknown), 'style inconnu : on garde');
  assert.equal(L.buildSet([...house, lonely, ...techno], { keepAll: true }).aside.length, 0);
  // sélection sans style dominant : rien n'est écarté
  const mixed = [dj('a', 'Jazz'), dj('b', 'Hip-hop & Rap'), dj('c', 'Drum & Bass')];
  assert.equal(L.buildSet(mixed).aside.length, 0);
});

test('set : point de départ au choix, aucune perte de titre', () => {
  const tracks = Array.from({ length: 12 }, (_, i) => dj(String(i), i % 2 ? 'House' : 'Techno'));
  const set = L.buildSet(tracks, { startId: tracks[5].id, keepAll: true });
  assert.equal(set.ordered[0].id, tracks[5].id);
  assert.deepEqual(set.ordered.map((t) => t.id).sort((a, b) => a - b), tracks.map((t) => t.id).sort((a, b) => a - b));
});

test('set depuis deux playlists : fusion sans doublons, ordre DJ, titres isolés dans une playlist à part', () => {
  const a = pl('Soirée', [dj('1', 'House'), dj('2', 'House'), dj('3', 'Techno'), dj('rap', 'Hip-hop & Rap')]);
  const b = pl('Warm-up', [tr('DJ 1 - Morceau 1 (Original Mix)', { genre: 'House' }), dj('4', 'Techno'), dj('5', 'House')]);
  const r = L.buildSetFrom([a, b], 'Set · Soirée + Warm-up');
  assert.equal(r.total, 7);
  assert.equal(r.removed, 1);
  assert.equal(r.playlist.dj, true);
  assert.equal(r.playlist.tracks.length, 5);
  assert.equal(r.aside.tracks.length, 1);
  assert.equal(r.aside.name, 'À part · Soirée + Warm-up');
  assert.equal(a.tracks.length, 4, 'les playlists d\'origine ne changent pas');
  assert.equal(L.deserialize(L.serialize([r.playlist]))[0].dj, true, 'le mode set est conservé');
});

// --- tonalité dans les sets ---
test('keyLink : voisins, relatifs, à surveiller, opposés, inconnus', async () => {
  const { keyLink } = await import('../js/library.js');
  assert.equal(keyLink('8A', '8A').cost, 0);
  assert.equal(keyLink('8A', '9A').cost, 0);
  assert.equal(keyLink('12A', '1A').cost, 0, 'la roue boucle');
  assert.match(keyLink('8A', '8B').label, /relatives/);
  assert.equal(keyLink('8A', '10A').cost, 0.75);
  assert.equal(keyLink('8A', '9B').cost, 0.75);
  assert.equal(keyLink('8A', '2A').cost, 2.5);
  assert.match(keyLink('8A', '2A').label, /s'opposent/);
  assert.equal(keyLink('8A', null), null);
  assert.equal(keyLink('', '8A'), null);
});

test('buildSet met les tonalités compatibles côte à côte et le dit sur chaque enchaînement', async () => {
  const L = await import('../js/library.js');
  const core = await import('../js/core.js');
  const mk = (title, key) => core.makeTrack({ artist: title, title: `Morceau ${title}`, genre: 'House', key });
  const tracks = [mk('A', '8A'), mk('B', '2A'), mk('C', '9A'), mk('D', '3A')];
  const { ordered } = L.buildSet(tracks, { keepAll: true });
  const keys = ordered.map((t) => t.key);
  assert.deepEqual(keys.slice(0, 2), ['8A', '9A']);
  assert.deepEqual(keys.slice(2).sort(), ['2A', '3A'], 'les deux tonalités voisines restent ensemble');
  const tr = L.transitionsOf(ordered);
  assert.match(tr[0].label, /tonalités voisines \(8A → 9A\)/);
  assert.match(tr[1].label, /tonalités qui s'opposent/);
  assert.equal(tr[1].tone, 'weak');
  assert.match(tr[2].label, /tonalités voisines/);
});

test('conseils d\'enchaînement : tonalité, tempo, style, durée', () => {
  const mk = (t, extra) => core.makeTrack({ artist: `Art ${t}`, title: `Morceau ${t}`, genre: 'House', ...extra });
  const tip = (a, b) => L.transitionsOf([a, b])[0].tip.join(' ');
  assert.match(tip(mk('A', { key: '8A' }), mk('B', { key: '2A' })), /tonalités s'opposent/);
  assert.match(tip(mk('A', { key: '8A' }), mk('B', { key: '9A' })), /compatibles/);
  assert.match(tip(mk('A', { bpm: 120 }), mk('B', { bpm: 127 })), /pitch d'environ 5,5 %/);
  assert.match(tip(mk('A', { bpm: 70 }), mk('B', { bpm: 140 })), /double-temps/);
  assert.match(tip(mk('A', { bpm: 100 }), mk('B', { bpm: 140 })), /Écart trop grand/);
  assert.match(tip(mk('A', { genre: 'House' }), mk('B', { genre: 'Drum & Bass', tags: ['dnb'] })), /style change/);
  assert.match(tip(mk('A', { duration: 500 }), mk('B')), /Titre long/);
  const t = L.transitionsOf([mk('A', { key: '8A', bpm: 100, duration: 500 }), mk('B', { key: '2A', bpm: 140 })])[0];
  assert.ok(t.tip.length <= 2, 'deux conseils au plus, les problèmes d\'abord');
  assert.match(t.tip[0], /tonalités s'opposent|Écart trop grand/);
});

test('conseils du set : courbe de tempo, tonalités manquantes, honnêteté sur les drops', () => {
  const mk = (t, bpm, key) => core.makeTrack({ artist: `Art ${t}`, title: `Morceau ${t}`, genre: 'House', bpm, key, duration: 240 });
  const adv = L.setAdvice([mk('A', 120, '8A'), mk('B', 123, '9A'), mk('C', 126, ''), mk('D', 128, '9A')]);
  assert.equal(adv.count, 4);
  assert.equal(adv.seconds, 960);
  assert.equal(adv.bpmMin, 120);
  assert.equal(adv.bpmMax, 128);
  assert.equal(adv.keysKnown, 3);
  const all = adv.tips.join(' | ');
  assert.match(all, /monte de 120 à 128 BPM/);
  assert.match(all, /manque la tonalité de 1 titre/);
  assert.match(all, /cue points dans Serato/);
  const none = L.setAdvice([core.makeTrack({ artist: 'x', title: 'a' }), core.makeTrack({ artist: 'y', title: 'b' })]);
  assert.match(none.tips.join(' '), /Aucune tonalité connue/);
  assert.match(none.tips.join(' '), /Aucun tempo connu/);
});
