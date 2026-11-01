import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as core from '../js/core.js';
import * as SH from '../js/share.js';

const pl = {
  name: 'Mon set « été »', art: 'artworks-abc', dj: true,
  tracks: [
    core.makeTrack({ artist: 'Aya', title: 'Night Drive (Remix)', url: 'https://soundcloud.com/aya/night', art: 'x1', duration: 301, genre: 'House', key: '8A', bpm: 122, tags: ['deep', 'club'] }),
    core.makeTrack({ artist: 'Bo', title: 'Glow', url: 'https://soundcloud.com/bo/glow' }),
  ],
};

test('partage : aller-retour sans perte, tonalités et tempos compris', async () => {
  const code = await SH.encodeShare(pl);
  assert.match(code, /^z\.[\w-]+$/);
  const back = await SH.decodeShare(code);
  assert.equal(back.name, pl.name);
  assert.equal(back.dj, true);
  assert.equal(back.art, 'artworks-abc');
  assert.equal(back.tracks.length, 2);
  assert.deepEqual(back.tracks[0], { title: 'Night Drive (Remix)', artist: 'Aya', url: 'https://soundcloud.com/aya/night', art: 'x1', duration: 301, genre: 'House', key: '8A', bpm: 122, tags: ['deep', 'club'] });
  assert.equal(back.tracks[1].key, '');
  assert.equal(back.tracks[1].bpm, null);
});

test('partage : liens abîmés refusés, extraction depuis une adresse', async () => {
  for (const bad of ['', 'z.', 'z.!!!', 'z.AAAA', 'x.abcd', null, 'r.' + Buffer.from('{"v":2}').toString('base64url'), 'r.' + Buffer.from('{"v":1,"t":[]}').toString('base64url')]) {
    assert.equal(await SH.decodeShare(bad), null, String(bad));
  }
  const code = await SH.encodeShare(pl);
  assert.equal(SH.shareFromHash(`#share=${code}`), code);
  assert.equal(SH.shareFromHash('#import=abc'), null);
});

test('partage : une grande playlist reste d\'une taille raisonnable', async () => {
  const tracks = Array.from({ length: 120 }, (_, i) => core.makeTrack({ artist: `Artiste ${i}`, title: `Titre numéro ${i}`, url: `https://soundcloud.com/artiste-${i}/titre-${i}`, art: `artworks-${i}abc`, duration: 200 + i, genre: 'House', key: '8A', bpm: 124 }));
  const code = await SH.encodeShare({ name: 'Grande', tracks });
  assert.ok(code.length < 12000, `trop long : ${code.length}`);
  assert.equal((await SH.decodeShare(code)).tracks.length, 120);
});

test('hors ligne : le service worker garde tous les scripts de la page et le manifeste est valide', () => {
  const idx = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  const mods = [...idx.matchAll(/"\.\/js\/(\w+)\.js":/g)].map((m) => m[1]);
  assert.ok(mods.length >= 10);
  for (const m of mods) assert.ok(sw.includes(`'${m}'`), `sw.js ne garde pas ${m}.js`);
  assert.ok(idx.includes('rel="manifest"'));
  const man = JSON.parse(readFileSync(new URL('../manifest.webmanifest', import.meta.url), 'utf8'));
  assert.equal(man.name, 'Simple playlist');
  assert.equal(man.display, 'standalone');
  for (const i of man.icons) assert.ok(readFileSync(new URL(`../${i.src}`, import.meta.url)).length > 500, i.src);
});
