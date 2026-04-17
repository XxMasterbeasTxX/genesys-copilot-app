import { CONFIG } from "../config.js";

/** Maximum number of retries for rate-limited (429) or server-error (5xx) responses. */
const MAX_RETRIES = 3;
/** Base delay in ms before the first retry (doubled each attempt). */
const RETRY_BASE_MS = 1000;

export function createApiClient(getAccessToken) {
  async function request(path, { method = "GET", headers = {}, body } = {}) {
    const token = getAccessToken();
    if (!token) throw new Error("No access token available");

    for (let attempt = 0; ; attempt++) {
      const res = await fetch(`${CONFIG.apiBase}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          ...headers,
        },
        body: body ? JSON.stringify(body) : undefined,
      });

      // Retry on 429 (rate-limit) and 5xx (server errors)
      if ((res.status === 429 || res.status >= 500) && attempt < MAX_RETRIES) {
        const retryAfter = res.headers.get("retry-after");
        const delayMs = retryAfter
          ? Math.min(parseFloat(retryAfter) * 1000, 30_000)
          : RETRY_BASE_MS * 2 ** attempt;
        console.warn(
          `[API] ${res.status} on ${method} ${path} — retry ${attempt + 1}/${MAX_RETRIES} in ${delayMs}ms`,
        );
        await new Promise((r) => setTimeout(r, delayMs));
        continue;
      }

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`API ${method} ${path} failed: ${res.status} ${res.statusText} ${text}`);
      }

      const contentType = res.headers.get("content-type") || "";
      if (!contentType.includes("application/json")) return null;
      return res.json();
    }
  }

  return {
    getUsersMe: () => request("/api/v2/users/me"),

    // ── Assistants / Copilot ────────────────────────────────────
    /** Fetch ALL assistants with copilot config embedded (cursor-paginated). */
    getAllAssistants: async () => {
      const all = [];
      let after = undefined;
      for (;;) {
        const qs = new URLSearchParams({ pageSize: 200, expand: "copilot" });
        if (after) qs.set("after", after);
        const res = await request(`/api/v2/assistants?${qs}`);
        if (res.entities) all.push(...res.entities);
        if (!res.nextUri) break;
        const m = new URL(res.nextUri, CONFIG.apiBase).searchParams.get("after");
        if (!m) break;
        after = m;
      }
      return all;
    },

    /** Fetch queue IDs assigned to an assistant (cursor-paginated). */
    getAssistantQueues: async (assistantId) => {
      const all = [];
      let after = undefined;
      for (;;) {
        const qs = new URLSearchParams({ pageSize: 200 });
        if (after) qs.set("after", after);
        const res = await request(
          `/api/v2/assistants/${assistantId}/queues?${qs}`,
        );
        if (res.entities) all.push(...res.entities);
        if (!res.nextUri) break;
        const m = new URL(res.nextUri, CONFIG.apiBase).searchParams.get("after");
        if (!m) break;
        after = m;
      }
      return all; // [{ id, mediaTypes, … }]
    },

    // ── Routing ─────────────────────────────────────────────────
    /** Fetch a single queue by ID (for name resolution). */
    getQueue: (queueId) => request(`/api/v2/routing/queues/${queueId}`),

    /** Fetch ALL members of a queue (auto-paginates). */
    getQueueMembers: async (queueId) => {
      const all = [];
      let page = 1;
      let total = Infinity;
      while (all.length < total) {
        const qs = new URLSearchParams({ pageNumber: page, pageSize: 100 });
        const res = await request(
          `/api/v2/routing/queues/${queueId}/members?${qs}`,
        );
        total = res.total ?? res.entities?.length ?? 0;
        if (res.entities) all.push(...res.entities);
        if (!res.entities?.length) break;
        page++;
      }
      return all;
    },

    // ── Analytics ───────────────────────────────────────────────
    /** POST conversation detail query (returns { conversations, totalHits }). */
    queryConversationDetails: (body) =>
      request("/api/v2/analytics/conversations/details/query", {
        method: "POST",
        body,
      }),

    // ── Conversations + Checklists ──────────────────────────────
    /** Fetch a single conversation (participants, communications). */
    getConversation: (conversationId) =>
      request(`/api/v2/conversations/${conversationId}`),

    /** Fetch checklists for a conversation communication. */
    getConversationChecklists: (conversationId, communicationId) =>
      request(
        `/api/v2/conversations/${conversationId}/communications/${communicationId}/agentchecklists`,
      ),

    /** Fetch conversation summaries (may contain multiple entities). */
    getConversationSummaries: (conversationId) =>
      request(`/api/v2/conversations/${conversationId}/summaries`),

    /**
     * List all recording stubs for a conversation (no format/transcode requested).
     * Returns metadata: id, fileState, mediaType, durationMilliseconds, etc.
     * Does NOT include a playable mediaUri — use getConversationRecording() for that.
     * maxWaitMs is required; without it the API returns empty for un-cached recordings.
     */
    getConversationRecordings: (conversationId) =>
      request(`/api/v2/conversations/${conversationId}/recordings?maxWaitMs=5000`),

    /**
     * Fetch a single recording with a presigned playable URL.
     * Triggers transcoding to the requested format and waits up to maxWaitMs.
     * Returns a recording object with `mediaUri` (presigned S3 URL, valid ~5 min).
     * Always call on demand — never cache the URL.
     * @param {string} conversationId
     * @param {string} recordingId
     * @param {string} [formatId='MP3'] WAV | WEBM | WAV_ULAW | OGG_VORBIS | OGG_OPUS | MP3
     */
    getConversationRecording: (conversationId, recordingId, formatId = "MP3") =>
      request(
        `/api/v2/conversations/${conversationId}/recordings/${recordingId}?formatId=${formatId}&maxWaitMs=5000`,
      ),

    // ── Lookup helpers ──────────────────────────────────────────
    /** Fetch ALL wrap-up codes (auto-paginated). Returns [{ id, name, … }]. */
    getAllWrapupCodes: async () => {
      const all = [];
      let page = 1;
      let total = Infinity;
      while (all.length < total) {
        const qs = new URLSearchParams({ pageNumber: page, pageSize: 500 });
        const res = await request(`/api/v2/routing/wrapupcodes?${qs}`);
        total = res.total ?? res.entities?.length ?? 0;
        if (res.entities) all.push(...res.entities);
        if (!res.entities?.length) break;
        page++;
      }
      return all;
    },
  };
}
