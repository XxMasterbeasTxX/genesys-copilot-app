import { resolveOrgKey, persistOrgKey } from "./orgContext.js";

// Static, customer-independent settings.
const APP_NAME = "Agent Copilot";

// OIDC scopes — enriches the id_token. API permissions are controlled
// by the logged-in user's own role in Genesys Cloud admin (not the OAuth client).
// "routing" scope is required for queue/skill/wrapup-code lookups.
const OAUTH_SCOPES = ["openid", "profile", "email", "routing"];

// ----------------------------------------------------------------------------
// CONFIG is a mutable object that starts UNRESOLVED. The customer-specific
// values (region, clientId, orgId) are filled in by `initConfig()`, which
// fetches them from the backend (GET /api/org-config). The full customer
// registry lives server-side and is never shipped to the browser.
//
// `initConfig()` MUST be awaited once at startup (in app.js → main) BEFORE any
// module reads the customer-specific fields (region / apiBase / oauthClientId).
// ----------------------------------------------------------------------------
export const CONFIG = {
  // Whether a valid customer has been resolved from the backend.
  resolved: false,
  orgKey: null,
  customerName: null,

  region: "",
  authHost: "",
  apiBase: "",
  appName: APP_NAME,

  // OAuth Client Application (Authorization Code + PKCE) for this customer.
  // The clientId is public in PKCE; it is not a secret. Filled by initConfig().
  oauthClientId: "",

  // Always redirect back to the URL the app is served from. The same shared
  // origin must be registered as an Authorized redirect URI in EACH customer's
  // Genesys OAuth client.
  oauthRedirectUri: window.location.origin,

  oauthScopes: OAUTH_SCOPES,

  // Expected Genesys org GUID for the post-login org-match check.
  // null disables the check for this customer.
  expectedOrgId: null,

  router: { mode: "hash" },
};

/**
 * Resolve this session's customer config from the backend and populate CONFIG
 * in place. Safe to await multiple times.
 *
 *  - Reads the active org key (`?org=` or persisted) via orgContext.
 *  - Calls GET /api/org-config[?org=<key>]; the backend returns ONLY the
 *    active org's public bootstrap values (or 404 for an unknown org).
 *  - On success, CONFIG.resolved becomes true and the customer fields are set.
 *  - On any failure (network/404/bad payload), CONFIG stays unresolved and
 *    app.js renders the "Organization not recognized" screen.
 *
 * @returns {Promise<typeof CONFIG>}
 */
export async function initConfig() {
  const key = resolveOrgKey();

  let res;
  try {
    const url = key
      ? `/api/org-config?org=${encodeURIComponent(key)}`
      : "/api/org-config";
    res = await fetch(url, { headers: { Accept: "application/json" } });
  } catch {
    return CONFIG; // network error → unresolved
  }

  if (!res.ok) return CONFIG; // 404 unknown_org (or other) → unresolved

  let data;
  try {
    data = await res.json();
  } catch {
    return CONFIG;
  }

  if (!data || !data.clientId || !data.region) return CONFIG;

  // Persist the backend-resolved key (covers the server-applied default case).
  persistOrgKey(data.key);

  Object.assign(CONFIG, {
    resolved: true,
    orgKey: data.key,
    customerName: data.name || null,
    region: data.region,
    authHost: `login.${data.region}`,
    apiBase: `https://api.${data.region}`,
    oauthClientId: data.clientId,
    expectedOrgId: data.orgId || null,
  });

  return CONFIG;
}
