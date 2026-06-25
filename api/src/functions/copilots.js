const { app } = require("@azure/functions");
const { resolveRequestOrg } = require("../shared/orgResolve");
const { genesysPaginateCursor } = require("../shared/genesysClient");

// ============================================================================
// GET /api/copilots
// ----------------------------------------------------------------------------
// First BFF orchestration endpoint. Replaces the browser's
// `getAllAssistants()` + copilot filter: it fetches every assistant (with the
// copilot config expanded), keeps only copilot-enabled ones, and returns the
// minimal projection the UI needs. The Genesys API paths, pagination cursor
// handling, and the "what counts as copilot-enabled" rule stay server-side.
//
// Auth: token-forwarding. The browser sends its own Genesys access token
// (Authorization: Bearer …) and X-Org-Key; the server resolves the region from
// the registry and calls Genesys with the forwarded token.
//
// Responses:
//   200 [{ id, name }]                     — copilot-enabled assistants
//   401 { error: "missing_token" }
//   400 { error: "missing_org" | "unknown_org" }
//   502 { error: "upstream_error" }        — Genesys call failed
// ============================================================================
app.http("copilots", {
  methods: ["GET"],
  authLevel: "anonymous", // the forwarded Genesys token is the real authZ
  route: "copilots",
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
      const assistants = await genesysPaginateCursor({
        apiBase: org.apiBase,
        token: org.token,
        path: "/api/v2/assistants?expand=copilot",
        pageSize: 200,
        context,
      });

      const copilots = assistants
        .filter((a) => a.copilot?.enabled === true || a.copilot?.liveOnQueue === true)
        .map((a) => ({ id: a.id, name: a.name }));

      return {
        status: 200,
        headers: { "Cache-Control": "no-store" },
        jsonBody: copilots,
      };
    } catch (err) {
      context.error(`copilots: upstream error: ${err.message ?? err}`);
      // Surface auth failures so the browser can re-login.
      const status = err.status === 401 ? 401 : 502;
      return {
        status,
        headers: { "Cache-Control": "no-store" },
        jsonBody: { error: status === 401 ? "unauthorized" : "upstream_error" },
      };
    }
  },
});
