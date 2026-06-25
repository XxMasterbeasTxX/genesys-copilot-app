const { app } = require("@azure/functions");
const { resolveRequestOrg } = require("../shared/orgResolve");

// ============================================================================
// GET /api/_debug-auth   (TEMPORARY diagnostic — remove after debugging)
// ----------------------------------------------------------------------------
// Reports what the Function actually RECEIVES for the forwarded token, so we
// can tell whether the Static Web Apps proxy is stripping/altering the
// Authorization header between the browser and the managed Function.
//
// Safety: never returns the token itself — only its length and a 6-char prefix
// (an opaque Genesys token prefix is not usable on its own). It also makes one
// lightweight server-side call to /api/v2/users/me to prove whether the token
// the Function received is valid from the server side.
// ============================================================================
app.http("debugAuth", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "_debug-auth",
  handler: async (request) => {
    const rawAuth = request.headers.get("authorization") || "";
    const scheme = rawAuth.split(/\s+/)[0] || null;
    const org = resolveRequestOrg(request);

    const info = {
      hasAuthHeader: !!rawAuth,
      authScheme: scheme,
      orgResolved: org.ok,
      orgError: org.ok ? null : org.error,
      tokenLen: org.ok ? org.token.length : 0,
      tokenPrefix: org.ok ? org.token.slice(0, 6) : null,
      seenHeaderNames: [...request.headers.keys()],
    };

    if (org.ok) {
      try {
        const res = await fetch(`${org.apiBase}/api/v2/users/me`, {
          headers: { Authorization: `Bearer ${org.token}` },
        });
        info.genesysUsersMeStatus = res.status;
      } catch (e) {
        info.genesysUsersMeStatus = `fetch_error: ${e.message}`;
      }
    }

    return {
      status: 200,
      headers: { "Cache-Control": "no-store" },
      jsonBody: info,
    };
  },
});
