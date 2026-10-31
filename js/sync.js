// Synchronisation de la bibliothèque entre appareils, via un Gist GitHub privé du compte de la personne.
// Rien de spécifique à la page ici : on passe `fetch` en argument pour pouvoir tester sans réseau.

const API = 'https://api.github.com';
const FILE = 'lebac.json';

const b64 = (text) => {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const unb64 = (s) => {
  const bin = atob(String(s).replace(/-/g, '+').replace(/_/g, '/'));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
};

/** Lien à ouvrir sur un autre appareil : la clé et l'identifiant du Gist, dans la partie # (jamais envoyée à un serveur). */
export const syncLink = (base, cfg) => `${base}#sync=${b64(JSON.stringify({ t: cfg.t, g: cfg.g }))}`;

/** Relit un lien de synchronisation ; renvoie null si ce n'en est pas un. */
export function decodeSyncLink(hash) {
  const m = /^#?sync=([A-Za-z0-9_-]+)$/.exec(String(hash || ''));
  if (!m) return null;
  try {
    const { t, g } = JSON.parse(unb64(m[1]));
    return /^[\w-]{10,}$/.test(t || '') && /^[0-9a-f]{8,}$/i.test(g || '') ? { t, g } : null;
  } catch {
    return null;
  }
}

/** Erreur lisible : le message dit quoi faire. */
export class SyncError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.status = status;
  }
}

function explain(status) {
  if (status === 401) return 'GitHub refuse cette clé. Vérifie qu\'elle est bien copiée en entier et qu\'elle n\'a pas expiré.';
  if (status === 403) return 'GitHub refuse l\'accès (clé sans droit « gist » ou trop de requêtes). Réessaie dans quelques minutes.';
  if (status === 404) return 'Le Gist de synchronisation est introuvable (supprimé, ou clé d\'un autre compte).';
  return `GitHub a répondu une erreur (${status}).`;
}

/** Accès au Gist : create / read / write. `doc` est le texte JSON de la bibliothèque. */
export function gistStore(token, fetchFn = (...a) => fetch(...a)) {
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
  };
  async function call(path, init) {
    let res;
    try {
      res = await fetchFn(`${API}${path}`, { ...init, headers });
    } catch {
      throw new SyncError('Pas de connexion à GitHub pour le moment.');
    }
    if (!res.ok) throw new SyncError(explain(res.status), res.status);
    return res.json();
  }
  return {
    async create(doc) {
      const g = await call('/gists', {
        method: 'POST',
        body: JSON.stringify({ description: 'Le bac : bibliothèque de playlists', public: false, files: { [FILE]: { content: doc } } }),
      });
      return g.id;
    },
    async read(id) {
      const g = await call(`/gists/${id}`);
      const f = g.files && g.files[FILE];
      if (!f) return null;
      if (f.truncated && f.raw_url) {
        let res;
        try {
          res = await fetchFn(f.raw_url, { headers: { Authorization: headers.Authorization } });
        } catch {
          throw new SyncError('Pas de connexion à GitHub pour le moment.');
        }
        if (!res.ok) throw new SyncError(explain(res.status), res.status);
        return res.text();
      }
      return f.content ?? null;
    },
    async write(id, doc) {
      await call(`/gists/${id}`, { method: 'PATCH', body: JSON.stringify({ files: { [FILE]: { content: doc } } }) });
    },
  };
}

/** Texte à stocker : la bibliothèque sérialisée + l'heure de la dernière modification. */
export const withStamp = (libText, updated, extra = {}) => JSON.stringify({ ...JSON.parse(libText), updated, ...extra });

/** Clé GetSongBPM rangée dans le document, pour que le téléphone n'ait rien à saisir (chaîne vide si absente). */
export function gsbOf(doc) {
  try {
    const g = JSON.parse(doc).gsb;
    return typeof g === 'string' && /^[\w-]{8,}$/.test(g) ? g : '';
  } catch {
    return '';
  }
}

/** Heure de modification d'un document distant (0 si absente ou illisible). */
export function stampOf(doc) {
  try {
    const n = Number(JSON.parse(doc).updated);
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

/** Réunit deux bibliothèques : tout ce qui est local reste, les playlists distantes inconnues s'ajoutent. */
export function mergeLibs(local, remote) {
  const ids = new Set(local.map((p) => p.id));
  return [...local, ...remote.filter((p) => !ids.has(p.id))];
}
