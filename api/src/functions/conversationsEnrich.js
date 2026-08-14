const { app } = require("@azure/functions");
const { resolveRequestOrg } = require("../shared/orgResolve");
const { enrichConversation } = require("../shared/checklistEnrich");
const { json, readJson, readIdList } = require("../shared/http");

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
// renders progressively), so the request carries a small list of IDs. The cap
// below is enforced server-side: each ID costs several upstream calls, so an
// oversized list would tie the worker up well past the SWA response timeout.
//
// Auth: token-forwarding (X-Genesys-Token + X-Org-Key).
//
// Responses:
//   200 { results: { [conversationId]: { checklists, communicationId,
//                                        completion, summaries, _error? } } }
//   400 { error: "missing_ids" | "too_many_conversationIds" | "missing_org" | "unknown_org" }
//   401 { error: "missing_token" | "unauthorized" }
//   403 { error: "org_mismatch" }
// ============================================================================

/** Must stay >= the client's ENRICHMENT_BATCH (js/…/checklistConfig.js). */
const MAX_CONVERSATION_IDS = 25;

app.http("conversationsEnrich", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "conversations/enrich",
  handler: async (request, context) => {
    const org = await resolveRequestOrg(request, context);
    if (!org.ok) return json(org.status, { error: org.error });

    const body = await readJson(request);
    const parsed = readIdList(body.conversationIds, {
      max: MAX_CONVERSATION_IDS,
      field: "conversationIds",
    });
    if (!parsed.ok) return parsed.response;
    if (!parsed.ids.length) return json(200, { results: {} });

    // enrichConversation never throws (it returns _error on failure), but guard
    // with allSettled so one bad ID can't sink the whole batch.
    const settled = await Promise.allSettled(
      parsed.ids.map((convId) => enrichConversation({ org, convId, context })),
    );

    const results = {};
    parsed.ids.forEach((convId, i) => {
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

    return json(200, { results });
  },
});
