const { app } = require("@azure/functions");
const { resolveRequestOrg } = require("../shared/orgResolve");
const { enrichConversation } = require("../shared/checklistEnrich");

// ============================================================================
// POST /api/conversations/enrich   { conversationIds: string[] }
// ----------------------------------------------------------------------------
// The crown-jewel orchestration: replaces the browser's per-conversation
// enrichOne(). For each conversation ID it fetches the full conversation, finds
// the agent communications, pulls agent checklists + summaries, attributes and
// de-duplicates them, and computes completion — all server-side. The browser
// only receives the finished record per conversation.
//
// Called once per UI batch (the page slices conversations into batches and
// renders progressively), so the request carries a small list of IDs.
//
// Auth: token-forwarding (Authorization: Bearer …  +  X-Org-Key).
//
// Responses:
//   200 { results: { [conversationId]: { checklists, communicationId,
//                                        completion, summaries, _error? } } }
//   400 { error: "missing_ids" | "missing_org" | "unknown_org" }
//   401 { error: "missing_token" }
// ============================================================================
app.http("conversationsEnrich", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "conversations/enrich",
  handler: async (request, context) => {
    const org = resolveRequestOrg(request);
    if (!org.ok) {
      return {
        status: org.status,
        headers: { "Cache-Control": "no-store" },
        jsonBody: { error: org.error },
      };
    }

    let body;
    try {
      body = await request.json();
    } catch {
      body = {};
    }
    const conversationIds = Array.isArray(body?.conversationIds) ? body.conversationIds : null;
    if (!conversationIds) {
      return {
        status: 400,
        headers: { "Cache-Control": "no-store" },
        jsonBody: { error: "missing_ids" },
      };
    }
    if (!conversationIds.length) {
      return { status: 200, headers: { "Cache-Control": "no-store" }, jsonBody: { results: {} } };
    }

    // enrichConversation never throws (it returns _error on failure), but guard
    // with allSettled so one bad ID can't sink the whole batch.
    const settled = await Promise.allSettled(
      conversationIds.map((convId) =>
        enrichConversation({ apiBase: org.apiBase, token: org.token, convId, context }),
      ),
    );

    const results = {};
    conversationIds.forEach((convId, i) => {
      const s = settled[i];
      results[convId] =
        s.status === "fulfilled"
          ? s.value
          : {
              checklists: [],
              communicationId: null,
              completion: null,
              summaries: [],
              _error: String(s.reason?.message ?? s.reason),
            };
    });

    return {
      status: 200,
      headers: { "Cache-Control": "no-store" },
      jsonBody: { results },
    };
  },
});
