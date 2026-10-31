// Accès réel à Firebase (connexion Google + Firestore). Les bibliothèques sont chargées à la demande depuis le CDN
// de Google, donc rien à installer. La configuration d'une app web Firebase n'est pas secrète : ce sont les règles
// Firestore (un utilisateur ne lit et n'écrit que ses propres données) qui protègent les données.

const VERSION = '10.14.1';
const CDN = `https://www.gstatic.com/firebasejs/${VERSION}/`;

export const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyBqIW1okhyHW_X9FOjuLj2Th5xct7TjmyE',
  authDomain: 'simpleplaylist-a386b.firebaseapp.com',
  projectId: 'simpleplaylist-a386b',
  storageBucket: 'simpleplaylist-a386b.firebasestorage.app',
  messagingSenderId: '1056947552517',
  appId: '1:1056947552517:web:bcd62921cffc7e8a66f76c',
};

export function firebaseBackend(config = FIREBASE_CONFIG) {
  let loading;
  const sdk = () =>
    (loading ??= (async () => {
      const [appMod, auth, fs] = await Promise.all([import(`${CDN}firebase-app.js`), import(`${CDN}firebase-auth.js`), import(`${CDN}firebase-firestore.js`)]);
      const app = appMod.initializeApp(config);
      return { auth, fs, au: auth.getAuth(app), db: fs.getFirestore(app) };
    })());

  const partId = (id, i) => `${id}-${i}`;

  return {
    async onUser(cb) {
      const s = await sdk();
      return s.auth.onAuthStateChanged(
        s.au,
        (u) => cb(u ? { uid: u.uid, name: u.displayName || '', email: u.email || '' } : null),
        (err) => cb(null, err),
      );
    },
    async signIn() {
      const s = await sdk();
      const provider = new s.auth.GoogleAuthProvider();
      try {
        await s.auth.signInWithPopup(s.au, provider);
      } catch (e) {
        if (e && (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment')) return s.auth.signInWithRedirect(s.au, provider);
        throw e;
      }
    },
    async signOut() {
      const s = await sdk();
      await s.auth.signOut(s.au);
    },
    async getUserMeta(uid) {
      const s = await sdk();
      const snap = await s.fs.getDoc(s.fs.doc(s.db, 'users', uid));
      return snap.exists() ? snap.data() : {};
    },
    async setUserMeta(uid, obj) {
      const s = await sdk();
      await s.fs.setDoc(s.fs.doc(s.db, 'users', uid), obj, { merge: true });
    },
    async watchPlaylists(uid, cb, onError) {
      const s = await sdk();
      return s.fs.onSnapshot(
        s.fs.collection(s.db, 'users', uid, 'playlists'),
        (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() })), snap.metadata.fromCache),
        onError,
      );
    },
    async readParts(uid, id, parts) {
      const s = await sdk();
      const docs = await Promise.all(Array.from({ length: parts }, (_, i) => s.fs.getDoc(s.fs.doc(s.db, 'users', uid, 'parts', partId(id, i)))));
      return docs.map((d) => (d.exists() ? d.data().data : '')).join('');
    },
    /** Écrit les morceaux (par lots, pour rester sous les limites) puis la fiche ; supprime les morceaux en trop. */
    async writePlaylist(uid, meta, parts, prevParts = 0) {
      const s = await sdk();
      for (let i = 0; i < parts.length; i += 6) {
        const batch = s.fs.writeBatch(s.db);
        parts.slice(i, i + 6).forEach((data, j) => batch.set(s.fs.doc(s.db, 'users', uid, 'parts', partId(meta.id, i + j)), { data }));
        await batch.commit();
      }
      const batch = s.fs.writeBatch(s.db);
      for (let i = parts.length; i < prevParts; i++) batch.delete(s.fs.doc(s.db, 'users', uid, 'parts', partId(meta.id, i)));
      const { id, ...fields } = meta;
      batch.set(s.fs.doc(s.db, 'users', uid, 'playlists', id), fields);
      await batch.commit();
    },
    async deletePlaylist(uid, id, parts) {
      const s = await sdk();
      const batch = s.fs.writeBatch(s.db);
      batch.delete(s.fs.doc(s.db, 'users', uid, 'playlists', id));
      for (let i = 0; i < parts; i++) batch.delete(s.fs.doc(s.db, 'users', uid, 'parts', partId(id, i)));
      await batch.commit();
    },
  };
}
