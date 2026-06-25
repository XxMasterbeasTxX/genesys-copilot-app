const { app } = require("@azure/functions");
const { resolveRequestOrg } = require("../shared/orgResolve");
const { genesysRequest } = require("../shared/genesysClient");

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
// Auth: token-forwarding (Authorization: Bearer …  +  X-Org-Key).
//
// Responses:
//   200 { conversations: [...] }
//   400 { error: "missing_params" | "missing_org" | "unknown_org" }
//   401 { error: "missing_token" | "unauthorized" }
//   502 { error: "upstream_error" }
// ============================================================================

/** Max conversations per analytics page. */
const QUERY_PAGE_SIZE = 100;

app.http("conversationsSearch", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "conversations/search",
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
    const copilotIds = Array.isArray(body?.copilotIds) ? body.copilotIds : null;
    const queueIds = Array.isArray(body?.queueIds) ? body.queueIds : null;
    const agentIds = Array.isArray(body?.agentIds) ? body.agentIds : [];
    const fromIso = typeof body?.fromIso === "string" ? body.fromIso : null;
    const toIso = typeof body?.toIso === "string" ? body.toIso : null;

    if (!copilotIds?.length || !queueIds?.length || !fromIso || !toIso) {
      return {
        status: 400,
        headers: { "Cache-Control": "no-store" },
        jsonBody: { error: "missing_params" },
      };
    }

    const segmentFilters = [
      { type: "or", predicates: copilotIds.map((id) => ({ dimension: "agentAssistantId", value: id })) },
      { type: "or", predicates: queueIds.map((id) => ({ dimension: "queueId", value: id })) },
    ];
    if (agentIds.length) {
      segmentFilters.push({
        type: "or",
        predicates: agentIds.map((id) => ({ dimension: "userId", value: id })),
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
      let page = 1;
      for (;;) {
        queryBody.paging.pageNumber = page;
        const res = await genesysRequest({
          apiBase: org.apiBase,
          token: org.token,
          path: "/api/v2/analytics/conversations/details/query",
          method: "POST",
          body: queryBody,
          context,
        });
        const batch = res?.conversations ?? [];
        conversations.push(...batch);
        if (batch.length < QUERY_PAGE_SIZE) break;
        page++;
      }

      return {
        status: 200,
        headers: { "Cache-Control": "no-store" },
        jsonBody: { conversations },
      };
    } catch (err) {
      context.error(`conversations/search: upstream error: ${err.message ?? err}`);
      const status = err.status === 401 ? 401 : 502;
      return {
        status,
        headers: { "Cache-Control": "no-store" },
        jsonBody: { error: status === 401 ? "unauthorized" : "upstream_error" },
      };
    }
  },
});
