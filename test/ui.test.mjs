// Interface de l'app dans jsdom : npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM, VirtualConsole } from 'jsdom';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
  .replace(/<script[^>]*><\/script>/g, '')
  .replace(/<link[^>]*>/g, '');
const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', (e) => errors.push(e));
const dom = new JSDOM(html, { url: 'http://localhost/', virtualConsole: vc });
const { window } = dom;
const { document } = window;

Object.assign(globalThis, { window, document, FileReader: window.FileReader, Blob: window.Blob });
Object.defineProperty(globalThis, 'navigator', {
  value: { clipboard: { writeText: async (t) => { globalThis.__copied = t; } } },
  configurable: true,
});
URL.createObjectURL = (b) => { globalThis.__blob = b; return 'blob:test'; };
URL.revokeObjectURL = () => {};
globalThis.__downloads = [];
window.HTMLAnchorElement.prototype.click = function () { globalThis.__downloads.push(this.download); };
window.scrollTo = () => {};
// faux lecteur SoundCloud : la vraie API se charge depuis w.soundcloud.com
const widgets = [];
window.SC = {
  Widget: Object.assign(
    (frame) => {
      const w = {
        frame, handlers: {}, loaded: [], toggled: 0, paused: 0,
        bind(e, fn) { this.handlers[e] = fn; }, load(u, o) { this.loaded.push([u, o]); },
        toggle() { this.toggled++; }, pause() { this.paused++; },
      };
      widgets.push(w);
      return w;
    },
    { Events: { PLAY: 'play', PAUSE: 'pause', FINISH: 'finish', ERROR: 'error' } },
  ),
};

await import('../js/app.js');

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const click = (el) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
const type = (el, value) => { el.value = value; el.dispatchEvent(new window.Event('input', { bubbles: true })); };
const wait = (ms = 20) => new Promise((r) => setTimeout(r, ms));
const cards = () => $$('.card');
const rows = () => $$('.trk');
const names = () => cards().map((c) => $('.card-name', c).textContent);
const open = (i) => click($('.card-open', cards()[i]));
const sheetOpen = () => !$('#sheet').hidden;
const stored = () => JSON.parse(window.localStorage.getItem('lebac.v2') || '{"playlists":[]}').playlists;

test('la version est affichée et cohérente avec la page', () => {
  assert.match($('#version').textContent, /^\d{4}-\d{2}-\d{2}-\w+$/);
  assert.equal($('#version').textContent, document.querySelector('meta[name="app-version"]').content);
  assert.equal($('#stale').hidden, true);
  const idx = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const v = $('#version').textContent;
  assert.ok(idx.includes(`js/app.js?v=${v}`) && idx.includes(`style.css?v=${v}`), 'adresses des scripts versionnées');
  for (const m of ['app', 'core', 'library', 'bookmarklet', 'sample']) assert.ok(idx.includes(`"./js/${m}.js": "./js/${m}.js?v=${v}"`), m);
});

test('au départ : un seul bouton, aucune playlist, un exemple proposé', () => {
  assert.equal($('#start').hidden, false);
  assert.equal(cards().length, 0);
  assert.equal(sheetOpen(), false);
  assert.equal($('#detail').hidden, true);
  assert.match($('#add').textContent, /Ajouter une playlist/);
});

test('« Ajouter » ouvre les deux étapes et le favori à glisser', () => {
  click($('#add'));
  assert.equal(sheetOpen(), true);
  const href = $('#bm-link').getAttribute('href');
  assert.ok(href.startsWith('javascript:'));
  assert.ok(decodeURIComponent(href).includes('"http://localhost/"'));
  click($('#bm-link'));
  assert.match($('#toast').textContent, /barre de favoris/);
  assert.equal(sheetOpen(), true);
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
  assert.equal(sheetOpen(), false);
});

test('l\'exemple affiche deux playlists en pochettes', () => {
  click($('#start-demo'));
  assert.deepEqual(names(), ['Soirée été', 'Warm-up']);
  assert.equal($('#start').hidden, true);
  assert.match($('.card-meta', cards()[0]).textContent, /24 titres/);
  assert.ok($('.cover-letter', cards()[0]), 'sans pochette : la lettre sur fond coloré');
});

test('entrer dans une playlist : titres, doublons marqués, bouton de nettoyage', () => {
  open(0);
  assert.equal($('#detail').hidden, false);
  assert.equal($('#home').hidden, true);
  assert.equal($('#pl-name').value, 'Soirée été');
  assert.equal(rows().length, 24);
  assert.equal($$('.trk.is-dup').length, 3);
  assert.equal($('#clean').textContent, 'Retirer 3 doublons');
  assert.ok($('.badge.is-dup').title.includes('Même titre'));
});

test('nettoyer en un clic, puis annuler', () => {
  click($('#clean'));
  assert.equal(rows().length, 21);
  assert.match($('#notice').textContent, /3 doublons retirés\. Il reste 21 titres/);
  assert.equal($('#clean').disabled, true);
  assert.equal($('#clean').textContent, 'Aucun doublon ✓');
  click($('[data-act="undo"]'));
  assert.equal(rows().length, 24);
  assert.equal($('#clean').textContent, 'Retirer 3 doublons');
  click($('#clean'));
  assert.equal(rows().length, 21);
});

test('retirer un titre, annuler', () => {
  const first = $('.trk-title', rows()[0]).textContent;
  click($('[data-act="remove-track"]', rows()[0]));
  assert.equal(rows().length, 20);
  assert.match($('#notice').textContent, new RegExp(`${first}.*retiré`));
  click($('[data-act="undo"]'));
  assert.equal(rows().length, 21);
});

test('renommer la playlist', () => {
  const input = $('#pl-name');
  type(input, 'Set du samedi');
  input.dispatchEvent(new window.Event('change', { bubbles: true }));
  click($('#back'));
  assert.deepEqual(names(), ['Set du samedi', 'Warm-up']);
});

test('les versions d\'un même titre portent un badge, le titre de base est affiché', () => {
  open(1);
  const badges = $$('.badge:not(.is-dup)').map((b) => b.textContent);
  assert.ok(badges.length >= 2, `badges: ${badges}`);
  assert.ok(badges.some((b) => /remix/i.test(b)));
  assert.ok(badges.includes('Original'));
  click($('#back'));
});

test('recréer sur SoundCloud : copie, étapes et favori vert', async () => {
  // aucun titre de l'exemple n'a d'identifiant : seuls ceux qui ont un lien partent
  open(0);
  globalThis.__copied = '';
  click($('#recreate'));
  await wait();
  assert.ok(globalThis.__copied.startsWith('LEBAC1:'));
  const lists = JSON.parse(globalThis.__copied.slice(7)).lists;
  assert.equal(lists.length, 1);
  assert.equal(lists[0].name, 'Set du samedi');
  assert.equal(sheetOpen(), true);
  assert.match($('#sheet-title').textContent, /Recréer « Set du samedi » sur SoundCloud/);
  assert.ok(decodeURIComponent($('#bm2-link').getAttribute('href')).includes('oauth_token'));
  assert.match($('#sheet-body').textContent, /soundcloud\.com.*connecté/);
  click($('#sheet-x'));
  assert.equal(sheetOpen(), false);
});

test('une playlist sans lien ni identifiant ne part pas', async () => {
  click($('#back'));
  click($('#add'));
  type($('#paste-name'), 'Sans lien');
  type($('#paste-text'), 'Artiste - Un\nArtiste - Deux');
  $('#paste-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await wait();
  assert.equal(sheetOpen(), false);
  open(2);
  globalThis.__copied = '';
  click($('#recreate'));
  await wait();
  assert.equal(globalThis.__copied, '');
  assert.match($('#toast').textContent, /Aucun titre à envoyer/);
  click($('#back'));
});

test('comparer deux playlists', () => {
  assert.equal($('.pick', cards()[0]).textContent, 'Choisir');
  assert.equal($('.card-open .pick', cards()[0]), null, 'le bouton Choisir n\'est pas sur la pochette');
  click($('.pick', cards()[0]));
  assert.equal($('.pick', cards()[0]).textContent, '✓ Choisie');
  assert.equal($('#homebar').hidden, false);
  assert.match($('#homebar-text').textContent, /1 playlist choisie/);
  assert.equal($('#hb-compare').hidden, true);
  click($('.pick', cards()[1]));
  assert.equal($('#hb-compare').hidden, false);
  click($('#hb-compare'));
  assert.equal(sheetOpen(), true);
  const stats = $$('.stat b').map((b) => Number(b.textContent));
  assert.ok(stats[0] >= 3, `en commun: ${stats[0]}`);
  assert.match($('#sheet-body').textContent, /En commun/);
});

test('fusionner : une nouvelle playlist sans doublons, les deux autres intactes', () => {
  click($('[data-act="merge-two"]'));
  assert.equal(sheetOpen(), false);
  assert.equal($('#detail').hidden, false);
  assert.equal($('#pl-name').value, 'Set du samedi + Warm-up');
  assert.match($('#notice').textContent, /Fusion de 2 playlists/);
  assert.equal($$('.trk.is-dup').length, 0);
  const [, kept, removed] = $('#notice').textContent.match(/(\d+) titres, (\d+) doublons? retirés?/).map(Number);
  assert.equal(rows().length, kept);
  assert.equal(kept + removed, 21 + 24, 'rien ne se perd : gardés + retirés = titres des deux playlists');
  click($('#back'));
  assert.equal(cards().length, 4);
});

test('ranger par style : des playlists en plus, la source reste', () => {
  const before = cards().length;
  open(cards().length - 1); // la fusion
  click($('#split'));
  assert.ok(cards().length >= before + 2, `${cards().length} cartes`);
  assert.ok(names().some((n) => n.startsWith('Set du samedi + Warm-up · ')));
  assert.match($('#toast').textContent, /playlists créées par style/);
});

test('exporter en CSV, supprimer avec confirmation', () => {
  open(0);
  click($('#export'));
  assert.equal(globalThis.__blob.type, 'text/csv;charset=utf-8');
  assert.deepEqual(globalThis.__downloads, ['Set_du_samedi.csv']);
  const n = cards().length;
  click($('#delete'));
  assert.match($('#notice').textContent, /Supprimer « Set du samedi »/);
  click($('[data-act="notice-close"]'));
  click($('#back'));
  assert.equal(cards().length, n);
  open(0);
  click($('#delete'));
  click($('[data-act="delete-yes"]'));
  assert.equal($('#home').hidden, false);
  assert.equal(cards().length, n - 1);
  assert.ok(!names().includes('Set du samedi'));
});

test('import depuis le favori : une nouvelle playlist avec pochette, adresse nettoyée', async () => {
  const payload = (name, tracks, art = '') =>
    '#import=' + Buffer.from(JSON.stringify({ v: 1, name, art, tracks }), 'utf8').toString('base64url');
  const before = cards().length;
  window.location.hash = payload('Chill é', [
    { id: 11, title: 'Moi - Un', uploader: 'x', genre: 'Lo-fi', webpage_url: 'https://soundcloud.com/a/un', art: 'artworks-1-a' },
    { id: 12, title: 'Deux', uploader: 'Bob', genre: 'House' },
  ], 'artworks-cover-z');
  await wait(40);
  assert.equal(cards().length, before + 1);
  const card = cards().at(-1);
  assert.equal($('.card-name', card).textContent, 'Chill é');
  assert.match($('.card-meta', card).textContent, /2 titres/);
  assert.ok($('img[data-art]', card).src.includes('artworks-cover-z-t200x200.jpg'), 'pochette de la playlist');
  assert.equal(window.location.hash, '');
  assert.match($('#toast').textContent, /Chill é ajoutée : 2 titres/);

  // le même nom reçoit un numéro
  window.location.hash = payload('Chill é', [{ title: 'Trois', uploader: 'Z' }]);
  await wait(40);
  assert.equal(names().at(-1), 'Chill é (2)');

  window.location.hash = '#import=@@@';
  await wait(40);
  assert.equal(cards().length, before + 2, 'adresse invalide ignorée');
  window.location.hash = '';

  // les identifiants SoundCloud arrivent jusqu'à l'envoi
  open(cards().length - 2);
  globalThis.__copied = '';
  click($('#recreate'));
  await wait();
  assert.deepEqual(JSON.parse(globalThis.__copied.slice(7)).lists, [{ name: 'Chill é', items: [11, 12] }]);
  click($('#sheet-x'));
  click($('#back'));
});

test('lecteur : écoute, pause, suivant, enchaînement automatique, fermeture', async () => {
  const payload = (name, tracks) => '#import=' + Buffer.from(JSON.stringify({ v: 1, name, tracks }), 'utf8').toString('base64url');
  window.location.hash = payload('Lecteur', [
    { id: 21, title: 'Eric Prydz - Pjanoo', genre: 'House' },
    { id: 22, title: 'Eric Prydz - Pjanoo (Club Edit)', genre: 'House' },
    { id: 23, title: 'DJ B - Autre morceau', genre: 'House' },
    { title: 'Sans - Identifiant', genre: 'House' },
  ]);
  await wait(40);
  open(cards().length - 1);
  assert.equal($$('.thumb.play').length, 3, 'le titre sans lien ni identifiant n\'a pas de bouton écouter');
  assert.equal($('#player').hidden, true);

  click($$('.thumb.play')[0]);
  await wait();
  assert.equal($('#player').hidden, false);
  assert.equal(widgets.length, 1);
  assert.ok(widgets[0].frame.src.includes('w.soundcloud.com/player/'));
  assert.ok(decodeURIComponent(widgets[0].frame.src).includes('https://api.soundcloud.com/tracks/21'));
  assert.equal($('#p-title').textContent, 'Pjanoo');
  assert.equal($('#p-prev').disabled, true);
  assert.ok(rows()[0].classList.contains('is-current'));

  widgets[0].handlers.play();
  assert.equal($('#p-toggle').textContent, '❚❚');
  assert.ok(rows()[0].classList.contains('is-playing'));
  click($('#p-toggle'));
  assert.equal(widgets[0].toggled, 1);
  widgets[0].handlers.pause();
  assert.equal($('#p-toggle').textContent, '▶');

  click($('#p-next'));
  await wait();
  assert.equal($('#p-title').textContent, 'Pjanoo (Club Edit)');
  assert.ok(widgets[0].loaded.at(-1)[0].endsWith('/tracks/22'), 'le même lecteur charge le titre suivant');
  assert.equal(widgets[0].loaded.at(-1)[1].auto_play, true);
  assert.equal(widgets.length, 1);

  widgets[0].handlers.finish();
  await wait();
  assert.equal($('#p-title').textContent, 'Autre morceau');
  assert.equal($('#p-next').disabled, true, 'fin de la file');
  click($('#p-prev'));
  await wait();
  assert.equal($('#p-title').textContent, 'Pjanoo (Club Edit)');
  click($('#p-prev'));
  await wait();
  assert.equal($('#p-title').textContent, 'Pjanoo');

  // un titre que SoundCloud refuse de jouer : le message le dit dans la barre
  widgets[0].handlers.error();
  assert.match($('#p-artist').textContent, /ne peut pas être lu ici/);
  widgets[0].handlers.play();
  assert.equal($('#p-artist').textContent, 'Eric Prydz', 'le message disparaît quand la lecture démarre');
});

test('idées d\'enchaînement : autres versions puis même style, « jouer ensuite »', async () => {
  click($('#p-ideas'));
  assert.equal(sheetOpen(), true);
  const text = $('#sheet-body').textContent;
  assert.match(text, /Autres versions dans tes playlists/);
  assert.match(text, /Pjanoo \(Club Edit\).*Lecteur/s);
  assert.match(text, /Même style : House/);
  assert.match(text, /Autre morceau/);
  assert.match(text, /tempo de ce titre n'est pas indiqué/);
  assert.match($('#sheet-body a.link').href, /soundcloud\.com\/search\/sounds\?q=Eric%20Prydz%20Pjanoo%20remix/);
  const before = widgets[0].loaded.length;
  click($$('[data-act="play-next"]').at(-1));
  await wait();
  assert.equal(sheetOpen(), false);
  assert.equal(widgets[0].loaded.length, before + 1);
  assert.equal($('#p-title').textContent, 'Autre morceau');
  click($('#p-close'));
  assert.equal($('#player').hidden, true);
  assert.equal(widgets[0].paused, 1);
  assert.equal(document.body.classList.contains('has-player'), false);
  click($('#back'));
});

test('toute la ligne lance la musique, pas les boutons qu\'elle contient', async () => {
  const payload = (name, tracks) => '#import=' + Buffer.from(JSON.stringify({ v: 1, name, tracks }), 'utf8').toString('base64url');
  window.location.hash = payload('Ligne', [
    { id: 31, title: 'Un - Premier', genre: 'House' },
    { id: 32, title: 'Deux - Second', genre: 'House', webpage_url: 'https://soundcloud.com/deux/second' },
  ]);
  await wait(40);
  open(cards().length - 1);
  const before = widgets[0].loaded.length;
  click($('.trk-main', rows()[1]));
  await wait();
  assert.equal($('#p-title').textContent, 'Second');
  assert.equal(widgets[0].loaded.length, before + 1);
  const n = widgets[0].loaded.length;
  click($('[data-act="remove-track"]', rows()[0]));
  await wait();
  assert.equal(widgets[0].loaded.length, n, 'le × retire le titre sans lancer la musique');
  click($('[data-act="undo"]'));
  click($('.open', rows()[1]));
  assert.equal(widgets[0].loaded.length, n, 'le lien ouvrir ne lance pas non plus le lecteur');
  click($('#p-close'));
  click($('#back'));
});

test('créer un set DJ à partir de deux playlists', async () => {
  const payload = (name, tracks) => '#import=' + Buffer.from(JSON.stringify({ v: 1, name, tracks }), 'utf8').toString('base64url');
  const t = (id, title, genre) => ({ id, title, genre });
  window.location.hash = payload('Set A', [t(41, 'A1 - Morceau un', 'House'), t(42, 'A2 - Morceau deux', 'Drum & Bass'), t(43, 'A3 - Morceau trois', 'House'), t(44, 'A4 - Seul au monde', 'Hip-hop & Rap')]);
  await wait(40);
  window.location.hash = payload('Set B', [t(45, 'B1 - Morceau quatre', 'Drum & Bass'), t(46, 'B2 - Morceau cinq', 'House'), t(47, 'A1 - Morceau un (Original Mix)', 'House'), t(48, 'B3 - Morceau six', 'Drum & Bass')]);
  await wait(40);
  const a = cards().findIndex((c) => $('.card-name', c).textContent === 'Set A');
  const b = cards().findIndex((c) => $('.card-name', c).textContent === 'Set B');
  const count = cards().length;
  click($('.pick', cards()[a]));
  click($('.pick', cards()[b]));
  assert.equal($('#hb-set').hidden, false);
  click($('#hb-set'));

  assert.equal($('#detail').hidden, false);
  assert.equal($('#pl-name').value, 'Set · Set A + Set B');
  assert.match($('#notice').textContent, /Set de 6 titres à partir de 2 playlists/);
  assert.match($('#notice').textContent, /1 doublon retiré/);
  assert.match($('#notice').textContent, /1 titre mis de côté dans « À part · Set A \+ Set B »/);
  assert.equal(rows().length, 6);
  assert.ok($('#tracks').classList.contains('is-set'));
  // 6 titres = 5 enchaînements décrits, dont les styles regroupés (house ensemble, drum & bass ensemble)
  assert.equal($$('.gap').length, 5);
  const titles = rows().map((r) => $('.trk-title', r).textContent);
  const styleOf = (title) => (/un|trois|cinq/.test(title) ? 'H' : 'D');
  const seq = titles.map(styleOf).join('');
  assert.ok(/^H+D+$|^D+H+$/.test(seq), `blocs de style : ${seq} (${titles})`);
  assert.equal($$('.gap-weak').length, 1, 'un seul saut de style, signalé');
  assert.match($('.gap-weak').textContent, /^À préparer · changement de style/);
  assert.match($('#pl-meta').textContent, /1 enchaînement à préparer/);
  assert.equal($('#order').textContent, 'Réordonner le set');
  click($('#back'));
  assert.equal(cards().length, count + 2, 'le set et la playlist « À part »');
  assert.ok(names().includes('À part · Set A + Set B'));
});

test('set : monter / descendre un titre, réordonner, annuler', () => {
  open(cards().findIndex((c) => $('.card-name', c).textContent === 'Set · Set A + Set B'));
  const first = $('.trk-title', rows()[0]).textContent;
  const second = $('.trk-title', rows()[1]).textContent;
  click($('[data-act="move-down"]', rows()[0]));
  assert.equal($('.trk-title', rows()[0]).textContent, second);
  assert.equal($('.trk-title', rows()[1]).textContent, first);
  click($('[data-act="move-up"]', rows()[1]));
  assert.equal($('.trk-title', rows()[0]).textContent, first);
  click($('[data-act="move-up"]', rows()[0])); // déjà en haut : rien
  assert.equal($('.trk-title', rows()[0]).textContent, first);
  // tout mélanger à la main, puis « Réordonner »
  for (let i = 0; i < 3; i++) click($('[data-act="move-down"]', rows()[i]));
  click($('#order'));
  assert.match($('#notice').textContent, /Mis en ordre pour le DJ/);
  assert.equal(rows().length, 6);
  click($('[data-act="undo"]'));
  assert.equal(rows().length, 6);
  click($('#back'));
});

test('« Ordonner pour DJer » sur une playlist ordinaire la passe en mode set', () => {
  open(cards().findIndex((c) => $('.card-name', c).textContent === 'Set B'));
  assert.equal($('#tracks').classList.contains('is-set'), false);
  assert.equal($$('.gap').length, 0);
  assert.equal($('#order').textContent, 'Ordonner pour DJer');
  click($('#order'));
  assert.ok($('#tracks').classList.contains('is-set'));
  assert.equal($$('.gap').length, 3);
  click($('[data-act="undo"]'));
  assert.equal($('#tracks').classList.contains('is-set'), false, 'annuler enlève aussi le mode set');
  click($('#back'));
});

test('idées : lien vers les sons similaires de SoundCloud', async () => {
  open(cards().findIndex((c) => $('.card-name', c).textContent === 'Ligne'));
  click($('.trk-main', rows()[1]));
  await wait();
  click($('#p-ideas'));
  assert.equal($('#sheet-body a[href$="/recommended"]').href, 'https://soundcloud.com/deux/second/recommended');
  assert.match($('#sheet-body').textContent, /Trouver de nouveaux sons/);
  click($('#sheet-x'));
  click($('#p-close'));
  click($('#back'));
});

test('un titre piégé n\'injecte pas de HTML', async () => {
  click($('#add'));
  type($('#paste-name'), '<b>gras</b>');
  type($('#paste-text'), 'Hack - <img src=x onerror=alert(1)> | <b>x</b>');
  $('#paste-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await wait();
  assert.equal($('#grid img[src="x"]'), null);
  assert.equal($('#grid b'), null);
  assert.ok(names().includes('<b>gras</b>'));
  open(cards().length - 1);
  assert.equal($('#tracks img[src="x"]'), null);
  assert.equal($('#tracks b'), null);
  assert.ok($('#tracks').textContent.includes('<img src=x'));
  click($('#back'));
});

test('lien de playlist collé : message clair, pas de plantage', async () => {
  const before = cards().length;
  click($('#add'));
  type($('#paste-text'), 'https://soundcloud.com/moi/sets/ma-playlist');
  $('#paste-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await wait();
  assert.equal(sheetOpen(), true);
  assert.match($('.warn').textContent, /lien de playlist ne peut pas être lu/);
  assert.equal(cards().length, before);
  click($('#sheet-x'));
});

test('les playlists sont enregistrées dans le navigateur et se rechargent', async () => {
  await wait(300);
  const saved = stored();
  assert.equal(saved.length, cards().length);
  assert.ok(saved.some((p) => p.name === 'Chill é' && p.art === 'artworks-cover-z' && p.tracks[0].scid === 11));
});

test('aucune erreur JavaScript levée', () => {
  assert.deepEqual(errors.map((e) => e.message), []);
});
