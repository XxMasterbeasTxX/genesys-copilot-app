// ============================================================================
// Customer registry (server-side, multi-customer support)
// ----------------------------------------------------------------------------
// SERVER-SIDE ONLY. This file lives in the Azure Functions API and is NEVER
// shipped to the browser. The front-end learns ONLY its own org's public
// bootstrap values (region + clientId) via GET /api/org-config?org=<key> — it
// never receives the full customer list.
//
// One entry per Genesys Cloud organization that uses this app. The active entry
// is selected from the `?org=<key>` query parameter (configured per org in that
// org's Genesys "Client Application" integration Application URL).
//
// For each customer you onboard:
//   1. Create an OAuth client (Authorization Code + PKCE) in THEIR Genesys org.
//   2. Add this app's origin(s) (DEV + PROD) as Authorized redirect URIs.
//   3. Add one line below with their region, clientId, and org GUID.
//   4. Set their integration's Application URL to: https://<app-origin>/?org=<key>
//
// NOTE: The OAuth clientId is PUBLIC in a PKCE flow (it is handed to the browser
// to start login, and is not a secret). Keeping the registry here hides the
// full customer LIST and other orgs' details from the browser.
// ============================================================================

const CUSTOMERS = {
  // Demo organization — keeps DEV/PROD working today.
  demo: {
    name: "Demo Organization",
    region: "mypurecloud.de",
    clientId: "b1945404-67f3-4909-aebf-b67ab7119544",
    // Org GUID — enables the post-login org-match check for this customer.
    orgId: "12354361-0531-4108-8a7f-d42b8828ae86",
  },

  // Test organization (Ireland region).
  testorgie: {
    name: "TestOrgIE",
    region: "mypurecloud.ie",
    clientId: "1a30cee8-3b4f-4e1d-bb22-95092d9e4b01",
    orgId: "fa184a47-28ac-4532-bf31-d8da9de9c8cf",
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
// When a request to /api/org-config arrives WITHOUT an `?org=` parameter, the
// endpoint falls back to this key so existing deployments keep working. Set
// this to null to enforce a strict hard-fail (404) when `?org=` is missing
// (recommended once every org's integration Application URL includes ?org=).
// ----------------------------------------------------------------------------
const DEFAULT_ORG_KEY = "demo";

module.exports = { CUSTOMERS, DEFAULT_ORG_KEY };
