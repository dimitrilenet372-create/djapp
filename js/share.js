// Partage d'une playlist par lien : la playlist est compressée dans l'adresse (après le #), rien n'est envoyé à un serveur.
// Celui qui ouvre le lien reçoit une copie dans sa propre page. Les titres gardent leur adresse SoundCloud, leur tonalité et leur tempo.

const toB64 = (bytes) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const fromB64 = (text) => {
  const s = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
};

async function pipe(bytes, stream) {
  const input = new ReadableStream({ start(c) { c.enqueue(bytes); c.close(); } });
  return new Uint8Array(await new Response(input.pipeThrough(stream)).arrayBuffer());
}

const MAX_TRACKS = 500;

/** Contenu minimal d'une playlist, sans identifiants ni état local. */
export function sharePack(pl) {
  return {
    v: 1,
    n: pl.name,
    a: pl.art || '',
    d: pl.dj ? 1 : 0,
    t: pl.tracks.slice(0, MAX_TRACKS).map((t) => [
      t.title, t.artist || '', t.url || '', t.art || '', t.duration || 0, t.genre || '',
      t.key || '', t.bpm || 0, (t.tags || []).slice(0, 3),
    ]),
  };
}

/** Texte du lien (sans l'adresse de la page) : `z.` si compressé, `r.` sinon. */
export async function encodeShare(pl) {
  const bytes = new TextEncoder().encode(JSON.stringify(sharePack(pl)));
  if (typeof CompressionStream === 'function') return 'z.' + toB64(await pipe(bytes, new CompressionStream('deflate-raw')));
  return 'r.' + toB64(bytes);
}

/** Relit un lien de partage ; renvoie null si le texte n'est pas valide. */
export async function decodeShare(payload) {
  try {
    const m = /^([zr])\.([\w-]+)$/.exec(String(payload || '').trim());
    if (!m) return null;
    let bytes = fromB64(m[2]);
    if (m[1] === 'z') bytes = await pipe(bytes, new DecompressionStream('deflate-raw'));
    const data = JSON.parse(new TextDecoder().decode(bytes));
    if (!data || data.v !== 1 || !Array.isArray(data.t)) return null;
    const tracks = data.t
      .slice(0, MAX_TRACKS)
      .map(([title, artist, url, art, duration, genre, key, bpm, tags]) => ({
        title: String(title || ''), artist: String(artist || ''), url: String(url || ''), art: String(art || ''),
        duration: Number(duration) || null, genre: String(genre || ''), key: String(key || ''), bpm: Number(bpm) || null,
        tags: Array.isArray(tags) ? tags.map(String) : [],
      }))
      .filter((t) => t.title);
    if (!tracks.length) return null;
    return { name: String(data.n || 'Playlist partagée').slice(0, 60), art: typeof data.a === 'string' ? data.a : '', dj: data.d === 1, tracks };
  } catch {
    return null;
  }
}

/** Extrait le texte de partage d'une adresse ou d'un `#share=…`, ou null. */
export const shareFromHash = (hash) => {
  const m = /[#&]share=([zr]\.[\w-]+)/.exec(String(hash || ''));
  return m ? m[1] : null;
};
