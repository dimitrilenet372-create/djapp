import test from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../js/serato.js';
import { makeTrack } from '../js/core.js';

const tr = (artist, title, extra = {}) => makeTrack({ artist, title, ...extra });

test('associe les titres aux fichiers, sans confondre original, remix et suite', () => {
  const files = [
    'Music/House/01 - Fred again.. - Delilah (pull me out of this).mp3',
    'Music/Daft Punk - One More Time.mp3',
    'Music/Daft Punk - One More Time (Purple Disco Machine Remix).wav',
    'Music/Rain 2.mp3',
    'Music/Kerri_Chandler_-_Rain.flac',
    'Music/cover.jpg',
    'Music/Opus.aiff',
  ];
  const tracks = [
    tr('Daft Punk', 'One More Time (Purple Disco Machine Remix)'),
    tr('Daft Punk', 'One More Time'),
    tr('Daft Punk', 'One More Time (Tiesto Remix)'),
    tr('Fred again..', 'Delilah (pull me out of this)'),
    tr('Kerri Chandler', 'Rain'),
    tr('Eric Prydz', 'Opus'),
    tr('Solomun', 'Ocean Drive'),
  ];
  const r = S.matchFiles(tracks, files);
  const got = Object.fromEntries(r.found.map((f) => [f.track.title, f.file.split('/').pop()]));
  assert.deepEqual(got, {
    'One More Time (Purple Disco Machine Remix)': 'Daft Punk - One More Time (Purple Disco Machine Remix).wav',
    'One More Time': 'Daft Punk - One More Time.mp3',
    'Delilah (pull me out of this)': '01 - Fred again.. - Delilah (pull me out of this).mp3',
    Rain: 'Kerri_Chandler_-_Rain.flac',
  });
  assert.deepEqual(r.missing.map((t) => t.title), ['One More Time (Tiesto Remix)', 'Opus', 'Ocean Drive']);
  // l'ordre de la playlist est gardé
  assert.deepEqual(r.found.map((f) => f.track.title)[0], 'One More Time (Purple Disco Machine Remix)');
});

test('un fichier nommé seulement par le titre est accepté si le titre est assez long', () => {
  const r = S.matchFiles([tr('deadmau5', 'Strobe'), tr('Pendulum', 'Tarantula')], ['M/Tarantula.mp3', 'M/Strobe.mp3']);
  assert.deepEqual(r.found.map((f) => f.file), ['M/Tarantula.mp3']);
});

test('un fichier ne sert qu\'une fois', () => {
  const r = S.matchFiles([tr('A', 'Same Song'), tr('A', 'Same Song')], ['M/A - Same Song.mp3']);
  assert.equal(r.found.length, 1);
  assert.equal(r.missing.length, 1);
});

test('chemins : Windows, Mac, et format Serato', () => {
  assert.equal(S.absolutePath('C:\\Users\\Dim\\Music\\', 'Music/House/a.mp3'), 'C:\\Users\\Dim\\Music\\House\\a.mp3');
  assert.equal(S.absolutePath('"D:\\DJ"', 'DJ/a.mp3'), 'D:\\DJ\\a.mp3');
  assert.equal(S.absolutePath('/Users/dim/Music', 'Music/a/b.mp3'), '/Users/dim/Music/a/b.mp3');
  assert.equal(S.seratoPath('C:\\Users\\Dim\\Music\\a.mp3'), 'Users/Dim/Music/a.mp3');
  assert.equal(S.seratoPath('/Users/dim/Music/a.mp3'), 'Users/dim/Music/a.mp3');
  assert.equal(S.driveOf('d:\\x'), 'D:');
});

test('crate : en-tête Serato, colonnes, chemins relus à l\'identique (accents compris)', () => {
  const bytes = S.makeCrate(['C:\\Users\\Dim\\Music\\Röyksopp - Été.mp3', '/Users/d/Music/b.wav']);
  assert.equal(String.fromCharCode(...bytes.subarray(0, 4)), 'vrsn');
  assert.equal(new DataView(bytes.buffer).getUint32(4), 56);
  const r = S.readCrate(bytes);
  assert.equal(r.version, '1.0/Serato ScratchLive Crate');
  assert.deepEqual(r.paths, ['Users/Dim/Music/Röyksopp - Été.mp3', 'Users/d/Music/b.wav']);
});

test('M3U, liens pour récupérer, nom de crate', () => {
  const t = tr('Solomun', 'Ocean', { url: 'https://soundcloud.com/s/o', duration: 301.4 });
  assert.equal(S.makeM3u([{ track: t, path: 'C:\\a.mp3' }]), '#EXTM3U\r\n#EXTINF:301,Solomun - Ocean\r\nC:\\a.mp3\r\n');
  assert.deepEqual(S.whereToGet(t).map((l) => l.label), ['SoundCloud', 'Beatport', 'Bandcamp']);
  assert.deepEqual(S.whereToGet(tr('A', 'B')).map((l) => l.label), ['Beatport', 'Bandcamp']);
  assert.equal(S.crateName('Set %% Été : 2026/11'), 'Set Été 2026 11');
});
