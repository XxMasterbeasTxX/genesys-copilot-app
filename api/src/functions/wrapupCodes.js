const { app } = require("@azure/functions");
const { resolveRequestOrg } = require("../shared/orgResolve");
const { genesysPaginatePage } = require("../shared/genesysClient");

// ============================================================================
// GET /api/wrapup-codes
// ----------------------------------------------------------------------------
// Replaces the browser's getAllWrapupCodes(): fetches every wrap-up code
// (auto-paginated) and returns the minimal { id, name } projection used to
// resolve wrap-up code IDs to names in the results table and export.
//
// Auth: token-forwarding (Authorization: Bearer …  +  X-Org-Key).
//
// Responses:
//   200 [{ id, name }]
//   400 { error: "missing_org" | "unknown_org" }
//   401 { error: "missing_token" | "unauthorized" }
//   502 { error: "upstream_error" }
// ============================================================================
app.http("wrapupCodes", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "wrapup-codes",
  handler: async (request, context) => {
    const org = resolveRequestOrg(request);
    if (!org.ok) {
      return {
        status: org.status,
        headers: { "Cache-Control": "no-store" },
        jsonBody: { error: org.error },
      };
    }

    try {
      const codes = await genesysPaginatePage({
        apiBase: org.apiBase,
        token: org.token,
        basePath: "/api/v2/routing/wrapupcodes",
        pageSize: 500,
        context,
      });

      const items = codes.map((c) => ({ id: c.id, name: c.name }));

      return { status: 200, headers: { "Cache-Control": "no-store" }, jsonBody: items };
    } catch (err) {
      context.error(`wrapup-codes: upstream error: ${err.message ?? err}`);
      const status = err.status === 401 ? 401 : 502;
      return {
        status,
        headers: { "Cache-Control": "no-store" },
        jsonBody: { error: status === 401 ? "unauthorized" : "upstream_error" },
      };
    }
  },
});
