import { createApiClient } from "./apiClient.js";

// ============================================================================
// Backend-for-Frontend (BFF) API client.
// ----------------------------------------------------------------------------
// Drop-in replacement for createApiClient(): it exposes the SAME method names,
// but migrated methods call our own `/api/*` orchestration endpoints instead of
// Genesys directly. Methods that haven't been moved server-side yet transparently
// fall back to the direct Genesys client, so migration can proceed one endpoint
// at a time without touching the pages that consume the client.
//
// Token-forwarding: every backend call carries the agent's own Genesys access
// token (Authorization: Bearer …) plus X-Org-Key. The server resolves the
// region from the registry and calls Genesys with the forwarded token — the
// orchestration logic never reaches the browser.
// ============================================================================

/**
 * @param {() => string|null} getAccessToken  returns the current Genesys token
 * @param {() => string|null} getOrgKey        returns the active org key (CONFIG.orgKey)
 */
export function createBffClient(getAccessToken, getOrgKey) {
  // Direct client provides the fallback for not-yet-migrated methods.
  const direct = createApiClient(getAccessToken);

  async function call(path, { method = "GET", body } = {}) {
    const token = getAccessToken();
    if (!token) throw new Error("No access token available");
    const orgKey = getOrgKey() || "";

    const res = await fetch(`/api${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "X-Org-Key": orgKey,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`BFF ${method} ${path} failed: ${res.status} ${res.statusText} ${text}`);
    }
    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) return null;
    return res.json();
  }

  return {
    // Fallback: everything the direct client can do (un-migrated methods).
    ...direct,

    // ── Migrated orchestration endpoints ────────────────────────
    /** Copilot-enabled assistants → [{ id, name }] (server-side filter). */
    getCopilots: () => call("/copilots"),

    /** Copilot→queue cascade → [{ id, label }] (server-side fan-out + names). */
    getQueuesForCopilots: (assistantIds) =>
      call("/queues", { method: "POST", body: { assistantIds: [...(assistantIds ?? [])] } }),

    /** Queue→agent cascade → [{ id, label }] (server-side fan-out + de-dup). */
    getAgentsForQueues: (queueIds) =>
      call("/agents", { method: "POST", body: { queueIds: [...(queueIds ?? [])] } }),

    /** All wrap-up codes → [{ id, name }] (server-side pagination). */
    getAllWrapupCodes: () => call("/wrapup-codes"),

    /** Analytics conversation search → conversations[] (server-side query + pagination). */
    searchConversations: ({ copilotIds, queueIds, agentIds, fromIso, toIso }) =>
      call("/conversations/search", {
        method: "POST",
        body: {
          copilotIds: [...(copilotIds ?? [])],
          queueIds: [...(queueIds ?? [])],
          agentIds: [...(agentIds ?? [])],
          fromIso,
          toIso,
        },
      }).then((r) => r?.conversations ?? []),

    /** Per-conversation checklist + summary enrichment → { [convId]: record }. */
    enrichConversationBatch: (conversationIds) =>
      call("/conversations/enrich", {
        method: "POST",
        body: { conversationIds: [...(conversationIds ?? [])] },
      }).then((r) => r?.results ?? {}),
  };
}
