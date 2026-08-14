import { createApiClient } from "./apiClient.js";

// ============================================================================
// Backend-for-Frontend (BFF) API client.
// ----------------------------------------------------------------------------
// All Genesys orchestration lives behind our own `/api/*` endpoints. This
// client calls them and mixes in the few direct-to-Genesys calls that must stay
// in the browser (recordings — see apiClient.js).
//
// Token-forwarding: every backend call carries the agent's own Genesys access
// token plus X-Org-Key. The server verifies the token belongs to that org,
// resolves the region from the server-side registry, and calls Genesys with the
// forwarded token — the orchestration logic never reaches the browser.
//
// The token rides in a custom X-Genesys-Token header, NOT Authorization: Azure
// Static Web Apps reserves the standard Authorization header for its own
// platform auth and overwrites it on the /api proxy hop, so the managed
// Function would never see the real token. Custom X-* headers pass through
// untouched.
// ============================================================================

/** Human-readable messages for the error codes the BFF can return. */
const ERROR_MESSAGES = {
  unauthorized: "Your Genesys session is no longer valid. Please reload to sign in again.",
  missing_token: "Not signed in.",
  org_mismatch: "Your account does not belong to this organization.",
  unknown_org: "This organization is not recognized.",
  missing_org: "No organization selected.",
  invalid_interval: "The selected period is not a valid date range.",
  interval_too_long: "The selected period is longer than the maximum allowed.",
  upstream_error: "Genesys Cloud could not be reached. Please try again.",
};

/** An error raised by a BFF endpoint, carrying the machine-readable code. */
export class BffError extends Error {
  constructor(code, status, fallback) {
    super(ERROR_MESSAGES[code] ?? fallback);
    this.name = "BffError";
    this.code = code;
    this.status = status;
  }
}

/**
 * @param {() => string|null} getAccessToken  returns the current Genesys token
 * @param {() => string|null} getOrgKey        returns the active org key (CONFIG.orgKey)
 */
export function createBffClient(getAccessToken, getOrgKey) {
  const direct = createApiClient(getAccessToken);

  async function call(path, { method = "GET", body, signal } = {}) {
    const token = getAccessToken();
    if (!token) throw new BffError("missing_token", 401, "No access token available");
    const orgKey = getOrgKey() || "";

    const res = await fetch(`/api${path}`, {
      method,
      headers: {
        "X-Genesys-Token": token,
        "X-Org-Key": orgKey,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
      signal,
    });

    if (!res.ok) {
      // Endpoints answer with { error: "<code>" }; fall back to the raw text.
      const text = await res.text().catch(() => "");
      let code = null;
      try {
        code = JSON.parse(text)?.error ?? null;
      } catch { /* not JSON */ }
      throw new BffError(
        code,
        res.status,
        `BFF ${method} ${path} failed: ${res.status} ${res.statusText} ${text}`,
      );
    }

    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) return null;
    return res.json();
  }

  return {
    // ── Direct Genesys calls that stay in the browser ───────────
    ...direct,

    // ── Orchestration endpoints (server-side) ──────────────────
    /** Copilot-enabled assistants → [{ id, name }] (server-side filter). */
    getCopilots: ({ signal } = {}) => call("/copilots", { signal }),

    /** Copilot→queue cascade → [{ id, label }] (server-side fan-out + names). */
    getQueuesForCopilots: (assistantIds, { signal } = {}) =>
      call("/queues", {
        method: "POST",
        body: { assistantIds: [...(assistantIds ?? [])] },
        signal,
      }),

    /** Queue→agent cascade → [{ id, label }] (server-side fan-out + de-dup). */
    getAgentsForQueues: (queueIds, { signal } = {}) =>
      call("/agents", {
        method: "POST",
        body: { queueIds: [...(queueIds ?? [])] },
        signal,
      }),

    /** All wrap-up codes → [{ id, name }] (server-side pagination). */
    getAllWrapupCodes: ({ signal } = {}) => call("/wrapup-codes", { signal }),

    /**
     * Analytics conversation search (server-side query + pagination).
     * @returns {Promise<{ conversations: any[], truncated: boolean }>}
     *          `truncated` is true when the server hit its page ceiling and the
     *          result set is only part of the matching interactions.
     */
    searchConversations: ({ copilotIds, queueIds, agentIds, fromIso, toIso, signal }) =>
      call("/conversations/search", {
        method: "POST",
        body: {
          copilotIds: [...(copilotIds ?? [])],
          queueIds: [...(queueIds ?? [])],
          agentIds: [...(agentIds ?? [])],
          fromIso,
          toIso,
        },
        signal,
      }).then((r) => ({
        conversations: r?.conversations ?? [],
        truncated: Boolean(r?.truncated),
      })),

    /** Per-conversation checklist + summary enrichment → { [convId]: record }. */
    enrichConversationBatch: (conversationIds, { signal } = {}) =>
      call("/conversations/enrich", {
        method: "POST",
        body: { conversationIds: [...(conversationIds ?? [])] },
        signal,
      }).then((r) => r?.results ?? {}),
  };
}
