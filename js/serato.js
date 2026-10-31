// Export vers Serato DJ : retrouve les fichiers audio de l'ordinateur qui correspondent aux titres
// d'une playlist, puis écrit une crate Serato (.crate) et une playlist M3U.
// Logique pure : utilisable dans la page et dans Node.
import { normalize, splitArtistTitle, parseVersion, kindOf, tokenSortRatio } from './core.js';

export const AUDIO_EXT = /\.(mp3|wav|aiff?|flac|m4a|aac|ogg|alac|mp4)$/i;

const digits = (s) => (s.match(/\d+/g) || []).join(',');
const STOP = new Set(['the', 'and', 'feat', 'remix', 'mix', 'edit', 'original', 'version', 'les', 'des']);
const tokensOf = (s) => [...new Set(s.split(' ').filter((w) => w.length >= 2 && !STOP.has(w)))];

/** Décrit un fichier à partir de son nom : « 03 - Artiste - Titre (Remix).mp3 ». */
export function describeFile(path) {
  const base = path.split(/[\\/]/).pop().replace(/\.[^.]+$/, '');
  const clean = base.replace(/^\s*\d{1,3}\s*(?:[.\-_)]\s*|\s+(?=\D))/, '').replace(/_/g, ' ').trim();
  const [artist, title] = splitArtistTitle(clean);
  const v = parseVersion(title);
  const sig = normalize(clean);
  return {
    path,
    hasArtist: Boolean(artist),
    sig,
    nTitle: normalize(title),
    kind: kindOf(v.marker),
    marker: normalize(v.marker),
    tokens: tokensOf(sig),
  };
}

function versionsAgree(t, f) {
  const v = parseVersion(t.title);
  if (kindOf(v.marker) !== f.kind) return false;
  if (!v.marker) return true;
  // deux remix : il faut le même remixeur
  return tokenSortRatio(normalize(v.marker), f.marker) >= 70;
}

function scoreOf(t, f) {
  if (!f.sig || !t.sig) return 0;
  if (!versionsAgree(t, f)) return 0;
  const sig = t.artist ? t.sig : t.nTitle;
  if (digits(sig) !== digits(f.sig)) return 0; // « Song » ≠ « Song 2 »
  let s = tokenSortRatio(sig, f.sig);
  // fichier nommé seulement d'après le titre
  if (!f.hasArtist && t.nTitle && t.nTitle.length >= 6) s = Math.max(s, tokenSortRatio(t.nTitle, f.sig) - 3);
  return s;
}

/**
 * Associe chaque titre au fichier audio le plus proche.
 * files : chemins relatifs (ou absolus). Un fichier ne sert qu'une fois.
 * → { found: [{ track, file, score }], missing: [track] } dans l'ordre de la playlist.
 */
export function matchFiles(tracks, files, threshold = 85) {
  const descs = files.filter((p) => AUDIO_EXT.test(p)).map(describeFile);
  const index = new Map();
  descs.forEach((d, i) => {
    for (const w of d.tokens) {
      if (!index.has(w)) index.set(w, []);
      index.get(w).push(i);
    }
  });
  const pairs = [];
  tracks.forEach((t, ti) => {
    const shared = new Map();
    for (const w of tokensOf(t.sig)) for (const i of index.get(w) || []) shared.set(i, (shared.get(i) || 0) + 1);
    const cands = [...shared.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40);
    for (const [fi] of cands) {
      const s = scoreOf(t, descs[fi]);
      if (s >= threshold) pairs.push({ ti, fi, s });
    }
  });
  pairs.sort((a, b) => b.s - a.s);
  const byTrack = new Map();
  const usedFiles = new Set();
  for (const p of pairs) {
    if (byTrack.has(p.ti) || usedFiles.has(p.fi)) continue;
    byTrack.set(p.ti, p);
    usedFiles.add(p.fi);
  }
  const found = [];
  const missing = [];
  tracks.forEach((t, ti) => {
    const p = byTrack.get(ti);
    if (p) found.push({ track: t, file: descs[p.fi].path, score: Math.round(p.s) });
    else missing.push(t);
  });
  return { found, missing };
}

/**
 * Chemin complet d'un fichier choisi avec le sélecteur de dossier.
 * base : chemin du dossier choisi sur l'ordinateur (« C:\Users\Dimitri\Music ») ;
 * rel : chemin donné par le navigateur, qui commence par le nom de ce dossier (« Music/House/titre.mp3 »).
 */
export function absolutePath(base, rel) {
  const b = String(base || '').trim().replace(/^"|"$/g, '').replace(/[\\/]+$/, '');
  const win = /^[a-z]:/i.test(b) || b.includes('\\');
  const sep = win ? '\\' : '/';
  const inner = rel.split(/[\\/]/).slice(1).join(sep);
  return b + sep + inner;
}

/** Lecteur du chemin (« D: ») ou '' pour un Mac ou le disque principal. */
export const driveOf = (abs) => (/^([a-z]):/i.exec(abs) || [])[0]?.toUpperCase() || '';

/** Chemin tel que Serato l'enregistre : sans lecteur, sans « / » au début, avec des « / ». */
export const seratoPath = (abs) => abs.replace(/^[a-z]:/i, '').replace(/\\/g, '/').replace(/^\/+/, '');

// --------------------------------------------------------------------------- //
// Format .crate : suite de champs « nom (4 lettres) + longueur (32 bits) + données », texte en UTF-16 BE
// --------------------------------------------------------------------------- //
function utf16be(s) {
  const out = new Uint8Array(s.length * 2);
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    out[i * 2] = c >> 8;
    out[i * 2 + 1] = c & 0xff;
  }
  return out;
}
function field(tag, data) {
  const out = new Uint8Array(8 + data.length);
  for (let i = 0; i < 4; i++) out[i] = tag.charCodeAt(i);
  new DataView(out.buffer).setUint32(4, data.length);
  out.set(data, 8);
  return out;
}
const concat = (parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let pos = 0;
  for (const p of parts) {
    out.set(p, pos);
    pos += p.length;
  }
  return out;
};

const COLUMNS = ['song', 'artist', 'bpm', 'key', 'album', 'length', 'comment', 'added'];

/** paths : chemins complets des fichiers, dans l'ordre → contenu du fichier .crate. */
export function makeCrate(paths) {
  const parts = [field('vrsn', utf16be('1.0/Serato ScratchLive Crate'))];
  for (const c of COLUMNS) parts.push(field('ovct', concat([field('tvcn', utf16be(c)), field('tvcw', utf16be('0'))])));
  for (const p of paths) parts.push(field('otrk', field('ptrk', utf16be(seratoPath(p)))));
  return concat(parts);
}

/** Lit une crate (pour les tests et pour vérifier un export). → chemins */
export function readCrate(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = (o, n) => {
    let s = '';
    for (let i = 0; i < n; i += 2) s += String.fromCharCode(dv.getUint16(o + i));
    return s;
  };
  const tag = (o) => String.fromCharCode(...bytes.subarray(o, o + 4));
  let version = '';
  const paths = [];
  for (let o = 0; o + 8 <= bytes.length; ) {
    const t = tag(o);
    const n = dv.getUint32(o + 4);
    if (t === 'vrsn') version = text(o + 8, n);
    if (t === 'otrk') {
      for (let q = o + 8; q + 8 <= o + 8 + n; ) {
        const m = dv.getUint32(q + 4);
        if (tag(q) === 'ptrk') paths.push(text(q + 8, m));
        q += 8 + m;
      }
    }
    o += 8 + n;
  }
  return { version, paths };
}

/** Playlist M3U (lue par Rekordbox, Traktor, VirtualDJ, djay…). */
export function makeM3u(found) {
  const lines = ['#EXTM3U'];
  for (const { track: t, path } of found) {
    lines.push(`#EXTINF:${t.duration ? Math.round(t.duration) : -1},${t.artist ? `${t.artist} - ` : ''}${t.title}`);
    lines.push(path);
  }
  return lines.join('\r\n') + '\r\n';
}

/** Liens pour trouver un titre manquant. */
export function whereToGet(t) {
  const q = encodeURIComponent(`${t.artist ? t.artist + ' ' : ''}${t.title}`.trim());
  return [
    ...(t.url && /soundcloud\.com\//i.test(t.url) ? [{ label: 'SoundCloud', href: t.url }] : []),
    { label: 'Beatport', href: `https://www.beatport.com/search?q=${q}` },
    { label: 'Bandcamp', href: `https://bandcamp.com/search?q=${q}&item_type=t` },
  ];
}

export const crateName = (name) => (name || 'Le bac').replace(/[\\/:*?"<>|%]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Le bac';
