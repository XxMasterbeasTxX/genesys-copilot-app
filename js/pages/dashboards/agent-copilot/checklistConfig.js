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

/** Maximum interval the Genesys analytics API allows (days). */
export const MAX_INTERVAL_DAYS = 31;

// ── Analytics query ───────────────────────────────────────
/** Max conversations per page returned by the detail query. */
export const QUERY_PAGE_SIZE = 100;

// ── Checklist enrichment ──────────────────────────────────
/** Number of conversations to enrich in parallel per batch. */
export const ENRICHMENT_BATCH = 10;

/** Number of queue-name lookups to run in parallel. */
export const QUEUE_RESOLVE_BATCH = 10;

// ── Time constants ────────────────────────────────────────
/** Milliseconds in one day. */
export const MS_PER_DAY = 86_400_000;

// ── Genesys API constants ─────────────────────────────────
/**
 * Media-specific keys under which communications are nested
 * inside a conversation participant (the API does NOT use a
 * generic "communications" key).
 */
export const MEDIA_KEYS = [
  "messages", "calls", "chats",
  "callbacks", "emails", "socialExpressions", "videos",
];

/** Participant purpose value for agent participants. */
export const PURPOSE_AGENT = "agent";

/** Metric name for handle time on a session. */
export const METRIC_HANDLE_TIME = "tHandle";

/** Checklist tick state values returned by the API. */
export const TICK_STATE = Object.freeze({
  TICKED: "Ticked",
  UNTICKED: "Unticked",
});

/** Client-side status filter values. */
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

export const TOOLTIP_DATE_FORMAT = {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
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

/** Column widths (wch = "width in characters") for Sheet 1 (Summary). */
export const EXPORT_SUMMARY_COLS = [
  { wch: 28 }, // Agent
  { wch: 24 }, // Queue
  { wch: 24 }, // Checklist
  { wch: 14 }, // Total
  { wch: 14 }, // Complete
  { wch: 14 }, // Incomplete
  { wch: 14 }, // Completion %
];

/** Column widths for Sheet 2 (Interactions). */
export const EXPORT_INTERACTION_COLS = [
  { wch: 38 }, // Conversation ID
  { wch: 20 }, // Time
  { wch: 24 }, // Agent
  { wch: 22 }, // Queue
  { wch: 10 }, // Media
  { wch: 12 }, // Duration
  { wch: 24 }, // Checklist
  { wch: 12 }, // Status
];

/** Column widths for Sheet 3 (Checklist Items). */
export const EXPORT_ITEM_COLS = [
  { wch: 38 }, // Conversation ID
  { wch: 24 }, // Checklist
  { wch: 30 }, // Item
  { wch: 40 }, // Description
  { wch: 12 }, // Agent Ticked
  { wch: 10 }, // AI Ticked
  { wch: 10 }, // Important
];

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
});
