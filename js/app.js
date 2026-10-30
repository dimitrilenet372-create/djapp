import * as core from './core.js';
import * as L from './library.js';
import { SAMPLE_A, SAMPLE_2 } from './sample.js';
import { bookmarkletCode, bookmarkletHref, pusherCode, pusherHref } from './bookmarklet.js';

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const safeUrl = (u) => (/^https?:\/\//i.test(u || '') ? u : '');
const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;
const hash = (s) => [...String(s)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
const tint = (s) => `var(--t${hash(s) % 10})`;
const letterOf = (s) => ([...String(s || '').trim()][0] || '♪').toUpperCase();

// --------------------------------------------------------------------------- //
// État et enregistrement : les playlists restent dans le navigateur
// --------------------------------------------------------------------------- //
const STORE = 'lebac.v2';
const state = {
  lib: [],
  view: 'home', // 'home' | 'detail'
  id: null,
  picked: new Set(),
  notice: null, // { text, undo?: { id, tracks }, confirmDelete?: true }
  threshold: 90,
};

try {
  state.lib = L.deserialize(window.localStorage.getItem(STORE));
} catch {
  state.lib = [];
}

let saveTimer;
const saveSoon = () => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      window.localStorage.setItem(STORE, L.serialize(state.lib));
    } catch {
      /* stockage plein ou refusé : l'app fonctionne quand même */
    }
  }, 250);
};

const current = () => state.lib.find((p) => p.id === state.id) || null;

// --------------------------------------------------------------------------- //
// Message, copie, téléchargement
// --------------------------------------------------------------------------- //
let toastTimer;
function toast(msg, ms = 3400) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

/** Copie dans le presse-papiers ; renvoie true si la copie a réussi. */
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0';
    document.body.append(ta);
    ta.select();
    let done = false;
    try {
      done = document.execCommand('copy');
    } catch {
      /* ignore */
    }
    ta.remove();
    return done;
  }
}

function download(name, data, type) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// une pochette qui ne charge pas laisse voir la couleur de fond
document.addEventListener(
  'error',
  (e) => {
    if (e.target && e.target.tagName === 'IMG' && e.target.dataset.art !== undefined) e.target.remove();
  },
  true,
);

// --------------------------------------------------------------------------- //
// Pochettes
// --------------------------------------------------------------------------- //
const img = (art, size) =>
  `<img src="${esc(L.artUrl(art, size))}" data-art alt="" loading="lazy" referrerpolicy="no-referrer">`;

function coverHtml(pl, big = false) {
  const arts = L.coverArts(pl);
  const size = big ? 't300x300' : 't200x200';
  const mosaic = arts.length >= 4;
  const head = `<div${big ? ' id="hero-cover"' : ''} class="cover${big ? ' cover-lg' : ''}${mosaic ? ' mosaic' : ''}" style="--c:${tint(pl.id)}"${big ? ' aria-hidden="true"' : ''}>`;
  if (mosaic) return `${head}${arts.map((a) => img(a, size)).join('')}</div>`;
  return `${head}<span class="cover-letter">${esc(letterOf(pl.name))}</span>${arts[0] ? img(arts[0], size) : ''}</div>`;
}

// --------------------------------------------------------------------------- //
// Accueil
// --------------------------------------------------------------------------- //
function metaOf(pl) {
  const dur = L.totalSeconds(pl.tracks);
  return `${plural(pl.tracks.length, 'titre', 'titres')}${dur ? ` · ${L.formatDuration(dur)}` : ''}`;
}

let firstHome = true;
function renderHome() {
  const grid = $('#grid');
  $('#start').hidden = state.lib.length > 0;
  grid.classList.toggle('fresh', firstHome && state.lib.length > 0);
  firstHome = false;
  grid.innerHTML = state.lib
    .map((pl, i) => {
      const on = state.picked.has(pl.id);
      return `<article class="card${on ? ' is-picked' : ''}" data-id="${pl.id}" style="--i:${Math.min(i, 10)}">
        <button type="button" class="card-open" data-act="open" aria-label="Ouvrir ${esc(pl.name)}">${coverHtml(pl)}
          <p class="card-name">${esc(pl.name)}</p><p class="card-meta">${esc(metaOf(pl))}</p></button>
        <button type="button" class="pick" data-act="pick" aria-pressed="${on}" aria-label="Choisir ${esc(pl.name)} pour comparer ou fusionner">${on ? '✓' : ''}</button>
      </article>`;
    })
    .join('');
  renderHomebar();
}

function renderHomebar() {
  const n = state.picked.size;
  const bar = $('#homebar');
  bar.hidden = state.view !== 'home' || n === 0;
  $('#homebar-text').textContent = n === 1 ? '1 playlist choisie. Choisis-en une autre pour comparer ou fusionner.' : `${n} playlists choisies`;
  $('#hb-compare').hidden = n !== 2;
  $('#hb-merge').hidden = n < 2;
}

// --------------------------------------------------------------------------- //
// Playlist
// --------------------------------------------------------------------------- //
const dupCache = new WeakMap();
function dupsOf(pl) {
  const hit = dupCache.get(pl.tracks);
  if (hit && hit.t === state.threshold) return hit.map;
  const map = L.findDuplicates(pl.tracks, state.threshold);
  dupCache.set(pl.tracks, { t: state.threshold, map });
  return map;
}

const OPEN_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>';

function rowHtml(t, dup) {
  const shown = t.familyId ? core.parseVersion(t.title).base || t.title : t.title;
  const badge = dup
    ? `<span class="badge is-dup" title="Même titre que « ${esc(core.labelOf(dup.kept))} » (${esc(dup.reason)})">Doublon</span>`
    : t.familyId
      ? `<span class="badge${t.versionLabel === 'Original' ? ' is-original' : ''}" title="Version liée">${esc(t.versionLabel)}</span>`
      : '';
  const url = safeUrl(t.url);
  const open = url
    ? `<a class="open" href="${esc(url)}" target="_blank" rel="noopener" aria-label="Ouvrir ${esc(t.title)} sur SoundCloud">${OPEN_ICON}</a>`
    : '<span></span>';
  return `<li class="trk${dup ? ' is-dup' : ''}" data-id="${t.id}">
    <span class="thumb" style="--c:${tint(t.artist || t.title)}">${esc(letterOf(t.artist || t.title))}${t.art ? img(t.art, 't200x200') : ''}</span>
    <span class="trk-main"><span class="trk-title" title="${esc(t.title)}">${esc(shown)}</span><span class="trk-artist">${esc(t.artist || 'Artiste inconnu')}</span></span>
    <span class="trk-badges">${badge}</span>
    <span class="trk-dur">${t.duration ? L.formatDuration(t.duration) : ''}</span>
    ${open}
    <button type="button" class="trk-x" data-act="remove-track" aria-label="Retirer ${esc(t.title)} de la playlist" title="Retirer de la playlist">×</button>
  </li>`;
}

function renderNotice() {
  const el = $('#notice');
  const n = state.notice;
  el.hidden = !n;
  if (!n) return;
  const pl = current();
  el.innerHTML =
    `<p>${esc(n.text)}</p>` +
    (n.undo ? '<button type="button" class="btn btn-small btn-line" data-act="undo">Annuler</button>' : '') +
    (n.confirmDelete
      ? `<button type="button" class="btn btn-small btn-solid" data-act="delete-yes">Supprimer « ${esc(pl ? pl.name : '')} »</button><button type="button" class="btn btn-small btn-line" data-act="notice-close">Garder</button>`
      : '<button type="button" class="link" data-act="notice-close">Fermer</button>');
}

function renderDetail() {
  const pl = current();
  if (!pl) return setView('home');
  core.annotateVersions(pl.tracks);
  const dups = dupsOf(pl);
  $('#hero-cover').outerHTML = coverHtml(pl, true);
  const name = $('#pl-name');
  if (document.activeElement !== name) name.value = pl.name;
  $('#pl-meta').textContent = metaOf(pl);
  const clean = $('#clean');
  clean.disabled = dups.size === 0;
  clean.textContent = dups.size ? `Retirer ${plural(dups.size, 'doublon', 'doublons')}` : 'Aucun doublon ✓';
  $('#recreate').disabled = pl.tracks.length === 0;
  $('#split').disabled = pl.tracks.length < 2;
  $('#export').disabled = pl.tracks.length === 0;
  $('#tracks').innerHTML = pl.tracks.length
    ? pl.tracks.map((t) => rowHtml(t, dups.get(t.id))).join('')
    : '<li class="tracks-empty">Cette playlist est vide.</li>';
  renderNotice();
}

function setView(view, id = null) {
  state.view = view;
  state.id = id;
  state.notice = null;
  $('#home').hidden = view !== 'home';
  $('#detail').hidden = view !== 'detail';
  $('#back').hidden = view !== 'detail';
  $('#top').classList.toggle('compact', view === 'detail');
  if (view === 'home') renderHome();
  else {
    state.picked.clear();
    renderHomebar();
    renderDetail();
  }
  window.scrollTo?.(0, 0);
}

function addPlaylist(name, tracks, art = '') {
  const pl = L.newPlaylist(L.uniqueName(state.lib, name), tracks, art);
  state.lib.push(pl);
  saveSoon();
  return pl;
}

function mutate(pl, tracks, text, undoable = true) {
  state.notice = { text, undo: undoable ? { id: pl.id, tracks: pl.tracks } : null };
  pl.tracks = tracks;
  saveSoon();
  renderDetail();
}

// --------------------------------------------------------------------------- //
// Fenêtres (ajout, envoi vers SoundCloud, comparaison)
// --------------------------------------------------------------------------- //
let lastFocus = null;
function openSheet(html) {
  if ($('#sheet').hidden) lastFocus = document.activeElement;
  $('#sheet-body').innerHTML = html;
  $('#sheet').hidden = false;
  const first = $('#sheet-body input, #sheet-body button, #sheet-body a');
  ($('#sheet-x') || first).focus?.();
}
function closeSheet() {
  $('#sheet').hidden = true;
  $('#sheet-body').innerHTML = '';
  lastFocus?.focus?.();
}

const bmBlock = (id, cls, label, href) =>
  `<a id="${id}" class="bm ${cls}" href="${esc(href)}" draggable="true">${label}</a>`;
const appUrl = () => window.location.origin + window.location.pathname;

function addSheet(message = '') {
  openSheet(`<h2 id="sheet-title">Ajouter une playlist</h2>
    <ol class="steps">
      <li><b>Une seule fois :</b> glisse ce bouton dans ta barre de favoris (Ctrl+Maj+B pour l'afficher).<br>
        ${bmBlock('bm-link', '', 'Ajouter à Le bac', bookmarkletHref(appUrl()))}<br>
        <button type="button" class="link" data-act="copy-bm">Il ne se glisse pas ? Copier le code</button></li>
      <li>Ouvre ta playlist sur <b>soundcloud.com</b> et clique sur ce favori. Elle arrive ici toute seule.</li>
    </ol>
    ${message ? `<p class="warn">${esc(message)}</p>` : ''}
    <details${message ? ' open' : ''}><summary>Autre façon : coller des titres ou un fichier</summary>
      <form id="paste-form" class="paste" autocomplete="off">
        <label class="sr-only" for="paste-name">Nom de la playlist</label>
        <input id="paste-name" placeholder="Nom de la playlist">
        <label class="sr-only" for="paste-text">Titres</label>
        <textarea id="paste-text" placeholder="Un titre par ligne&#10;Artiste - Titre&#10;Artiste - Titre | genre | lien"></textarea>
        <div class="paste-foot">
          <label class="btn btn-small btn-line" style="cursor:pointer">Importer un fichier<input id="paste-file" type="file" accept=".txt,.csv,.json,.jsonl,text/*,application/json" multiple class="sr-only"></label>
          <button type="submit" class="btn btn-small btn-solid">Créer la playlist</button>
        </div>
      </form>
    </details>
    <div class="sheet-foot"><button type="button" class="link" data-act="sample">Essayer avec un exemple</button></div>`);
}

async function pushSheet(pl) {
  const out = core.soundcloudPayload([pl]);
  if (!out.tracks) {
    toast('Aucun titre à envoyer : il faut un lien ou un identifiant SoundCloud.');
    return;
  }
  const done = await copyText(out.text);
  openSheet(`<h2 id="sheet-title">Recréer « ${esc(pl.name)} » sur SoundCloud</h2>
    ${
      done
        ? `<p class="ok">✓ ${plural(out.tracks, 'titre copié', 'titres copiés')}.${out.skipped ? ` ${plural(out.skipped, 'titre sans lien SoundCloud est ignoré', 'titres sans lien SoundCloud sont ignorés')}.` : ''}</p>`
        : `<p class="warn">La copie automatique a échoué : sélectionne le texte ci-dessous et copie-le (Ctrl+C).</p>`
    }
    <ol class="steps">
      <li><b>Une seule fois :</b> glisse ce bouton dans ta barre de favoris.<br>
        ${bmBlock('bm2-link', 'bm-out', 'Envoyer à SoundCloud', pusherHref())}<br>
        <button type="button" class="link" data-act="copy-bm2">Il ne se glisse pas ? Copier le code</button></li>
      <li>Ouvre <a href="https://soundcloud.com/" target="_blank" rel="noopener"><b>soundcloud.com</b></a> connecté à ton compte.</li>
      <li>Clique sur le favori : il demande confirmation, puis crée la playlist <b>privée</b> « ${esc(pl.name)} ».</li>
    </ol>
    <details${done ? '' : ' open'}><summary>Le texte copié</summary><textarea class="copied" readonly aria-label="Texte à copier">${esc(out.text)}</textarea></details>
    <div class="sheet-foot"><button type="button" class="link" data-act="copy-push" data-id="${pl.id}">Copier à nouveau</button></div>`);
}

function compareSheet(a, b) {
  const r = L.comparePlaylists(a, b, state.threshold);
  const li = (t, extra = '') => `<li>${esc(core.labelOf(t))}${extra}</li>`;
  openSheet(`<h2 id="sheet-title">${esc(a.name)} et ${esc(b.name)}</h2>
    <div class="stats">
      <div class="stat"><b>${r.common.length}</b><span>en commun</span></div>
      <div class="stat"><b>${r.onlyA.length}</b><span>seulement dans ${esc(a.name)}</span></div>
      <div class="stat"><b>${r.onlyB.length}</b><span>seulement dans ${esc(b.name)}</span></div>
    </div>
    <div class="cmp">
      <section><h3>En commun</h3><ul>${r.common.map((c) => li(c.a, c.b.title !== c.a.title ? ` <small>= ${esc(c.b.title)}</small>` : '')).join('') || '<li>Aucun titre en commun.</li>'}</ul></section>
      <section><h3>Seulement dans ${esc(a.name)}</h3><ul>${r.onlyA.map((t) => li(t)).join('') || '<li>Rien.</li>'}</ul></section>
      <section><h3>Seulement dans ${esc(b.name)}</h3><ul>${r.onlyB.map((t) => li(t)).join('') || '<li>Rien.</li>'}</ul></section>
    </div>
    <div class="sheet-foot"><button type="button" class="btn btn-solid" data-act="merge-two" data-a="${a.id}" data-b="${b.id}">Fusionner sans doublons</button></div>`);
}

// --------------------------------------------------------------------------- //
// Actions
// --------------------------------------------------------------------------- //
function mergePicked(ids) {
  const pls = ids.map((id) => state.lib.find((p) => p.id === id)).filter(Boolean);
  if (pls.length < 2) return;
  const name = L.uniqueName(state.lib, pls.map((p) => p.name).join(' + ').slice(0, 60));
  const m = L.mergePlaylists(pls, name, state.threshold);
  state.lib.push(m.playlist);
  saveSoon();
  closeSheet();
  setView('detail', m.playlist.id);
  state.notice = {
    text: `Fusion de ${pls.length} playlists : ${plural(m.playlist.tracks.length, 'titre', 'titres')}${m.removed ? `, ${plural(m.removed, 'doublon retiré', 'doublons retirés')}` : ''}.`,
  };
  renderNotice();
}

async function readFiles(files) {
  const texts = await Promise.all(
    [...files].map(
      (f) =>
        new Promise((resolve) => {
          const r = new FileReader();
          r.onload = () => resolve({ name: f.name, text: String(r.result || '') });
          r.onerror = () => resolve({ name: f.name, text: '' });
          r.readAsText(f);
        }),
    ),
  );
  return texts;
}

function handleImport() {
  const imp = core.decodeImport(window.location.hash);
  if (!imp) return;
  window.history.replaceState(null, '', window.location.pathname + window.location.search);
  const tracks = core.parseEntries(imp.tracks, imp.name);
  if (!tracks.length) {
    toast('Aucun titre dans cette playlist.');
    return;
  }
  const pl = addPlaylist(imp.name, tracks, imp.art);
  closeSheet();
  setView('home');
  toast(`${pl.name} ajoutée : ${plural(tracks.length, 'titre', 'titres')}.`);
}
window.addEventListener('hashchange', handleImport);

// --------------------------------------------------------------------------- //
// Événements
// --------------------------------------------------------------------------- //
$('#add').addEventListener('click', () => addSheet());
$('#start-demo').addEventListener('click', loadSample);
$('#back').addEventListener('click', () => setView('home'));
$('#sheet-x').addEventListener('click', closeSheet);
$('#sheet').addEventListener('click', (e) => {
  if (e.target === $('#sheet')) closeSheet();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('#sheet').hidden) closeSheet();
});

function loadSample() {
  const a = addPlaylist('Soirée été', core.parseAny(SAMPLE_A, 'Soirée été'));
  addPlaylist('Warm-up', core.parseAny(SAMPLE_2, 'Warm-up'));
  closeSheet();
  setView('home');
  toast(`Exemple ajouté : ${a.name} et Warm-up.`);
}

$('#grid').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-act]');
  const card = e.target.closest('.card');
  if (!btn || !card) return;
  if (btn.dataset.act === 'open') setView('detail', card.dataset.id);
  else if (btn.dataset.act === 'pick') {
    if (state.picked.has(card.dataset.id)) state.picked.delete(card.dataset.id);
    else state.picked.add(card.dataset.id);
    renderHome();
  }
});
$('#hb-clear').addEventListener('click', () => {
  state.picked.clear();
  renderHome();
});
$('#hb-merge').addEventListener('click', () => {
  const ids = [...state.picked];
  state.picked.clear();
  mergePicked(ids);
});
$('#hb-compare').addEventListener('click', () => {
  const [a, b] = [...state.picked].map((id) => state.lib.find((p) => p.id === id));
  if (a && b) compareSheet(a, b);
});

$('#pl-name').addEventListener('change', (e) => {
  const pl = current();
  if (!pl) return;
  pl.name = e.target.value.trim().slice(0, 60) || pl.name;
  e.target.value = pl.name;
  saveSoon();
});

$('#clean').addEventListener('click', () => {
  const pl = current();
  if (!pl) return;
  const { kept, removed } = L.cleanTracks(pl.tracks, state.threshold);
  if (!removed.length) return;
  mutate(pl, kept, `${plural(removed.length, 'doublon retiré', 'doublons retirés')}. Il reste ${plural(kept.length, 'titre', 'titres')}.`);
});
$('#recreate').addEventListener('click', () => {
  const pl = current();
  if (pl) pushSheet(pl);
});
$('#split').addEventListener('click', () => {
  const pl = current();
  if (!pl) return;
  const parts = L.splitByStyle(pl, 5);
  for (const p of parts) {
    p.name = L.uniqueName(state.lib, p.name);
    state.lib.push(p);
  }
  saveSoon();
  setView('home');
  toast(`${plural(parts.length, 'playlist créée', 'playlists créées')} par style, à partir de « ${pl.name} ».`, 4500);
});
$('#export').addEventListener('click', () => {
  const pl = current();
  if (pl) download(`${pl.name.replace(/[^\p{L}\p{N}\- ]+/gu, '').trim().replace(/\s+/g, '_') || 'playlist'}.csv`, core.tracksToCsv([pl]), 'text/csv;charset=utf-8');
});
$('#delete').addEventListener('click', () => {
  const pl = current();
  if (!pl) return;
  state.notice = { text: `Supprimer « ${pl.name} » de cette page ? Elle ne sera pas supprimée de SoundCloud.`, confirmDelete: true };
  renderNotice();
});

$('#notice').addEventListener('click', (e) => {
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (act === 'undo' && state.notice?.undo) {
    const { id, tracks } = state.notice.undo;
    const pl = state.lib.find((p) => p.id === id);
    if (pl) {
      pl.tracks = tracks;
      saveSoon();
    }
    state.notice = null;
    renderDetail();
  } else if (act === 'notice-close') {
    state.notice = null;
    renderNotice();
  } else if (act === 'delete-yes') {
    const pl = current();
    state.lib = state.lib.filter((p) => p !== pl);
    saveSoon();
    setView('home');
    toast(pl ? `« ${pl.name} » supprimée.` : 'Supprimée.');
  }
});

$('#tracks').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-act="remove-track"]');
  if (!btn) return;
  const pl = current();
  const id = Number(btn.closest('.trk').dataset.id);
  const t = pl && pl.tracks.find((x) => x.id === id);
  if (t) mutate(pl, pl.tracks.filter((x) => x !== t), `« ${t.title} » retiré de la playlist.`);
});

$('#sheet-body').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-act]');
  if (!btn) {
    if (e.target.closest('#bm-link, #bm2-link')) {
      e.preventDefault();
      toast("Glisse ce bouton dans ta barre de favoris, ne clique pas dessus ici.");
    }
    return;
  }
  const act = btn.dataset.act;
  if (act === 'copy-bm') toast((await copyText(bookmarkletCode(appUrl()))) ? "Code copié : colle-le comme adresse d'un nouveau favori." : 'Copie impossible.');
  else if (act === 'copy-bm2') toast((await copyText(pusherCode())) ? "Code copié : colle-le comme adresse d'un nouveau favori." : 'Copie impossible.');
  else if (act === 'sample') loadSample();
  else if (act === 'copy-push') {
    const pl = state.lib.find((p) => p.id === btn.dataset.id);
    if (pl) toast((await copyText(core.soundcloudPayload([pl]).text)) ? 'Copié.' : 'Copie impossible.');
  } else if (act === 'merge-two') mergePicked([btn.dataset.a, btn.dataset.b]);
});
$('#sheet-body').addEventListener('submit', async (e) => {
  if (e.target.id !== 'paste-form') return;
  e.preventDefault();
  const text = $('#paste-text').value;
  const files = $('#paste-file').files;
  let tracks = core.parseAny(text, 'Collé');
  if (files && files.length) {
    for (const f of await readFiles(files)) tracks = tracks.concat(core.parseAny(f.text, f.name));
  }
  if (!tracks.length) {
    const onlyPlaylist = core.findUrls(text).some(core.isPlaylistUrl);
    addSheet(
      onlyPlaylist
        ? "Un lien de playlist ne peut pas être lu depuis cette page : SoundCloud l'interdit aux sites tiers. Utilise le favori « Ajouter à Le bac » depuis la playlist."
        : 'Aucun titre reconnu. Écris un titre par ligne : Artiste - Titre.',
    );
    return;
  }
  const name = $('#paste-name').value.trim() || `Playlist ${state.lib.length + 1}`;
  const pl = addPlaylist(name, tracks);
  closeSheet();
  setView('home');
  toast(`${pl.name} ajoutée : ${plural(tracks.length, 'titre', 'titres')}.`);
});

// --------------------------------------------------------------------------- //
setView('home');
handleImport();
