// Synchronisation des playlists entre appareils : compte Google + Firestore.
// Ce module ne connaît ni la page ni Firebase : il reçoit un `backend` (voir firebase.js) et des fonctions de lecture
// et d'écriture de la bibliothèque, ce qui permet de le tester sans réseau.
//
// Principe : une playlist = un document (nom, pochette, mode set, heure de modification) + des morceaux de texte
// (ses titres, découpés pour rester sous la limite de 1 Mo par document). Chaque appareil retient, pour chaque playlist,
// ce qu'il a vu en dernier ; il en déduit ce qui a changé ici (à envoyer), ce qui a changé ailleurs (à reprendre)
// et ce qui a été supprimé.

const CHUNK = 250_000; // caractères par morceau

export const chunkText = (text) => {
  const out = [];
  for (let i = 0; i < text.length; i += CHUNK) out.push(text.slice(i, i + CHUNK));
  return out.length ? out : [''];
};

/** Empreinte rapide (FNV-1a) : sert seulement à savoir si une playlist a changé. */
export function hashOf(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${h.toString(16)}-${text.length}`;
}

/** Message lisible pour une erreur Firebase. */
export function explain(e) {
  const code = String((e && e.code) || '');
  if (code.includes('permission-denied')) return "Firestore refuse l'accès : les règles de la base ne sont pas celles de l'app. Colle les règles indiquées dans la console Firebase, onglet Règles.";
  if (code.includes('unauthorized-domain')) return "Google refuse la connexion depuis cette adresse : ajoute-la dans Firebase, Authentication, Paramètres, Domaines autorisés.";
  if (code.includes('popup-closed') || code.includes('cancelled-popup')) return 'Connexion annulée.';
  if (code.includes('popup-blocked')) return 'Le navigateur a bloqué la fenêtre de connexion : autorise les fenêtres pour ce site, puis réessaie.';
  if (code.includes('operation-not-allowed')) return "La connexion Google n'est pas activée dans Firebase (Authentication, Méthode de connexion).";
  if (code.includes('network') || code.includes('unavailable')) return 'Pas de connexion pour le moment : tes changements seront envoyés au retour du réseau.';
  if (code.includes('not-found') && code.includes('firestore')) return "La base Firestore n'existe pas encore : crée-la dans la console Firebase.";
  return (e && e.message) || 'Synchronisation impossible.';
}

export function createCloud({ backend, getLib, setLib, pack, unpack, loadKnown, saveKnown, onStatus = () => {}, onMeta = () => {}, now = () => Date.now(), delay = 1200, deviceId = Math.random().toString(36).slice(2, 10) }) {
  const status = { user: null, busy: false, error: '', last: 0 };
  let uid = null;
  let known = {}; // id -> { hash, updated, parts }
  let remote = new Map();
  let unsubs = [];
  let queue = Promise.resolve();
  let timer;
  let started = false;

  const emit = () => onStatus({ ...status });
  const enqueue = (fn) => {
    queue = queue.then(fn).catch((e) => {
      status.error = explain(e);
      status.busy = false;
      emit();
    });
    return queue;
  };
  const persist = () => saveKnown(uid, known);

  async function push() {
    const lib = getLib();
    for (const pl of lib) {
      const text = pack(pl);
      const h = hashOf(text);
      if (known[pl.id] && known[pl.id].hash === h) continue;
      const parts = chunkText(text);
      const prev = known[pl.id];
      const updated = Math.max(now(), (remote.get(pl.id)?.updated || 0) + 1, (prev?.updated || 0) + 1);
      await backend.writePlaylist(uid, { id: pl.id, name: pl.name, art: pl.art || '', dj: Boolean(pl.dj), updated, by: deviceId, parts: parts.length }, parts, prev?.parts || 0);
      known[pl.id] = { hash: h, updated, by: deviceId, parts: parts.length };
      persist();
    }
    const ids = new Set(lib.map((p) => p.id));
    for (const id of Object.keys(known)) {
      if (ids.has(id)) continue;
      await backend.deletePlaylist(uid, id, known[id].parts || 1);
      delete known[id];
      persist();
    }
  }

  async function reconcile(list, fromCache = false) {
    remote = new Map(list.map((d) => [d.id, d]));
    let lib = [...getLib()];
    let changed = false;
    for (const d of list) {
      const idx = lib.findIndex((p) => p.id === d.id);
      const k = known[d.id];
      if (idx < 0) {
        if (k) continue; // supprimée ici : la suppression part avec le prochain envoi
        const pl = unpack(await backend.readParts(uid, d.id, d.parts || 1));
        if (!pl) continue;
        lib.push(pl);
        known[d.id] = { hash: hashOf(pack(pl)), updated: d.updated, by: d.by, parts: d.parts || 1 };
        changed = true;
        continue;
      }
      if (k && d.updated === k.updated && d.by === k.by) continue; // c'est la version qu'on connaît déjà
      if (k && hashOf(pack(lib[idx])) !== k.hash) continue; // modifiée ici aussi : la version d'ici gagne et sera envoyée
      const pl = unpack(await backend.readParts(uid, d.id, d.parts || 1));
      if (!pl) continue;
      lib[idx] = pl;
      known[d.id] = { hash: hashOf(pack(pl)), updated: d.updated, by: d.by, parts: d.parts || 1 };
      changed = true;
    }
    if (!fromCache) {
      // supprimées ailleurs
      for (const [id, k] of Object.entries(known)) {
        if (remote.has(id)) continue;
        const idx = lib.findIndex((p) => p.id === id);
        if (idx >= 0 && hashOf(pack(lib[idx])) === k.hash) {
          lib.splice(idx, 1);
          changed = true;
        }
        delete known[id]; // si elle a été modifiée ici entre-temps, elle repart au prochain envoi
      }
    }
    persist();
    if (changed) setLib(lib);
    await push();
    status.last = now();
    status.error = '';
  }

  async function attach(user) {
    unsubs.forEach((u) => u());
    unsubs = [];
    status.user = user;
    status.error = '';
    uid = user ? user.uid : null;
    known = user ? loadKnown(user.uid) || {} : {};
    remote = new Map();
    emit();
    if (!user) return;
    status.busy = true;
    emit();
    try {
      onMeta(await backend.getUserMeta(uid));
    } catch (e) {
      status.error = explain(e);
    }
    unsubs.push(
      await backend.watchPlaylists(
        uid,
        (list, fromCache) => {
          status.busy = true;
          emit();
          enqueue(async () => {
            await reconcile(list, fromCache);
            status.busy = false;
            emit();
          });
        },
        (e) => {
          status.error = explain(e);
          status.busy = false;
          emit();
        },
      ),
    );
  }

  return {
    status: () => ({ ...status }),
    /** Résolu quand tout ce qui était en cours est terminé (pour les tests). */
    idle: () => queue,
    /** Démarre l'écoute de la connexion ; à appeler une fois. */
    async start() {
      if (started) return;
      started = true;
      const off = await backend.onUser((user, err) => {
        if (err) {
          status.error = explain(err);
          emit();
        }
        enqueue(() => attach(user));
      });
      unsubs.push(() => off && off());
    },
    async signIn() {
      status.error = '';
      try {
        await backend.signIn();
      } catch (e) {
        status.error = explain(e);
        emit();
      }
    },
    async signOut() {
      await backend.signOut();
    },
    /** La bibliothèque a changé ici : envoi dans un instant. */
    localChanged() {
      if (!uid) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        status.busy = true;
        emit();
        enqueue(async () => {
          await push();
          status.last = now();
          status.error = '';
          status.busy = false;
          emit();
        });
      }, delay);
    },
    /** Envoie ce qui a changé ici tout de suite. */
    async flush() {
      clearTimeout(timer);
      if (!uid) return;
      await enqueue(async () => {
        await push();
        status.last = now();
        status.error = '';
        status.busy = false;
        emit();
      });
    },
    setMeta(obj) {
      if (uid) backend.setUserMeta(uid, obj).catch((e) => {
        status.error = explain(e);
        emit();
      });
    },
  };
}
