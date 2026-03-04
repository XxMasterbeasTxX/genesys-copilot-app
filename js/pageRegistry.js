/**
 * Maps route paths → page loaders — Agent Copilot Only.
 *
 * Each loader receives a context { route, me, api } and returns
 * a Promise<HTMLElement>.
 */

const registry = {
  // ── Dashboards › Agent Copilot ────────────────────────────
  "/dashboards/agent-copilot/agent-checklists": (ctx) =>
    import("./pages/dashboards/agent-copilot/agentChecklists.js").then((m) =>
      m.render(ctx),
    ),
  "/dashboards/agent-copilot/performance": (ctx) =>
    import("./pages/dashboards/agent-copilot/performance.js").then((m) =>
      m.render(ctx),
    ),
};

/**
 * Look up the loader for a route.
 * Returns the loader function, or null if the route is not registered.
 */
export function getPageLoader(route) {
  return registry[route] || null;
}
