const { app } = require("@azure/functions");
const { resolveRequestOrg } = require("../shared/orgResolve");
const { genesysRequest, genesysPaginateCursor } = require("../shared/genesysClient");
const { json, readJson, readIdList, upstreamFailure } = require("../shared/http");

// ============================================================================
// POST /api/queues   { assistantIds: string[] }
// ----------------------------------------------------------------------------
// Replaces the browser's copilot→queue cascade. Given the selected copilot
// (assistant) IDs, it fans out to fetch each assistant's assigned queues,
// de-duplicates the queue IDs, resolves each to a display name, and returns the
// minimal projection the UI needs. The fan-out + name-resolution orchestration
// stays server-side.
//
// Auth: token-forwarding (X-Genesys-Token + X-Org-Key).
//
// Responses:
//   200 [{ id, label }]                    — queues for the selected copilots
//   400 { error: "missing_ids" | "too_many_assistantIds" | "missing_org" | "unknown_org" }
//   401 { error: "missing_token" | "unauthorized" }
//   403 { error: "org_mismatch" }
//   502 { error: "upstream_error" }
// ============================================================================

/** Upper bound on copilots per request — each one costs a paginated fan-out. */
const MAX_ASSISTANT_IDS = 50;

app.http("queues", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "queues",
  handler: async (request, context) => {
    const org = await resolveRequestOrg(request, context);
    if (!org.ok) return json(org.status, { error: org.error });

    const body = await readJson(request);
    const parsed = readIdList(body.assistantIds, {
      max: MAX_ASSISTANT_IDS,
      field: "assistantIds",
    });
    if (!parsed.ok) return parsed.response;
    if (!parsed.ids.length) return json(200, []);

    try {
      // Fan out: queues assigned to each selected assistant.
      const perAssistant = await Promise.all(
        parsed.ids.map((id) =>
          genesysPaginateCursor({
            org,
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
            org,
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

      return json(200, items);
    } catch (err) {
      return upstreamFailure(context, "queues", err);
    }
  },
});
