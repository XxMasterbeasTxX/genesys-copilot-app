const { app } = require("@azure/functions");
const { resolveRequestOrg } = require("../shared/orgResolve");
const { genesysPaginatePage } = require("../shared/genesysClient");
const { json, readJson, readIdList, upstreamFailure } = require("../shared/http");

// ============================================================================
// POST /api/agents   { queueIds: string[] }
// ----------------------------------------------------------------------------
// Replaces the browser's queue→agent cascade. Given the selected queue IDs, it
// fans out to fetch each queue's members, de-duplicates agents across queues,
// and returns a sorted [{ id, label }] projection. The fan-out + de-dup
// orchestration stays server-side.
//
// Auth: token-forwarding (X-Genesys-Token + X-Org-Key).
//
// Responses:
//   200 [{ id, label }]                    — agents in the selected queues
//   400 { error: "missing_ids" | "too_many_queueIds" | "missing_org" | "unknown_org" }
//   401 { error: "missing_token" | "unauthorized" }
//   403 { error: "org_mismatch" }
//   502 { error: "upstream_error" }
// ============================================================================

/** Upper bound on queues per request — each one costs a paginated fan-out. */
const MAX_QUEUE_IDS = 100;

app.http("agents", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "agents",
  handler: async (request, context) => {
    const org = await resolveRequestOrg(request, context);
    if (!org.ok) return json(org.status, { error: org.error });

    const body = await readJson(request);
    const parsed = readIdList(body.queueIds, { max: MAX_QUEUE_IDS, field: "queueIds" });
    if (!parsed.ok) return parsed.response;
    if (!parsed.ids.length) return json(200, []);

    try {
      const perQueue = await Promise.all(
        parsed.ids.map((id) =>
          genesysPaginatePage({
            org,
            basePath: `/api/v2/routing/queues/${encodeURIComponent(id)}/members`,
            pageSize: 100,
            context,
          }),
        ),
      );

      const agentMap = new Map();
      for (const members of perQueue) {
        for (const m of members) {
          const userId = m.id ?? m.user?.id;
          const userName = m.name ?? m.user?.name ?? userId;
          if (userId) agentMap.set(userId, userName);
        }
      }

      const items = [...agentMap.entries()]
        .map(([id, label]) => ({ id, label }))
        .sort((a, b) => String(a.label).localeCompare(String(b.label)));

      return json(200, items);
    } catch (err) {
      return upstreamFailure(context, "agents", err);
    }
  },
});
