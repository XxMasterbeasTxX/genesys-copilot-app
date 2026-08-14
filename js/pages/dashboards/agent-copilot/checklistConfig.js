/**
 * Agent Copilot › Checklists — feature-level configuration.
 *
 * All customer-tunable settings for the checklists view live here.
 */

// ── Date range presets ────────────────────────────────────
/** Default range shown when the page loads. */
export const DEFAULT_RANGE_DAYS = 7;

/** Preset buttons in the period toolbar. */
export const RANGE_PRESETS = [
  { label: "Today", days: 0 },
  { label: "7 days", days: 7 },
  { label: "30 days", days: 30 },
];

/**
 * Maximum interval the Genesys analytics API allows (days).
 * The BFF enforces the same limit — this copy only exists to fail fast in the
 * UI. Keep the two in step (api/src/functions/conversationsSearch.js).
 */
export const MAX_INTERVAL_DAYS = 31;

// ── Checklist enrichment ──────────────────────────────────
/**
 * Number of conversations sent to /api/conversations/enrich per batch.
 * Must stay <= MAX_CONVERSATION_IDS in api/src/functions/conversationsEnrich.js.
 */
export const ENRICHMENT_BATCH = 10;

// ── Time constants ────────────────────────────────────────
/** Milliseconds in one day. */
export const MS_PER_DAY = 86_400_000;

// ── Genesys API constants ─────────────────────────────────
// The server owns the conversation traversal (media keys, checklist dedup,
// completion) in api/src/shared/checklistEnrich.js. Only the values the browser
// still needs to READ off an enriched record live here.

/** Participant purpose value for agent participants. */
export const PURPOSE_AGENT = "agent";

/** Metric name for handle time on a session. */
export const METRIC_HANDLE_TIME = "tHandle";

/** Checklist tick state values returned by the API. */
export const TICK_STATE = Object.freeze({
  TICKED: "Ticked",
  UNTICKED: "Unticked",
});

/**
 * Client-side status filter values. COMPLETE/INCOMPLETE must match the
 * `completion` values produced by the server (checklistEnrich.js STATUS).
 * A record may also have `completion: null` — "undetermined", e.g. a checklist
 * that carries no items. That is NOT incomplete and must never be counted as
 * such (see LABELS.badgeNoItems).
 */
export const STATUS_FILTER = Object.freeze({
  ALL: "all",
  COMPLETE: "complete",
  INCOMPLETE: "incomplete",
  SUMMARIES: "summaries",
});

// ── Date / time formats (Intl.DateTimeFormat options) ─────
export const TABLE_DATE_FORMAT = {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
};

// ── Chart configuration ───────────────────────────────────
/** Bar chart appearance & sizing. */
export const CHART_CONFIG = Object.freeze({
  /** Chart title displayed above the bars. */
  title: "Checklist Completion",
  /** Title font colour. */
  titleColor: "#e0e0e0",
  /** Title font size in px. */
  titleFontSize: 13,
  /** Axis tick / label colour. */
  axisColor: "#aaa",
  /** Axis tick font size in px. */
  axisFontSize: 11,
  /** Horizontal grid line colour. */
  gridColor: "rgba(255,255,255,0.06)",
  /** "Complete" bar fill colour. */
  completeColor: "rgba(74,222,128,0.7)",
  /** "Complete" bar border colour. */
  completeBorder: "rgba(74,222,128,1)",
  /** "Incomplete" bar fill colour. */
  incompleteColor: "rgba(251,191,36,0.7)",
  /** "Incomplete" bar border colour. */
  incompleteBorder: "rgba(251,191,36,1)",
  /** Bar border width in px. */
  borderWidth: 1,
  /** Bar corner radius in px. */
  borderRadius: 4,
  /** Fraction of the available width each bar should occupy. */
  barPercentage: 0.6,
});

// ── Export (Excel) configuration ──────────────────────────
/** Filename prefix — final name: {prefix}_{YYYY-MM-DD}.xlsx */
export const EXPORT_FILENAME_PREFIX = "Agent_Checklists";

/** Header cell style for all export sheets (bold white on brand blue). */
export const EXPORT_HEADER_STYLE = {
  font: { bold: true, color: { rgb: "FFFFFF" }, sz: 11 },
  fill: { fgColor: { rgb: "1F6FEB" } },
  alignment: { horizontal: "center", vertical: "center" },
  border: {
    bottom: { style: "thin", color: { rgb: "0B1B33" } },
  },
};

/**
 * Column widths (wch = "width in characters") keyed by COLUMN HEADER.
 *
 * Keyed by name rather than by position on purpose: the previous positional
 * arrays silently went out of step with the sheets whenever a column was
 * inserted (the "Wrapup" and per-item "Agent" columns both shifted every width
 * after them). With a lookup, an unlisted column simply falls back to
 * EXPORT_DEFAULT_COL_WIDTH instead of corrupting its neighbours.
 *
 * Shared across all three sheets — identical headers get identical widths.
 */
export const EXPORT_COL_WIDTHS = Object.freeze({
  "Conversation ID": 38,
  "Time": 20,
  "Agent": 28,
  "Queue": 24,
  "Copilot": 24,
  "Media": 10,
  "Duration (s)": 12,
  "Checklist": 24,
  "Wrapup": 28,
  "Status": 14,
  "Total": 14,
  "Complete": 14,
  "Incomplete": 14,
  "Completion %": 14,
  "Item": 30,
  "Description": 40,
  "Agent Ticked": 14,
  "AI Ticked": 12,
  "Important": 12,
});

/** Width used for any exported column not listed above. */
export const EXPORT_DEFAULT_COL_WIDTH = 18;

// ── UI labels ─────────────────────────────────────────────
/** Labels used in the status filter buttons. */
export const LABELS = Object.freeze({
  statusAll: "All",
  statusComplete: "✅ Completed",
  statusIncomplete: "⚠️ Incomplete",
  statusSummaries: "📝 Summaries",
  statusAgentChecked: "✋ Agent Checked",
  searchBtn: "🔍 Search",
  exportBtn: "⬇ Export Excel",
  applyBtn: "Apply",
  chartLabelComplete: "Complete",
  chartLabelIncomplete: "Incomplete",
  badgeComplete: "✅ Complete",
  badgeIncomplete: "⚠️ Incomplete",
  badgeNone: "No checklist",
  /** A checklist exists but has no items — undetermined, not incomplete. */
  badgeNoItems: "No items",
  badgeError: "⚠ Error",
  exportFiltered: "Export reflects the filters currently applied.",
});
