import { CONFIG } from "../config.js";

// --- STORAGE KEYS (same as your working template) ---
const K_ACCESS_TOKEN  = "gc_access_token";
const K_EXPIRES_AT    = "gc_expires_at";     // epoch ms
const K_PKCE_VERIFIER = "pkce_verifier";
const K_OAUTH_STATE   = "oauth_state";

// Use a small skew to avoid using a token that's about to expire mid-request
const EXPIRY_SKEW_MS = 60 * 1000;

// NOTE: there is deliberately no cross-tab session handoff. An earlier version
// had one half-wired (a reader with no writer), which meant it never actually
// worked. Re-introducing it would require copying the access token into
// localStorage, where it outlives the tab and is readable by anything on the
// origin; sessionStorage keeps it scoped to the tab that obtained it. A new tab
// re-runs the PKCE flow instead, which is silent when the Genesys session is
// still live.

// --- UTILS ---
function qp() { return new URLSearchParams(window.location.search); }

// IMPORTANT: preserve hash routing (#/dashboards) after login
function clearQueryPreserveHash() {
  history.replaceState({}, document.title, location.origin + location.pathname + location.hash);
}

function setToken(token) {
  const expiresAt = Date.now() + (Number(token.expires_in) * 1000);
  sessionStorage.setItem(K_ACCESS_TOKEN, token.access_token);
  sessionStorage.setItem(K_EXPIRES_AT, String(expiresAt));
}

export function getValidAccessToken() {
  const accessToken = sessionStorage.getItem(K_ACCESS_TOKEN);
  const expiresAtStr = sessionStorage.getItem(K_EXPIRES_AT);
  if (!accessToken || !expiresAtStr) return null;

  const expiresAt = Number(expiresAtStr);
  if (!Number.isFinite(expiresAt)) return null;

  if (Date.now() >= (expiresAt - EXPIRY_SKEW_MS)) return null;
  return accessToken;
}

function clearAuthSession() {
  sessionStorage.removeItem(K_ACCESS_TOKEN);
  sessionStorage.removeItem(K_EXPIRES_AT);
  sessionStorage.removeItem(K_PKCE_VERIFIER);
  sessionStorage.removeItem(K_OAUTH_STATE);
}

// --- PKCE HELPERS ---
function base64UrlEncode(bytes) {
  const bin = String.fromCharCode(...bytes);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function randomBytes(len) {
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  return arr;
}

async function sha256(bytes) {
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return new Uint8Array(hash);
}

async function buildPkce() {
  const verifier = base64UrlEncode(randomBytes(32));
  const challenge = base64UrlEncode(await sha256(new TextEncoder().encode(verifier)));
  return { verifier, challenge };
}

// --- OAUTH + API ---
/**
 * Navigate THIS window to the Genesys login page.
 *
 * Only ever called from inside the sign-in popup (see runAuthPopup), where the
 * window is top-level. Calling it from the embedded app would navigate the
 * Genesys Cloud iframe to the login page — the pattern Genesys is retiring.
 */
async function startLoginRedirect() {
  const clientId = CONFIG.oauthClientId;
  const redirectUri = CONFIG.oauthRedirectUri;

  if (!clientId) throw new Error("Missing CONFIG.oauthClientId");
  if (!redirectUri) throw new Error("Missing CONFIG.oauthRedirectUri");

  const { verifier, challenge } = await buildPkce();
  const state = base64UrlEncode(randomBytes(16));

  sessionStorage.setItem(K_PKCE_VERIFIER, verifier);
  sessionStorage.setItem(K_OAUTH_STATE, state);

  const authUrl =
    `https://${CONFIG.authHost}/oauth/authorize` +
    `?response_type=code` +
    `&client_id=${encodeURIComponent(clientId)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&code_challenge_method=S256` +
    `&code_challenge=${encodeURIComponent(challenge)}` +
    `&state=${encodeURIComponent(state)}` +
    `&scope=${encodeURIComponent((CONFIG.oauthScopes || ["openid"]).join(" "))}`;

  window.location.href = authUrl; // top-level navigation of the popup
}

async function exchangeCodeForToken(code) {
  const clientId = CONFIG.oauthClientId;
  const redirectUri = CONFIG.oauthRedirectUri;

  const verifier = sessionStorage.getItem(K_PKCE_VERIFIER);
  if (!verifier) throw new Error("Missing pkce_verifier (session lost).");

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: clientId,
    code,
    redirect_uri: redirectUri,
    code_verifier: verifier
  });

  const resp = await fetch(`https://${CONFIG.authHost}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });

  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(`Token exchange failed (${resp.status}): ${JSON.stringify(json)}`);
  return json;
}

async function usersMe(accessToken) {
  const resp = await fetch(`${CONFIG.apiBase}/api/v2/users/me`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(`/users/me failed (${resp.status}): ${JSON.stringify(json)}`);
  return json;
}

async function organizationsMe(accessToken) {
  const resp = await fetch(`${CONFIG.apiBase}/api/v2/organizations/me`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(`/organizations/me failed (${resp.status}): ${JSON.stringify(json)}`);
  return json;
}

/**
 * Verify the logged-in user's org matches the one configured for this `?org=`.
 * Throws an Error with code "ORG_MISMATCH" on mismatch.
 * No-op when CONFIG.expectedOrgId is null (check disabled for this customer).
 */
async function verifyOrgOrThrow(accessToken) {
  if (!CONFIG.expectedOrgId) return;
  const org = await organizationsMe(accessToken);
  if (org?.id !== CONFIG.expectedOrgId) {
    const err = new Error("Logged-in organization does not match the configured organization.");
    err.code = "ORG_MISMATCH";
    throw err;
  }
}

// ============================================================================
// POP-OUT AUTHENTICATION
// ----------------------------------------------------------------------------
// The app is embedded inside a Genesys Cloud iframe. Genesys is retiring the
// ability to embed the login web application within an iframe (new integrations
// from 2026-08-31, all integrations from 2027-02-04), so the app must NOT
// navigate its own frame to the login page.
//
// Instead a small TOP-LEVEL popup on our own origin runs the whole PKCE flow in
// a first-party context and hands the resulting token back to the opener via
// postMessage. Browser storage partitioning gives the third-party iframe and
// the top-level popup separate storage buckets, so the PKCE verifier cannot be
// shared through session/localStorage — the popup therefore runs the full flow
// itself, and postMessage over a live window handle is the only reliable
// channel back.
//
// Because window.open needs a user gesture, sign-in can no longer be automatic:
// ensureAuthenticatedWithMe() returns "needs-login" and app.js renders a
// sign-in gate.
// ============================================================================

const AUTH_POPUP_NAME = "gcLoginPopup";

/** Marker that identifies the popup's first load. */
const AUTH_POPUP_PARAM = "gcauth";

/**
 * True when THIS window is the sign-in popup. Detected by the presence of an
 * opener plus either our own `gcauth=start` marker or the OAuth `code` Genesys
 * returns. Safe to call before initConfig().
 */
export function isAuthPopup() {
  let hasOpener = false;
  try { hasOpener = !!window.opener && window.opener !== window; }
  catch { hasOpener = !!window.opener; }
  if (!hasOpener) return false;

  const p = qp();
  return p.get(AUTH_POPUP_PARAM) === "start" || p.has("code");
}

/**
 * Controller for the popup window. On the initial `gcauth=start` load it starts
 * the PKCE redirect (top-level, so NOT an embedded login). When Genesys
 * redirects back with a `code`, it exchanges it, posts the token to the opener,
 * and closes.
 *
 * Requires initConfig() to have resolved first — the popup needs its org's
 * region and clientId. The org key travels on the popup URL (`?org=`) because
 * the popup cannot read the iframe's partitioned storage; orgContext persists
 * it into the popup's OWN storage so it survives the trip through Genesys.
 */
export async function runAuthPopup() {
  renderPopupStatus("Completing sign-in…");
  const p = qp();

  try {
    if (!CONFIG.resolved) {
      throw new Error("Organization could not be resolved for sign-in.");
    }
    if (p.get(AUTH_POPUP_PARAM) === "start") {
      await startLoginRedirect();
      return;
    }
    if (p.has("code")) {
      await completeAuthInPopup(p.get("code"), p.get("state") || "");
    }
  } catch (e) {
    notifyOpener({ ok: false, error: String(e?.message ?? e) });
    renderPopupStatus("Sign-in failed. You can close this window.");
  }
}

async function completeAuthInPopup(code, returnedState) {
  const expectedState = sessionStorage.getItem(K_OAUTH_STATE) || "";
  if (!expectedState || returnedState !== expectedState) {
    throw new Error("OAuth state mismatch");
  }

  const token = await exchangeCodeForToken(code);

  // The popup is about to close; it never persists the token itself. Only the
  // transient PKCE material lived here, and it goes now.
  sessionStorage.removeItem(K_PKCE_VERIFIER);
  sessionStorage.removeItem(K_OAUTH_STATE);

  notifyOpener({
    ok: true,
    accessToken: token.access_token,
    expiresAt: Date.now() + Number(token.expires_in) * 1000,
  });
  renderPopupStatus("Signed in. You can close this window.");
  setTimeout(() => { try { window.close(); } catch { /* ignore */ } }, 150);
}

function notifyOpener(payload) {
  try {
    if (window.opener && !window.opener.closed) {
      // Explicit target origin — never "*", the payload carries an access token.
      window.opener.postMessage({ __gcAuth: true, ...payload }, window.location.origin);
    }
  } catch { /* opener gone — nothing to do */ }
}

function renderPopupStatus(text) {
  try {
    document.title = "Sign in";
    const host = document.body || document.documentElement;
    host.replaceChildren();
    const box = document.createElement("div");
    box.className = "auth-popup"; // styled in css/styles.css — no inline style, so CSP stays strict
    box.textContent = text;
    host.append(box);
  } catch { /* DOM not ready — ignore */ }
}

/**
 * Called from the app on a user gesture (the Sign in button). Opens the popup,
 * waits for the token via postMessage, and stores it in this window's session.
 *
 * @returns {Promise<void>} resolves once the session is stored; rejects with
 *          "popup-blocked", "popup-closed", or the underlying error message.
 */
export function loginViaPopup() {
  return new Promise((resolve, reject) => {
    const orgKey = CONFIG.orgKey;
    const base = window.location.origin + window.location.pathname;
    const url =
      `${base}?${AUTH_POPUP_PARAM}=start` +
      (orgKey ? `&org=${encodeURIComponent(orgKey)}` : "");

    const w = 500;
    const h = 660;
    const dualLeft = (window.screenLeft != null ? window.screenLeft : window.screenX) || 0;
    const dualTop = (window.screenTop != null ? window.screenTop : window.screenY) || 0;
    const outerW = window.outerWidth || document.documentElement.clientWidth || screen.width;
    const outerH = window.outerHeight || document.documentElement.clientHeight || screen.height;
    const left = dualLeft + Math.max(0, (outerW - w) / 2);
    const top = dualTop + Math.max(0, (outerH - h) / 2);

    const popup = window.open(
      url,
      AUTH_POPUP_NAME,
      `width=${w},height=${h},left=${left},top=${top},resizable=yes,scrollbars=yes`,
    );
    if (!popup) {
      reject(new Error("popup-blocked"));
      return;
    }
    try { popup.focus(); } catch { /* ignore */ }

    let settled = false;

    const onMessage = (event) => {
      if (event.origin !== window.location.origin) return;
      const d = event.data;
      if (!d || d.__gcAuth !== true) return;
      // Only accept a message from the window we actually opened.
      if (event.source && event.source !== popup) return;
      finish(d);
    };

    // The popup can be dismissed without ever posting back.
    const poll = setInterval(() => {
      if (settled) return;
      let closed = false;
      try { closed = popup.closed; } catch { closed = true; }
      if (closed) finish({ ok: false, error: "popup-closed" });
    }, 500);

    function finish(d) {
      if (settled) return;
      settled = true;
      window.removeEventListener("message", onMessage);
      clearInterval(poll);
      try { if (!popup.closed) popup.close(); } catch { /* ignore */ }

      if (d?.ok) {
        sessionStorage.setItem(K_ACCESS_TOKEN, d.accessToken);
        sessionStorage.setItem(K_EXPIRES_AT, String(d.expiresAt));
        resolve();
      } else {
        reject(new Error(d?.error || "auth-failed"));
      }
    }

    window.addEventListener("message", onMessage);
  });
}

/**
 * Bootstraps auth:
 * - If this window carries a `code` (defensive: the popup normally handles it):
 *   validate state, exchange, store token, clear URL, call /users/me
 * - Else if a token exists: call /users/me
 * - Else report that a sign-in gesture is needed
 *
 * Never navigates to the login page itself — that is the popup's job.
 *
 * Returns:
 *  { status:"authenticated", accessToken, me }
 *  { status:"org_mismatch" }
 *  { status:"needs-login" }
 */
export async function ensureAuthenticatedWithMe() {
  const p = qp();

  // A) Returned with a code
  if (p.has("code")) {
    const code = p.get("code");
    const returnedState = p.get("state") || "";
    const expectedState = sessionStorage.getItem(K_OAUTH_STATE) || "";

    if (!expectedState || returnedState !== expectedState) {
      clearAuthSession();
      clearQueryPreserveHash(); // drop the unusable code from the URL
      return { status: "needs-login" };
    }

    try {
      const token = await exchangeCodeForToken(code);
      setToken(token);
      clearQueryPreserveHash(); // avoid re-exchange on refresh

      // Clean transient
      sessionStorage.removeItem(K_PKCE_VERIFIER);
      sessionStorage.removeItem(K_OAUTH_STATE);

      const me = await usersMe(token.access_token);
      try {
        await verifyOrgOrThrow(token.access_token);
      } catch (e) {
        if (e && e.code === "ORG_MISMATCH") { clearAuthSession(); return { status: "org_mismatch" }; }
        throw e;
      }
      return { status: "authenticated", accessToken: token.access_token, me };
    } catch {
      clearAuthSession();
      clearQueryPreserveHash();
      return { status: "needs-login" };
    }
  }

  // B) Reuse existing token
  const existing = getValidAccessToken();
  if (existing) {
    try {
      const me = await usersMe(existing);
      try {
        await verifyOrgOrThrow(existing);
      } catch (e) {
        if (e && e.code === "ORG_MISMATCH") { clearAuthSession(); return { status: "org_mismatch" }; }
        throw e;
      }
      return { status: "authenticated", accessToken: existing, me };
    } catch {
      clearAuthSession();
      return { status: "needs-login" };
    }
  }

  // C) No token and no code => show the sign-in gate (pop-out login).
  return { status: "needs-login" };
}

// --- PROACTIVE SESSION REFRESH ---
// Warning fires 2 minutes before expiry; auto-redirect fires 1 minute before.
const WARNING_BEFORE_MS = 2 * 60 * 1000;

/**
 * Schedule proactive session monitoring.
 *
 * @param {Object}   callbacks
 * @param {Function} callbacks.onExpiringSoon  Called with seconds remaining when session is about to expire.
 * @param {Function} callbacks.onSessionExpired Called when the token is no longer usable (triggers re-login).
 * @returns {Function} cleanup — call to clear all timers.
 */
export function scheduleTokenRefresh({ onExpiringSoon, onSessionExpired } = {}) {
  const expiresAtStr = sessionStorage.getItem(K_EXPIRES_AT);
  if (!expiresAtStr) return () => {};

  const expiresAt = Number(expiresAtStr);
  if (!Number.isFinite(expiresAt)) return () => {};

  const timers = [];
  const now = Date.now();

  // Warning callback
  const warningIn = expiresAt - WARNING_BEFORE_MS - now;
  if (warningIn > 0 && onExpiringSoon) {
    timers.push(setTimeout(() => {
      const secsLeft = Math.round((expiresAt - Date.now()) / 1000);
      onExpiringSoon(secsLeft);
    }, warningIn));
  }

  // When the token becomes unusable (EXPIRY_SKEW_MS before actual expiry),
  // reload in-frame. That is a same-origin self navigation, NOT an embedded
  // login — the boot flow then presents the sign-in gate again.
  const expireIn = expiresAt - EXPIRY_SKEW_MS - now;
  if (expireIn > 0) {
    timers.push(setTimeout(() => {
      if (onSessionExpired) onSessionExpired();
      clearAuthSession();
      window.location.reload();
    }, expireIn));
  }

  return () => timers.forEach(clearTimeout);
}
