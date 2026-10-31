// Recherche automatique de la tonalité et du tempo d'un titre dans la base GetSongBPM (clé gratuite, https://getsongbpm.com/api).
// La base décrit le morceau tel que publié : on ne l'applique pas aux remixes, dont la tonalité peut différer.
// `fetchFn` est passé en argument pour tester sans réseau.

import { normalize, parseKey, parseVersion, kindOf, tokenSortRatio } from './core.js';

const BASE = 'https://api.getsongbpm.com';

export class KeyLookupError extends Error {
  constructor(message, fatal = false) {
    super(message);
    this.fatal = fatal; // fatal : inutile de continuer (clé refusée, limite atteinte, service injoignable)
  }
}

async function call(fetchFn, apiKey, path, params) {
  const url = `${BASE}${path}?${new URLSearchParams({ api_key: apiKey, ...params })}`;
  let res;
  try {
    res = await fetchFn(url);
  } catch {
    throw new KeyLookupError("Impossible de joindre GetSongBPM depuis ce navigateur (connexion coupée ou appel bloqué par le service).", true);
  }
  if (res.status === 401 || res.status === 403) throw new KeyLookupError('GetSongBPM refuse cette clé. Vérifie qu\'elle est copiée en entier.', true);
  if (res.status === 429) throw new KeyLookupError('GetSongBPM limite le nombre de demandes. Réessaie dans une heure.', true);
  if (!res.ok) throw new KeyLookupError(`GetSongBPM a répondu une erreur (${res.status}).`);
  try {
    return await res.json();
  } catch {
    throw new KeyLookupError('Réponse illisible de GetSongBPM.');
  }
}

const listOf = (json, field) => (Array.isArray(json) ? json : Array.isArray(json?.[field]) ? json[field] : []);

/** Un remix, un edit ou un bootleg n'a pas forcément la tonalité de l'original. */
export function isAltVersion(title) {
  const { marker } = parseVersion(title || '');
  const kind = kindOf(marker);
  return kind === 'remix' || kind === 'bootleg' || /\b(?:vip|edit|rework|flip)\b/i.test(marker);
}

/** Titre à chercher : sans « (Original Mix) », « [Free Download] » et autres mentions qui n'existent pas dans la base. */
export function searchTitle(title) {
  const clean = String(title || '')
    .replace(/[(\[][^)\]]*\b(?:original(?: mix)?|radio edit|extended(?: mix| version)?|free ?dl|free download|out now|premiere|official[^)\]]*)\b[^)\]]*[)\]]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return parseVersion(clean).base || clean || String(title || '');
}

/** Meilleure correspondance parmi les résultats : même titre et même artiste, sinon rien. */
export function bestMatch(results, track) {
  const nTitle = normalize(parseVersion(track.title).base || track.title);
  const nArtist = normalize(track.artist);
  let best = null;
  let bestScore = 0;
  for (const r of results) {
    const rTitle = normalize(parseVersion(String(r?.title || '')).base);
    if (!rTitle) continue;
    const titleScore = tokenSortRatio(nTitle, rTitle);
    if (titleScore < 88) continue;
    const rArtist = normalize(typeof r.artist === 'string' ? r.artist : r.artist?.name || '');
    const artistScore = nArtist && rArtist ? Math.max(tokenSortRatio(nArtist, rArtist), nArtist.includes(rArtist) || rArtist.includes(nArtist) ? 90 : 0) : 0;
    if (nArtist && rArtist && artistScore < 80) continue;
    const score = titleScore + artistScore / 4; // l'artiste départage, le titre décide
    if (score > bestScore) {
      best = r;
      bestScore = score;
    }
  }
  return best;
}

/** Tonalité (code Camelot) et tempo lus dans une fiche de la base. */
export function readSong(song) {
  if (!song) return { key: null, bpm: null };
  const key = parseKey(song.camelot) || parseKey(song.key_of) || null;
  const t = parseFloat(String(song.tempo ?? '').replace(',', '.'));
  return { key, bpm: t >= 40 && t <= 250 ? t : null };
}

/**
 * Cherche un titre. Renvoie { key, bpm, status } avec status 'found' | 'none' | 'skipped'.
 * Une fiche peut manquer de tonalité dans les résultats de recherche : on ouvre alors la fiche détaillée.
 */
export async function lookupTrack(fetchFn, apiKey, track) {
  if (isAltVersion(track.title)) return { key: null, bpm: null, status: 'skipped' };
  const lookup = searchTitle(track.title);
  const found = bestMatch(listOf(await call(fetchFn, apiKey, '/search/', { type: 'song', lookup }), 'search'), track);
  if (!found) return { key: null, bpm: null, status: 'none' };
  let info = readSong(found);
  if (!info.key && found.id) {
    const detail = await call(fetchFn, apiKey, '/song/', { id: found.id });
    const song = Array.isArray(detail) ? detail[0] : detail?.song || detail;
    info = readSong(song);
  }
  return info.key || info.bpm ? { ...info, status: 'found' } : { key: null, bpm: null, status: 'none' };
}
