const { app } = require("@azure/functions");
const { resolveRequestOrg } = require("../shared/orgResolve");
const { genesysPaginateCursor } = require("../shared/genesysClient");
const { json, upstreamFailure } = require("../shared/http");

// ============================================================================
// GET /api/copilots
// ----------------------------------------------------------------------------
// Fetches every assistant (with the copilot config expanded), keeps only
// copilot-enabled ones, and returns the minimal projection the UI needs. The
// Genesys API paths, pagination cursor handling, and the "what counts as
// copilot-enabled" rule live here and nowhere else — the browser has no copy.
//
// Auth: token-forwarding. The browser sends its own Genesys access token
// (X-Genesys-Token) and X-Org-Key; the server verifies the token belongs to
// that org, resolves the region from the registry, and calls Genesys with the
// forwarded token.
//
// Responses:
//   200 [{ id, name }]                     — copilot-enabled assistants
//   400 { error: "missing_org" | "unknown_org" }
//   401 { error: "missing_token" | "unauthorized" }
//   403 { error: "org_mismatch" }
//   502 { error: "upstream_error" }        — Genesys call failed
// ============================================================================
app.http("copilots", {
  methods: ["GET"],
  authLevel: "anonymous", // the forwarded Genesys token is the real authZ
  route: "copilots",
  handler: async (request, context) => {
    const org = await resolveRequestOrg(request, context);
    if (!org.ok) return json(org.status, { error: org.error });

    try {
      const assistants = await genesysPaginateCursor({
        org,
        path: "/api/v2/assistants?expand=copilot",
        pageSize: 200,
        context,
      });

      const copilots = assistants
        .filter((a) => a.copilot?.enabled === true || a.copilot?.liveOnQueue === true)
        .map((a) => ({ id: a.id, name: a.name }));

      return json(200, copilots);
    } catch (err) {
      return upstreamFailure(context, "copilots", err);
    }
  },
});
