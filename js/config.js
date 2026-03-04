const REGION = "mypurecloud.de";

export const CONFIG = {
  region: REGION,
  authHost: `login.${REGION}`,
  apiBase: `https://api.${REGION}`,
  appName: "Agent Copilot",

  // OAuth Client Application (Authorization Code + PKCE)
  oauthClientId: "b1945404-67f3-4909-aebf-b67ab7119544",

  oauthRedirectUri: "https://thankful-mushroom-005ed0710.1.azurestaticapps.net",

  // OIDC scopes — enriches the id_token. API permissions are controlled
  // by the logged-in user's own role in Genesys Cloud admin (not the OAuth client).
  // "routing" scope is required for queue/skill/wrapup-code lookups.
  oauthScopes: ["openid", "profile", "email", "routing"],

  router: { mode: "hash" }
};
