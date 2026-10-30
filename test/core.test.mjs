import test from 'node:test';
import assert from 'node:assert/strict';
import * as core from '../js/core.js';
import { makeZip } from '../js/zip.js';

const T = core.makeTrack;
const labels = (arr) => arr.map(core.labelOf);

function sample() {
  return [
    T({ title: 'Strobe', artist: 'deadmau5', url: 'https://soundcloud.com/deadmau5/strobe', genre: 'Progressive House', duration: 637, source: 'P1' }),
    T({ title: 'Strobe (Free Download)', artist: 'deadmau5', url: 'https://soundcloud.com/x/strobe-2', duration: 636, source: 'P2' }),
    T({ title: 'Strobe (Club Edit)', artist: 'deadmau5', url: 'https://soundcloud.com/x/strobe-club', duration: 300, source: 'P2' }),
    T({ title: 'Midnight City - Eric Prydz Remix', artist: 'M83', genre: 'Electronic', duration: 290, source: 'P1' }),
    T({ title: 'Midnight City', artist: 'M83', genre: 'Electronic', duration: 244, source: 'P2' }),
    T({ title: 'Song 2', artist: 'Blur', genre: 'Rock', source: 'P1' }),
    T({ title: 'Song', artist: 'Blur', genre: 'Rock', source: 'P2' }),
    T({ title: 'Nuvole Bianche', artist: 'Ludovico Einaudi', genre: 'Piano', source: 'P1' }),
    T({ title: 'Nuvole Bianche', artist: 'Ludovico Einaudi', genre: 'Piano', source: 'P2' }),
    T({ title: 'Rushing Back', artist: 'Flume ft. Vera Blue', url: 'https://soundcloud.com/flume/rushing-back?in=a/sets/b', genre: 'Electronic', source: 'P1' }),
    T({ title: 'Rushing Back', artist: 'Flume', url: 'https://soundcloud.com/flume/rushing-back', source: 'P2' }),
    T({ title: 'Neon Jungle', artist: 'Pendulum', genre: 'Drum & Bass', source: 'P1' }),
    T({ title: 'Tarantula', artist: 'Pendulum', genre: 'Drum & Bass', source: 'P1' }),
    T({ title: 'Blood Sugar', artist: 'Pendulum', genre: 'Drum & Bass', source: 'P2' }),
  ];
}

test('normalize', () => {
  assert.equal(core.normalize('Strobe (Free Download)'), 'strobe');
  assert.equal(core.normalize('Café del Mar [HQ]'), 'cafe del mar');
  assert.equal(core.normalize('Track feat. Someone'), 'track');
  assert.equal(core.normalize('Дискотека 80-х'), 'дискотека 80 х');
});

test('tokenSortRatio suit rapidfuzz', () => {
  assert.equal(core.tokenSortRatio('new york mets vs atlanta braves', 'atlanta braves vs new york mets'), 100);
  assert.ok(Math.abs(core.tokenSortRatio('this is a test', 'this is a test!') - 96.55) < 0.01);
});

test('splitArtistTitle', () => {
  assert.deepEqual(core.splitArtistTitle('Daft Punk - One More Time', 'label'), ['Daft Punk', 'One More Time']);
  assert.deepEqual(core.splitArtistTitle('One More Time', 'Daft Punk'), ['Daft Punk', 'One More Time']);
  // la partie droite n'est qu'une version : l'artiste vient de l'uploader
  assert.deepEqual(core.splitArtistTitle('Midnight City - Eric Prydz Remix', 'Eric Prydz'), ['Eric Prydz', 'Midnight City - Eric Prydz Remix']);
  assert.deepEqual(core.splitArtistTitle('Artist - Live Your Life'), ['Artist', 'Live Your Life']);
});

test('dedupe : vrais doublons retirés, versions conservées', () => {
  const { kept, dups } = core.dedupe(sample());
  const removed = labels(dups.map((d) => d.removed));
  assert.ok(removed.includes('deadmau5 - Strobe (Free Download)'));
  assert.ok(removed.includes('Ludovico Einaudi - Nuvole Bianche'));
  assert.ok(removed.includes('Flume - Rushing Back'));
  const k = labels(kept);
  assert.ok(k.includes('deadmau5 - Strobe (Club Edit)'));
  assert.ok(k.includes('M83 - Midnight City'));
  assert.ok(k.includes('M83 - Midnight City - Eric Prydz Remix'));
  assert.ok(k.includes('Blur - Song') && k.includes('Blur - Song 2'));
  assert.equal(kept.length + dups.length, 14);
});

test('dedupe enrichit le genre du titre gardé', () => {
  const { kept, dups } = core.dedupe([
    T({ title: 'Rushing Back', artist: 'Flume', url: 'https://soundcloud.com/flume/rushing-back' }),
    T({ title: 'Rushing Back', artist: 'Flume', genre: 'Electronic', tags: ['future bass'], source: 'P2' }),
  ]);
  assert.equal(kept.length, 1);
  assert.equal(dups.length, 1);
  assert.equal(kept[0].genre, 'Electronic');
  assert.deepEqual(kept[0].tags, ['future bass']);
});

test('versions liées', () => {
  const { kept } = core.dedupe(sample());
  const fams = core.annotateVersions(kept);
  const bases = fams.map((f) => f.title).sort();
  assert.deepEqual(bases, ['Midnight City', 'Strobe']);
  const mc = fams.find((f) => f.title === 'Midnight City');
  assert.equal(mc.members.length, 2);
  assert.deepEqual(mc.members.map((t) => t.versionLabel).sort(), ['Eric Prydz Remix', 'Original']);
  // un remix publié par le remixeur (sans artiste d'origine) rejoint aussi la famille
  const x = [
    T({ title: 'Midnight City', artist: 'M83' }),
    T({ title: 'Midnight City (Eric Prydz Remix)', artist: 'Eric Prydz' }),
  ];
  assert.equal(core.annotateVersions(x).length, 1);
  // deux morceaux homonymes d'artistes différents + un remix : ambigu, pas de famille
  const y = [T({ title: 'Paradise', artist: 'A' }), T({ title: 'Paradise', artist: 'B' }), T({ title: 'Paradise (VIP)', artist: 'C' })];
  assert.equal(core.annotateVersions(y).length, 0);
});

test('styles, regroupement et héritage de famille', () => {
  const { kept } = core.dedupe(sample());
  const fams = core.annotateVersions(kept);
  const pls = core.groupByStyle(kept, { minSize: 2, families: fams });
  const byName = Object.fromEntries(pls.map((p) => [p.name, p.tracks]));
  assert.equal(byName['Drum & Bass'].length, 3);
  assert.equal(pls.at(-1).name, 'Divers');
  assert.equal(pls.reduce((n, p) => n + p.tracks.length, 0), kept.length);
  // Strobe et sa version Club Edit se retrouvent ensemble, côte à côte
  const house = pls.find((p) => p.tracks.some((t) => t.title === 'Strobe'));
  assert.ok(house.tracks.some((t) => t.title === 'Strobe (Club Edit)'));
  const idx = house.tracks.map((t) => t.title);
  assert.equal(Math.abs(idx.indexOf('Strobe') - idx.indexOf('Strobe (Club Edit)')), 1);

  const heritage = [
    T({ title: 'Strobe', artist: 'deadmau5', genre: 'Progressive House' }),
    T({ title: 'Strobe (Club Edit)', artist: 'deadmau5' }),
  ];
  const f2 = core.annotateVersions(heritage);
  const g2 = core.groupByStyle(heritage, { minSize: 1, families: f2 });
  assert.equal(g2.length, 1);
});

test('analyze', () => {
  const r = core.analyze([{ name: 'P1', tracks: sample() }], { minSize: 2 });
  assert.equal(r.total, 14);
  assert.equal(r.kept.length + r.dups.length, 14);
  assert.ok(r.playlists.length >= 2);
});

test('lecture : lignes, champs, liens, CSV, JSON', () => {
  const t = core.parseAny(
    [
      'Daft Punk - One More Time | House | 123 | https://soundcloud.com/daft-punk/one-more-time',
      'https://soundcloud.com/blur/song-2',
      'https://soundcloud.com/moi/sets/ma-playlist',
      'Blur - Parklife https://soundcloud.com/blur/parklife',
      'Pendulum - Tarantula | NA',
    ].join('\n'),
    'P1',
  );
  assert.equal(t.length, 4);
  assert.deepEqual([t[0].genre, t[0].bpm, t[0].url], ['House', 123, 'https://soundcloud.com/daft-punk/one-more-time']);
  assert.deepEqual([t[1].artist, t[1].title], ['blur', 'song 2']);
  assert.equal(t[2].url, 'https://soundcloud.com/blur/parklife');
  assert.equal(t[3].genre, '');

  const csv = 'Playlist,Artiste,Titre,Genre SoundCloud,Lien,Origine\nHouse,Daft Punk,"Around the World, Pt. 2",House,https://soundcloud.com/d/a,P1\n';
  const c = core.parseAny(csv, 'X');
  assert.equal(c.length, 1);
  assert.equal(c[0].title, 'Around the World, Pt. 2');
  assert.equal(c[0].source, 'P1');

  const jl = [
    JSON.stringify({ title: 'Strobe', uploader: 'deadmau5', genre: 'Progressive House', tags: ['house'], duration: 637, webpage_url: 'https://soundcloud.com/deadmau5/strobe' }),
    JSON.stringify({ title: 'Blur - Song 2', uploader: 'x', genre: 'NA' }),
  ].join('\n');
  const j = core.parseAny(jl, 'J');
  assert.equal(j.length, 2);
  assert.deepEqual([j[0].artist, j[0].genre, j[0].duration], ['deadmau5', 'Progressive House', 637]);
  assert.deepEqual([j[1].artist, j[1].title, j[1].genre], ['Blur', 'Song 2', '']);
  assert.equal(core.parseAny('[{"title":"A - B"}]', 'J').length, 1);
});

test('export CSV ré-importable', () => {
  const { kept, dups } = core.dedupe(sample());
  const pls = core.groupByStyle(kept, { minSize: 2 });
  const back = core.parseAny(core.tracksToCsv(pls), 'R');
  assert.equal(back.length, kept.length);
  const files = core.exportFiles(pls, dups);
  assert.ok(files.some((f) => f.name === 'doublons_supprimes.csv'));
  assert.ok(files[0].name.startsWith('playlists/01_'));
});

test('zip valide', () => {
  const z = makeZip([{ name: 'a/é.txt', data: 'héllo\n' }, { name: 'b.csv', data: 'x,y\n' }]);
  const dv = new DataView(z.buffer, z.byteOffset, z.byteLength);
  assert.equal(dv.getUint32(0, true), 0x04034b50);
  assert.equal(dv.getUint32(z.length - 22, true), 0x06054b50);
  assert.equal(dv.getUint16(z.length - 22 + 10, true), 2);
});
