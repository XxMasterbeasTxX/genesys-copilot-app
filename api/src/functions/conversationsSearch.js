const { app } = require("@azure/functions");
const { resolveRequestOrg } = require("../shared/orgResolve");
const { genesysRequest } = require("../shared/genesysClient");
const { json, readJson, readIdList, upstreamFailure } = require("../shared/http");

// ============================================================================
// POST /api/conversations/search
//   { copilotIds: string[], queueIds: string[], agentIds?: string[],
//     fromIso: string, toIso: string }
// ----------------------------------------------------------------------------
// Replaces the browser's analytics query: builds the conversation-detail query
// (segment filters: copilot OR, queue OR, optional agent OR), auto-paginates to
// collect every matching conversation, and returns the raw analytics records
// the results table consumes. The query shape + pagination stay server-side.
//
// All limits are enforced HERE, not just in the browser: the interval length,
// the filter list sizes, and the page ceiling. The client checks exist for fast
// feedback, but they are trivially bypassable.
//
// Auth: token-forwarding (X-Genesys-Token + X-Org-Key).
//
// Responses:
//   200 { conversations: [...], truncated: boolean }
//   400 { error: "missing_params" | "invalid_interval" | "interval_too_long"
//                | "too_many_*" | "missing_org" | "unknown_org" }
//   401 { error: "missing_token" | "unauthorized" }
//   403 { error: "org_mismatch" }
//   502 { error: "upstream_error" }
// ============================================================================

/** Max conversations per analytics page. */
const QUERY_PAGE_SIZE = 100;
/** Page ceiling — caps both the response size and the time spent upstream. */
const MAX_PAGES = 50;
/** Maximum interval the Genesys analytics API allows (days). */
const MAX_INTERVAL_DAYS = 31;
const MS_PER_DAY = 86_400_000;

const MAX_COPILOT_IDS = 50;
const MAX_QUEUE_IDS = 100;
const MAX_AGENT_IDS = 500;

app.http("conversationsSearch", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "conversations/search",
  handler: async (request, context) => {
    const org = await resolveRequestOrg(request, context);
    if (!org.ok) return json(org.status, { error: org.error });

    const body = await readJson(request);

    const copilots = readIdList(body.copilotIds, {
      max: MAX_COPILOT_IDS, field: "copilotIds",
    });
    if (!copilots.ok) return copilots.response;

    const queues = readIdList(body.queueIds, { max: MAX_QUEUE_IDS, field: "queueIds" });
    if (!queues.ok) return queues.response;

    const agents = readIdList(body.agentIds ?? [], {
      max: MAX_AGENT_IDS, field: "agentIds",
    });
    if (!agents.ok) return agents.response;

    const fromIso = typeof body.fromIso === "string" ? body.fromIso : null;
    const toIso = typeof body.toIso === "string" ? body.toIso : null;

    if (!copilots.ids.length || !queues.ids.length || !fromIso || !toIso) {
      return json(400, { error: "missing_params" });
    }

    // --- Interval validation (mirrors the client-side guard) ---
    const fromMs = Date.parse(fromIso);
    const toMs = Date.parse(toIso);
    if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs <= fromMs) {
      return json(400, { error: "invalid_interval" });
    }
    if ((toMs - fromMs) / MS_PER_DAY > MAX_INTERVAL_DAYS) {
      return json(400, { error: "interval_too_long", maxDays: MAX_INTERVAL_DAYS });
    }

    const segmentFilters = [
      { type: "or", predicates: copilots.ids.map((id) => ({ dimension: "agentAssistantId", value: id })) },
      { type: "or", predicates: queues.ids.map((id) => ({ dimension: "queueId", value: id })) },
    ];
    if (agents.ids.length) {
      segmentFilters.push({
        type: "or",
        predicates: agents.ids.map((id) => ({ dimension: "userId", value: id })),
      });
    }

    const queryBody = {
      interval: `${fromIso}/${toIso}`,
      order: "desc",
      orderBy: "conversationStart",
      segmentFilters,
      paging: { pageSize: QUERY_PAGE_SIZE, pageNumber: 1 },
    };

    try {
      const conversations = [];
      let truncated = false;

      for (let page = 1; ; page++) {
        queryBody.paging.pageNumber = page;
        const res = await genesysRequest({
          org,
          path: "/api/v2/analytics/conversations/details/query",
          method: "POST",
          body: queryBody,
          context,
        });
        const batch = res?.conversations ?? [];
        conversations.push(...batch);

        if (batch.length < QUERY_PAGE_SIZE) break;
        if (page >= MAX_PAGES) {
          // Tell the browser the result set was cut short so it can say so,
          // rather than silently presenting a partial picture as complete.
          truncated = true;
          context.warn(
            `conversations/search: hit MAX_PAGES=${MAX_PAGES} (${conversations.length} records)`,
          );
          break;
        }
      }

      return json(200, { conversations, truncated });
    } catch (err) {
      return upstreamFailure(context, "conversations/search", err);
    }
  },
});
