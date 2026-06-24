// ============================================================================
// Organization context resolver (multi-customer support)
// ----------------------------------------------------------------------------
// Determines which customer (Genesys org) the current session belongs to, based
// on the `?org=<key>` query parameter. The chosen key is persisted in
// sessionStorage so it survives the OAuth redirect round-trip (the redirect URI
// is `window.location.origin`, which does not carry the query string back).
// This mirrors how the PKCE verifier and OAuth state are already persisted.
// ============================================================================

import { CUSTOMERS, DEFAULT_ORG_KEY } from "./customers.js";

const K_ORG_KEY = "gc_org_key";

/**
 * Resolve the active org key.
 *  1) An explicit `?org=` on the URL wins and is persisted for this session.
 *  2) Otherwise fall back to a value persisted earlier this session
 *     (e.g. after returning from the OAuth redirect).
 *  3) Otherwise fall back to DEFAULT_ORG_KEY during rollout (may be null).
 *
 * @returns {string|null} the org key, or null if none could be resolved.
 */
export function resolveOrgKey() {
  const params = new URLSearchParams(window.location.search);
  const fromUrl = (params.get("org") || "").trim().toLowerCase();
  if (fromUrl) {
    sessionStorage.setItem(K_ORG_KEY, fromUrl);
    return fromUrl;
  }

  const stored = sessionStorage.getItem(K_ORG_KEY);
  if (stored) return stored;

  if (DEFAULT_ORG_KEY) {
    sessionStorage.setItem(K_ORG_KEY, DEFAULT_ORG_KEY);
    return DEFAULT_ORG_KEY;
  }

  return null;
}

/**
 * Resolve the active customer entry.
 *
 * @returns {{key:string, name:string, region:string, clientId:string, orgId:(string|null)}|null}
 *          the customer record, or null if the org is missing or unknown
 *          (unknown org → caller should hard-fail).
 */
export function resolveCustomer() {
  const key = resolveOrgKey();
  if (!key) return null;

  const entry = CUSTOMERS[key];
  if (!entry) return null;

  return { key, ...entry };
}
