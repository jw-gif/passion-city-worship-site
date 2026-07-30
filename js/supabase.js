/* =============================================
   Minimal Supabase client

   Only three things are needed — password auth, PostgREST reads/RPC, and a
   Storage upload — so this talks to the REST endpoints directly rather than
   pulling in the full supabase-js bundle. That keeps the site build-free and
   free of any CDN dependency at runtime.
   ============================================= */
(function () {
  'use strict';

  const { SUPABASE_URL: BASE, SUPABASE_KEY: KEY } = window.PCC;
  const SESSION_KEY = 'pcc-session';
  const REFRESH_MARGIN_MS = 60_000;

  let session = null;
  try {
    session = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
  } catch {
    session = null;
  }

  function setSession(next) {
    session = next;
    try {
      if (next) localStorage.setItem(SESSION_KEY, JSON.stringify(next));
      else localStorage.removeItem(SESSION_KEY);
    } catch {
      /* Private browsing with storage disabled — session stays in memory. */
    }
    window.dispatchEvent(
      new CustomEvent('pcc:auth', { detail: { signedIn: !!next } })
    );
  }

  const stamp = raw => ({
    ...raw,
    expires_at: Date.now() + (Number(raw.expires_in) || 3600) * 1000,
  });

  async function authRequest(path, body) {
    let res;
    try {
      res = await fetch(`${BASE}/auth/v1/${path}`, {
        method: 'POST',
        headers: { apikey: KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch {
      throw new Error("Couldn't reach the server. Check your connection and try again.");
    }
    let data = {};
    try {
      data = await res.json();
    } catch {
      /* leave empty */
    }
    if (!res.ok) {
      const detail = data.error_description || data.msg || data.error || '';
      if (res.status === 400 || res.status === 401) {
        throw new Error(detail || 'That email and password combination is not recognised.');
      }
      throw new Error(detail || `Sign-in failed (${res.status}).`);
    }
    return data;
  }

  async function signIn(email, password) {
    const data = await authRequest('token?grant_type=password', {
      email: (email || '').trim(),
      password: password || '',
    });
    setSession(stamp(data));
  }

  async function refresh() {
    if (!session || !session.refresh_token) return null;
    try {
      setSession(stamp(await authRequest('token?grant_type=refresh_token', {
        refresh_token: session.refresh_token,
      })));
      return session;
    } catch {
      // A refresh token that no longer works means the session is over.
      setSession(null);
      return null;
    }
  }

  async function accessToken() {
    if (!session) return null;
    if (Date.now() > (session.expires_at || 0) - REFRESH_MARGIN_MS) await refresh();
    return session ? session.access_token : null;
  }

  async function signOut() {
    const token = session && session.access_token;
    setSession(null);
    if (!token) return;
    try {
      await fetch(`${BASE}/auth/v1/logout`, {
        method: 'POST',
        headers: { apikey: KEY, Authorization: `Bearer ${token}` },
      });
    } catch {
      /* Local session is already cleared; a failed round-trip is harmless. */
    }
  }

  const isSignedIn = () => !!session;
  const currentEmail = () =>
    (session && session.user && session.user.email) || '';

  async function rest(path, options = {}) {
    // Anonymous reads still need a bearer token; the publishable key doubles
    // as the anon credential.
    const token = (await accessToken()) || KEY;
    const res = await fetch(`${BASE}/rest/v1/${path}`, {
      ...options,
      headers: {
        apikey: KEY,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    });
    if (!res.ok) {
      let message = `Request failed (${res.status}).`;
      try {
        const body = await res.json();
        message = body.message || body.hint || body.error || message;
      } catch {
        /* keep the status-based message */
      }
      const err = new Error(message);
      err.status = res.status;
      throw err;
    }
    return res.status === 204 ? null : res.json();
  }

  const rpc = (fn, args) =>
    rest(`rpc/${fn}`, { method: 'POST', body: JSON.stringify(args || {}) });

  async function uploadPhoto(file) {
    const token = await accessToken();
    if (!token) throw new Error('Your session has expired — please sign in again.');

    const ext = (file.name.match(/\.[A-Za-z0-9]+$/) || ['.jpg'])[0].toLowerCase();
    const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;

    const res = await fetch(`${BASE}/storage/v1/object/staff-photos/${unique}`, {
      method: 'POST',
      headers: {
        apikey: KEY,
        Authorization: `Bearer ${token}`,
        'Content-Type': file.type || 'application/octet-stream',
        'cache-control': 'public, max-age=31536000',
      },
      body: file,
    });
    if (!res.ok) {
      let message = `Upload failed (${res.status}).`;
      try {
        const body = await res.json();
        message = body.message || body.error || message;
      } catch {
        /* keep the status-based message */
      }
      throw new Error(message);
    }
    return `${BASE}/storage/v1/object/public/staff-photos/${unique}`;
  }

  window.PCCApi = {
    signIn,
    signOut,
    refresh,
    isSignedIn,
    currentEmail,
    accessToken,
    rest,
    rpc,
    uploadPhoto,
  };
})();
