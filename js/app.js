import * as core from './core.js';
import { makeZip } from './zip.js';
import { SAMPLE_1, SAMPLE_2 } from './sample.js';
import { bookmarkletCode, bookmarkletHref } from './bookmarklet.js';

const PALETTE = 10;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const safeUrl = (u) => (/^https?:\/\//i.test(u || '') ? u : '');

let uid = 0;
const newSource = (name, text = '') => ({ id: `s${++uid}`, name, text, files: [] });

// Les playlists ajoutées restent dans le navigateur : on peut en ajouter une, fermer l'onglet, revenir.
const STORE = 'lebac.v1';
const packTrack = (t) => ({ title: t.title, artist: t.artist, url: t.url, genre: t.genre, tags: t.tags, duration: t.duration, bpm: t.bpm });

function saveSources() {
  try {
    const sources = state.sources.map((s) => ({
      name: s.name,
      text: s.text,
      files: s.files.map((f) => ({ name: f.name, tracks: f.tracks.map(packTrack) })),
    }));
    window.localStorage.setItem(STORE, JSON.stringify({ sources }));
  } catch {
    /* stockage plein ou refusé : l'app fonctionne quand même */
  }
}

function loadSources() {
  try {
    const data = JSON.parse(window.localStorage.getItem(STORE));
    if (!data || !Array.isArray(data.sources) || !data.sources.length) return null;
    return data.sources.map((s) => {
      const src = newSource(String(s.name || 'Playlist'), String(s.text || ''));
      src.files = (s.files || []).map((f) => ({
        name: f.name,
        tracks: f.tracks.map((p) => core.makeTrack({ ...p, source: src.name })),
      }));
      return src;
    });
  } catch {
    return null;
  }
}

let saveTimer;
const saveSoon = () => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveSources, 300);
};

const state = {
  sources: loadSources() || [newSource('Playlist 1'), newSource('Playlist 2')],
  result: null,
  selected: new Set(),
  view: 'bacs',
  colorSeq: 0,
  hotFam: null,
  dragIds: null,
  focusCrate: null,
};

// --------------------------------------------------------------------------- //
// Utilitaires : message, copie, téléchargement
// --------------------------------------------------------------------------- //
let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3400);
}

async function copyText(text, ok) {
  try {
    await navigator.clipboard.writeText(text);
    toast(ok);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0';
    document.body.append(ta);
    ta.select();
    let done = false;
    try { done = document.execCommand('copy'); } catch { /* ignore */ }
    ta.remove();
    toast(done ? ok : 'Copie impossible : sélectionne le texte à la main.');
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

const readFile = (file) =>
  new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(fr.error);
    fr.readAsText(file);
  });

// --------------------------------------------------------------------------- //
// Entrée : cartes de playlists
// --------------------------------------------------------------------------- //
const sourcesEl = $('#sources');

function renderSources() {
  sourcesEl.innerHTML = state.sources
    .map(
      (s, i) => `
    <section class="source" data-id="${s.id}">
      <div class="source-head">
        <input class="source-name" value="${esc(s.name)}" maxlength="40" aria-label="Nom de la playlist ${i + 1}">
        ${state.sources.length > 1 ? '<button type="button" class="link on-blue" data-act="remove-source">Retirer</button>' : ''}
      </div>
      <textarea spellcheck="false" aria-label="Titres de ${esc(s.name)}" placeholder="Un titre par ligne&#10;Artiste - Titre&#10;Artiste - Titre | genre | lien">${esc(s.text)}</textarea>
      <div class="source-foot">
        <label class="btn btn-small btn-ghost file-btn">Importer un fichier<input class="sr-only" type="file" accept=".txt,.csv,.json,.jsonl,.ndjson,text/plain,text/csv,application/json" multiple></label>
        ${s.files
          .map(
            (f, j) =>
              `<span class="chip">${esc(f.name)}, ${f.tracks.length} titres<button type="button" class="chip-x" data-act="remove-file" data-j="${j}" aria-label="Retirer ${esc(f.name)}">×</button></span>`,
          )
          .join('')}
      </div>
    </section>`,
    )
    .join('');
  saveSources();
}

const sourceOf = (el) => state.sources.find((s) => s.id === el.closest('.source')?.dataset.id);

sourcesEl.addEventListener('input', (e) => {
  const s = sourceOf(e.target);
  if (!s) return;
  if (e.target.matches('.source-name')) s.name = e.target.value;
  else if (e.target.matches('textarea')) s.text = e.target.value;
  saveSoon();
});

sourcesEl.addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]');
  const s = sourceOf(e.target);
  if (!b || !s) return;
  if (b.dataset.act === 'remove-source') state.sources = state.sources.filter((x) => x !== s);
  if (b.dataset.act === 'remove-file') s.files.splice(Number(b.dataset.j), 1);
  renderSources();
});

sourcesEl.addEventListener('change', async (e) => {
  if (!e.target.matches('input[type="file"]')) return;
  const s = sourceOf(e.target);
  if (!s) return;
  for (const f of [...e.target.files]) {
    try {
      const tracks = core.parseAny(await readFile(f), s.name);
      if (tracks.length) s.files.push({ name: f.name, tracks });
      else toast(`Aucun titre reconnu dans ${f.name}.`);
    } catch {
      toast(`Impossible de lire ${f.name}.`);
    }
  }
  renderSources();
});

// ----- ajout en un clic depuis SoundCloud (favori) -----
const appUrl = () => window.location.origin + window.location.pathname;
const bmLink = $('#bm-link');
bmLink.href = bookmarkletHref(appUrl());
bmLink.addEventListener('click', (e) => {
  e.preventDefault();
  toast('Glisse ce bouton dans ta barre de favoris (Ctrl+Maj+B pour l\'afficher).');
});
$('#bm-copy').addEventListener('click', () => copyText(bookmarkletCode(appUrl()), 'Code copié : colle-le comme adresse d\'un nouveau favori.'));

function handleImport() {
  const imp = core.decodeImport(window.location.hash);
  if (!imp) return;
  window.history.replaceState(null, '', window.location.pathname + window.location.search);
  const tracks = core.parseEntries(imp.tracks, imp.name);
  if (!tracks.length) {
    toast('Aucun titre dans cette playlist.');
    return;
  }
  let s = state.sources.find((x) => !x.text.trim() && !x.files.length);
  if (!s) {
    s = newSource(imp.name);
    state.sources.push(s);
  }
  s.name = imp.name;
  s.files.push({ name: 'Import SoundCloud', tracks });
  renderSources();
  toast(`${imp.name} : ${tracks.length} ${tracks.length > 1 ? 'titres ajoutés' : 'titre ajouté'}.`);
  $('#sources').scrollIntoView?.({ block: 'nearest' });
}
window.addEventListener('hashchange', handleImport);

$('#clear-all').addEventListener('click', () => {
  state.sources = [newSource('Playlist 1'), newSource('Playlist 2')];
  renderSources();
  toast('Playlists effacées.');
});

$('#add-source').addEventListener('click', () => {
  state.sources.push(newSource(`Playlist ${state.sources.length + 1}`));
  renderSources();
  $$('.source textarea', sourcesEl).at(-1)?.focus();
});

for (const [id, out] of [['threshold', 'threshold-out'], ['minsize', 'minsize-out']]) {
  $(`#${id}`).addEventListener('input', (e) => { $(`#${out}`).textContent = e.target.value; });
}
$('#copy-cmd').addEventListener('click', () => copyText($('#cmd-text').textContent, 'Commande copiée.'));

$('#form').addEventListener('submit', (e) => {
  e.preventDefault();
  run();
});
$('#load-sample').addEventListener('click', () => {
  state.sources = [newSource('Playlist 1', SAMPLE_1), newSource('Playlist 2', SAMPLE_2)];
  renderSources();
  run();
});

// --------------------------------------------------------------------------- //
// Analyse
// --------------------------------------------------------------------------- //
function run() {
  const sources = state.sources.map((s) => {
    const tracks = [...s.files.flatMap((f) => f.tracks), ...core.parseAny(s.text, s.name)];
    tracks.forEach((t) => { t.source = s.name; });
    return { name: s.name, tracks };
  });
  const total = sources.reduce((n, s) => n + s.tracks.length, 0);
  const playlistLinks = state.sources.flatMap((s) => core.findUrls(s.text)).filter(core.isPlaylistUrl).length;
  if (!total) {
    toast(
      playlistLinks
        ? 'Les liens de playlist ne sont pas lus ici. Ouvre la playlist sur SoundCloud et clique sur le favori « Ajouter à Le bac ».'
        : 'Colle une liste de titres ou importe un fichier.',
    );
    return;
  }
  const r = core.analyze(sources, { threshold: Number($('#threshold').value), minSize: Number($('#minsize').value) });
  r.playlists.forEach((p, i) => { p.color = i % PALETTE; });
  r.playlistLinks = playlistLinks;
  state.result = r;
  state.colorSeq = r.playlists.length;
  state.selected.clear();
  state.view = 'bacs';
  renderResults(true);
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  $('#results').scrollIntoView?.({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
}

// --------------------------------------------------------------------------- //
// Résultats
// --------------------------------------------------------------------------- //
const board = $('#board');

function renderResults(fresh = false) {
  const r = state.result;
  $('#empty').hidden = !!r;
  $('#results').hidden = !r;
  if (!r) return;
  renderSummary();
  renderNotices();
  renderBoard(fresh);
  renderDups();
  renderVersions();
  setView(state.view);
}

function renderSummary() {
  const r = state.result;
  const kept = r.playlists.reduce((n, p) => n + p.tracks.length, 0);
  $('#summary').innerHTML =
    `<b>${r.total}</b> titres lus, <b>${r.dups.length}</b> doublons retirés. ` +
    `<b>${kept}</b> titres rangés dans <b>${r.playlists.length}</b> ${r.playlists.length > 1 ? 'bacs' : 'bac'}.`;
}

function renderNotices() {
  const r = state.result;
  const out = [];
  if (r.kept.length && r.noGenre / r.kept.length > 0.5) {
    out.push(
      "La plupart des titres n'ont pas de genre : le rangement se base alors sur les mots du titre, donc il est approximatif. Importe un fichier avec les genres (voir l'aide en haut de page) ou déplace les titres à la main.",
    );
  }
  if (r.playlistLinks) {
    out.push('Les liens de playlist collés ont été ignorés : ils ne se lisent pas depuis cette page. Ouvre la playlist sur SoundCloud et clique sur le favori « Ajouter à Le bac ».');
  }
  $('#notices').innerHTML = out.map((t) => `<p class="notice">${esc(t)}</p>`).join('');
}

const OPEN_ICON =
  '<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3H3v10h10v-3M9 3h4v4M13 3L7 9" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function rowHtml(t, first) {
  const sel = state.selected.has(t.id);
  const ver = t.familyId
    ? `<span class="ver${t.versionLabel === 'Original' ? ' is-original' : ''}" title="Version liée">${esc(t.versionLabel)}</span>`
    : '';
  const url = safeUrl(t.url);
  const open = url
    ? `<a class="open" href="${esc(url)}" target="_blank" rel="noopener" aria-label="Ouvrir ${esc(t.title)} sur SoundCloud">${OPEN_ICON}</a>`
    : '';
  // une version liée affiche le titre de base : le badge porte déjà la mention remix, edit, etc.
  const shown = t.familyId ? core.parseVersion(t.title).base || t.title : t.title;
  return `<li class="row" draggable="true" tabindex="${first ? 0 : -1}" role="checkbox" aria-checked="${sel}" data-id="${t.id}"${
    t.familyId ? ` data-fam="${t.familyId}"` : ''
  } title="${esc([t.title, t.genre].filter(Boolean).join(' – '))}"><span class="row-main"><span class="row-title">${esc(shown)}</span><span class="row-artist">${esc(
    t.artist || 'Artiste inconnu',
  )}</span></span>${ver}${open}</li>`;
}

function crateHtml(pl, i) {
  const has = pl.tracks.length > 0;
  return `<section class="crate" data-id="${pl.id}" style="--c:var(--t${pl.color % PALETTE});--i:${Math.min(i, 8)}">
    <div class="tab">
      <input class="crate-name" value="${esc(pl.name)}" size="${Math.max(4, pl.name.length + 1)}" maxlength="40" aria-label="Nom du bac">
      <span class="count">${pl.tracks.length}</span>
    </div>
    <div class="crate-body">
      <div class="crate-tools">${
        has
          ? '<button type="button" class="link" data-act="select-crate">Tout sélectionner</button><button type="button" class="link" data-act="copy-links">Copier les liens</button>'
          : '<button type="button" class="link" data-act="remove-crate">Retirer ce bac</button>'
      }</div>
      <ul class="rows" role="group" aria-label="Titres du bac ${esc(pl.name)}">${
        has ? pl.tracks.map((t, k) => rowHtml(t, k === 0)).join('') : '<li class="rows-empty">Dépose des titres ici.</li>'
      }</ul>
    </div>
  </section>`;
}

function renderBoard(fresh = false) {
  const r = state.result;
  setHot(null);
  board.classList.toggle('fresh', fresh);
  board.innerHTML =
    r.playlists.map(crateHtml).join('') +
    '<section class="crate crate-new" data-id="new" aria-label="Nouveau bac"><div class="crate-body"><p>Dépose des titres ici pour créer un bac.</p><button type="button" class="btn btn-small btn-line" data-act="new-crate">Nouveau bac vide</button></div></section>';
  $('#n-bacs').textContent = r.playlists.length;
  if (state.focusCrate) {
    const input = $(`.crate[data-id="${state.focusCrate}"] .crate-name`, board);
    input?.focus();
    input?.select();
    state.focusCrate = null;
  }
  renderSelBar();
}

// ----- sélection -----
function syncSelection() {
  $$('.row', board).forEach((el) => el.setAttribute('aria-checked', String(state.selected.has(Number(el.dataset.id)))));
  renderSelBar();
}
function toggleSel(id) {
  if (state.selected.has(id)) state.selected.delete(id);
  else state.selected.add(id);
  syncSelection();
}

function renderSelBar() {
  const bar = $('#selbar');
  const n = state.selected.size;
  bar.hidden = !state.result || n === 0 || state.view !== 'bacs';
  if (bar.hidden) return;
  $('#sel-count').textContent = n === 1 ? '1 titre sélectionné' : `${n} titres sélectionnés`;
  const sel = $('#sel-target');
  const prev = sel.value;
  sel.innerHTML = state.result.playlists.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
  if ([...sel.options].some((o) => o.value === prev)) sel.value = prev;
}

$('#sel-move').addEventListener('click', () => {
  const to = $('#sel-target').value;
  if (to) moveTracks([...state.selected], to);
  else toast('Crée d\'abord un bac.');
});
$('#sel-new').addEventListener('click', () => moveTracks([...state.selected], 'new'));
$('#sel-clear').addEventListener('click', () => { state.selected.clear(); syncSelection(); });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && state.selected.size) { state.selected.clear(); syncSelection(); }
});

// ----- bacs -----
function addCrate(name = 'Nouveau bac') {
  const p = core.newPlaylist(name);
  p.color = state.colorSeq++ % PALETTE;
  state.result.playlists.push(p);
  return p;
}

function moveTracks(ids, toId) {
  const r = state.result;
  const set = new Set(ids);
  const moved = [];
  for (const pl of r.playlists) {
    const keep = [];
    for (const t of pl.tracks) (set.has(t.id) ? moved : keep).push(t);
    pl.tracks = keep;
  }
  if (!moved.length) return;
  let target = r.playlists.find((p) => p.id === toId);
  if (!target) {
    target = addCrate();
    state.focusCrate = target.id;
  }
  target.tracks.push(...moved);
  core.sortTracks(target.tracks);
  moved.forEach((t) => { t.style = target.name; });
  state.selected.clear();
  renderBoard();
  renderSummary();
  renderVersions();
  toast(`${moved.length} ${moved.length > 1 ? 'titres déplacés' : 'titre déplacé'} vers ${target.name}.`);
}

const playlistOf = (el) => state.result.playlists.find((p) => p.id === el.closest('.crate')?.dataset.id);

board.addEventListener('click', (e) => {
  const act = e.target.closest('[data-act]');
  if (act) {
    const crate = e.target.closest('.crate');
    if (act.dataset.act === 'new-crate') {
      state.focusCrate = addCrate().id;
      renderBoard();
      renderSummary();
      return;
    }
    const pl = playlistOf(act);
    if (!pl || !crate) return;
    if (act.dataset.act === 'select-crate') {
      const all = pl.tracks.every((t) => state.selected.has(t.id));
      pl.tracks.forEach((t) => (all ? state.selected.delete(t.id) : state.selected.add(t.id)));
      syncSelection();
    } else if (act.dataset.act === 'copy-links') {
      const links = core.playlistLinks(pl);
      if (links) copyText(links, 'Liens copiés.');
      else toast('Aucun lien dans ce bac.');
    } else if (act.dataset.act === 'remove-crate') {
      state.result.playlists = state.result.playlists.filter((p) => p !== pl);
      renderBoard();
      renderSummary();
    }
    return;
  }
  if (e.target.closest('a, input')) return;
  const row = e.target.closest('.row');
  if (row) toggleSel(Number(row.dataset.id));
});

board.addEventListener('keydown', (e) => {
  const row = e.target.closest?.('.row');
  if (!row || e.target !== row) return;
  if (e.key === ' ' || e.key === 'Enter') {
    e.preventDefault();
    toggleSel(Number(row.dataset.id));
  } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const next = e.key === 'ArrowDown' ? row.nextElementSibling : row.previousElementSibling;
    if (next?.classList.contains('row')) {
      row.tabIndex = -1;
      next.tabIndex = 0;
      next.focus();
    }
  }
});

board.addEventListener('input', (e) => {
  if (!e.target.matches('.crate-name')) return;
  const pl = playlistOf(e.target);
  if (!pl) return;
  pl.name = e.target.value;
  e.target.size = Math.max(4, pl.name.length + 1);
  pl.tracks.forEach((t) => { t.style = pl.name; });
});
board.addEventListener('change', (e) => {
  if (!e.target.matches('.crate-name')) return;
  const pl = playlistOf(e.target);
  if (!pl) return;
  if (!pl.name.trim()) {
    pl.name = 'Sans nom';
    e.target.value = pl.name;
  }
  renderSelBar();
  renderVersions();
});

// ----- glisser-déposer -----
function setHot(fam) {
  state.hotFam = fam;
  $$('.row.fam-hot', board).forEach((el) => el.classList.remove('fam-hot'));
  if (fam) $$(`.row[data-fam="${fam}"]`, board).forEach((el) => el.classList.add('fam-hot'));
}
board.addEventListener('mouseover', (e) => {
  const fam = e.target.closest?.('.row')?.dataset.fam || null;
  if (fam !== state.hotFam) setHot(fam);
});
board.addEventListener('mouseleave', () => setHot(null));

board.addEventListener('dragstart', (e) => {
  const row = e.target.closest?.('.row');
  if (!row) return;
  const id = Number(row.dataset.id);
  const ids = state.selected.has(id) ? [...state.selected] : [id];
  state.dragIds = ids;
  e.dataTransfer.setData('text/plain', ids.join(','));
  e.dataTransfer.effectAllowed = 'move';
  setTimeout(() => ids.forEach((i) => $(`.row[data-id="${i}"]`, board)?.classList.add('dragging')), 0);
});
board.addEventListener('dragend', () => {
  state.dragIds = null;
  $$('.dragging, .drop', board).forEach((el) => el.classList.remove('dragging', 'drop'));
});
board.addEventListener('dragover', (e) => {
  const crate = e.target.closest?.('.crate');
  if (!crate || !state.dragIds) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  crate.classList.add('drop');
});
board.addEventListener('dragleave', (e) => {
  const crate = e.target.closest?.('.crate');
  if (crate && !crate.contains(e.relatedTarget)) crate.classList.remove('drop');
});
board.addEventListener('drop', (e) => {
  const crate = e.target.closest?.('.crate');
  if (!crate || !state.dragIds) return;
  e.preventDefault();
  const ids = state.dragIds;
  state.dragIds = null;
  crate.classList.remove('drop');
  moveTracks(ids, crate.dataset.id);
});

// ----- doublons -----
const panelDups = $('#panel-doublons');

function renderDups() {
  const r = state.result;
  $('#n-doublons').textContent = r.dups.length;
  if (!r.dups.length) {
    panelDups.innerHTML = '<p>Aucun doublon trouvé.</p>';
    return;
  }
  panelDups.innerHTML = `<p>Ces titres ont été retirés parce qu'un titre identique ou très proche était déjà là. Si l'outil s'est trompé, garde-les : ils rejoignent le bac du titre conservé.</p>
    <div class="table-wrap"><table class="grid">
      <thead><tr><th>Retiré</th><th>Gardé à la place</th><th>Raison</th><th><span class="sr-only">Action</span></th></tr></thead>
      <tbody>${r.dups
        .map(
          (d) => `<tr>
        <td>${esc(core.labelOf(d.removed))}<span class="sub">${esc(d.removed.source)}</span></td>
        <td>${esc(core.labelOf(d.kept))}<span class="sub">${esc(d.kept.source)}</span></td>
        <td>${esc(d.reason)}</td>
        <td><button type="button" class="link" data-act="restore" data-id="${d.removed.id}">Garder aussi</button></td></tr>`,
        )
        .join('')}</tbody></table></div>`;
}

panelDups.addEventListener('click', (e) => {
  const b = e.target.closest('[data-act="restore"]');
  if (!b) return;
  const r = state.result;
  const i = r.dups.findIndex((d) => d.removed.id === Number(b.dataset.id));
  if (i < 0) return;
  const [d] = r.dups.splice(i, 1);
  const home = r.playlists.find((p) => p.tracks.includes(d.kept)) || r.playlists.at(-1) || addCrate('Divers');
  home.tracks.push(d.removed);
  r.kept.push(d.removed);
  r.families = core.annotateVersions(r.kept);
  core.sortTracks(home.tracks);
  d.removed.style = home.name;
  renderBoard();
  renderSummary();
  renderDups();
  renderVersions();
  toast(`Gardé dans ${home.name}.`);
});

// ----- versions liées -----
const panelVers = $('#panel-versions');

function renderVersions() {
  const r = state.result;
  $('#n-versions').textContent = r.families.length;
  if (!r.families.length) {
    panelVers.innerHTML =
      "<p>Aucune version liée trouvée. Quand un remix, un edit ou un bootleg partage son titre avec un morceau de tes playlists, ils sont reliés ici.</p>";
    return;
  }
  const home = (t) => r.playlists.find((p) => p.tracks.includes(t));
  panelVers.innerHTML = `<p>Un titre et ses versions (remix, edit, bootleg) : pratique pour les enchaîner en set. Réunis-les dans un même bac pour les retrouver ensemble.</p>
    <ul class="fams">${r.families
      .map((f) => {
        const together = new Set(f.members.map((t) => home(t)?.id)).size <= 1;
        return `<li class="fam"><h3>${esc(f.title)}</h3><ul>${f.members
          .map(
            (t) =>
              `<li><span class="ver${t.versionLabel === 'Original' ? ' is-original' : ''}">${esc(t.versionLabel)}</span>${esc(
                t.artist || 'Artiste inconnu',
              )}<span class="where">${esc(home(t)?.name || '')}</span></li>`,
          )
          .join('')}</ul>${
          together
            ? '<span class="where">Déjà dans le même bac</span>'
            : `<button type="button" class="link" data-act="join" data-fam="${f.id}">Réunir dans le même bac</button>`
        }</li>`;
      })
      .join('')}</ul>`;
}

panelVers.addEventListener('click', (e) => {
  const b = e.target.closest('[data-act="join"]');
  if (!b) return;
  const r = state.result;
  const fam = r.families.find((f) => f.id === b.dataset.fam);
  if (!fam) return;
  const anchor = fam.members.find((t) => t.versionLabel === 'Original') || fam.members[0];
  const target = r.playlists.find((p) => p.tracks.includes(anchor));
  if (target) moveTracks(fam.members.map((t) => t.id), target.id);
});

// ----- onglets et export -----
function setView(v) {
  state.view = v;
  for (const name of ['bacs', 'doublons', 'versions']) {
    $(`#panel-${name}`).hidden = name !== v;
    $(`#tab-${name}`).setAttribute('aria-selected', String(name === v));
  }
  renderSelBar();
}
const tabsEl = $('.tabs');
tabsEl.addEventListener('click', (e) => {
  const b = e.target.closest('[data-view]');
  if (b) setView(b.dataset.view);
});
tabsEl.addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
  const tabs = $$('[data-view]', tabsEl);
  const i = tabs.indexOf(document.activeElement);
  if (i < 0) return;
  const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
  next.focus();
  setView(next.dataset.view);
});

$('#dl-zip').addEventListener('click', () => {
  const r = state.result;
  if (r) download('le-bac.zip', makeZip(core.exportFiles(r.playlists, r.dups)), 'application/zip');
});
$('#dl-csv').addEventListener('click', () => {
  const r = state.result;
  if (r) download('le-bac.csv', core.tracksToCsv(r.playlists), 'text/csv;charset=utf-8');
});

// --------------------------------------------------------------------------- //
renderSources();
renderResults();
handleImport();
