const { app } = require("@azure/functions");
const { resolveRequestOrg } = require("../shared/orgResolve");
const { genesysPaginatePage } = require("../shared/genesysClient");

// ============================================================================
// POST /api/agents   { queueIds: string[] }
// ----------------------------------------------------------------------------
// Replaces the browser's queue→agent cascade. Given the selected queue IDs, it
// fans out to fetch each queue's members, de-duplicates agents across queues,
// and returns a sorted [{ id, label }] projection. The fan-out + de-dup
// orchestration stays server-side.
//
// Auth: token-forwarding (Authorization: Bearer …  +  X-Org-Key).
//
// Responses:
//   200 [{ id, label }]                    — agents in the selected queues
//   400 { error: "missing_ids" | "missing_org" | "unknown_org" }
//   401 { error: "missing_token" | "unauthorized" }
//   502 { error: "upstream_error" }
// ============================================================================
app.http("agents", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "agents",
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
    const queueIds = Array.isArray(body?.queueIds) ? body.queueIds : null;
    if (!queueIds) {
      return {
        status: 400,
        headers: { "Cache-Control": "no-store" },
        jsonBody: { error: "missing_ids" },
      };
    }
    if (!queueIds.length) {
      return { status: 200, headers: { "Cache-Control": "no-store" }, jsonBody: [] };
    }

    try {
      const perQueue = await Promise.all(
        queueIds.map((id) =>
          genesysPaginatePage({
            apiBase: org.apiBase,
            token: org.token,
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

      return { status: 200, headers: { "Cache-Control": "no-store" }, jsonBody: items };
    } catch (err) {
      context.error(`agents: upstream error: ${err.message ?? err}`);
      const status = err.status === 401 ? 401 : 502;
      return {
        status,
        headers: { "Cache-Control": "no-store" },
        jsonBody: { error: status === 401 ? "unauthorized" : "upstream_error" },
      };
    }
  },
});
