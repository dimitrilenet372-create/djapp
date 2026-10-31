import * as core from './core.js';
import * as L from './library.js';
import { SAMPLE_A, SAMPLE_2 } from './sample.js';
import { createCloud } from './cloud.js';
import { firebaseBackend } from './firebase.js';
import * as KY from './keys.js';
import * as SE from './serato.js';
import { bookmarkletCode, bookmarkletHref, pusherCode, pusherHref } from './bookmarklet.js';

const VERSION = '2026-10-31-o';
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
  tab: 'playlists', // 'playlists' | 'sets'
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
    cloud?.localChanged();
  }, 250);
};

let cloud = null; // synchronisation entre appareils (voir plus bas)

const current = () => state.lib.find((p) => p.id === state.id) || null;

// lecteur : file des titres de la playlist en cours d'écoute
const player = { queue: [], i: -1, widget: null, playing: false, note: '', timer: null };
const nowTrack = () => player.queue[player.i] || null;
const playableUrl = (t) => safeUrl(t.url) || (t.scid ? `https://api.soundcloud.com/tracks/${t.scid}` : '');

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

const tabOf = (pl) => (pl.dj ? 'sets' : 'playlists');
const TAB_EMPTY = {
  playlists: "Aucune playlist ici. Les sets sont dans l'onglet « Sets DJ ».",
  sets: 'Aucun set pour l\'instant. Choisis deux playlists avec « Choisir », puis clique sur « Créer un set DJ », ou ouvre une playlist et clique sur « Ordonner pour DJer ».',
};

let firstHome = true;
function renderHome() {
  const grid = $('#grid');
  const empty = state.lib.length === 0;
  const counts = { playlists: state.lib.filter((p) => !p.dj).length, sets: state.lib.filter((p) => p.dj).length };
  $('#start').hidden = !empty;
  $('#tabs').hidden = empty;
  for (const b of document.querySelectorAll('#tabs [data-tab]')) {
    const on = b.dataset.tab === state.tab;
    b.setAttribute('aria-selected', String(on));
    b.tabIndex = on ? 0 : -1;
  }
  $('#n-playlists').textContent = counts.playlists;
  $('#n-sets').textContent = counts.sets;
  const shown = state.lib.filter((p) => tabOf(p) === state.tab);
  $('#tab-empty').hidden = empty || shown.length > 0;
  $('#tab-empty').textContent = TAB_EMPTY[state.tab];
  grid.setAttribute('aria-labelledby', `tab-${state.tab}`);
  grid.classList.toggle('fresh', firstHome && shown.length > 0);
  firstHome = false;
  grid.innerHTML = shown
    .map((pl, i) => {
      const on = state.picked.has(pl.id);
      return `<article class="card${on ? ' is-picked' : ''}${pl.dj ? ' is-set' : ''}" data-id="${pl.id}" style="--i:${Math.min(i, 10)}">
        <button type="button" class="card-open" data-act="open" aria-label="Ouvrir ${pl.dj ? 'le set ' : ''}${esc(pl.name)}">${coverHtml(pl)}
          <p class="card-name">${esc(pl.name)}</p><p class="card-meta">${esc(metaOf(pl))}</p></button>
        <button type="button" class="pick" data-act="pick" aria-pressed="${on}" aria-label="Choisir ${esc(pl.name)} pour comparer, fusionner ou créer un set">${on ? '✓ Choisie' : 'Choisir'}</button>
      </article>`;
    })
    .join('');
  renderHomebar();
}

function setTab(tab) {
  if (state.tab === tab) return;
  state.tab = tab;
  state.picked.clear();
  renderHome();
}

function renderHomebar() {
  const n = state.picked.size;
  const bar = $('#homebar');
  bar.hidden = state.view !== 'home' || n === 0;
  $('#homebar-text').textContent = n === 1 ? '1 playlist choisie. Choisis-en une autre pour comparer ou fusionner.' : `${n} playlists choisies`;
  $('#hb-compare').hidden = n !== 2;
  $('#hb-merge').hidden = n < 2;
  $('#hb-set').hidden = n < 2;
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

/** Pastille tonalité (code Camelot, coloré comme la roue) et tempo ; un clic ouvre la saisie. */
function tuneHtml(t) {
  const n = t.key ? parseInt(t.key, 10) : 0;
  const hue = ((n - 1) * 30 + (t.key && t.key.endsWith('B') ? 0 : 0)) % 360;
  const key = t.key
    ? `<span class="tune-key" style="--k:${hue}" data-b="${t.key.endsWith('B') ? 1 : 0}"${t.keyAuto ? ' data-auto="1" title="Trouvée dans la base GetSongBPM : à vérifier à l\'oreille"' : ''}>${esc(t.key)}</span>`
    : keyRun.pending.has(t.id)
      ? '<span class="tune-add" title="Recherche en cours">…</span>'
      : '<span class="tune-add">+ clé</span>';
  const bpm = t.bpm ? `<span class="tune-bpm">${Math.round(t.bpm)}</span>` : '';
  return `<button type="button" class="tune" data-act="tune" aria-label="Tonalité et tempo de ${esc(t.title)}${t.key ? ` : ${esc(t.key)}` : ''}" title="Tonalité et tempo">${key}${bpm}</button>`;
}

/** Titre que l'artiste laisse récupérer : téléchargement gratuit sur SoundCloud, ou lien d'achat. */
const getChip = (t) => (t.dl ? '<span class="get is-free" title="Téléchargement proposé par l\'artiste">Gratuit</span>' : t.buy ? '<span class="get" title="Lien d\'achat proposé par l\'artiste">Achat</span>' : '');
const gettable = (pl) => pl.tracks.filter((t) => t.dl || t.buy);

function getSheet(pl) {
  const list = gettable(pl);
  const link = (href, label) => `<a href="${esc(href)}" target="_blank" rel="noopener">${label}</a>`;
  openSheet(`<h2 id="sheet-title">À récupérer : ${list.length} sur ${pl.tracks.length}</h2>
    <p>Ces titres sont proposés au téléchargement ou à l'achat par leurs artistes. Une fois les fichiers sur ton ordinateur, tu peux les mixer dans Mixxx, Serato ou rekordbox, même en soirée.</p>
    <ul class="get-list">${list
      .map((t) => {
        const links = [t.dl && safeUrl(t.url) ? link(t.url, 'Télécharger') : '', t.buy ? link(t.buy, 'Acheter') : ''].filter(Boolean).join(' · ');
        return `<li><span class="get-name">${esc(core.labelOf(t))}</span><span class="get-links">${links}</span></li>`;
      })
      .join('')}</ul>
    <p class="hint">C'est l'artiste qui décide : certains demandent de les suivre, de commenter ou de passer par leur page avant d'ouvrir le téléchargement.</p>
    <div class="sheet-foot"><button type="button" class="link" data-act="copy-get" data-id="${pl.id}">Copier les liens</button></div>`);
}

function rowHtml(t, dup, dj = false) {
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
  const cur = nowTrack() && nowTrack().id === t.id;
  return `<li class="trk${dup ? ' is-dup' : ''}${playableUrl(t) ? ' can-play' : ''}${cur ? ' is-current' : ''}${cur && player.playing ? ' is-playing' : ''}" data-id="${t.id}">
    ${
      playableUrl(t)
        ? `<button type="button" class="thumb play" data-act="play" style="--c:${tint(t.artist || t.title)}" aria-label="Écouter ${esc(t.title)}">${esc(letterOf(t.artist || t.title))}${t.art ? img(t.art, 't200x200') : ''}</button>`
        : `<span class="thumb" style="--c:${tint(t.artist || t.title)}">${esc(letterOf(t.artist || t.title))}${t.art ? img(t.art, 't200x200') : ''}</span>`
    }
    <span class="trk-main"><span class="trk-title" title="${esc(t.title)}">${esc(shown)}</span><span class="trk-artist">${esc(t.artist || 'Artiste inconnu')}</span><span class="trk-meta">${tuneHtml(t)}${getChip(t)}</span></span>
    <span class="trk-badges">${badge}</span>
    <span class="trk-dur">${t.duration ? L.formatDuration(t.duration) : ''}</span>
    ${
      dj
        ? `<span class="moves"><button type="button" class="mv" data-act="move-up" aria-label="Monter ${esc(t.title)}" title="Monter">▲</button><button type="button" class="mv" data-act="move-down" aria-label="Descendre ${esc(t.title)}" title="Descendre">▼</button></span>`
        : ''
    }
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

/** Ligne sous le titre : nombre de titres, durée, état des enchaînements d'un set et de l'analyse des tonalités. */
function renderMeta(pl, weakCount = null) {
  const weak = weakCount ?? (pl.dj ? L.transitionsOf(pl.tracks).filter((x) => x.tone === 'weak').length : 0);
  const dj = pl.dj ? (weak ? ` · ${plural(weak, 'enchaînement à préparer', 'enchaînements à préparer')}` : ' · set sans saut difficile') : '';
  const run = keyRun.running && keyRun.pl === pl.id ? ` · Recherche des tonalités ${keyRun.done}/${keyRun.total}…` : '';
  $('#pl-meta').textContent = metaOf(pl) + dj + run;
  const hint = $('#keys-hint');
  if (hint) hint.hidden = Boolean(readJson(GSB_KEY, '')) || !needsKey(pl).length || pl.tracks.length === 0;
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
  $('#serato').disabled = pl.tracks.length === 0;
  const nKey = needsKey(pl).length;
  $('#findkeys').disabled = pl.tracks.length === 0;
  $('#findkeys').textContent = nKey ? `Trouver les tonalités (${nKey})` : 'Tonalités trouvées ✓';
  const nGet = gettable(pl).length;
  $('#getlist').hidden = nGet === 0;
  $('#getlist').textContent = `Titres à récupérer (${nGet})`;
  const trans = pl.dj ? L.transitionsOf(pl.tracks) : [];
  const weak = trans.filter((x) => x.tone === 'weak').length;
  renderMeta(pl, weak);
  $('#order').textContent = pl.dj ? 'Réordonner le set' : 'Ordonner pour DJer';
  $('#order').disabled = pl.tracks.length < 3;
  $('#tracks').classList.toggle('is-set', Boolean(pl.dj));
  $('#tracks').innerHTML = pl.tracks.length
    ? pl.tracks
        .map((t, i) => {
          const x = trans[i];
          const gap = x ? `<li class="gap gap-${x.tone}" role="presentation"><span>${x.tone === 'weak' ? 'À préparer · ' : ''}${esc(x.label)}</span></li>` : '';
          return rowHtml(t, dups.get(t.id), Boolean(pl.dj)) + gap;
        })
        .join('')
    : '<li class="tracks-empty">Cette playlist est vide.</li>';
  renderNotice();
}

/** Au retour sur l'accueil, on retrouve l'onglet de l'élément qu'on vient de quitter (playlist ou set). */
function leaveDetail() {
  const pl = current();
  if (pl) state.tab = tabOf(pl);
  setView('home');
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
    autoKeys(current());
  }
  window.scrollTo?.(0, 0);
}

function addPlaylist(name, tracks, art = '') {
  const pl = L.newPlaylist(L.uniqueName(state.lib, name), tracks, art);
  state.lib.push(pl);
  saveSoon();
  return pl;
}

function mutate(pl, tracks, text, undoable = true, dj = pl.dj) {
  state.notice = { text, undo: undoable ? { id: pl.id, tracks: pl.tracks, dj: pl.dj } : null };
  pl.tracks = tracks;
  pl.dj = dj;
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
      <li>Ouvre sur <b>soundcloud.com</b> une playlist, un titre ou ta page <b>Likes</b> (ton profil, onglet Likes), puis clique sur ce favori. Les titres arrivent ici tout seuls.</li>
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

// --------------------------------------------------------------------------- //
// Export vers Serato DJ : les fichiers audio de l'ordinateur, rangés dans une crate
// --------------------------------------------------------------------------- //
const SERATO_STORE = 'lebac.serato';
const serato = { files: [], folder: '', base: '', plId: null };
try {
  serato.base = window.localStorage.getItem(SERATO_STORE) || '';
} catch {
  /* ignore */
}

/** Dossier où Serato range ses crates, d'après le chemin de la musique. */
function subcratesDir(base) {
  const b = String(base || '').trim();
  let m = /^c:\\users\\([^\\]+)/i.exec(b);
  if (m) return `C:\\Users\\${m[1]}\\Music\\_Serato_\\Subcrates`;
  if (/^c:/i.test(b)) return 'C:\\Users\\(ton nom)\\Music\\_Serato_\\Subcrates';
  m = /^([a-z]):/i.exec(b);
  if (m) return `${m[1].toUpperCase()}:\\_Serato_\\Subcrates`;
  m = /^\/Volumes\/([^/]+)/.exec(b);
  if (m) return `/Volumes/${m[1]}/_Serato_/Subcrates`;
  m = /^\/Users\/([^/]+)/.exec(b);
  if (m) return `/Users/${m[1]}/Music/_Serato_/Subcrates`;
  return '';
}

const seratoTracks = (pl) => {
  const dups = dupsOf(pl);
  return pl.tracks.filter((t) => !dups.has(t.id));
};

function seratoResult(pl) {
  if (!serato.files.length) return '';
  const tracks = seratoTracks(pl);
  const r = SE.matchFiles(tracks, serato.files);
  const base = serato.base.trim();
  const last = base.split(/[\\/]/).filter(Boolean).pop() || '';
  const dir = subcratesDir(base);
  const miss = r.missing
    .map(
      (t) =>
        `<li><span>${esc(core.labelOf(t))}</span> ${SE.whereToGet(t)
          .map((l) => `<a href="${esc(l.href)}" target="_blank" rel="noopener">${esc(l.label)}</a>`)
          .join(' · ')}</li>`,
    )
    .join('');
  const found = r.found.map((f) => `<li>${esc(core.labelOf(f.track))} <small>→ ${esc(f.file.split('/').pop())}</small></li>`).join('');
  return `<div class="stats">
      <div class="stat"><b>${r.found.length}</b><span>${r.found.length > 1 ? 'trouvés' : 'trouvé'} sur ton ordi</span></div>
      <div class="stat"><b>${r.missing.length}</b><span>à récupérer</span></div>
    </div>
    ${
      !r.found.length
        ? '<p class="warn">Aucun fichier ne correspond. Vérifie le dossier choisi : les fichiers doivent être nommés « Artiste - Titre ».</p>'
        : !base
          ? '<p class="warn">Colle le chemin du dossier (étape 2) pour télécharger la crate.</p>'
          : `${last && last.toLowerCase() !== serato.folder.toLowerCase() ? `<p class="warn">Le chemin finit par « ${esc(last)} » mais le dossier choisi s'appelle « ${esc(serato.folder)} ». Vérifie qu'il s'agit du même.</p>` : ''}
      <div class="sheet-foot"><button type="button" class="btn btn-solid" data-act="se-crate">Télécharger la crate Serato</button><button type="button" class="link" data-act="se-m3u">ou en M3U (Rekordbox, Traktor, VirtualDJ)</button></div>
      <p class="hint">Range le fichier .crate dans <code class="path">${esc(dir || '_Serato_\\Subcrates')}</code>, puis relance Serato : la crate « ${esc(SE.crateName(pl.name))} » apparaît dans la colonne de gauche, dans l'ordre de la playlist.</p>`
    }
    ${miss ? `<details open><summary>${plural(r.missing.length, 'titre à récupérer', 'titres à récupérer')}</summary><ul class="se-list">${miss}</ul><p class="hint">Sur SoundCloud, le bouton de téléchargement n'existe que si l'artiste l'autorise. Une fois les fichiers dans ton dossier, choisis-le à nouveau.</p></details>` : ''}
    ${found ? `<details><summary>Titres trouvés</summary><ul class="se-list">${found}</ul></details>` : ''}`;
}

function renderSerato() {
  const pl = state.lib.find((p) => p.id === serato.plId);
  const box = $('#se-result');
  if (pl && box) box.innerHTML = seratoResult(pl);
}

function seratoSheet(pl) {
  serato.plId = pl.id;
  const canPick = 'webkitdirectory' in document.createElement('input');
  const n = seratoTracks(pl).length;
  openSheet(`<div id="serato-box"><h2 id="sheet-title">Mettre « ${esc(pl.name)} » dans Serato DJ</h2>
    <p>Sans l'abonnement SoundCloud qui donne accès à Serato, Serato ne joue que les fichiers de ton ordinateur. L'app retrouve ceux de la playlist (${plural(n, 'titre', 'titres')}, doublons exclus) dans ton dossier de musique et te donne une crate prête à ouvrir.</p>
    ${canPick ? '' : '<p class="warn">Ce navigateur ne permet pas de choisir un dossier : ouvre l\'app sur ton ordinateur, avec Chrome ou Edge.</p>'}
    <ol class="steps">
      <li><b>Choisis ton dossier de musique.</b> Rien n'est envoyé : l'app lit seulement les noms des fichiers.<br>
        <button type="button" class="btn btn-line" data-act="se-pick"${canPick ? '' : ' disabled'}>${serato.folder ? `Dossier : ${esc(serato.folder)} · changer` : 'Choisir le dossier'}</button>
        <input type="file" id="se-dir" webkitdirectory multiple hidden></li>
      <li><b>Colle son chemin complet.</b> Le navigateur ne le connaît pas, et Serato en a besoin.
        <div class="paste"><input id="se-base" spellcheck="false" autocomplete="off" placeholder="C:\\Users\\Dimitri\\Music" value="${esc(serato.base)}" aria-label="Chemin du dossier de musique"></div>
        <p class="hint">Dans l'Explorateur Windows, ouvre le dossier, clique dans la barre d'adresse et copie (Ctrl+C). Sur Mac : clic droit sur le dossier, touche Option, « Copier … comme nom de chemin ».</p></li>
    </ol>
    <div id="se-result">${seratoResult(pl)}</div></div>`);
}

function seratoDownload(kind) {
  const pl = state.lib.find((p) => p.id === serato.plId);
  if (!pl || !serato.base.trim()) return;
  const r = SE.matchFiles(seratoTracks(pl), serato.files);
  const found = r.found.map((f) => ({ ...f, path: SE.absolutePath(serato.base, f.file) }));
  const name = SE.crateName(pl.name);
  if (kind === 'crate') download(`${name}.crate`, SE.makeCrate(found.map((f) => f.path)), 'application/octet-stream');
  else download(`${name}.m3u8`, SE.makeM3u(found), 'audio/x-mpegurl;charset=utf-8');
  toast(`${plural(found.length, 'titre', 'titres')} dans « ${name} ».`);
}

function tuneSheet(pl, t) {
  openSheet(`<h2 id="sheet-title">Tonalité et tempo</h2>
    <p class="tune-for">${esc(core.labelOf(t))}</p>
    <form id="tune-form" class="paste" autocomplete="off" data-pl="${pl.id}" data-id="${t.id}">
      <label for="tune-key"><b>Tonalité</b> <small>8A, Am, F# minor, Db…</small></label>
      <input id="tune-key" value="${esc(t.key || '')}" placeholder="ex. 8A" autocapitalize="off" spellcheck="false">
      <label for="tune-bpm"><b>Tempo</b> <small>BPM</small></label>
      <input id="tune-bpm" inputmode="decimal" value="${t.bpm ? esc(String(Math.round(t.bpm * 10) / 10)) : ''}" placeholder="ex. 128">
      <p class="hint">Tu les trouves dans Mixxx, Serato, rekordbox ou Mixed In Key. 8A est la mineur, 8B do majeur ; les cases voisines de la roue se mixent bien.</p>
      <p class="warn" id="tune-warn" hidden></p>
      <div class="paste-foot"><button type="submit" class="btn btn-small btn-solid">Enregistrer</button></div>
    </form>`);
  $('#tune-key').focus();
}


// --------------------------------------------------------------------------- //
// Recherche automatique des tonalités (GetSongBPM)
// --------------------------------------------------------------------------- //
const GSB_KEY = 'lebac.gsb';
const GSB_CACHE = 'lebac.keycache';
const readJson = (k, d) => {
  try {
    return JSON.parse(window.localStorage.getItem(k)) ?? d;
  } catch {
    return d;
  }
};
const writeStore = (k, v) => {
  try {
    window.localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* sans stockage, la clé est redemandée à la prochaine visite */
  }
};
const keyRun = { pl: null, running: false, cancel: false, done: 0, total: 0, last: '', pending: new Set() };
const needsKey = (pl) => pl.tracks.filter((t) => !t.key);

function keysSheet(pl, message = '') {
  const apiKey = readJson(GSB_KEY, '');
  const todo = needsKey(pl);
  if (!apiKey) {
    openSheet(`<div id="keys-box"><h2 id="sheet-title">Trouver les tonalités automatiquement</h2>
      <p>L'app cherche chaque titre dans <a href="https://getsongbpm.com" target="_blank" rel="noopener">GetSongBPM</a>, une base gratuite de tonalités et de tempos, et remplit les cases (8A, 9B…). Ça marche pour les morceaux connus ; les remixes sont ignorés, car leur tonalité peut différer de l'original.</p>
      <ol class="steps">
        <li><b>Une seule fois :</b> demande une clé gratuite sur <a href="https://getsongbpm.com/api" target="_blank" rel="noopener"><b>getsongbpm.com/api</b></a> (formulaire, elle arrive par e-mail).</li>
        <li>Colle-la ici.
          <form id="gsb-form" class="paste" autocomplete="off">
            <label class="sr-only" for="gsb-key">Clé GetSongBPM</label>
            <input id="gsb-key" type="password" placeholder="Ta clé" autocapitalize="off" spellcheck="false">
            <div class="paste-foot"><button type="submit" class="btn btn-small btn-solid">Enregistrer la clé</button></div>
          </form></li>
      </ol>${message ? `<p class="warn">${esc(message)}</p>` : ''}</div>`);
    return;
  }
  const running = keyRun.running && keyRun.pl === pl.id;
  openSheet(`<div id="keys-box"><h2 id="sheet-title">Trouver les tonalités</h2>
    ${message ? `<p class="warn">${esc(message)}</p>` : ''}
    ${
      running
        ? `<p id="keys-progress" role="status">Recherche : ${keyRun.done} sur ${keyRun.total}…<br><small>${esc(keyRun.last)}</small></p>
           <div class="paste-foot"><button type="button" class="btn btn-small btn-line" data-act="keys-stop">Arrêter</button></div>`
        : todo.length
          ? `<p><b>${plural(todo.length, 'titre sans tonalité', 'titres sans tonalité')}</b> dans « ${esc(pl.name)} ». Ceux que tu as déjà renseignés ne sont pas touchés.</p>
             <div class="paste-foot"><button type="button" class="btn btn-small btn-solid" data-act="keys-go" data-id="${pl.id}">Lancer la recherche</button></div>`
          : '<p class="ok">✓ Tous les titres ont déjà une tonalité.</p>'
    }
    <p class="hint">Les tonalités trouvées ont une bordure en pointillés : écoute avant de t'y fier. Données : <a href="https://getsongbpm.com" target="_blank" rel="noopener">GetSongBPM.com</a>.</p>
    <div class="sheet-foot"><button type="button" class="link" data-act="keys-change">Changer de clé</button></div></div>`);
}

const keyTried = new Set(); // playlists déjà analysées pendant cette visite

/** Applique les résultats trouvés aux titres de la playlist (sans toucher à une tonalité déjà là). */
function applyKeys(pl, found) {
  if (!found.size) return;
  pl.tracks = pl.tracks.map((x) => {
    const r = found.get(x.id);
    return !r || x.key ? x : { ...x, key: r.key || x.key, keyAuto: Boolean(r.key), bpm: x.bpm || r.bpm };
  });
  saveSoon();
  if (state.view === 'detail' && state.id === pl.id) renderDetail();
}

/**
 * Cherche la tonalité et le tempo des titres qui n'en ont pas. `quiet` : en arrière-plan, sans fenêtre ;
 * sinon (bouton « Trouver les tonalités ») une fenêtre suit la progression et le résultat est annulable.
 */
async function runKeys(pl, { quiet = false } = {}) {
  const apiKey = readJson(GSB_KEY, '');
  if (!apiKey || keyRun.running) return;
  const cache = readJson(GSB_CACHE, {});
  const todo = needsKey(pl);
  if (!todo.length) return;
  Object.assign(keyRun, { pl: pl.id, running: true, cancel: false, done: 0, total: todo.length, last: '', pending: new Set(todo.map((t) => t.id)) });
  const before = pl.tracks;
  const found = new Map();
  const stats = { found: 0, none: 0, skipped: 0 };
  let fatal = '';
  const bySig = new Map();
  const showProgress = () => {
    if (state.view === 'detail' && state.id === pl.id) renderMeta(pl);
    const el = $('#keys-progress');
    if (el) el.innerHTML = `Recherche : ${keyRun.done} sur ${keyRun.total}…<br><small>${esc(keyRun.last)}</small>`;
  };
  if (!quiet) keysSheet(pl);
  if (state.view === 'detail' && state.id === pl.id) renderDetail(); // les lignes en attente affichent « … »
  showProgress();
  for (const t of todo) {
    if (keyRun.cancel) break;
    keyRun.last = core.labelOf(t);
    const sig = t.sig;
    let r = bySig.get(sig) ?? cache[sig];
    if (r === undefined || r === null) {
      try {
        r = await KY.lookupTrack((u) => fetch(u), apiKey, t);
      } catch (e) {
        if (e.fatal) {
          fatal = e.message;
          break;
        }
        r = { key: null, bpm: null, status: 'none' };
      }
      if (r.status !== 'skipped') cache[sig] = r.status === 'found' ? { key: r.key, bpm: r.bpm } : 0;
      await new Promise((ok) => setTimeout(ok, 350)); // GetSongBPM limite le nombre de demandes par heure
    }
    if (r === 0) r = { key: null, bpm: null, status: 'none' };
    else if (!r.status) r = { ...r, status: 'found' };
    bySig.set(sig, r);
    stats[r.status] += 1;
    if (r.status === 'found') found.set(t.id, r);
    keyRun.done += 1;
    keyRun.pending.delete(t.id);
    if (quiet && found.size && keyRun.done % 4 === 0) applyKeys(pl, found); // les lignes se remplissent au fur et à mesure
    showProgress();
  }
  keyRun.running = false;
  keyRun.pending = new Set();
  writeStore(GSB_CACHE, cache);
  if (!state.lib.includes(pl)) return;
  const text = `${plural(stats.found, 'tonalité trouvée', 'tonalités trouvées')} sur ${keyRun.done}${stats.none ? `, ${plural(stats.none, 'titre introuvable', 'titres introuvables')}` : ''}${stats.skipped ? `, ${plural(stats.skipped, 'remix ignoré', 'remix ignorés')}` : ''}${fatal ? `. Arrêtée : ${fatal}` : keyRun.cancel ? '. Arrêtée.' : '.'} Les cases en pointillés viennent de GetSongBPM : à vérifier à l'oreille.`;
  if (quiet) {
    applyKeys(pl, found);
    if (state.view === 'detail' && state.id === pl.id) {
      state.notice = { text: found.size || fatal ? text : `Aucune tonalité trouvée (${plural(stats.none, 'titre introuvable', 'titres introuvables')}). Les morceaux récents ou peu connus manquent souvent dans la base : saisis-les avec « + clé ».`, undo: null };
      renderDetail();
    }
    if (fatal) toast(fatal, 6000);
    return;
  }
  if (state.id !== pl.id) return;
  if (found.size) {
    closeSheet();
    const updated = before.map((x) => {
      const r = found.get(x.id);
      return !r || x.key ? x : { ...x, key: r.key || x.key, keyAuto: Boolean(r.key), bpm: x.bpm || r.bpm };
    });
    mutate(pl, updated, text);
  } else {
    keysSheet(pl, fatal || (keyRun.cancel ? 'Recherche arrêtée.' : `Aucune tonalité trouvée (${plural(stats.none, 'titre introuvable', 'titres introuvables')}${stats.skipped ? `, ${plural(stats.skipped, 'remix ignoré', 'remix ignorés')}` : ''}). Les morceaux très récents ou peu connus manquent souvent dans la base : saisis-les à la main avec « + clé ».`));
  }
}

/** Lance la recherche en arrière-plan, une fois par playlist et par visite, si une clé est enregistrée. */
function autoKeys(pl) {
  if (!pl || keyTried.has(pl.id) || keyRun.running || !readJson(GSB_KEY, '') || !needsKey(pl).length) return;
  keyTried.add(pl.id);
  runKeys(pl, { quiet: true });
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

function makeSet(ids) {
  const pls = ids.map((id) => state.lib.find((p) => p.id === id)).filter(Boolean);
  if (pls.length < 2) return;
  const name = L.uniqueName(state.lib, `Set · ${pls.map((p) => p.name).join(' + ')}`.slice(0, 60));
  const r = L.buildSetFrom(pls, name, { threshold: state.threshold });
  r.playlist.name = name;
  state.lib.push(r.playlist);
  if (r.aside) {
    r.aside.name = L.uniqueName(state.lib, r.aside.name);
    state.lib.push(r.aside);
  }
  saveSoon();
  closeSheet();
  state.tab = 'sets';
  setView('detail', r.playlist.id);
  const parts = [
    `Set de ${plural(r.playlist.tracks.length, 'titre', 'titres')} à partir de ${pls.length} playlists`,
    r.removed ? `${plural(r.removed, 'doublon retiré', 'doublons retirés')}` : '',
    r.weak ? `${plural(r.weak, 'enchaînement à préparer', 'enchaînements à préparer')} (en orange)` : 'aucun saut difficile',
    r.aside ? `${plural(r.aside.tracks.length, 'titre mis de côté', 'titres mis de côté')} dans « ${r.aside.name} »` : '',
  ].filter(Boolean);
  state.notice = { text: `${parts.join(' · ')}.` };
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

// --------------------------------------------------------------------------- //
// Synchronisation entre appareils : compte Google + Firestore (voir cloud.js et firebase.js)
// --------------------------------------------------------------------------- //
const CLOUD_KNOWN = 'lebac.cloud';
let cloudStatus = { user: null, busy: false, error: '', last: 0 };

/** Remplace la bibliothèque affichée par celle que la synchro vient de reconstituer, sans bousculer l'écran. */
function applyLib(lib) {
  state.lib = lib;
  try {
    window.localStorage.setItem(STORE, L.serialize(lib));
  } catch {
    /* voir saveSoon */
  }
  state.picked = new Set([...state.picked].filter((id) => lib.some((p) => p.id === id)));
  if (state.view === 'detail' && !current()) setView('home');
  else if (state.view === 'detail') renderDetail();
  else renderHome();
}

function startCloud() {
  cloud = createCloud({
    backend: firebaseBackend(),
    getLib: () => state.lib,
    setLib: applyLib,
    pack: (pl) => L.serialize([pl]),
    unpack: (text) => L.deserialize(text)[0] || null,
    loadKnown: (uid) => readJson(CLOUD_KNOWN, {})[uid] || {},
    saveKnown: (uid, known) => writeStore(CLOUD_KNOWN, { ...readJson(CLOUD_KNOWN, {}), [uid]: known }),
    onStatus: (s) => {
      cloudStatus = s;
      renderSyncBtn();
      if (!$('#sheet').hidden && $('#sync-box')) syncSheet();
    },
    onMeta: (meta) => {
      // la clé GetSongBPM suit le compte : prise ici si elle manque, envoyée si c'est le compte qui ne l'a pas
      if (meta && meta.gsb && !readJson(GSB_KEY, '')) {
        writeStore(GSB_KEY, meta.gsb);
        if (state.view === 'detail') autoKeys(current());
      } else if (!meta?.gsb && readJson(GSB_KEY, '')) cloud.setMeta({ gsb: readJson(GSB_KEY, '') });
    },
  });
  cloud.start().catch((e) => {
    cloudStatus = { ...cloudStatus, error: 'Impossible de charger la synchro (connexion ou bloqueur de contenu).' };
    renderSyncBtn();
  });
}

function renderSyncBtn() {
  const u = cloudStatus.user;
  for (const b of document.querySelectorAll('[data-act="sync-open"]')) {
    b.classList.toggle('is-on', Boolean(u));
    b.classList.toggle('is-err', Boolean(u && cloudStatus.error));
    b.textContent = !u ? 'Se connecter' : cloudStatus.error ? 'Synchro à vérifier' : cloudStatus.busy ? 'Synchronisation…' : 'Synchronisé';
  }
}

function syncSheet() {
  const u = cloudStatus.user;
  if (!u) {
    openSheet(`<div id="sync-box"><h2 id="sheet-title">Retrouver mes playlists partout</h2>
      <p>Connecte-toi avec ton compte Google : tes playlists sont sauvegardées et apparaissent sur tous tes appareils (ordinateur, téléphone), sans lien à copier. Seul ton compte y a accès.</p>
      ${cloudStatus.error ? `<p class="warn">${esc(cloudStatus.error)}</p>` : ''}
      <div class="paste-foot"><button type="button" class="btn btn-small btn-solid" data-act="cloud-signin">Continuer avec Google</button></div>
      <p class="hint">Sur chaque appareil, il suffit de te connecter une fois.</p></div>`);
    return;
  }
  const when = cloudStatus.last ? new Date(cloudStatus.last).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '';
  openSheet(`<div id="sync-box"><h2 id="sheet-title">Synchro</h2>
    <p>Connecté : <b>${esc(u.email || u.name || 'compte Google')}</b></p>
    ${
      cloudStatus.error
        ? `<p class="warn">${esc(cloudStatus.error)}</p>`
        : cloudStatus.busy
          ? '<p>Synchronisation en cours…</p>'
          : `<p class="ok">✓ Synchronisé${when ? ` à ${when}` : ''}. Les changements se copient tout seuls entre tes appareils.</p>`
    }
    <div class="sheet-foot">
      <button type="button" class="link" data-act="sync-now">Synchroniser maintenant</button>
      <button type="button" class="link danger" data-act="cloud-signout">Se déconnecter</button>
    </div></div>`);
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
  autoKeys(pl);
}
window.addEventListener('hashchange', handleImport);

// --------------------------------------------------------------------------- //
// Lecteur SoundCloud (widget officiel) : ne joue que les titres que leurs artistes autorisent hors de SoundCloud
// --------------------------------------------------------------------------- //
let apiPromise = null;
function loadWidgetApi() {
  if (window.SC && window.SC.Widget) return Promise.resolve();
  if (!apiPromise) {
    apiPromise = new Promise((resolve, reject) => {
      const el = document.createElement('script');
      el.src = 'https://w.soundcloud.com/player/api.js';
      el.onload = resolve;
      el.onerror = () => {
        apiPromise = null;
        reject(new Error('api'));
      };
      document.head.append(el);
      setTimeout(() => reject(new Error('délai dépassé')), 10000);
    });
  }
  return apiPromise;
}

function syncPlayer() {
  const t = nowTrack();
  $('#player').hidden = !t;
  document.body.classList.toggle('has-player', Boolean(t));
  if (!t) return;
  $('#p-title').textContent = t.title;
  $('#p-artist').textContent = player.note || t.artist || 'Artiste inconnu';
  $('#p-toggle').textContent = player.playing ? '❚❚' : '▶';
  $('#p-prev').disabled = player.i <= 0;
  $('#p-next').disabled = player.i >= player.queue.length - 1;
  const thumb = $('#p-thumb');
  thumb.style.setProperty('--c', tint(t.artist || t.title));
  thumb.innerHTML = esc(letterOf(t.artist || t.title)) + (t.art ? img(t.art, 't200x200') : '');
  $('#p-open').href = safeUrl(t.url) || '#';
  $('#p-open').hidden = !safeUrl(t.url);
  // la ligne en cours reste surlignée sans refaire toute la liste
  for (const li of document.querySelectorAll('#tracks .trk')) {
    const on = String(t.id) === li.dataset.id;
    li.classList.toggle('is-current', on);
    li.classList.toggle('is-playing', on && player.playing);
  }
}

const HINT_MS = 7000;
async function playIndex(i) {
  const t = player.queue[i];
  if (!t) return;
  player.i = i;
  player.playing = false;
  player.note = 'Chargement du lecteur…';
  clearTimeout(player.timer);
  syncPlayer();
  const url = playableUrl(t);
  try {
    await loadWidgetApi();
  } catch {
    // pas d'ouverture automatique d'un onglet (le navigateur la bloque après une attente) : un lien visible à la place
    player.note = 'Le lecteur SoundCloud ne se charge pas (bloqueur de publicités ?). Utilise « Ouvrir sur SoundCloud ».';
    syncPlayer();
    return;
  }
  const opts = { auto_play: true, show_comments: false, hide_related: true, visual: false };
  if (!player.widget) {
    const q = new URLSearchParams({ url, auto_play: 'true', show_comments: 'false', hide_related: 'true', visual: 'false' });
    const frame = $('#p-frame');
    frame.src = `https://w.soundcloud.com/player/?${q}`;
    const w = window.SC.Widget(frame);
    const E = window.SC.Widget.Events;
    w.bind(E.PLAY, () => {
      clearTimeout(player.timer);
      player.playing = true;
      player.note = '';
      syncPlayer();
    });
    w.bind(E.PAUSE, () => { player.playing = false; syncPlayer(); });
    w.bind(E.FINISH, () => {
      player.playing = false;
      if (player.i < player.queue.length - 1) playIndex(player.i + 1);
      else syncPlayer();
    });
    w.bind(E.ERROR, () => {
      player.note = 'Ce titre ne peut pas être lu ici : ouvre-le sur SoundCloud.';
      syncPlayer();
    });
    player.widget = w;
  } else {
    player.widget.load(url, opts);
  }
  player.note = '';
  syncPlayer();
  // sans son au bout de quelques secondes : on dit pourquoi, au lieu de rester muet
  player.timer = setTimeout(() => {
    if (!player.playing && player.i === i) {
      player.note = 'Pas de son ? Appuie sur ▶ dans le lecteur, ou ouvre le titre sur SoundCloud.';
      syncPlayer();
    }
  }, HINT_MS);
}

/** Écoute un titre de la playlist ouverte ; la file reprend les titres de la liste, doublons exceptés. */
function playFromPlaylist(pl, id) {
  const dups = dupsOf(pl);
  const queue = pl.tracks.filter((t) => playableUrl(t) && (!dups.has(t.id) || t.id === id));
  const i = queue.findIndex((t) => t.id === id);
  if (i < 0) return;
  player.queue = queue;
  playIndex(i);
}

function ideasSheet() {
  const t = nowTrack();
  if (!t) return;
  const pl = state.lib.find((p) => p.tracks.includes(t)) || current() || state.lib[0];
  const r = L.relatedTracks(state.lib, pl, t);
  const row = (x, extra) => {
    const can = playableUrl(x.track);
    return `<div class="idea"><span class="idea-main"><b>${esc(core.labelOf(x.track))}</b><small>${esc(extra)}</small></span>${
      can ? `<button type="button" class="btn btn-small btn-line" data-act="play-next" data-id="${x.track.id}">Jouer ensuite</button>` : ''
    }</div>`;
  };
  const q = encodeURIComponent(`${t.artist} ${core.parseVersion(t.title).base}`.trim());
  openSheet(`<div class="ideas"><h2 id="sheet-title">Pour enchaîner avec « ${esc(core.parseVersion(t.title).base || t.title)} »</h2>
    <h3>Autres versions dans tes playlists</h3>
    ${
      r.versions.length
        ? r.versions.map((v) => row(v, `${v.label} · ${v.playlist.name}`)).join('')
        : '<p>Aucune autre version de ce titre dans tes playlists.</p>'
    }
    <p style="margin-top:8px"><a class="link" href="https://soundcloud.com/search/sounds?q=${q}%20remix" target="_blank" rel="noopener">Chercher ses remixes sur SoundCloud</a></p>
    <h3>Trouver de nouveaux sons</h3>
    <p>${
      safeUrl(t.url)
        ? `<a class="link" href="${esc(safeUrl(t.url).replace(/[?#].*$/, '').replace(/\/+$/, ''))}/recommended" target="_blank" rel="noopener">Voir les sons similaires sur SoundCloud</a>. Sur cette page, clique sur le favori « Ajouter à Le bac » : ils arrivent ici comme une playlist, que tu peux fusionner dans ton set.`
        : 'Ce titre n\'a pas de lien SoundCloud : impossible d\'ouvrir ses sons similaires.'
    }</p>
    <h3>${r.style ? `Même style : ${esc(r.style)}` : 'Même style'}</h3>
    ${
      r.style
        ? r.similar.length
          ? `<p>${r.tempoKnown ? 'Tempo proche d\'abord, quand il est connu.' : 'Le tempo de ce titre n\'est pas indiqué : le choix se fait sur le style seulement.'} La tonalité n'est pas fournie par SoundCloud.</p>` +
            r.similar.map((x) => row(x, `${x.playlist.name}${x.track.bpm ? ` · ${Math.round(x.track.bpm)} BPM` : ''}`)).join('')
          : '<p>Aucun autre titre de ce style dans cette playlist.</p>'
        : '<p>Le style de ce titre n\'est pas reconnu (genre absent sur SoundCloud).</p>'
    }</div>`);
}

$('#p-toggle').addEventListener('click', () => player.widget && player.widget.toggle());
$('#p-prev').addEventListener('click', () => player.i > 0 && playIndex(player.i - 1));
$('#p-next').addEventListener('click', () => player.i < player.queue.length - 1 && playIndex(player.i + 1));
$('#p-ideas').addEventListener('click', ideasSheet);
$('#p-close').addEventListener('click', () => {
  clearTimeout(player.timer);
  player.note = '';
  if (player.widget) player.widget.pause();
  player.queue = [];
  player.i = -1;
  player.playing = false;
  syncPlayer();
});

// --------------------------------------------------------------------------- //
// Événements
// --------------------------------------------------------------------------- //
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-act="sync-open"]')) syncSheet();
});
$('#tabs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-tab]');
  if (b) setTab(b.dataset.tab);
});
$('#tabs').addEventListener('keydown', (e) => {
  if ((e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') || !e.target.closest('[role="tab"]')) return;
  const next = state.tab === 'playlists' ? 'sets' : 'playlists';
  setTab(next);
  $(`#tab-${next}`).focus();
});
$('#add').addEventListener('click', () => addSheet());
$('#start-demo').addEventListener('click', loadSample);
$('#back').addEventListener('click', leaveDetail);
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
$('#hb-set').addEventListener('click', () => {
  const ids = [...state.picked];
  state.picked.clear();
  makeSet(ids);
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
$('#keys-setup').addEventListener('click', () => {
  const pl = current();
  if (pl) keysSheet(pl);
});
$('#findkeys').addEventListener('click', () => {
  const pl = current();
  if (pl) keysSheet(pl);
});
$('#getlist').addEventListener('click', () => {
  const pl = current();
  if (pl) getSheet(pl);
});
$('#order').addEventListener('click', () => {
  const pl = current();
  if (!pl || pl.tracks.length < 3) return;
  const set = L.buildSet(pl.tracks, { startId: pl.tracks[0].id, keepAll: true });
  mutate(pl, set.ordered, `Mis en ordre pour le DJ, en partant du premier titre. ${set.weak ? plural(set.weak, 'enchaînement à préparer', 'enchaînements à préparer') + ' (en orange).' : 'Aucun saut difficile.'}`, true, true);
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
  state.tab = 'playlists';
  setView('home');
  toast(`${plural(parts.length, 'playlist créée', 'playlists créées')} par style, à partir de « ${pl.name} ».`, 4500);
});
$('#serato').addEventListener('click', () => {
  const pl = current();
  if (pl) seratoSheet(pl);
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
    const { id, tracks, dj } = state.notice.undo;
    const pl = state.lib.find((p) => p.id === id);
    if (pl) {
      pl.tracks = tracks;
      pl.dj = dj;
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
  const mv = e.target.closest('[data-act="move-up"], [data-act="move-down"]');
  if (mv) {
    const pl = current();
    const id = Number(mv.closest('.trk').dataset.id);
    const i = pl ? pl.tracks.findIndex((t) => t.id === id) : -1;
    const j = i + (mv.dataset.act === 'move-up' ? -1 : 1);
    if (i < 0 || j < 0 || j >= pl.tracks.length) return;
    const arr = [...pl.tracks];
    [arr[i], arr[j]] = [arr[j], arr[i]];
    pl.tracks = arr;
    saveSoon();
    renderDetail();
    $(`#tracks .trk[data-id="${id}"] [data-act="${mv.dataset.act}"]`)?.focus();
    return;
  }
  const tune = e.target.closest('[data-act="tune"]');
  if (tune) {
    const pl = current();
    const t = pl && pl.tracks.find((x) => x.id === Number(tune.closest('.trk').dataset.id));
    if (t) tuneSheet(pl, t);
    return;
  }
  // toute la ligne lance la musique, sauf les boutons et liens qu'elle contient
  const row = e.target.closest('.trk.can-play');
  if (row && !e.target.closest('a, button:not([data-act="play"])')) {
    const pl = current();
    if (pl) playFromPlaylist(pl, Number(row.dataset.id));
    return;
  }
  const play = e.target.closest('[data-act="play"]');
  if (play) {
    const pl = current();
    if (pl) playFromPlaylist(pl, Number(play.closest('.trk').dataset.id));
    return;
  }
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
  else if (act === 'keys-go') {
    const pl = state.lib.find((p) => p.id === btn.dataset.id);
    if (pl) await runKeys(pl);
  } else if (act === 'keys-stop') keyRun.cancel = true;
  else if (act === 'keys-change') {
    writeStore(GSB_KEY, '');
    const pl = current();
    if (pl) keysSheet(pl);
  } else if (act === 'copy-get') {
    const pl = state.lib.find((p) => p.id === btn.dataset.id);
    const links = pl ? gettable(pl).map((t) => (t.dl && safeUrl(t.url)) || t.buy).filter(Boolean).join('\n') : '';
    toast(links && (await copyText(links)) ? 'Liens copiés.' : 'Copie impossible.');
  } else if (act === 'se-pick') $('#se-dir')?.click();
  else if (act === 'se-crate') seratoDownload('crate');
  else if (act === 'se-m3u') seratoDownload('m3u');
  else if (act === 'cloud-signin') await cloud?.signIn();
  else if (act === 'sync-now') {
    syncSheet();
    await cloud?.flush();
  } else if (act === 'cloud-signout') {
    await cloud?.signOut();
    closeSheet();
    toast('Déconnecté. Tes playlists restent sur cet appareil et dans ton compte.');
  } else if (act === 'copy-push') {
    const pl = state.lib.find((p) => p.id === btn.dataset.id);
    if (pl) toast((await copyText(core.soundcloudPayload([pl]).text)) ? 'Copié.' : 'Copie impossible.');
  } else if (act === 'merge-two') mergePicked([btn.dataset.a, btn.dataset.b]);
  else if (act === 'play-next') {
    const id = Number(btn.dataset.id);
    const t = state.lib.flatMap((p) => p.tracks).find((x) => x.id === id);
    if (!t) return;
    player.queue.splice(player.i + 1, 0, t);
    closeSheet();
    playIndex(player.i + 1);
  }
});
$('#sheet-body').addEventListener('change', (e) => {
  if (e.target.id !== 'se-dir') return;
  const files = [...(e.target.files || [])];
  serato.files = files.map((f) => f.webkitRelativePath || f.name);
  serato.folder = (serato.files[0] || '').split('/')[0] || '';
  const btn = $('[data-act="se-pick"]');
  if (btn) btn.textContent = serato.folder ? `Dossier : ${serato.folder} · changer` : 'Choisir le dossier';
  renderSerato();
});
$('#sheet-body').addEventListener('input', (e) => {
  if (e.target.id !== 'se-base') return;
  serato.base = e.target.value;
  try {
    window.localStorage.setItem(SERATO_STORE, serato.base.trim());
  } catch {
    /* ignore */
  }
  renderSerato();
});
$('#sheet-body').addEventListener('submit', async (e) => {
  if (e.target.id === 'gsb-form') {
    e.preventDefault();
    const k = $('#gsb-key').value.trim();
    const pl = current();
    if (!/^[\w-]{8,}$/.test(k)) return pl && keysSheet(pl, "Cette clé n'a pas la bonne forme. Copie-la en entier depuis l'e-mail de GetSongBPM.");
    writeStore(GSB_KEY, k);
    cloud?.setMeta({ gsb: k });
    if (pl) {
      closeSheet();
      renderMeta(pl);
      toast('Clé enregistrée : recherche des tonalités et des tempos…');
      keyTried.delete(pl.id);
      autoKeys(pl);
    }
    return;
  }
  if (e.target.id === 'tune-form') {
    e.preventDefault();
    const f = e.target;
    const pl = state.lib.find((p) => p.id === f.dataset.pl);
    const t = pl && pl.tracks.find((x) => x.id === Number(f.dataset.id));
    if (!t) return closeSheet();
    const rawKey = $('#tune-key').value.trim();
    const rawBpm = $('#tune-bpm').value.trim().replace(',', '.');
    const key = core.parseKey(rawKey);
    const bpm = rawBpm ? parseFloat(rawBpm) : null;
    const warn = $('#tune-warn');
    if (rawKey && !key) {
      warn.textContent = `« ${rawKey} » n'est pas une tonalité reconnue. Essaie 8A, Am ou F# minor.`;
      warn.hidden = false;
      return;
    }
    if (rawBpm && !(bpm >= 40 && bpm <= 250)) {
      warn.textContent = 'Le tempo doit être un nombre entre 40 et 250.';
      warn.hidden = false;
      return;
    }
    closeSheet();
    mutate(pl, pl.tracks.map((x) => (x === t ? { ...x, key, keyAuto: false, bpm } : x)), `${t.title} : ${[key, bpm && `${Math.round(bpm)} BPM`].filter(Boolean).join(' · ') || 'tonalité et tempo effacés'}.`, false);
    return;
  }
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
$('#version').textContent = VERSION;
const pageVersion = document.querySelector('meta[name="app-version"]');
$('#stale').hidden = !pageVersion || pageVersion.content === VERSION;
setView('home');
renderSyncBtn();
handleImport();
startCloud();
