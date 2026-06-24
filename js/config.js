const REGION = "mypurecloud.de";

export const CONFIG = {
  region: REGION,
  authHost: `login.${REGION}`,
  apiBase: `https://api.${REGION}`,
  appName: "Agent Copilot",

  // OAuth Client Application (Authorization Code + PKCE)
  oauthClientId: "b1945404-67f3-4909-aebf-b67ab7119544",

  // Always redirect back to the URL the app is served from (DEV, PROD, or
  // customer host). Each deployed origin must be registered as an Authorized
  // redirect URI in the Genesys OAuth client.
  oauthRedirectUri: window.location.origin,

  // OIDC scopes — enriches the id_token. API permissions are controlled
  // by the logged-in user's own role in Genesys Cloud admin (not the OAuth client).
  // "routing" scope is required for queue/skill/wrapup-code lookups.
  oauthScopes: ["openid", "profile", "email", "routing"],

  router: { mode: "hash" }
};
