const REGION = "mypurecloud.de";

export const CONFIG = {
  region: REGION,
  authHost: `login.${REGION}`,
  apiBase: `https://api.${REGION}`,
  appName: "Agent Copilot",

  // OAuth Client Application (Authorization Code + PKCE)
  // TODO: Replace with the customer-specific OAuth Client ID
  oauthClientId: "REPLACE_WITH_CUSTOMER_OAUTH_CLIENT_ID",

  // TODO: Replace with the customer's Azure Static Web App URL
  oauthRedirectUri: "https://REPLACE_WITH_SWA_HOSTNAME.azurestaticapps.net",

  // OIDC scopes — enriches the id_token. API permissions are controlled
  // by the OAuth client roles and the user's own roles in Genesys Cloud admin.
  // "routing" scope is required for queue/skill/wrapup-code lookups.
  oauthScopes: ["openid", "profile", "email", "routing"],

  router: { mode: "hash" }
};
