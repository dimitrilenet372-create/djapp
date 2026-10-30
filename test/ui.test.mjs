// Test de bout en bout de l'interface dans jsdom : npm test
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
// jsdom ne sait pas « naviguer » : on enregistre les téléchargements déclenchés par l'app
globalThis.__downloads = [];
window.HTMLAnchorElement.prototype.click = function () { globalThis.__downloads.push(this.download); };

await import('../js/app.js');

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const click = (el) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
const type = (el, value) => { el.value = value; el.dispatchEvent(new window.Event('input', { bubbles: true })); };
const dnd = (type, el) => {
  const ev = new window.Event(type, { bubbles: true, cancelable: true });
  ev.dataTransfer = { setData() {}, effectAllowed: '', dropEffect: '' };
  el.dispatchEvent(ev);
};
const crates = () => $$('.crate:not(.crate-new)');
const rowCount = () => $$('.row').length;

test('exemple : bacs, doublons et versions apparaissent', () => {
  click($('#load-sample'));
  assert.equal($('#results').hidden, false);
  assert.equal($('#empty').hidden, true);
  assert.match($('#summary').textContent, /45 titres lus, 4 doublons retirés\. 41 titres rangés/);
  assert.ok(crates().length >= 4, `bacs: ${crates().length}`);
  assert.equal(rowCount(), 41);
  assert.equal($('#n-doublons').textContent, '4');
  assert.equal($('#n-versions').textContent, '2');
  assert.ok($('.crate-name').value.length > 0);
  // le dernier bac est « Divers »
  assert.equal(crates().at(-1).querySelector('.crate-name').value, 'Divers');
});

test('sélection puis déplacement vers un autre bac', () => {
  const first = $('.row');
  const id = first.dataset.id;
  click(first);
  assert.equal(first.getAttribute('aria-checked'), 'true');
  assert.equal($('#selbar').hidden, false);
  assert.equal($('#sel-count').textContent, '1 titre sélectionné');
  const target = $$('#sel-target option').at(-1).value;
  $('#sel-target').value = target;
  click($('#sel-move'));
  const moved = $(`.row[data-id="${id}"]`);
  assert.equal(moved.closest('.crate').dataset.id, target);
  assert.equal($('#selbar').hidden, true);
  assert.equal(rowCount(), 41);
});

test('glisser-déposer sur la zone « nouveau bac »', () => {
  const before = crates().length;
  const row = $('.row');
  const id = row.dataset.id;
  dnd('dragstart', row);
  dnd('dragover', $('.crate-new'));
  assert.ok($('.crate-new').classList.contains('drop'));
  dnd('drop', $('.crate-new'));
  assert.equal(crates().length, before + 1);
  const home = $(`.row[data-id="${id}"]`).closest('.crate');
  assert.equal(home.querySelector('.crate-name').value, 'Nouveau bac');
  assert.equal(rowCount(), 41);
});

test('renommer un bac met à jour la liste de destination', () => {
  const input = crates().at(-1).querySelector('.crate-name');
  type(input, 'Warm-up');
  input.dispatchEvent(new window.Event('change', { bubbles: true }));
  click($('.row'));
  assert.ok($$('#sel-target option').some((o) => o.textContent === 'Warm-up'));
  click($('#sel-clear'));
  assert.equal($('#selbar').hidden, true);
});

test('un bac vide peut être retiré', () => {
  const before = crates().length;
  // vide le bac « Warm-up » en déplaçant son titre ailleurs
  const warm = crates().find((c) => c.querySelector('.crate-name').value === 'Warm-up');
  click($('.row', warm));
  $('#sel-target').value = crates()[0].dataset.id;
  click($('#sel-move'));
  const emptied = crates().find((c) => c.querySelector('.crate-name').value === 'Warm-up');
  click($('[data-act="remove-crate"]', emptied));
  assert.equal(crates().length, before - 1);
});

test('doublons : on peut garder un titre retiré', () => {
  click($('[data-view="doublons"]'));
  assert.equal($('#panel-doublons').hidden, false);
  assert.equal($('#panel-bacs').hidden, true);
  const n = $$('#panel-doublons tbody tr').length;
  click($('[data-act="restore"]'));
  assert.equal($$('#panel-doublons tbody tr').length, n - 1);
  assert.equal(rowCount(), 42);
  assert.equal($('#n-doublons').textContent, String(n - 1));
});

test('versions : réunir une famille dans le même bac', () => {
  click($('[data-view="versions"]'));
  const join = $('[data-act="join"]');
  if (join) {
    click(join);
  }
  const fams = $$('#panel-versions .fam');
  assert.ok(fams.length >= 2);
  assert.ok(fams.every((f) => f.textContent.includes('Déjà dans le même bac')), 'toutes les familles réunies');
  click($('[data-view="bacs"]'));
});

test('copie des liens et exports', async () => {
  const withLinks = crates().find((c) => $$('.open', c).length);
  click($('[data-act="copy-links"]', withLinks));
  await new Promise((r) => setTimeout(r, 10));
  assert.match(globalThis.__copied, /^https:\/\/soundcloud\.com\//);

  click($('#dl-zip'));
  assert.ok(globalThis.__blob.size > 200);
  assert.equal(globalThis.__blob.type, 'application/zip');
  click($('#dl-csv'));
  assert.equal(globalThis.__blob.type, 'text/csv;charset=utf-8');
  assert.deepEqual(globalThis.__downloads, ['le-bac.zip', 'le-bac.csv']);
});

test('un titre piégé n\'injecte pas de HTML', () => {
  const ta = $$('.source textarea');
  type(ta[0], 'Hack - <img src=x onerror=alert(1)> | <b>x</b>');
  type(ta[1], '');
  $('#form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  assert.equal($('#board img'), null, 'aucun élément injecté');
  assert.equal($('#board b'), null);
  assert.ok($('.row').getAttribute('title').includes('<img'), 'le texte reste lisible dans l\'info-bulle');
  assert.ok($('#board').textContent.includes('<img src=x'));
});


test('lien de playlist collé : message clair, pas de plantage', () => {
  const ta = $$('.source textarea');
  type(ta[0], 'https://soundcloud.com/moi/sets/ma-playlist');
  type(ta[1], '');
  const before = $('#summary').textContent;
  $('#form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  assert.match($('#toast').textContent, /liens de playlist/);
  assert.equal($('#summary').textContent, before);
});

const payload = (name, tracks) => '#import=' + Buffer.from(JSON.stringify({ v: 1, name, tracks }), 'utf8').toString('base64url');
const wait = (ms = 30) => new Promise((r) => setTimeout(r, ms));

test('favori : le bouton embarque l\'adresse de l\'app et ne s\'exécute pas ici', () => {
  const href = $('#bm-link').getAttribute('href');
  assert.ok(href.startsWith('javascript:'));
  assert.ok(decodeURIComponent(href).includes('"http://localhost/"'));
  click($('#bm-link'));
  assert.match($('#toast').textContent, /barre de favoris/);
});

test('import depuis le favori : remplit les cartes vides puis en ajoute', async () => {
  click($('#clear-all'));
  assert.equal($$('.source').length, 2);
  window.location.hash = payload('Chill é', [
    { title: 'Moi - Un', uploader: 'x', genre: 'Lo-fi', webpage_url: 'https://soundcloud.com/a/un' },
    { title: 'Deux', uploader: 'Bob', genre: 'House' },
  ]);
  await wait();
  let cards = $$('.source');
  assert.equal($('.source-name', cards[0]).value, 'Chill é');
  assert.match(cards[0].textContent, /2 titres/);
  assert.equal(window.location.hash, '', 'l\'adresse est nettoyée');
  assert.match($('#toast').textContent, /Chill é : 2 titres ajoutés/);

  window.location.hash = payload('Deep', [{ title: 'Trois', uploader: 'Z', genre: 'Techno' }]);
  await wait();
  assert.equal($$('.source').length, 2);
  assert.match($$('.source')[1].textContent, /1 titres/);

  window.location.hash = payload('Troisième', [{ title: 'Quatre', uploader: 'Y' }]);
  await wait();
  assert.equal($$('.source').length, 3, 'une carte est ajoutée quand les autres sont pleines');

  window.location.hash = '#import=@@@';
  await wait();
  assert.equal($$('.source').length, 3, 'adresse invalide ignorée');
  window.location.hash = '';

  click($('#form button[type="submit"]'));
  $('#form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  assert.match($('#summary').textContent, /4 titres lus/);
});

test('les playlists ajoutées sont conservées dans le navigateur', () => {
  const saved = JSON.parse(window.localStorage.getItem('lebac.v1'));
  assert.equal(saved.sources.length, 3);
  assert.equal(saved.sources[0].name, 'Chill é');
  assert.equal(saved.sources[0].files[0].tracks.length, 2);
  assert.equal(saved.sources[0].files[0].tracks[0].genre, 'Lo-fi');
  click($('#clear-all'));
  assert.equal(JSON.parse(window.localStorage.getItem('lebac.v1')).sources.length, 2);
});

test('aucune erreur JavaScript levée', () => {
  assert.deepEqual(errors.map((e) => e.message), []);
});
