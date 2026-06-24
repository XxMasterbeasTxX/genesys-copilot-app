// ============================================================================
// Customer registry (multi-customer support)
// ----------------------------------------------------------------------------
// One entry per Genesys Cloud organization that uses this app. The app resolves
// which entry to use from the `?org=<key>` query parameter on the URL — which
// you configure per org in that org's Genesys "Client Application" integration
// (the Application URL field), e.g. https://<app-origin>/?org=acme
//
// For each customer you onboard:
//   1. Create an OAuth client (Authorization Code + PKCE) in THEIR Genesys org.
//   2. Add this app's origin as an Authorized redirect URI in that client
//      (the redirect URI is the same shared origin for every customer).
//   3. Add one line below with their region, clientId, and org GUID.
//   4. Set their integration's Application URL to: https://<app-origin>/?org=<key>
//
// NOTE: The OAuth clientId is PUBLIC in a PKCE flow (it is visible in the
// browser). It is not a secret, so it lives safely in this file. Access is
// protected by the fact that login must succeed against that specific org
// (and, when `orgId` is set, by the post-login org-match check).
// ============================================================================

export const CUSTOMERS = {
  // Demo organization — keeps DEV/PROD working today.
  demo: {
    name: "Demo Organization",
    region: "mypurecloud.de",
    clientId: "b1945404-67f3-4909-aebf-b67ab7119544",
    // Org GUID — enables the post-login org-match check for this customer.
    orgId: "12354361-0531-4108-8a7f-d42b8828ae86",
  },

  // Example of an additional customer (remove or replace):
  // acme: {
  //   name: "Acme",
  //   region: "mypurecloud.com",
  //   clientId: "00000000-0000-0000-0000-000000000000",
  //   orgId: "11111111-1111-1111-1111-111111111111",
  // },
};

// ----------------------------------------------------------------------------
// Rollout transition switch.
// While integrations may not yet include `?org=<key>`, requests without an
// `?org=` parameter fall back to this key so existing deployments keep working.
// Set this to `null` to enforce a strict hard-fail when `?org=` is missing
// (recommended once every org's integration Application URL includes ?org=).
// ----------------------------------------------------------------------------
export const DEFAULT_ORG_KEY = "demo";
