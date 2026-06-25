// ============================================================================
// Org resolution for token-forwarding BFF endpoints.
// ----------------------------------------------------------------------------
// The browser sends two things to every orchestration endpoint:
//   - Authorization: Bearer <genesys access token>   (token-forwarding)
//   - X-Org-Key:     <org key>                        (e.g. "demo")
//
// The server NEVER trusts a client-supplied region. Instead it looks the org
// key up in the server-side registry and derives the region from there. This
// keeps the registry (and the region/clientId of every other customer) hidden,
// and prevents a caller from pointing the forwarded token at an arbitrary host.
// ============================================================================
const { CUSTOMERS } = require("../../data/customers");

/**
 * Resolve the request's org context from its headers.
 *
 * @param {import("@azure/functions").HttpRequest} request
 * @returns {{ ok: true, orgKey: string, region: string, apiBase: string, token: string }
 *          | { ok: false, status: number, error: string }}
 */
function resolveRequestOrg(request) {
  // --- Bearer token (forwarded Genesys access token) ---
  const authHeader = request.headers.get("authorization") || "";
  const match = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
  const token = match ? match[1].trim() : "";
  if (!token) {
    return { ok: false, status: 401, error: "missing_token" };
  }

  // --- Org key → region (from the server-side registry only) ---
  const orgKey = (request.headers.get("x-org-key") || "").trim().toLowerCase();
  if (!orgKey) {
    return { ok: false, status: 400, error: "missing_org" };
  }

  const entry = CUSTOMERS[orgKey];
  if (!entry) {
    return { ok: false, status: 400, error: "unknown_org" };
  }

  return {
    ok: true,
    orgKey,
    region: entry.region,
    apiBase: `https://api.${entry.region}`,
    token,
  };
}

module.exports = { resolveRequestOrg };
