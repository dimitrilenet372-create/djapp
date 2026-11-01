// Import des tonalités et tempos depuis un export de logiciel de DJ (Mixxx, rekordbox, Mixed In Key) ou d'un simple tableur :
// un fichier CSV ou texte avec des colonnes artiste, titre, tonalité et/ou BPM. Rien n'est envoyé nulle part.
import { parseCsvRows, parseKey, normalize, splitArtistTitle, tokenSortRatio } from './core.js';

const simple = (s) => String(s || '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const HEADERS = {
  artist: ['artist', 'artiste', 'track artist', 'interpret', 'artists'],
  title: ['title', 'titre', 'track title', 'track name', 'song', 'song name', 'name', 'nom', 'track'],
  key: ['key', 'initial key', 'tonalite', 'camelot', 'open key', 'key camelot', 'musical key', 'key text'],
  bpm: ['bpm', 'tempo', 'average bpm'],
};

/** Décode un fichier texte : UTF-8, ou UTF-16 (rekordbox) quand une marque d'ordre des octets est présente. */
export function decodeText(bytes) {
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (u[0] === 0xff && u[1] === 0xfe) return new TextDecoder('utf-16le').decode(u.subarray(2));
  if (u[0] === 0xfe && u[1] === 0xff) return new TextDecoder('utf-16be').decode(u.subarray(2));
  return new TextDecoder('utf-8').decode(u).replace(/^﻿/, '');
}

/** Open Key (« 1d » à « 12m », utilisé par Traktor) en code Camelot. */
export function openKeyToCamelot(raw) {
  const m = /^(1[0-2]|[1-9])\s?([dm])$/i.exec(String(raw || '').trim());
  if (!m) return null;
  return `${((Number(m[1]) + 6) % 12) + 1}${m[2].toLowerCase() === 'd' ? 'B' : 'A'}`;
}

const keyOf = (raw) => parseKey(raw) || openKeyToCamelot(raw);
const bpmOf = (raw) => {
  const n = parseFloat(String(raw || '').replace(',', '.'));
  return n >= 60 && n <= 220 ? Math.round(n * 10) / 10 : null;
};

/** Lit le texte d'un export. Renvoie { rows: [{artist, title, key, bpm}], error }. */
export function parseTuneFile(text) {
  const table = parseCsvRows(String(text || '').replace(/^﻿/, ''));
  if (table.length < 2) return { rows: [], error: 'Le fichier est vide ou ne contient qu\'une ligne.' };
  const head = table[0].map(simple);
  const col = (names) => {
    for (const n of names) {
      const i = head.indexOf(n);
      if (i >= 0) return i;
    }
    return -1;
  };
  const c = { artist: col(HEADERS.artist), title: col(HEADERS.title), key: col(HEADERS.key), bpm: col(HEADERS.bpm) };
  if (c.title < 0) return { rows: [], error: 'Je ne trouve pas de colonne « Titre » (Title, Track title, Name…) sur la première ligne.' };
  if (c.key < 0 && c.bpm < 0) return { rows: [], error: 'Je ne trouve ni colonne « Tonalité » (Key, Initial key, Camelot…) ni colonne « BPM ».' };
  const rows = [];
  for (const r of table.slice(1)) {
    let artist = c.artist >= 0 ? (r[c.artist] || '').trim() : '';
    let title = (r[c.title] || '').trim();
    if (!title) continue;
    if (!artist) [artist, title] = splitArtistTitle(title);
    const key = c.key >= 0 ? keyOf(r[c.key]) : null;
    const bpm = c.bpm >= 0 ? bpmOf(r[c.bpm]) : null;
    if (key || bpm) rows.push({ artist, title, key, bpm });
  }
  return { rows, error: rows.length ? '' : 'Aucune ligne avec une tonalité ou un BPM lisible.' };
}

const digits = (s) => (s.match(/\d+/g) || []).join(',');

/**
 * Rapproche les titres de la playlist des lignes du fichier. Prudent : même titre et même artiste (à une faute près),
 * ou même titre long et unique dans le fichier. Un remix n'est pas confondu avec l'original.
 * Renvoie [{ id, key, bpm }] pour les titres à qui il manque une tonalité ou un tempo.
 */
export function matchTunes(tracks, rows) {
  const prepared = rows.map((r) => ({ ...r, nTitle: normalize(r.title), nArtist: normalize(r.artist) }));
  prepared.forEach((r) => (r.sig = `${r.nArtist} ${r.nTitle}`.trim()));
  const byTitle = new Map();
  for (const r of prepared) byTitle.set(r.nTitle, [...(byTitle.get(r.nTitle) || []), r]);
  const out = [];
  for (const t of tracks) {
    if (t.key && t.bpm) continue;
    let hit = prepared.find((r) => r.sig === t.sig);
    if (!hit) {
      hit = prepared.find((r) => digits(r.sig) === digits(t.sig) && tokenSortRatio(r.sig, t.sig, 92) >= 92);
    }
    if (!hit) {
      const same = byTitle.get(t.nTitle) || [];
      if (same.length === 1 && t.nTitle.length >= 8) hit = same[0];
    }
    if (!hit) continue;
    const key = t.key ? null : hit.key;
    const bpm = t.bpm ? null : hit.bpm;
    if (key || bpm) out.push({ id: t.id, key, bpm });
  }
  return out;
}
