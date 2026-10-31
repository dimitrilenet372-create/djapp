// Bibliothèque de playlists : logique pure (aucune dépendance au navigateur), testée sous Node.
import * as core from './core.js';

let seq = 0;
export const newId = () => `pl${Date.now().toString(36)}${(++seq).toString(36)}`;

/** Adresse d'une pochette SoundCloud à partir de son identifiant compact (voir le favori). */
export const artUrl = (art, size = 't200x200') => (art && /^[\w./-]+$/.test(art) ? `https://i1.sndcdn.com/${art}-${size}.jpg` : '');

// --------------------------------------------------------------------------- //
// Playlists
// --------------------------------------------------------------------------- //
export const newPlaylist = (name, tracks = [], art = '') => ({ id: newId(), name: String(name || 'Playlist').slice(0, 60), art, tracks });

/** Un nom libre : « Soirée », puis « Soirée (2) »… */
export function uniqueName(lib, name) {
  const base = String(name || 'Playlist').trim() || 'Playlist';
  const taken = new Set(lib.map((p) => p.name));
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base} (${n})`)) n++;
  return `${base} (${n})`;
}

/** Les pochettes à afficher pour une playlist : la sienne, sinon celles des premiers titres. */
export function coverArts(pl) {
  if (pl.art) return [pl.art];
  const seen = [];
  for (const t of pl.tracks) {
    if (t.art && !seen.includes(t.art)) seen.push(t.art);
    if (seen.length === 4) break;
  }
  return seen.length >= 4 ? seen : seen.slice(0, 1);
}

export const totalSeconds = (tracks) => tracks.reduce((n, t) => n + (t.duration || 0), 0);

export function formatDuration(sec) {
  const s = Math.max(0, Math.round(sec || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, '0');
  return h ? `${h} h ${String(m).padStart(2, '0')}` : `${m}:${r}`;
}

// --------------------------------------------------------------------------- //
// Doublons
// --------------------------------------------------------------------------- //
const copyTrack = (t) => ({ ...t, tags: [...(t.tags || [])] });

/** Doublons d'une playlist, sans la modifier : Map identifiant du doublon → { kept, reason }. */
export function findDuplicates(tracks, threshold = 90) {
  const { dups } = core.dedupe(tracks.map(copyTrack), threshold);
  return new Map(dups.map((d) => [d.removed.id, { kept: d.kept, reason: d.reason }]));
}

/** Retire les doublons : renvoie les titres gardés et ceux retirés (le premier exemplaire est gardé). */
export function cleanTracks(tracks, threshold = 90) {
  const dups = findDuplicates(tracks, threshold);
  return { kept: tracks.filter((t) => !dups.has(t.id)), removed: tracks.filter((t) => dups.has(t.id)), dups };
}

/** Fusionne plusieurs playlists en une seule, sans doublons. */
export function mergePlaylists(pls, name, threshold = 90) {
  const all = pls.flatMap((p) => p.tracks);
  const { kept, removed } = cleanTracks(all, threshold);
  return { playlist: newPlaylist(name, kept, pls.find((p) => p.art)?.art || ''), removed: removed.length, total: all.length };
}

/** Compare deux playlists : titres communs (avec leur équivalent), seulement dans A, seulement dans B. */
export function comparePlaylists(a, b, threshold = 90) {
  const inA = new Set(a.tracks.map((t) => t.id));
  const byId = new Map([...a.tracks, ...b.tracks].map((t) => [t.id, t]));
  // A passe en premier : un titre de B retiré comme doublon d'un titre de A est « commun »
  const { dups } = core.dedupe([...a.tracks, ...b.tracks].map(copyTrack), threshold);
  const common = [];
  const matchedA = new Set();
  const dupB = new Set();
  for (const d of dups) {
    if (inA.has(d.removed.id)) continue; // doublon à l'intérieur de A : sans effet ici
    dupB.add(d.removed.id);
    if (inA.has(d.kept.id)) {
      common.push({ a: byId.get(d.kept.id), b: byId.get(d.removed.id) });
      matchedA.add(d.kept.id);
    }
  }
  return {
    common,
    onlyA: a.tracks.filter((t) => !matchedA.has(t.id)),
    // un doublon à l'intérieur de B n'est pas un titre de plus
    onlyB: b.tracks.filter((t) => !dupB.has(t.id)),
  };
}

// --------------------------------------------------------------------------- //
// Rangement par style
// --------------------------------------------------------------------------- //
/** Découpe une playlist en playlists de même style. La playlist d'origine n'est pas touchée. */
export function splitByStyle(pl, minSize = 5) {
  const copies = pl.tracks.map(copyTrack);
  const families = core.annotateVersions(copies);
  const groups = core.groupByStyle(copies, { minSize, families });
  const byId = new Map(pl.tracks.map((t) => [t.id, t]));
  return groups.map((g) => newPlaylist(`${pl.name} · ${g.name}`, g.tracks.map((t) => byId.get(t.id))));
}

// --------------------------------------------------------------------------- //
// Enregistrement
// --------------------------------------------------------------------------- //
const packTrack = (t) => ({
  title: t.title, artist: t.artist, url: t.url, scid: t.scid, art: t.art,
  genre: t.genre, tags: t.tags, duration: t.duration, bpm: t.bpm,
});

export const serialize = (lib) => JSON.stringify({ v: 2, playlists: lib.map((p) => ({ id: p.id, name: p.name, art: p.art, tracks: p.tracks.map(packTrack) })) });

/** Relit la bibliothèque enregistrée ; renvoie un tableau vide si le texte est illisible. */
export function deserialize(text) {
  try {
    const data = JSON.parse(text);
    if (!data || data.v !== 2 || !Array.isArray(data.playlists)) return [];
    return data.playlists.map((p) => ({
      id: String(p.id || newId()),
      name: String(p.name || 'Playlist').slice(0, 60),
      art: typeof p.art === 'string' ? p.art : '',
      tracks: (p.tracks || []).map((t) => core.makeTrack({ ...t, source: p.name })).filter((t) => t.title),
    }));
  } catch {
    return [];
  }
}

// --------------------------------------------------------------------------- //
// DJ : versions d'un titre et idées d'enchaînement
// --------------------------------------------------------------------------- //
const BPM_TOLERANCE = 0.06;

/**
 * Autour d'un titre : ses autres versions (original, remix, edit…) dans toute la bibliothèque, puis des titres
 * de la même playlist au même style, et au tempo proche quand les deux tempos sont connus.
 * Rien n'est inventé : SoundCloud ne fournit pas toujours le tempo, et la tonalité n'est pas disponible.
 */
export function relatedTracks(lib, pl, track, limit = 8) {
  const where = new Map();
  const all = [];
  for (const p of lib) {
    for (const t of p.tracks) {
      all.push({ ...t, tags: [...(t.tags || [])] });
      where.set(t.id, { track: t, playlist: p });
    }
  }
  const families = core.annotateVersions(all);
  const fam = families.find((f) => f.members.some((m) => m.id === track.id));
  const famIds = new Set(fam ? fam.members.map((m) => m.id) : [track.id]);

  const seen = new Set([track.sig]);
  const versions = [];
  if (fam) {
    const members = [...fam.members].sort((a, b) => (a.versionLabel === 'Original' ? -1 : 0) - (b.versionLabel === 'Original' ? -1 : 0));
    for (const m of members) {
      if (m.id === track.id || seen.has(m.sig)) continue; // même titre sous un autre exemplaire : un doublon, pas une version
      seen.add(m.sig);
      versions.push({ ...where.get(m.id), label: m.versionLabel });
    }
  }

  const style = core.detectStyle(track);
  const similar = [];
  if (style) {
    for (const t of pl.tracks) {
      if (famIds.has(t.id) || t.sig === track.sig || core.detectStyle(t) !== style) continue;
      let gap = 0;
      if (track.bpm && t.bpm) {
        gap = Math.abs(t.bpm - track.bpm) / track.bpm;
        if (gap > BPM_TOLERANCE) continue;
      }
      similar.push({ track: t, playlist: pl, gap, tempo: Boolean(track.bpm && t.bpm) });
    }
    // d'abord ceux dont le tempo est connu et proche, puis les autres dans l'ordre de la playlist
    similar.sort((a, b) => (a.tempo === b.tempo ? a.gap - b.gap : a.tempo ? -1 : 1));
  }
  return { versions, similar: similar.slice(0, limit), style, tempoKnown: Boolean(track.bpm) };
}
