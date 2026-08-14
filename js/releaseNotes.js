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
    version: "1.4",
    date: "2026-08-14",
    title: "Pop-out sign-in & unlimited exports",
    changes: [
      "Sign-in now opens a separate window instead of loading the Genesys login page inside the app. Genesys is retiring embedded login (all integrations must move by 4 February 2027).",
      "You now click \"Sign in with Genesys\" once per session — pop-ups must be allowed for this app.",
      "Excel exports no longer have a size limit; large exports download in full instead of being refused.",
    ],
  },
  {
    version: "1.3",
    date: "2026-08-14",
    title: "Export fixes, accurate results & hardening",
    changes: [
      "Fixed misaligned column widths in the Excel export — the Wrapup and per-item Agent columns no longer shift the columns after them.",
      "The Excel export now matches the filters on screen instead of always exporting every interaction.",
      "Date presets now search exactly the dates they put in the boxes, so pressing Search straight afterwards gives the same result.",
      "Starting a new search can no longer leave checklist data from the previous search in the table.",
      "A checklist with no items is shown as \"No items\" instead of being counted as Incomplete.",
      "Very large searches are now labelled as partial rather than silently showing only part of the result.",
      "An export too large to download is reported clearly instead of producing a corrupt file.",
      "Result rows can now be opened with the keyboard.",
    ],
  },
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
