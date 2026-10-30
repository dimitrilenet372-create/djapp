// Favori « Ajouter à Le bac » : tourne sur une page soundcloud.com, lit la playlist ou le titre
// affiché et l'envoie à l'app dans l'adresse (#import=…), sans rien envoyer à un serveur.
//
// `extractor` doit rester autonome : sa source est copiée telle quelle dans le favori
// (Function.prototype.toString), donc elle ne peut pas utiliser d'autres variables du module.
export async function extractor(win, appUrl) {
  const doc = win.document;
  let box = null;
  const say = (text, ms) => {
    if (!box) {
      box = doc.createElement('div');
      box.style.cssText =
        'position:fixed;z-index:2147483647;top:16px;left:50%;transform:translateX(-50%);max-width:90vw;' +
        'padding:10px 18px;border-radius:18px;background:#1d38f5;color:#fff;font:600 14px/1.3 system-ui,sans-serif;' +
        'box-shadow:0 6px 24px rgba(0,0,0,.3)';
      doc.body.appendChild(box);
    }
    box.textContent = text;
    if (ms) {
      win.setTimeout(() => {
        if (box) box.remove();
        box = null;
      }, ms);
    }
  };
  const fail = (text) => {
    say('Le bac : ' + text, 7000);
  };

  try {
    if (!/(^|\.)soundcloud\.com$/.test(win.location.hostname)) {
      return fail('ouvre une playlist sur soundcloud.com, puis clique sur ce favori.');
    }
    say('Le bac : lecture de la playlist…');

    // identifiant que la page utilise elle-même pour parler à SoundCloud
    let clientId = '';
    const hyd = win.__sc_hydration || [];
    const api = hyd.find((h) => h && h.hydratable === 'apiClient');
    if (api && api.data && api.data.id) clientId = api.data.id;
    if (!clientId) {
      const res = win.performance.getEntriesByType('resource');
      for (let i = res.length - 1; i >= 0 && !clientId; i--) {
        const m = /[?&]client_id=([A-Za-z0-9]+)/.exec(res[i].name);
        if (m) clientId = m[1];
      }
    }
    if (!clientId) return fail('identifiant de page introuvable. Recharge la page puis réessaie.');

    const get = async (path, params) => {
      const q = new URLSearchParams(params);
      q.set('client_id', clientId);
      const r = await win.fetch('https://api-v2.soundcloud.com/' + path + '?' + q.toString());
      if (!r.ok) throw new Error('SoundCloud a répondu ' + r.status);
      return r.json();
    };

    const data = await get('resolve', { url: win.location.origin + win.location.pathname });
    let tracks;
    let name;
    if (data.kind === 'playlist' || data.kind === 'system-playlist') {
      tracks = data.tracks || [];
      name = data.title;
    } else if (data.kind === 'track') {
      tracks = [data];
      name = data.title;
    } else {
      return fail("cette page n'est ni une playlist ni un titre.");
    }

    // la page ne détaille que les premiers titres : on récupère les autres par lots
    const missing = tracks.filter((t) => !t.title).map((t) => t.id);
    const byId = new Map();
    for (let i = 0; i < missing.length; i += 50) {
      say('Le bac : lecture de la playlist… ' + Math.min(i + 50, missing.length) + ' / ' + missing.length);
      const part = await get('tracks', { ids: missing.slice(i, i + 50).join(',') });
      part.forEach((t) => byId.set(t.id, t));
    }
    const full = tracks.map((t) => (t.title ? t : byId.get(t.id))).filter(Boolean);

    const parseTags = (s) => (s ? (s.match(/"[^"]+"|\S+/g) || []).map((x) => x.replace(/"/g, '')) : []);
    const out = full.map((t) => ({
      title: t.title,
      uploader: (t.publisher_metadata && t.publisher_metadata.artist) || (t.user && t.user.username) || '',
      genre: t.genre || '',
      tags: parseTags(t.tag_list),
      duration: Math.round((t.full_duration || t.duration || 0) / 1000) || null,
      webpage_url: t.permalink_url || '',
    }));
    if (!out.length) return fail('aucun titre trouvé (playlist vide ou privée).');

    const json = JSON.stringify({ v: 1, name: name || 'Playlist SoundCloud', tracks: out });
    const b64 = win
      .btoa(unescape(encodeURIComponent(json)))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    const url = appUrl + '#import=' + b64;
    say('Le bac : ' + out.length + (out.length > 1 ? ' titres envoyés.' : ' titre envoyé.'), 3500);
    if (!win.open(url, 'lebac')) win.location.href = url;
  } catch (e) {
    fail('échec de la lecture (' + ((e && e.message) || e) + ').');
  }
}

/** Code JavaScript du favori, prêt à devenir une adresse `javascript:`. */
export const bookmarkletCode = (appUrl) => `void (${extractor.toString()})(window, ${JSON.stringify(appUrl)});`;

export const bookmarkletHref = (appUrl) => 'javascript:' + encodeURIComponent(bookmarkletCode(appUrl));
