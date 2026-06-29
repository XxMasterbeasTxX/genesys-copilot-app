/**
 * Release notes — newest entry first.
 *
 * Add a new object at the TOP of the array for each notable release.
 * The first (latest) entry always shows the live build number from
 * version.js, so it never drifts from the sidebar footer — no `version`
 * field is needed on it. When you add a newer entry on top, optionally
 * set a `version` on the now-older entry to record the build it shipped as.
 */
export const RELEASE_NOTES = [
  {
    date: "2026-06-29",
    title: "Copilot column, styled export & simpler menu",
    changes: [
      "Added a Copilot column to the results list and the Excel export (Summary + Interactions sheets).",
      "Excel export now has styled header rows and per-column filters, ready to sort and filter on open.",
      "Flattened the navigation: Agent Checklists & Summaries now sits directly under Dashboards.",
      "Added an auto-incrementing version indicator in the sidebar footer.",
      "Click the version indicator to open this Release Notes page.",
    ],
  },
];
