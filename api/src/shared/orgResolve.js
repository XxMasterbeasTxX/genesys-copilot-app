// ============================================================================
// Org resolution for token-forwarding BFF endpoints.
// ----------------------------------------------------------------------------
// The browser sends two things to every orchestration endpoint:
//   - X-Genesys-Token: <genesys access token>        (token-forwarding)
//   - X-Org-Key:       <org key>                      (e.g. "demo")
//
// The token rides in a CUSTOM header rather than Authorization: Azure Static
// Web Apps reserves the standard Authorization header for its own platform auth
// and overwrites it on the managed-Functions proxy hop. Custom X-* headers pass
// through untouched. (A local `func start` dev server with no SWA in front may
// still send Authorization: Bearer; resolveRequestOrg accepts that as a
// fallback.)
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
  // --- Forwarded Genesys access token ---
  // Primary: custom X-Genesys-Token header. Azure Static Web Apps reserves the
  // standard Authorization header for its own platform auth on the managed
  // Functions hop and OVERWRITES it (the Function would otherwise receive a SWA
  // platform JWT instead of the agent's Genesys token). The token is therefore
  // forwarded in a custom X-* header, which SWA passes through untouched.
  // Fallback: Authorization: Bearer — for local `func start` dev with no SWA
  // proxy in front.
  let token = (request.headers.get("x-genesys-token") || "").trim();
  if (!token) {
    const authHeader = request.headers.get("authorization") || "";
    const match = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
    token = match ? match[1].trim() : "";
  }
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
