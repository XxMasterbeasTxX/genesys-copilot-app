// ============================================================================
// Organization context resolver (multi-customer support)
// ----------------------------------------------------------------------------
// Determines WHICH org key the current session belongs to, from the
// `?org=<key>` query parameter. The key is persisted in sessionStorage so it
// survives the OAuth redirect round-trip (the redirect URI is
// `window.location.origin`, which does not carry the query string back). This
// mirrors how the PKCE verifier and OAuth state are already persisted.
//
// NOTE: This module only resolves the *key*. The actual per-customer config
// (region, clientId, orgId) is fetched from the backend in config.js — the
// registry is server-side and never shipped to the browser.
// ============================================================================

const K_ORG_KEY = "gc_org_key";

/**
 * Resolve the active org key.
 *  1) An explicit `?org=` on the URL wins and is persisted for this session.
 *  2) Otherwise fall back to a value persisted earlier this session
 *     (e.g. after returning from the OAuth redirect).
 *  3) Otherwise null — the backend may apply a default and return the
 *     resolved key (persisted via persistOrgKey).
 *
 * @returns {string|null} the org key, or null if none is present yet.
 */
export function resolveOrgKey() {
  const params = new URLSearchParams(window.location.search);
  const fromUrl = (params.get("org") || "").trim().toLowerCase();
  if (fromUrl) {
    sessionStorage.setItem(K_ORG_KEY, fromUrl);
    return fromUrl;
  }

  const stored = sessionStorage.getItem(K_ORG_KEY);
  return stored || null;
}

/**
 * Persist the resolved org key for this session (e.g. the key the backend
 * resolved when none was supplied on the URL).
 *
 * @param {string|null} key
 */
export function persistOrgKey(key) {
  if (key) sessionStorage.setItem(K_ORG_KEY, key);
}
