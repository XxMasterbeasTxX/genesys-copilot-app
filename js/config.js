import { resolveCustomer } from "./orgContext.js";

// Static, customer-independent settings.
const APP_NAME = "Agent Copilot";

// OIDC scopes — enriches the id_token. API permissions are controlled
// by the logged-in user's own role in Genesys Cloud admin (not the OAuth client).
// "routing" scope is required for queue/skill/wrapup-code lookups.
const OAUTH_SCOPES = ["openid", "profile", "email", "routing"];

// Resolve which customer (Genesys org) this session belongs to from `?org=`.
// Returns null when the org is missing or unknown → the app hard-fails cleanly.
const customer = resolveCustomer();

export const CONFIG = customer
  ? {
      // Whether a valid customer was resolved (true here).
      resolved: true,
      orgKey: customer.key,
      customerName: customer.name,

      region: customer.region,
      authHost: `login.${customer.region}`,
      apiBase: `https://api.${customer.region}`,
      appName: APP_NAME,

      // OAuth Client Application (Authorization Code + PKCE) for this customer.
      // The clientId is public in PKCE; it is not a secret.
      oauthClientId: customer.clientId,

      // Always redirect back to the URL the app is served from. The same shared
      // origin must be registered as an Authorized redirect URI in EACH
      // customer's Genesys OAuth client.
      oauthRedirectUri: window.location.origin,

      oauthScopes: OAUTH_SCOPES,

      // Expected Genesys org GUID for the post-login org-match check.
      // null disables the check for this customer (until a GUID is provided).
      expectedOrgId: customer.orgId || null,

      router: { mode: "hash" }
    }
  : {
      // No valid customer — app.js renders a "missing/unknown organization"
      // screen and does not attempt login.
      resolved: false,
      orgKey: null,
      customerName: null,

      region: "",
      authHost: "",
      apiBase: "",
      appName: APP_NAME,

      oauthClientId: "",
      oauthRedirectUri: window.location.origin,
      oauthScopes: OAUTH_SCOPES,
      expectedOrgId: null,

      router: { mode: "hash" }
    };
