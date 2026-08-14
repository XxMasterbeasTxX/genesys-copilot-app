const { app } = require("@azure/functions");
const { CUSTOMERS, DEFAULT_ORG_KEY } = require("../../data/customers");
const { json } = require("../shared/http");

// ============================================================================
// GET /api/org-config?org=<key>
// ----------------------------------------------------------------------------
// Returns ONLY the requested org's public bootstrap values so the browser can
// start the PKCE login. The full customer registry stays server-side and is
// never exposed.
//
// Anonymous by design: this must be reachable BEFORE the user logs in (the
// browser needs region + clientId to begin OAuth). The returned values are not
// secrets — the clientId is public in a PKCE flow, and the org GUID is needed
// for the post-login org-match check.
//
// The customer's display `name` is deliberately NOT returned. Because this
// endpoint is pre-auth, a 200 vs 404 already lets anyone probe whether a given
// org key exists; there is no reason to hand out the customer's name with it.
// Anything human-readable about the org belongs behind authentication.
//
// Responses:
//   200 { key, region, clientId, orgId }   — resolved org
//   404 { error: "unknown_org" }           — missing/unknown org
// ============================================================================
app.http("orgConfig", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "org-config",
  handler: async (request, context) => {
    const requested = (request.query.get("org") || "").trim().toLowerCase();
    const key = requested || DEFAULT_ORG_KEY || "";
    const entry = key ? CUSTOMERS[key] : null;

    if (!entry) {
      context.log(`org-config: unknown org key "${requested || "(none)"}"`);
      return json(404, { error: "unknown_org" });
    }

    return json(200, {
      key,
      region: entry.region,
      clientId: entry.clientId,
      orgId: entry.orgId || null,
    });
  },
});
