const { app } = require("@azure/functions");
const { resolveRequestOrg } = require("../shared/orgResolve");
const { genesysPaginatePage } = require("../shared/genesysClient");
const { json, upstreamFailure } = require("../shared/http");

// ============================================================================
// GET /api/wrapup-codes
// ----------------------------------------------------------------------------
// Replaces the browser's getAllWrapupCodes(): fetches every wrap-up code
// (auto-paginated) and returns the minimal { id, name } projection used to
// resolve wrap-up code IDs to names in the results table and export.
//
// Auth: token-forwarding (X-Genesys-Token + X-Org-Key).
//
// Responses:
//   200 [{ id, name }]
//   400 { error: "missing_org" | "unknown_org" }
//   401 { error: "missing_token" | "unauthorized" }
//   403 { error: "org_mismatch" }
//   502 { error: "upstream_error" }
// ============================================================================
app.http("wrapupCodes", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "wrapup-codes",
  handler: async (request, context) => {
    const org = await resolveRequestOrg(request, context);
    if (!org.ok) return json(org.status, { error: org.error });

    try {
      const codes = await genesysPaginatePage({
        org,
        basePath: "/api/v2/routing/wrapupcodes",
        pageSize: 500,
        context,
      });

      return json(200, codes.map((c) => ({ id: c.id, name: c.name })));
    } catch (err) {
      return upstreamFailure(context, "wrapup-codes", err);
    }
  },
});
