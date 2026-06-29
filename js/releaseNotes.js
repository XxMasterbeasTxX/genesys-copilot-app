/**
 * Release notes — newest entry first.
 *
 * This file is the single source of truth for the app version. Each entry
 * carries an explicit two-number `version` (e.g. "1.0", "1.1", "2.0").
 * The newest entry's version is exported as APP_VERSION and shown in the
 * sidebar footer, so the footer and the latest release note never drift.
 *
 * To cut a release: add a new object at the TOP with the next version
 * number and that release's changes.
 */
export const RELEASE_NOTES = [
  {
    version: "1.2",
    date: "2026-06-29",
    title: "Proper release versioning",
    changes: [
      "Switched to explicit two-number release versions (1.0, 1.1, 1.2 …) shown on every release note.",
      "The sidebar version indicator now matches the latest release note instead of an auto-incrementing build number.",
    ],
  },
  {
    version: "1.1",
    date: "2026-06-29",
    title: "Clearer summaries & shorter page name",
    changes: [
      "Renamed the page to \"Checklists & Summaries\".",
      "Conversation summaries no longer show a stray \"_agentName\" field — the agent appears under the \"Agent\" label.",
    ],
  },
  {
    version: "1.0",
    date: "2026-06-29",
    title: "Copilot column, styled export & simpler menu",
    changes: [
      "Added a Copilot column to the results list and the Excel export (Summary + Interactions sheets).",
      "Excel export now has styled header rows and per-column filters, ready to sort and filter on open.",
      "Flattened the navigation: Checklists & Summaries now sits directly under Dashboards.",
      "Added a version indicator in the sidebar footer.",
      "Click the version indicator to open this Release Notes page.",
    ],
  },
];

/** Current app version — the newest release note. Single source of truth. */
export const APP_VERSION = RELEASE_NOTES[0].version;
