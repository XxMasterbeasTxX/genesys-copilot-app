const { app } = require("@azure/functions");
const { resolveRequestOrg } = require("../shared/orgResolve");
const { genesysRequest, genesysPaginateCursor } = require("../shared/genesysClient");

// ============================================================================
// POST /api/queues   { assistantIds: string[] }
// ----------------------------------------------------------------------------
// Replaces the browser's copilot→queue cascade. Given the selected copilot
// (assistant) IDs, it fans out to fetch each assistant's assigned queues,
// de-duplicates the queue IDs, resolves each to a display name, and returns the
// minimal projection the UI needs. The fan-out + name-resolution orchestration
// stays server-side.
//
// Auth: token-forwarding (Authorization: Bearer …  +  X-Org-Key).
//
// Responses:
//   200 [{ id, label }]                    — queues for the selected copilots
//   400 { error: "missing_ids" | "missing_org" | "unknown_org" }
//   401 { error: "missing_token" | "unauthorized" }
//   502 { error: "upstream_error" }
// ============================================================================
app.http("queues", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "queues",
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
    const assistantIds = Array.isArray(body?.assistantIds) ? body.assistantIds : null;
    if (!assistantIds) {
      return {
        status: 400,
        headers: { "Cache-Control": "no-store" },
        jsonBody: { error: "missing_ids" },
      };
    }
    if (!assistantIds.length) {
      return { status: 200, headers: { "Cache-Control": "no-store" }, jsonBody: [] };
    }

    try {
      // Fan out: queues assigned to each selected assistant.
      const perAssistant = await Promise.all(
        assistantIds.map((id) =>
          genesysPaginateCursor({
            apiBase: org.apiBase,
            token: org.token,
            path: `/api/v2/assistants/${encodeURIComponent(id)}/queues`,
            pageSize: 200,
            context,
          }),
        ),
      );

      const queueIds = new Set();
      for (const queues of perAssistant) {
        for (const q of queues) if (q?.id) queueIds.add(q.id);
      }

      const idArr = [...queueIds];
      // Resolve names in parallel; fall back to the ID if a lookup fails.
      const names = await Promise.allSettled(
        idArr.map((id) =>
          genesysRequest({
            apiBase: org.apiBase,
            token: org.token,
            path: `/api/v2/routing/queues/${encodeURIComponent(id)}`,
            context,
          }),
        ),
      );

      const items = idArr.map((id, i) => ({
        id,
        label:
          names[i].status === "fulfilled" && names[i].value?.name
            ? names[i].value.name
            : id,
      }));

      return { status: 200, headers: { "Cache-Control": "no-store" }, jsonBody: items };
    } catch (err) {
      context.error(`queues: upstream error: ${err.message ?? err}`);
      const status = err.status === 401 ? 401 : 502;
      return {
        status,
        headers: { "Cache-Control": "no-store" },
        jsonBody: { error: status === 401 ? "unauthorized" : "upstream_error" },
      };
    }
  },
});
