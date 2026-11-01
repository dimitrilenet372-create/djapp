import test from 'node:test';
import assert from 'node:assert/strict';
import * as core from '../js/core.js';
import * as TF from '../js/tunefile.js';

const tr = (artist, title, extra = {}) => core.makeTrack({ artist, title, ...extra });

test('export Mixxx (virgules), tableur (point-virgule) et rekordbox (tabulations, UTF-16)', () => {
  const mixxx = 'Artist,Title,Album,Key,BPM\nAya,Night Drive,,8A,122.00\nBo,"Glow, part 1",,Am,124';
  const a = TF.parseTuneFile(mixxx).rows;
  assert.deepEqual(a.map((r) => [r.artist, r.title, r.key, r.bpm]), [['Aya', 'Night Drive', '8A', 122], ['Bo', 'Glow, part 1', '8A', 124]]);
  const sheet = 'Artiste;Titre;Tonalité;Tempo\nCy;Deep Blue;9B;125,5';
  assert.deepEqual(TF.parseTuneFile(sheet).rows[0], { artist: 'Cy', title: 'Deep Blue', key: '9B', bpm: 125.5 });
  const rekordbox = '#\tTrack Title\tArtist\tBPM\tKey\n1\tJungle Run\tDi\t174.00\t2A';
  const bytes = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(rekordbox, 'utf16le')]);
  const text = TF.decodeText(new Uint8Array(bytes));
  assert.deepEqual(TF.parseTuneFile(text).rows[0], { artist: 'Di', title: 'Jungle Run', key: '2A', bpm: 174 });
});

test('Open Key (Traktor) converti en Camelot, « Artiste - Titre » dans une seule colonne', () => {
  assert.equal(TF.openKeyToCamelot('1d'), '8B');
  assert.equal(TF.openKeyToCamelot('1m'), '8A');
  assert.equal(TF.openKeyToCamelot('12d'), '7B');
  assert.equal(TF.openKeyToCamelot('13d'), null);
  const r = TF.parseTuneFile('Name,Key\nAya - Night Drive,5m').rows[0];
  assert.deepEqual([r.artist, r.title, r.key], ['Aya', 'Night Drive', '12A']);
});

test('fichiers inutilisables : message clair', () => {
  assert.match(TF.parseTuneFile('').error, /vide/);
  assert.match(TF.parseTuneFile('Foo,Bar\n1,2').error, /colonne « Titre »/);
  assert.match(TF.parseTuneFile('Title,Album\nA,B').error, /ni colonne « Tonalité »/);
  assert.match(TF.parseTuneFile('Title,Key\nA,pas une clé').error, /Aucune ligne/);
});

test('rapprochement prudent : mêmes titres, remix distinct, rien d\'écrasé', () => {
  const rows = TF.parseTuneFile('Artist,Title,Key,BPM\nAya,Night Drive,8A,122\nAya,Night Drive (Bo Remix),3B,128\nZed,Un titre assez long,10A,100\nQui,Solo,1A,90').rows;
  const t1 = tr('Aya', 'Night Drive');
  const t2 = tr('Aya', 'Night Drive (Bo Remix)');
  const t3 = tr('Autre uploader', 'Un titre assez long');
  const t4 = tr('Qui', 'Solo (Edit)');
  const t5 = tr('Aya', 'Night Drive', { key: '5A', bpm: 100 });
  const hits = TF.matchTunes([t1, t2, t3, t4, t5], rows);
  const by = new Map(hits.map((h) => [h.id, h]));
  assert.deepEqual([by.get(t1.id).key, by.get(t1.id).bpm], ['8A', 122]);
  assert.deepEqual([by.get(t2.id).key, by.get(t2.id).bpm], ['3B', 128], 'le remix prend sa propre ligne');
  assert.equal(by.get(t3.id).key, '10A', 'titre long et unique : accepté même si l\'artiste diffère');
  assert.equal(by.has(t4.id), false, 'une édition n\'hérite pas de la tonalité de l\'original');
  assert.equal(by.has(t5.id), false, 'rien à remplir');
  const t6 = tr('Aya', 'Night Drive', { key: '5A' });
  const only = TF.matchTunes([t6], rows);
  assert.equal(only[0].key, null, 'la tonalité saisie est conservée');
  assert.equal(only[0].bpm, 122);
});
