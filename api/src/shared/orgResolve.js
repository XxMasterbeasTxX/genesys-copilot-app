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
//
// The org key is also BOUND to the token: the token's real organization is read
// from Genesys (/organizations/me, cached) and must match the registry entry's
// orgId. Without that check the key would be decorative — a caller could label
// their own token with any org key and have it forwarded to another region's
// host. Customers with no `orgId` in the registry skip the check.
// ============================================================================
const crypto = require("node:crypto");
const { CUSTOMERS } = require("../../data/customers");
const { genesysRequest } = require("./genesysClient");

/** How long a token→orgId resolution is reused before re-checking. */
const ORG_CACHE_TTL_MS = 5 * 60 * 1000;

/** sha256(token) → { orgId, expiresAt }. Never stores the raw token. */
const orgIdCache = new Map();

function tokenKey(token) {
  return crypto.createHash("sha256").update(token).digest("base64");
}

function pruneOrgIdCache(now) {
  for (const [k, v] of orgIdCache) {
    if (v.expiresAt <= now) orgIdCache.delete(k);
  }
}

/**
 * Resolve (and cache) the organization a forwarded token actually belongs to.
 *
 * @param {{orgKey: string, apiBase: string, token: string}} org provisional context
 * @param {object} [context] Functions invocation context (for logging)
 * @returns {Promise<string|null>} the org GUID, or null when Genesys omits it
 */
async function resolveTokenOrgId(org, context) {
  const now = Date.now();
  const key = tokenKey(org.token);

  const hit = orgIdCache.get(key);
  if (hit && hit.expiresAt > now) return hit.orgId;

  const me = await genesysRequest({ org, path: "/api/v2/organizations/me", context });
  const orgId = me?.id ?? null;

  pruneOrgIdCache(now);
  orgIdCache.set(key, { orgId, expiresAt: now + ORG_CACHE_TTL_MS });
  return orgId;
}

/**
 * Resolve the request's org context from its headers, verifying that the
 * forwarded token really belongs to the claimed organization.
 *
 * @param {import("@azure/functions").HttpRequest} request
 * @param {object} [context] Functions invocation context (for logging)
 * @returns {Promise<{ ok: true, orgKey: string, region: string, apiBase: string, token: string }
 *          | { ok: false, status: number, error: string }>}
 */
async function resolveRequestOrg(request, context) {
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

  const org = {
    ok: true,
    orgKey,
    region: entry.region,
    apiBase: `https://api.${entry.region}`,
    token,
  };

  // --- Bind the token to the claimed org ---
  if (!entry.orgId) return org; // check disabled for this customer

  let actualOrgId;
  try {
    actualOrgId = await resolveTokenOrgId(org, context);
  } catch (err) {
    // 401 = the forwarded token is bad; anything else is an upstream problem.
    if (err.status === 401) return { ok: false, status: 401, error: "unauthorized" };
    context?.error?.(`orgResolve: could not verify token org: ${err.message ?? err}`);
    return { ok: false, status: 502, error: "upstream_error" };
  }

  if (actualOrgId && actualOrgId !== entry.orgId) {
    context?.warn?.(`orgResolve: token org ${actualOrgId} does not match "${orgKey}"`);
    return { ok: false, status: 403, error: "org_mismatch" };
  }

  return org;
}

module.exports = { resolveRequestOrg };
