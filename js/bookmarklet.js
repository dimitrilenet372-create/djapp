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

    let tracks;
    let name;
    let kind;
    let data = {};
    const likes = /^\/([^/]+)\/likes$/.exec(win.location.pathname.replace(/\/+$/, ''));
    const rec = /^(\/[^/]+\/[^/]+)\/recommended$/.exec(win.location.pathname.replace(/\/+$/, ''));
    if (rec) {
      // page « Sons similaires » d'un titre : on lit les titres que SoundCloud propose
      kind = 'related';
      const base = await get('resolve', { url: win.location.origin + rec[1] });
      if (!base || base.kind !== 'track' || !base.id) return fail('titre introuvable pour cette page de sons similaires.');
      const j = await get('tracks/' + base.id + '/related', { limit: '50' });
      tracks = (Array.isArray(j) ? j : (j && j.collection) || []).map((it) => (it && it.track) || it).filter((t) => t && t.id);
      name = 'Similaires à ' + (base.title || 'ce titre');
    } else if (likes) {
      // page « Likes » : titres aimés, par pages de 100 (SoundCloud donne l'adresse de la suivante)
      kind = 'likes';
      let user;
      if (likes[1] === 'you') {
        const tk = /(?:^|;\s*)oauth_token=([^;]+)/.exec(doc.cookie || '');
        if (!tk) return fail("tu ne sembles pas connecté à SoundCloud. Connecte-toi, recharge la page, puis réessaie.");
        const r = await win.fetch('https://api-v2.soundcloud.com/me?client_id=' + clientId, {
          headers: { Authorization: 'OAuth ' + decodeURIComponent(tk[1]) },
        });
        if (!r.ok) throw new Error('SoundCloud a répondu ' + r.status);
        user = await r.json();
      } else {
        user = await get('resolve', { url: win.location.origin + '/' + likes[1] });
      }
      if (!user || user.kind !== 'user' || !user.id) return fail('profil introuvable pour cette page Likes.');
      tracks = [];
      let next = 'https://api-v2.soundcloud.com/users/' + user.id + '/track_likes?limit=100&client_id=' + clientId;
      for (let page = 0; next && page < 100; page++) {
        say('Le bac : lecture des likes… ' + tracks.length);
        const r = await win.fetch(next);
        if (!r.ok) throw new Error('SoundCloud a répondu ' + r.status);
        const j = await r.json();
        for (const it of j.collection || []) {
          const t = it && (it.track || (it.kind === 'track' ? it : null));
          if (t && t.id) tracks.push(t);
        }
        next = j.next_href ? j.next_href + (/[?&]client_id=/.test(j.next_href) ? '' : '&client_id=' + clientId) : '';
      }
      name = 'Likes de ' + (user.username || user.permalink || 'SoundCloud');
    } else {
      data = await get('resolve', { url: win.location.origin + win.location.pathname });
      kind = data.kind;
      if (data.kind === 'playlist' || data.kind === 'system-playlist') {
        tracks = data.tracks || [];
        name = data.title;
      } else if (data.kind === 'track') {
        tracks = [data];
        name = data.title;
      } else {
        return fail("cette page n'est ni une playlist, ni un titre, ni une page Likes, ni des sons similaires.");
      }
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
    // pochette réduite à son identifiant : l'app recompose l'adresse de l'image
    const art = (u) => {
      const m = /^https?:\/\/i1\.sndcdn\.com\/(.+?)-(?:large|original|t\d+x\d+|crop|badge|small|tiny)\.(?:jpg|jpeg|png)/.exec(u || '');
      return m ? m[1] : '';
    };
    const out = full.map((t) => ({
      id: t.id,
      art: art(t.artwork_url) || art(t.user && t.user.avatar_url),
      title: t.title,
      uploader: (t.publisher_metadata && t.publisher_metadata.artist) || (t.user && t.user.username) || '',
      genre: t.genre || '',
      tags: full.length > 400 ? [] : parseTags(t.tag_list),
      duration: Math.round((t.full_duration || t.duration || 0) / 1000) || null,
      key: t.key_signature || '',
      dl: t.downloadable ? 1 : undefined,
      buy: t.purchase_url || undefined,
      bpm: typeof t.bpm === 'number' ? t.bpm : null,
      desc: full.length <= 400 && /bpm|key|tonalit|camelot|\b(?:1[0-2]|[1-9])[ab]\b/i.test(t.description || '') ? String(t.description).slice(0, 240) : '',
      webpage_url: t.permalink_url || '',
    }));
    if (!out.length) return fail('aucun titre trouvé (playlist vide ou privée).');

    const json = JSON.stringify({ v: 1, name: name || 'Playlist SoundCloud', art: kind === 'track' || kind === 'likes' || kind === 'related' ? '' : art(data.artwork_url), tracks: out });
    const b64 = win
      .btoa(unescape(encodeURIComponent(json)))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    if (b64.length > 1900000) return fail('trop de titres pour un seul envoi. Utilise une playlist plus petite.');
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

// --------------------------------------------------------------------------- //
// Favori « Envoyer à SoundCloud » : tourne sur soundcloud.com, connecté, lit les bacs copiés depuis
// l'app (presse-papiers, sinon boîte de collage) et crée une playlist PRIVÉE par bac avec la session
// de la personne. Même contrainte que `extractor` : le code doit rester autonome.
// Le fonctionnement interne de SoundCloud n'étant pas documenté, on vérifie le nombre de titres
// réellement présents après la création et on le dit, au lieu d'annoncer un succès supposé.
// --------------------------------------------------------------------------- //
export async function pusher(win) {
  const doc = win.document;
  let box = null;
  const say = (text, ms) => {
    if (!box) {
      box = doc.createElement('div');
      box.style.cssText =
        'position:fixed;z-index:2147483647;top:16px;left:50%;transform:translateX(-50%);max-width:90vw;' +
        'padding:10px 18px;border-radius:18px;background:#1d38f5;color:#fff;font:600 14px/1.3 system-ui,sans-serif;' +
        'box-shadow:0 6px 24px rgba(0,0,0,.3);white-space:pre-line';
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
  const fail = (text) => say('Le bac : ' + text, 9000);
  const MAX = 500; // limite de titres par playlist SoundCloud

  try {
    if (!/(^|\.)soundcloud\.com$/.test(win.location.hostname)) {
      return fail('ouvre soundcloud.com (connecté à ton compte), puis clique sur ce favori.');
    }

    // 1. ce que l'app a copié
    let text = '';
    try {
      text = await win.navigator.clipboard.readText();
    } catch (e) {
      text = '';
    }
    if (!/^\s*LEBAC1:/.test(text || '')) {
      text = win.prompt("Le bac : colle ici les titres copiés depuis l'app (Ctrl+V), puis valide.") || '';
    }
    const m = /^\s*LEBAC1:([\s\S]*)$/.exec(text);
    if (!m) return fail("rien à envoyer. Dans l'app, clique d'abord sur « Copier pour SoundCloud ».");
    let lists;
    try {
      lists = JSON.parse(m[1]).lists;
    } catch (e) {
      lists = null;
    }
    if (!Array.isArray(lists) || !lists.length) return fail("le texte copié n'est pas lisible. Recopie-le depuis l'app.");

    // les playlists SoundCloud sont limitées à 500 titres : on découpe au besoin
    const jobs = [];
    for (const l of lists) {
      const items = (l.items || []).filter((x) => typeof x === 'number' || typeof x === 'string');
      const parts = Math.max(1, Math.ceil(items.length / MAX));
      for (let i = 0; i < parts; i++) {
        jobs.push({ name: String(l.name || 'Playlist').slice(0, 100) + (parts > 1 ? ` (${i + 1})` : ''), items: items.slice(i * MAX, (i + 1) * MAX) });
      }
    }
    const total = jobs.reduce((n, j) => n + j.items.length, 0);
    const ask =
      `Le bac va créer ${jobs.length} playlist${jobs.length > 1 ? 's' : ''} PRIVÉE${jobs.length > 1 ? 'S' : ''} sur ton compte SoundCloud (${total} titres) :\n` +
      jobs.slice(0, 12).map((j) => `• ${j.name} (${j.items.length})`).join('\n') +
      (jobs.length > 12 ? `\n• … et ${jobs.length - 12} autres` : '') +
      '\n\nContinuer ?';
    if (!win.confirm(ask)) return say('Le bac : annulé, rien n\'a été créé.', 3500);

    // 2. identifiants de la session
    let clientId = '';
    const hyd = win.__sc_hydration || [];
    const api = hyd.find((h) => h && h.hydratable === 'apiClient');
    if (api && api.data && api.data.id) clientId = api.data.id;
    if (!clientId) {
      const res = win.performance.getEntriesByType('resource');
      for (let i = res.length - 1; i >= 0 && !clientId; i--) {
        const r = /[?&]client_id=([A-Za-z0-9]+)/.exec(res[i].name);
        if (r) clientId = r[1];
      }
    }
    if (!clientId) return fail('identifiant de page introuvable. Recharge la page puis réessaie.');
    const tk = /(?:^|;\s*)oauth_token=([^;]+)/.exec(doc.cookie || '');
    if (!tk) return fail("tu ne sembles pas connecté à SoundCloud. Connecte-toi, recharge la page, puis réessaie.");
    const token = decodeURIComponent(tk[1]);

    const call = async (method, path, body, params) => {
      const q = new URLSearchParams(params || {});
      q.set('client_id', clientId);
      const init = { method, headers: { Authorization: 'OAuth ' + token } };
      if (body !== undefined) {
        init.headers['Content-Type'] = 'application/json';
        init.body = JSON.stringify(body);
      }
      const r = await win.fetch('https://api-v2.soundcloud.com/' + path + '?' + q.toString(), init);
      const raw = await r.text();
      if (!r.ok) throw new Error(`${method} ${path} : SoundCloud a répondu ${r.status} ${String(raw).slice(0, 80)}`.trim());
      try {
        return JSON.parse(raw);
      } catch (e) {
        return {};
      }
    };
    const countOf = (p) => (p && typeof p.track_count === 'number' ? p.track_count : p && Array.isArray(p.tracks) ? p.tracks.length : 0);

    // 3. liens → identifiants (les titres venus du favori « Ajouter » ont déjà le leur)
    let done = 0;
    for (const j of jobs) {
      const ids = [];
      for (const it of j.items) {
        if (typeof it === 'number') {
          ids.push(it);
          continue;
        }
        say(`Le bac : ${j.name} : lecture des liens… ${ids.length} / ${j.items.length}`);
        try {
          const t = await call('GET', 'resolve', undefined, { url: it });
          if (t && t.kind === 'track' && t.id) ids.push(t.id);
        } catch (e) {
          /* lien illisible : ce titre est écarté */
        }
      }
      j.ids = ids;
    }

    // 4. création, puis vérification
    const report = [];
    for (const j of jobs) {
      if (!j.ids.length) {
        report.push(`• ${j.name} : aucun titre reconnu, non créée`);
        continue;
      }
      say(`Le bac : création de « ${j.name} » (${++done} / ${jobs.length})…`);
      try {
      let pl;
      try {
        pl = await call('POST', 'playlists', { playlist: { title: j.name, sharing: 'private', tracks: j.ids } });
      } catch (e1) {
        // création avec titres refusée : on crée la playlist vide, puis on la remplit
        pl = await call('POST', 'playlists', { playlist: { title: j.name, sharing: 'private' } });
      }
      let n = countOf(pl);
      if (n < j.ids.length && pl && pl.id) {
        // la création n'a pas pris les titres : on les ajoute par une mise à jour
        const bodies = [{ playlist: { tracks: j.ids } }, { tracks: j.ids }, { playlist: { tracks: j.ids.map((id) => ({ id })) } }];
        for (const b of bodies) {
          if (n >= j.ids.length) break;
          try {
            const up = await call('PUT', 'playlists/' + pl.id, b);
            if (countOf(up) > n) {
              pl = { ...pl, ...up };
              n = countOf(up);
            }
          } catch (e) {
            /* variante refusée : on essaie la suivante */
          }
        }
      }
      report.push(n >= j.ids.length ? `• ${j.name} : ${n} titres ✓` : `• ${j.name} : seulement ${n} / ${j.ids.length} titres (vérifie sur SoundCloud)`);
      } catch (e) {
        report.push(`• ${j.name} : échec (${(e && e.message) || e})`);
      }
    }
    say('Le bac : terminé. Les playlists sont privées, dans « Bibliothèque > Playlists ».\n' + report.join('\n'), 20000);
  } catch (e) {
    fail('échec (' + ((e && e.message) || e) + ').');
  }
}

export const pusherCode = () => `void (${pusher.toString()})(window);`;
export const pusherHref = () => 'javascript:' + encodeURIComponent(pusherCode());
