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
  genre: t.genre, tags: t.tags, duration: t.duration, bpm: t.bpm, key: t.key, keyAuto: t.keyAuto, dl: t.dl, buy: t.buy,
});

export const serialize = (lib) => JSON.stringify({ v: 2, playlists: lib.map((p) => ({ id: p.id, name: p.name, art: p.art, dj: Boolean(p.dj), tracks: p.tracks.map(packTrack) })) });

/** Relit la bibliothèque enregistrée ; renvoie un tableau vide si le texte est illisible. */
export function deserialize(text) {
  try {
    const data = JSON.parse(text);
    if (!data || data.v !== 2 || !Array.isArray(data.playlists)) return [];
    return data.playlists.map((p) => ({
      id: String(p.id || newId()),
      name: String(p.name || 'Playlist').slice(0, 60),
      art: typeof p.art === 'string' ? p.art : '',
      dj: p.dj === true,
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

// --------------------------------------------------------------------------- //
// DJ : mettre des titres dans un ordre qui s'enchaîne
// --------------------------------------------------------------------------- //
// Voisinage des styles : deux styles voisins se mixent sans choc (coût 1), les autres sont un vrai changement (coût 3).
const NEIGHBOURS = [
  ['House', 'Techno'], ['House', 'Électro & EDM'], ['House', 'Afro & Latin'], ['House', 'Jazz, Funk & Disco'],
  ['Techno', 'Trance'], ['Techno', 'Hardstyle & Hard dance'], ['Trance', 'Électro & EDM'], ['Trance', 'Hardstyle & Hard dance'],
  ['Électro & EDM', 'Dubstep & Bass'], ['Électro & EDM', 'Pop & Indie'], ['Drum & Bass', 'Dubstep & Bass'],
  ['Hip-hop & Rap', 'R&B & Soul'], ['Hip-hop & Rap', 'Dubstep & Bass'], ['Hip-hop & Rap', 'Reggae & Dancehall'],
  ['R&B & Soul', 'Lo-fi & Chill'], ['R&B & Soul', 'Pop & Indie'], ['R&B & Soul', 'Jazz, Funk & Disco'],
  ['Lo-fi & Chill', 'Jazz, Funk & Disco'], ['Pop & Indie', 'Rock & Metal'], ['Pop & Indie', 'Folk & Country'],
  ['Folk & Country', 'Rock & Metal'], ['Reggae & Dancehall', 'Afro & Latin'], ['Jazz, Funk & Disco', 'Classique & Ciné'],
];
const NEAR = new Set(NEIGHBOURS.flatMap(([a, b]) => [`${a}|${b}`, `${b}|${a}`]));

/** Distance entre deux styles : 0 identique, 1 voisin, 1.5 inconnu, 3 éloigné. */
export function styleDistance(a, b) {
  if (!a || !b) return 1.5;
  if (a === b) return 0;
  return NEAR.has(`${a}|${b}`) ? 1 : 3;
}

const copyForSet = (t) => ({ ...t, tags: [...(t.tags || [])] });

/** Style et famille de chaque titre ; une version sans style prend celui de sa famille. */
function prepareSet(tracks) {
  const copies = tracks.map(copyForSet);
  const families = core.annotateVersions(copies);
  const style = new Map(copies.map((t) => [t.id, core.detectStyle(t)]));
  const fam = new Map();
  for (const f of families) {
    const counts = new Map();
    for (const m of f.members) {
      fam.set(m.id, f.id);
      const st = style.get(m.id);
      if (st) counts.set(st, (counts.get(st) || 0) + 1);
    }
    if (counts.size) {
      const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
      for (const m of f.members) if (!style.get(m.id)) style.set(m.id, best);
    }
  }
  return { style, fam };
}

/**
 * Deux tonalités (codes Camelot) se mixent-elles ? Même case, case voisine de même lettre (±1) et relatif (même numéro,
 * autre lettre) vont ensemble ; ±2 ou la diagonale demandent un peu de métier ; le reste sonne faux.
 * Renvoie null si l'une des deux est inconnue.
 */
export function keyLink(ka, kb) {
  const pa = /^(\d+)([AB])$/.exec(ka || '');
  const pb = /^(\d+)([AB])$/.exec(kb || '');
  if (!pa || !pb) return null;
  const na = Number(pa[1]);
  const nb = Number(pb[1]);
  const step = Math.min((na - nb + 12) % 12, (nb - na + 12) % 12);
  const same = pa[2] === pb[2];
  const arrow = `${ka} → ${kb}`;
  if (ka === kb) return { cost: 0, label: `même tonalité (${ka})` };
  if (same && step === 1) return { cost: 0, label: `tonalités voisines (${arrow})` };
  if (!same && step === 0) return { cost: 0.25, label: `tonalités relatives (${arrow})` };
  if ((same && step === 2) || (!same && step === 1)) return { cost: 0.75, label: `tonalité à surveiller (${arrow})` };
  return { cost: 2.5, label: `tonalités qui s'opposent (${arrow})` };
}

/** Coût et description d'un enchaînement a → b (plus c'est bas, mieux ça se mixe). */
function link(ctx, a, b) {
  const parts = [];
  const tips = []; // [priorité, conseil] : les problèmes d'abord
  let cost = 0;
  const sameFamily = ctx.fam.has(a.id) && ctx.fam.get(a.id) === ctx.fam.get(b.id);
  if (sameFamily) {
    cost -= 1; // les versions d'un même titre se placent côte à côte
    parts.push('versions du même titre');
    tips.push([1, 'Même morceau en deux versions : passe de l\'une à l\'autre sur un break, ça passe inaperçu.']);
  } else {
    const sa = ctx.style.get(a.id);
    const sb = ctx.style.get(b.id);
    const d = styleDistance(sa, sb);
    cost += d;
    parts.push(d === 0 ? `même style (${sa})` : d === 1 ? `style voisin (${sa} → ${sb})` : d === 1.5 ? 'style inconnu' : `changement de style (${sa} → ${sb})`);
    if (a.nArtist && a.nArtist === b.nArtist) {
      cost += 0.5; // varier les artistes
      tips.push([6, 'Même artiste que le titre d\'avant : intercale un autre univers pour varier.']);
    }
    if (d >= 3) tips.push([2, 'Le style change : fais-le sur un break, avec un filtre ou une coupe nette, pas en long fondu.']);
    else if (d === 1) tips.push([5, 'Styles voisins : un fondu d\'une trentaine de secondes suffit.']);
    else if (d === 0) tips.push([7, 'Même style : un fondu long (16 à 32 temps) fonctionne bien.']);
  }
  if (a.bpm && b.bpm) {
    const gap = Math.abs(a.bpm - b.bpm) / Math.max(a.bpm, b.bpm);
    const half = Math.abs(a.bpm * 2 - b.bpm) / Math.max(a.bpm * 2, b.bpm);
    const half2 = Math.abs(b.bpm * 2 - a.bpm) / Math.max(b.bpm * 2, a.bpm);
    const rounded = `${Math.round(a.bpm)} → ${Math.round(b.bpm)} BPM`;
    const pct = (Math.round(gap * 1000) / 10).toString().replace('.', ',');
    if (gap <= 0.03) {
      parts.push(`tempo proche (${rounded})`);
      tips.push([4, 'Tempos proches : cale-les (sync) et profite d\'un long fondu.']);
    } else if (gap <= BPM_TOLERANCE) {
      cost += 0.5;
      parts.push(`tempo à ajuster (${rounded})`);
      tips.push([3, `Ajuste le pitch d'environ ${pct} % avant de lancer le titre suivant.`]);
    } else if (Math.min(half, half2) <= 0.03) {
      cost += 1;
      parts.push(`tempo moitié/double (${rounded})`);
      tips.push([3, 'Un titre va deux fois plus vite que l\'autre : enchaîne en double-temps, la batterie se cale d\'un coup sur deux.']);
    } else {
      cost += 2.5;
      parts.push(`écart de tempo (${rounded})`);
      tips.push([1, 'Écart trop grand pour caler les deux : coupe franc, passe par un break ou un effet, ou accélère par paliers.']);
    }
  }
  const k = keyLink(a.key, b.key);
  if (k) {
    cost += k.cost;
    parts.push(k.label);
    if (k.cost >= 2.5) tips.push([1, 'Les tonalités s\'opposent : évite de superposer les deux longtemps. Coupe les médiums à l\'EQ ou passe par un break.']);
    else if (k.cost >= 0.75) tips.push([3, 'Tonalité à surveiller : fondu court, ou baisse les basses du titre entrant le temps du mélange.']);
    else tips.push([4, 'Tonalités compatibles : tu peux laisser jouer les deux ensemble assez longtemps.']);
  }
  if (a.duration >= 420) tips.push([5, 'Titre long : tu as le temps, laisse-le vivre avant de lancer le suivant.']);
  else if (a.duration && a.duration <= 150) tips.push([5, 'Titre court : prépare le suivant dès le début.']);
  tips.sort((x, y) => x[0] - y[0]);
  return {
    cost,
    tone: cost <= 1 ? 'good' : cost <= 2 ? 'ok' : 'weak',
    label: parts.join(' · '),
    tip: tips.slice(0, 2).map((x) => x[1]),
  };
}

/** Pour chaque paire de titres voisins dans la liste : { tone: 'good' | 'ok' | 'weak', label, tip: [conseils] }. */
export function transitionsOf(tracks) {
  const ctx = prepareSet(tracks);
  const out = [];
  for (let i = 0; i + 1 < tracks.length; i++) {
    const { tone, label, tip } = link(ctx, tracks[i], tracks[i + 1]);
    out.push({ tone, label, tip });
  }
  return out;
}

/**
 * Vue d'ensemble d'un set : durée, courbe de tempo, tonalités connues, passages à préparer et conseils généraux.
 * Elle ne s'appuie que sur ce que l'app sait de chaque titre ; le moment exact des drops n'est pas connu.
 */
export function setAdvice(tracks) {
  const trans = transitionsOf(tracks);
  const bpms = tracks.map((t) => t.bpm).filter(Boolean);
  const keys = tracks.filter((t) => t.key).length;
  const weak = trans
    .map((x, i) => ({ ...x, from: tracks[i], to: tracks[i + 1] }))
    .filter((x) => x.tone === 'weak');
  const out = {
    count: tracks.length,
    seconds: totalSeconds(tracks),
    bpmKnown: bpms.length,
    bpmMin: bpms.length ? Math.min(...bpms) : null,
    bpmMax: bpms.length ? Math.max(...bpms) : null,
    keysKnown: keys,
    weak,
    good: trans.filter((x) => x.tone === 'good').length,
    tips: [],
  };
  if (tracks.length < 2) return out;
  if (bpms.length >= Math.ceil(tracks.length / 2) && bpms.length >= 3) {
    const first = bpms[0];
    const last = bpms[bpms.length - 1];
    const span = out.bpmMax - out.bpmMin;
    if (last - first >= 4 && span <= 25) out.tips.push(`Le tempo monte de ${Math.round(first)} à ${Math.round(last)} BPM : bonne courbe pour faire monter la salle.`);
    else if (first - last >= 4 && span <= 25) out.tips.push(`Le tempo descend de ${Math.round(first)} à ${Math.round(last)} BPM : un set pour finir en douceur.`);
    else if (span > 25) out.tips.push(`Le tempo va de ${Math.round(out.bpmMin)} à ${Math.round(out.bpmMax)} BPM : prévois des paliers pour ne pas brusquer la danse.`);
    else out.tips.push('Le tempo reste stable : tu peux t\'appuyer sur les fondus longs.');
  }
  if (keys < tracks.length) {
    out.tips.push(keys ? `Il manque la tonalité de ${tracks.length - keys} titre${tracks.length - keys > 1 ? 's' : ''} : les conseils de tonalité ne couvrent que les autres.` : 'Aucune tonalité connue : renseigne-les (ou « Trouver les tonalités ») pour des conseils sur les mélanges harmoniques.');
  }
  if (!bpms.length) out.tips.push('Aucun tempo connu : sans BPM, impossible de dire quels titres se calent bien.');
  if (weak.length) out.tips.push(`${weak.length} passage${weak.length > 1 ? 's' : ''} à préparer : prévois un break, un effet ou une coupe franche à ces endroits.`);
  else if (tracks.length >= 3) out.tips.push('Aucun saut difficile : concentre-toi sur le moment du fondu plutôt que sur le choix des titres.');
  out.tips.push('Le moment exact des drops et des breaks n\'est pas connu de l\'app, qui ne peut pas écouter SoundCloud. Pose-les toi-même en cue points dans Serato en écoutant chaque titre une fois.');
  return out;
}

/**
 * Ordonne des titres pour les mixer : on part du premier (ou de `startId`) puis, à chaque fois, on prend le titre
 * qui s'enchaîne le mieux (style, tempo quand il est connu, versions côte à côte). Les titres sans aucun voisin de style
 * dans la sélection sont mis de côté (`aside`) quand `keepAll` est faux.
 * Le tempo et la tonalité (roue Camelot) ne comptent que s'ils sont connus des deux côtés.
 */
export function buildSet(tracks, { startId = null, keepAll = false } = {}) {
  const ctx = prepareSet(tracks);
  let pool = [...tracks];
  const aside = [];
  if (!keepAll && pool.length > 2) {
    const styles = pool.map((t) => ctx.style.get(t.id));
    const keep = [];
    pool.forEach((t, i) => {
      const st = styles[i];
      const hasFriend = pool.some((o, j) => j !== i && ((styles[j] && styleDistance(st, styles[j]) <= 1) || (ctx.fam.has(t.id) && ctx.fam.get(t.id) === ctx.fam.get(o.id))));
      (hasFriend || !st ? keep : aside).push(t);
    });
    // si presque tout est « isolé », on ne met rien de côté : la sélection n'a pas de style dominant
    if (keep.length >= 2) pool = keep;
    else aside.length = 0;
  }
  const first = pool.findIndex((t) => t.id === startId);
  const ordered = [pool.splice(first >= 0 ? first : 0, 1)[0]].filter(Boolean);
  while (pool.length) {
    const last = ordered[ordered.length - 1];
    let best = 0;
    let bestCost = Infinity;
    for (let i = 0; i < pool.length; i++) {
      const c = link(ctx, last, pool[i]).cost;
      if (c < bestCost) {
        bestCost = c;
        best = i;
      }
    }
    ordered.push(pool.splice(best, 1)[0]);
  }
  const trans = transitionsOf(ordered);
  return { ordered, aside, weak: trans.filter((t) => t.tone === 'weak').length };
}

/** Réunit des playlists sans doublons puis les met en ordre pour le DJ. */
export function buildSetFrom(pls, name, opts = {}) {
  const m = mergePlaylists(pls, name, opts.threshold || 90);
  const set = buildSet(m.playlist.tracks, opts);
  const playlist = { ...m.playlist, tracks: set.ordered, dj: true };
  const asidePl = set.aside.length ? newPlaylist(`À part · ${name.replace(/^Set · /, '')}`.slice(0, 60), set.aside) : null;
  return { playlist, aside: asidePl, removed: m.removed, total: m.total, weak: set.weak };
}
