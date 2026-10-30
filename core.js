// Logique pure (aucune dépendance au navigateur) : utilisable dans la page et dans Node.

// --------------------------------------------------------------------------- //
// Modèle
// --------------------------------------------------------------------------- //
let seq = 0;

export function makeTrack(p) {
  const t = {
    id: ++seq,
    title: (p.title || '').trim(),
    artist: (p.artist || '').trim(),
    url: p.url || '',
    genre: p.genre || '',
    tags: p.tags || [],
    bpm: p.bpm ?? null,
    duration: p.duration ?? null,
    source: p.source || '',
    style: '',
    familyId: null,
    versionLabel: '',
  };
  t.nArtist = normalize(t.artist);
  t.nTitle = normalize(t.title);
  t.sig = `${t.nArtist} ${t.nTitle}`.trim();
  return t;
}

export const labelOf = (t) => (t.artist ? `${t.artist} - ${t.title}` : t.title);

// --------------------------------------------------------------------------- //
// Normalisation des titres
// --------------------------------------------------------------------------- //
const NOISE = String.raw`free ?dl|free download|download|out now|premiere|official(?: audio| video| music video| lyric video)?|hq|hd|lyrics?|lyric video|audio|full version|buy|original mix|radio edit`;
const BRACKET_NOISE = new RegExp(String.raw`[\(\[\{][^\)\]\}]*\b(?:${NOISE})\b[^\)\]\}]*[\)\]\}]`, 'gi');
const FEAT_BRACKET = /[(\[]\s*(?:feat|ft|featuring)\b[^)\]]*[)\]]/gi;
const FEAT_TAIL = /\b(?:feat|ft|featuring)\b\.?\s+.*$/i;

export function normalize(s) {
  s = (s || '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
  s = s.replace(BRACKET_NOISE, ' ').replace(FEAT_BRACKET, ' ').replace(FEAT_TAIL, ' ');
  s = s.replace(/&/g, ' and ').replace(/[^\p{L}\p{N}]+/gu, ' ');
  return s.replace(/\s+/g, ' ').trim();
}

// Marqueurs de version : un remix n'est pas le même morceau qu'un original.
const V = String.raw`remix|rmx|rework|re-?fix|flip|edit|vip|bootleg|mashup|mash up|extended(?: mix| version)?|club mix|dub mix|acoustic|live|sped up|slowed(?: \+ reverb| and reverb)?|nightcore|instrumental|cover|remaster(?:ed)?`;
const BRACKET_VER = new RegExp(String.raw`[(\[]([^)\]]*\b(?:${V})\b[^)\]]*)[)\]]`, 'i');
const SUFFIX_VER = new RegExp(String.raw`\s[-–—]\s*([^\-–—]*\b(?:${V})\b[^\-–—]*)$`, 'i');
const MARKER_ONLY = new RegExp(String.raw`^[^\-–—]*\b(?:${V})\s*$`, 'i');

export function splitArtistTitle(raw, uploader = '') {
  const r = (raw || '').trim();
  for (const sep of [' - ', ' – ', ' — ']) {
    const i = r.indexOf(sep);
    if (i > -1) {
      const a = r.slice(0, i).trim();
      const t = r.slice(i + sep.length).trim();
      // « Midnight City - Eric Prydz Remix » : la partie droite n'est qu'un marqueur de version
      if (a && t && !(MARKER_ONLY.test(t) && !t.includes(sep.trim()))) return [a, t];
    }
  }
  return [(uploader || '').trim(), r];
}

const normUrl = (u) => (u || '').trim().toLowerCase().replace(/[?#].*$/, '').replace(/\/+$/, '');

// --------------------------------------------------------------------------- //
// Versions liées (original, remix, edit, bootleg…)
// --------------------------------------------------------------------------- //
export function parseVersion(title) {
  let m = BRACKET_VER.exec(title);
  if (m) {
    const base = (title.slice(0, m.index) + ' ' + title.slice(m.index + m[0].length)).replace(/\s+/g, ' ').trim();
    return { base, marker: m[1].trim() };
  }
  m = SUFFIX_VER.exec(title);
  if (m) return { base: title.slice(0, m.index).trim(), marker: m[1].trim() };
  return { base: title, marker: '' };
}

export function kindOf(marker) {
  const m = (marker || '').toLowerCase();
  if (!m) return 'original';
  if (/remix|rmx|rework|re-?fix|flip/.test(m)) return 'remix';
  if (/bootleg|mash/.test(m)) return 'bootleg';
  if (/edit|extended|club|dub mix|vip/.test(m)) return 'edit';
  return 'autre';
}

/** Repère les familles (un titre + ses versions). Annote les pistes et renvoie les familles. */
export function annotateVersions(tracks) {
  const groups = new Map();
  for (const t of tracks) {
    t.familyId = null;
    t.versionLabel = '';
    t._famKey = `${t.nArtist}|${t.nTitle}|0`;
    const v = parseVersion(t.title);
    const base = normalize(v.base);
    t._ver = { base, marker: v.marker };
    if (base.length < 5) continue;
    if (!groups.has(base)) groups.set(base, []);
    groups.get(base).push(t);
  }
  const families = [];
  for (const [base, members] of groups) {
    if (members.length < 2 || !members.some((t) => t._ver.marker)) continue;
    const originals = members.filter((t) => !t._ver.marker);
    // plusieurs artistes pour le même titre sans marqueur : on ne sait pas lequel est l'original
    if (new Set(originals.map((t) => t.nArtist)).size > 1) continue;
    const id = `f${families.length + 1}`;
    const anchor = originals[0] || members[0];
    const display = originals[0] ? originals[0].title : parseVersion(members[0].title).base;
    for (const t of members) {
      t.familyId = id;
      t.versionLabel = t._ver.marker || 'Original';
      t._famKey = `${anchor.nArtist}|${base}|${t._ver.marker ? '1 ' + normalize(t._ver.marker) : '0'}`;
    }
    families.push({ id, title: display, members });
  }
  return families;
}

// --------------------------------------------------------------------------- //
// Doublons
// --------------------------------------------------------------------------- //
function lcsLength(a, b) {
  if (a.length < b.length) [a, b] = [b, a];
  let prev = new Uint16Array(b.length + 1);
  let cur = new Uint16Array(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= b.length; j++) {
      cur[j] = ca === b.charCodeAt(j - 1) ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[b.length];
}

/** Même mesure que rapidfuzz.fuzz.token_sort_ratio (0 à 100). */
export function tokenSortRatio(a, b, minScore = 0) {
  const sa = a.split(' ').sort().join(' ');
  const sb = b.split(' ').sort().join(' ');
  const total = sa.length + sb.length;
  if (!total) return 100;
  // borne haute : la plus longue sous-séquence ne dépasse pas la plus courte chaîne
  if ((200 * Math.min(sa.length, sb.length)) / total < minScore) return 0;
  return (200 * lcsLength(sa, sb)) / total;
}

const digits = (s) => (s.match(/\d+/g) || []).join(',');
const durClose = (a, b, tol) => a.duration != null && b.duration != null && Math.abs(a.duration - b.duration) <= tol;
const durConflict = (a, b, tol) => a.duration != null && b.duration != null && Math.abs(a.duration - b.duration) > tol * 3;

function near(a, b, threshold, tol) {
  if (a.nTitle && a.nTitle === b.nTitle && a.nTitle.length >= 6 && durClose(a, b, tol)) {
    return 'même titre et même durée';
  }
  if (durConflict(a, b, tol)) return null; // écart net de durée : autre version
  if (digits(a.sig) !== digits(b.sig)) return null; // « Song » ≠ « Song 2 »
  const score = tokenSortRatio(a.sig, b.sig, threshold);
  return score >= threshold ? `titre très proche (${Math.round(score)} %)` : null;
}

/** Retire doublons exacts et quasi-doublons. Garde la première occurrence. */
export function dedupe(tracks, threshold = 90, durationTol = 6) {
  const kept = [];
  const dups = [];
  const byUrl = new Map();
  const byKey = new Map();
  for (const t of tracks) {
    let match = null;
    let reason = '';
    const nu = normUrl(t.url);
    const key = `${t.nArtist}|${t.nTitle}`;
    if (nu && byUrl.has(nu)) {
      match = byUrl.get(nu);
      reason = 'même lien';
    } else if (t.nTitle && byKey.has(key)) {
      match = byKey.get(key);
      reason = 'même artiste et même titre';
    } else {
      for (const k of kept) {
        const r = near(t, k, threshold, durationTol);
        if (r) {
          match = k;
          reason = r;
          break;
        }
      }
    }
    if (!match) {
      kept.push(t);
      if (nu) byUrl.set(nu, t);
      if (t.nTitle) byKey.set(key, t);
    } else {
      if (!match.genre && t.genre) match.genre = t.genre;
      if (!match.tags.length && t.tags.length) match.tags = t.tags;
      if (match.bpm == null && t.bpm != null) match.bpm = t.bpm;
      dups.push({ removed: t, kept: match, reason });
    }
  }
  return { kept, dups };
}

// --------------------------------------------------------------------------- //
// Styles
// --------------------------------------------------------------------------- //
export const STYLE_RULES = [
  ['Drum & Bass', String.raw`drum(?: and| n)? bass|dnb|jungle|neurofunk|liquid funk`],
  ['Dubstep & Bass', String.raw`dubstep|riddim|brostep|future bass|bass music|bass house|glitch hop`],
  ['Hardstyle & Hard dance', String.raw`hardstyle|gabber|rawstyle|frenchcore|hard dance`],
  ['Techno', String.raw`techno|hardtechno|acid|industrial|minimal`],
  ['House', String.raw`house|garage|ukg`],
  ['Trance', String.raw`trance|psytrance|goa|uplifting`],
  ['Électro & EDM', String.raw`electro|electronic|electronica|edm|big room|dance|synthwave|progressive`],
  ['Hip-hop & Rap', String.raw`hip hop|hiphop|rap|trap|drill|boom bap|grime|phonk`],
  ['R&B & Soul', String.raw`rnb|r and b|soul|neo soul|rhythm and blues`],
  ['Lo-fi & Chill', String.raw`lo ?fi|chill|chillout|ambient|downtempo|relax|study|sleep|meditation`],
  ['Pop & Indie', String.raw`pop|indie|alternative`],
  ['Folk & Country', String.raw`folk|country|acoustic|bluegrass|singer songwriter`],
  ['Rock & Metal', String.raw`rock|metal|punk|grunge|emo`],
  ['Reggae & Dancehall', String.raw`reggae|dancehall|ska|dub`],
  ['Afro & Latin', String.raw`afro ?beats?|afro|amapiano|reggaeton|latin|baile funk|kizomba|salsa|bachata`],
  ['Jazz, Funk & Disco', String.raw`jazz|blues|funk|disco|boogie`],
  ['Classique & Ciné', String.raw`classical|orchestral|piano|soundtrack|cinematic`],
].map(([name, pat]) => [name, new RegExp(String.raw`\b(?:${pat})\b`)]);

const titleCase = (s) => s.toLowerCase().replace(/(^|[\s\-/&])(\p{L})/gu, (_, a, b) => a + b.toUpperCase());

/** Style d'après le genre (poids fort), les tags, puis le titre. */
export function detectStyle(t) {
  const g = normalize(t.genre);
  const tags = normalize((t.tags || []).join(' '));
  const title = normalize(`${t.artist} ${t.title}`);
  const scores = new Map();
  const add = (name, n) => scores.set(name, (scores.get(name) || 0) + n);
  for (const [name, rx] of STYLE_RULES) {
    if (g && rx.test(g)) add(name, 4);
    if (tags && rx.test(tags)) add(name, 2);
    if (rx.test(title)) add(name, 1);
  }
  if (!scores.size) return t.genre.trim() ? titleCase(t.genre.trim()) : '';
  const best = Math.max(...scores.values());
  for (const [name] of STYLE_RULES) if (scores.get(name) === best) return name; // priorité = ordre
  return '';
}

const sortKey = (t) => t._famKey || `${t.nArtist}|${t.nTitle}|0`;
/** Trie par artiste puis titre, en gardant un titre et ses versions côte à côte. */
export const sortTracks = (items) => items.sort((a, b) => sortKey(a).localeCompare(sortKey(b)));

let plSeq = 0;
export const newPlaylist = (name, tracks = []) => ({ id: `p${++plSeq}`, name, tracks });

export function groupByStyle(tracks, { minSize = 5, otherName = 'Divers', families = [] } = {}) {
  for (const t of tracks) t.style = detectStyle(t);
  // une version hérite du style de sa famille quand elle n'en a pas
  for (const f of families) {
    const counts = new Map();
    for (const t of f.members) if (t.style) counts.set(t.style, (counts.get(t.style) || 0) + 1);
    if (!counts.size) continue;
    const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    for (const t of f.members) if (!t.style) t.style = best;
  }
  const buckets = new Map();
  for (const t of tracks) {
    const k = t.style || otherName;
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(t);
  }
  const final = new Map();
  const put = (name, items) => final.set(name, (final.get(name) || []).concat(items));
  for (const [name, items] of buckets) {
    if (name !== otherName && items.length < minSize) put(otherName, items);
    else put(name, items);
  }
  const out = [...final.entries()]
    .sort((a, b) => (a[0] === otherName) - (b[0] === otherName) || b[1].length - a[1].length)
    .map(([name, items]) => {
      sortTracks(items);
      items.forEach((t) => (t.style = name));
      return newPlaylist(name, items);
    });
  return out;
}

// --------------------------------------------------------------------------- //
// Analyse complète
// --------------------------------------------------------------------------- //
export function analyze(sources, { threshold = 90, minSize = 5 } = {}) {
  const all = sources.flatMap((s) => s.tracks);
  const { kept, dups } = dedupe(all, threshold);
  const families = annotateVersions(kept);
  const playlists = groupByStyle(kept, { minSize, families });
  return {
    total: all.length,
    kept,
    dups,
    families,
    playlists,
    noGenre: kept.filter((t) => !t.genre && !(t.tags || []).length).length,
  };
}

// --------------------------------------------------------------------------- //
// Lecture des données collées ou importées
// --------------------------------------------------------------------------- //
export const findUrls = (text) => (text || '').match(/https?:\/\/(?:on\.)?soundcloud\.com\/[^\s,;|"]+/gi) || [];
export const isPlaylistUrl = (u) => /soundcloud\.com\/[^/\s]+\/sets\//i.test(u) || /soundcloud\.com\/[^/\s]+\/albums?\b/i.test(u);

function trackFromUrlOnly(url, source) {
  const parts = url.replace(/^https?:\/\/(?:on\.)?soundcloud\.com\//i, '').replace(/[?#].*$/, '').split('/').filter(Boolean);
  if (parts.length < 2) return null;
  return makeTrack({ artist: parts[0].replace(/-/g, ' '), title: parts[1].replace(/-/g, ' '), url, source });
}

function trackFromLine(line, source) {
  const parts = line.split('|').map((s) => s.trim()).filter(Boolean);
  let label = parts.shift() || '';
  let url = '';
  let genre = '';
  let bpm = null;
  const inLabel = findUrls(label)[0];
  if (inLabel) {
    url = inLabel;
    label = label.replace(inLabel, '').trim().replace(/^[-–—|,;\s]+|[-–—|,;\s]+$/g, '');
  }
  for (const p of parts) {
    const u = findUrls(p)[0];
    if (u) {
      url = url || u;
    } else if (/^\d{2,3}(?:[.,]\d+)?(?:\s*bpm)?$/i.test(p)) {
      bpm = parseFloat(p.replace(',', '.'));
    } else if (!genre && !/^(na|none|null)$/i.test(p)) {
      genre = p;
    }
  }
  if (!label) return url && !isPlaylistUrl(url) ? trackFromUrlOnly(url, source) : null;
  const [artist, title] = splitArtistTitle(label);
  return title ? makeTrack({ artist, title, url, genre, bpm, source }) : null;
}

export function parseCsvRows(text) {
  const first = text.split(/\r?\n/, 1)[0];
  const delim = (first.match(/;/g) || []).length > (first.match(/,/g) || []).length ? ';' : ',';
  const rows = [];
  let row = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === delim) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((x) => x !== '')) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x !== '')) rows.push(row);
  return rows;
}

function fromCsv(text, source) {
  const rows = parseCsvRows(text);
  const head = rows.shift().map((h) => normalize(h));
  const col = (...names) => head.findIndex((h) => names.includes(h));
  const iTitle = col('titre', 'title');
  const iArtist = col('artiste', 'artist', 'uploader');
  const iGenre = col('genre soundcloud', 'genre');
  const iBpm = col('bpm');
  const iUrl = col('lien', 'url', 'link');
  const iSrc = col('origine', 'source');
  if (iTitle < 0) return [];
  return rows
    .map((r) => {
      const bpm = iBpm > -1 ? parseFloat((r[iBpm] || '').replace(',', '.')) : NaN;
      return makeTrack({
        title: r[iTitle], artist: iArtist > -1 ? r[iArtist] : '', genre: iGenre > -1 ? r[iGenre] : '',
        bpm: Number.isFinite(bpm) ? bpm : null, url: iUrl > -1 ? r[iUrl] : '', source: (iSrc > -1 && r[iSrc]) || source,
      });
    })
    .filter((t) => t.title);
}

function fromEntry(e, source) {
  if (!e || typeof e !== 'object') return null;
  const [artist, title] = splitArtistTitle(e.title || '', e.uploader || e.artist || '');
  if (!title) return null;
  const genre = e.genre && !/^na$/i.test(e.genre) ? e.genre : '';
  return makeTrack({
    title, artist, genre, url: e.webpage_url || e.url || '', tags: Array.isArray(e.tags) ? e.tags : [],
    duration: typeof e.duration === 'number' ? e.duration : null, bpm: typeof e.bpm === 'number' ? e.bpm : null, source,
  });
}

function fromJson(text, source) {
  let items;
  try {
    const data = JSON.parse(text);
    items = Array.isArray(data) ? data : Array.isArray(data.entries) ? data.entries : [data];
  } catch {
    items = text.split(/\r?\n/).map((l) => {
      try { return JSON.parse(l); } catch { return null; }
    }); // une ligne JSON par titre (yt-dlp -j)
  }
  return items.map((e) => fromEntry(e, source)).filter(Boolean);
}

/** Texte libre, lignes « Artiste - Titre | genre | bpm | lien », CSV ou JSON yt-dlp. */
export function parseAny(text, source = '') {
  const t = (text || '').replace(/^﻿/, '').trim();
  if (!t) return [];
  if (t[0] === '{' || t[0] === '[') return fromJson(t, source);
  if (/^"?(?:playlist|artiste|artist|titre|title)"?\s*[,;]/i.test(t)) return fromCsv(t, source);
  return t.split(/\r?\n/).map((l) => trackFromLine(l.trim(), source)).filter(Boolean);
}

// --------------------------------------------------------------------------- //
// Exports
// --------------------------------------------------------------------------- //
const csvCell = (v) => {
  const s = String(v ?? '');
  return /[",;\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csvLine = (a) => a.map(csvCell).join(',');

export function tracksToCsv(playlists) {
  const lines = [csvLine(['Playlist', 'Artiste', 'Titre', 'Genre', 'BPM', 'Lien', 'Origine', 'Version'])];
  for (const pl of playlists) {
    for (const t of pl.tracks) lines.push(csvLine([pl.name, t.artist, t.title, t.genre, t.bpm ?? '', t.url, t.source, t.versionLabel]));
  }
  return '﻿' + lines.join('\n') + '\n';
}

export function duplicatesToCsv(dups) {
  const lines = [csvLine(['Supprimé', 'Lien supprimé', 'Origine', 'Gardé', 'Lien gardé', 'Raison'])];
  for (const d of dups) lines.push(csvLine([labelOf(d.removed), d.removed.url, d.removed.source, labelOf(d.kept), d.kept.url, d.reason]));
  return '﻿' + lines.join('\n') + '\n';
}

export const playlistToTxt = (pl) =>
  pl.tracks.map((t) => (t.url ? `${labelOf(t)}  |  ${t.url}` : labelOf(t))).join('\n') + '\n';

export const playlistLinks = (pl) => pl.tracks.map((t) => t.url).filter(Boolean).join('\n');

const safeName = (n) => n.replace(/[^\p{L}\p{N}\- ]+/gu, '').trim().replace(/\s+/g, '_') || 'playlist';

export function exportFiles(playlists, dups) {
  const files = playlists.map((pl, i) => ({
    name: `playlists/${String(i + 1).padStart(2, '0')}_${safeName(pl.name)}.txt`,
    data: playlistToTxt(pl),
  }));
  files.push({ name: 'toutes_les_pistes.csv', data: tracksToCsv(playlists) });
  files.push({ name: 'doublons_supprimes.csv', data: duplicatesToCsv(dups) });
  return files;
}
