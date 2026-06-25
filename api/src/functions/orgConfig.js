const { app } = require("@azure/functions");
const { CUSTOMERS, DEFAULT_ORG_KEY } = require("../../data/customers");

// ============================================================================
// GET /api/org-config?org=<key>
// ----------------------------------------------------------------------------
// Returns ONLY the requested org's public bootstrap values so the browser can
// start the PKCE login. The full customer registry stays server-side and is
// never exposed.
//
// Anonymous by design: this must be reachable BEFORE the user logs in (the
// browser needs region + clientId to begin OAuth). The returned values are not
// secrets — the clientId is public in a PKCE flow.
//
// Responses:
//   200 { key, name, region, clientId, orgId }   — resolved org
//   404 { error: "unknown_org" }                  — missing/unknown org
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
      return {
        status: 404,
        headers: { "Cache-Control": "no-store" },
        jsonBody: { error: "unknown_org" },
      };
    }

    return {
      status: 200,
      headers: { "Cache-Control": "no-store" },
      jsonBody: {
        key,
        name: entry.name,
        region: entry.region,
        clientId: entry.clientId,
        orgId: entry.orgId || null,
      },
    };
  },
});
