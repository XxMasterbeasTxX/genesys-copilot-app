/**
 * Dashboards › Agent Copilot › Checklists & Summaries
 *
 * Historical view of interactions that used Agent Copilot checklists.
 *
 * Filter flow:
 *   1. Select copilot(s)        → cascades available queues
 *   2. Select queue(s)          → required before search
 *   3. Choose period            → presets or custom dates
 *   4. Search                   → analytics detail query
 *   5. Status filter            → client-side (All / Completed / Incomplete)
 *   6. Click row                → drill-down to checklist items
 *
 * Data enrichment:
 *   After table renders, checklists are fetched in background batches
 *   to populate the Checklist column and enable status filtering.
 */
import { escapeHtml } from "../../../utils.js";
import { createMultiSelect } from "../../../components/multiSelect.js";
import {
  DEFAULT_RANGE_DAYS,
  RANGE_PRESETS,
  MAX_INTERVAL_DAYS,
  ENRICHMENT_BATCH,
  MS_PER_DAY,
  PURPOSE_AGENT,
  METRIC_HANDLE_TIME,
  TICK_STATE,
  STATUS_FILTER,
  TABLE_DATE_FORMAT,
  CHART_CONFIG,
  EXPORT_FILENAME_PREFIX,
  EXPORT_HEADER_STYLE,
  EXPORT_COL_WIDTHS,
  EXPORT_DEFAULT_COL_WIDTH,
  EXPORT_MAX_B64_BYTES,
  LABELS,
} from "./checklistConfig.js";

/* ── Helpers ───────────────────────────────────────────── */

function todayUTC() {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/** True when a rejection is just a cancelled request, not a real failure. */
function isAborted(err) {
  return err?.name === "AbortError";
}

/**
 * Combine abort signals. Uses AbortSignal.any where available and falls back to
 * manual wiring for older embedded browsers (the app runs inside the Genesys
 * Cloud client, whose Chromium version is not ours to choose).
 */
function anySignal(signals) {
  if (typeof AbortSignal.any === "function") return AbortSignal.any(signals);
  const ctrl = new AbortController();
  for (const s of signals) {
    if (s.aborted) { ctrl.abort(s.reason); break; }
    s.addEventListener("abort", () => ctrl.abort(s.reason), { once: true });
  }
  return ctrl.signal;
}

/** Abortable delay — rejects with an AbortError instead of firing late. */
function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    }, { once: true });
  });
}

/** `YYYY-MM-DD` for a date input, in UTC to match how the interval is built. */
function toDateInputValue(d) {
  return d.toISOString().slice(0, 10);
}

/**
 * Turn the two date inputs into the interval that is actually queried.
 *
 * The search always covers whole UTC days, so the interval matches exactly what
 * the inputs show. (Presets used to pass raw timestamps instead, which meant
 * pressing Search straight afterwards — with the same visible dates — returned
 * a different result set.)
 */
function intervalFromInputs(fromValue, toValue) {
  return {
    from: new Date(`${fromValue}T00:00:00.000Z`),
    to: new Date(`${toValue}T23:59:59.999Z`),
  };
}

function fmtDate(d) {
  return d.toLocaleString(undefined, TABLE_DATE_FORMAT);
}

/** Format milliseconds as m:ss or h:mm:ss. */
function fmtDuration(ms) {
  if (!ms || ms <= 0) return "—";
  const totalSecs = Math.round(ms / 1000);
  const h = Math.floor(totalSecs / 3600);
  const m = Math.floor((totalSecs % 3600) / 60);
  const s = totalSecs % 60;
  if (h) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * Extract handle time from a participant's session metrics.
 * Falls back to 0 if not found.
 */
function extractDuration(participant) {
  for (const sess of participant.sessions ?? []) {
    for (const metric of sess.metrics ?? []) {
      if (metric.name === METRIC_HANDLE_TIME && metric.value) return metric.value;
    }
  }
  return 0;
}

/** Total handle time across all agent participants (handles transfers). */
function extractTotalDuration(agents) {
  return (agents ?? []).reduce((sum, a) => sum + extractDuration(a), 0);
}

/** Find the first agent participant in an analytics conversation record. */
function findAgentParticipant(conv) {
  return (conv.participants ?? []).find((p) => p.purpose === PURPOSE_AGENT);
}

/** Find ALL agent participants in an analytics conversation record. */
function findAllAgentParticipants(conv) {
  return (conv.participants ?? []).filter((p) => p.purpose === PURPOSE_AGENT);
}

/** Find the queueId from a participant's sessions/segments. */
function extractQueueId(participant) {
  for (const sess of participant.sessions ?? []) {
    for (const seg of sess.segments ?? []) {
      if (seg.queueId) return seg.queueId;
    }
    if (sess.queueId) return sess.queueId;
  }
  return null;
}

/** Find mediaType from a participant's sessions. */
function extractMediaType(participant) {
  for (const sess of participant.sessions ?? []) {
    if (sess.mediaType) return sess.mediaType;
  }
  return null;
}

/** Extract unique wrapup code IDs from a participant's session segments. */
function extractWrapUpCodes(participant) {
  const codes = [];
  for (const sess of participant?.sessions ?? []) {
    for (const seg of sess.segments ?? []) {
      if (seg.wrapUpCode && !codes.includes(seg.wrapUpCode)) {
        codes.push(seg.wrapUpCode);
      }
    }
  }
  return codes;
}

/** Resolve wrapup code IDs to display names using the cache. */
function resolveWrapUpNames(ids, cache) {
  return ids.map((id) => cache.get(id) ?? id);
}

/**
 * Build one export worksheet from an array of row objects and append it.
 *
 * Column widths are looked up by header name, so inserting a column can no
 * longer shift every width after it. An empty `rows` array is handled here too:
 * json_to_sheet produces a sheet with no `!ref`, which would otherwise blow up
 * decode_range and take the whole export down with it.
 */
function appendSheet(wb, sheetName, rows) {
  const ws = XLSX.utils.json_to_sheet(rows);

  const headers = Object.keys(rows[0] ?? {});
  if (headers.length) {
    ws["!cols"] = headers.map((h) => ({
      wch: EXPORT_COL_WIDTHS[h] ?? EXPORT_DEFAULT_COL_WIDTH,
    }));
  } else if (!ws["!ref"]) {
    ws["!ref"] = "A1"; // an empty sheet still needs a dimension to be writable
  }

  const ref = headers.length ? ws["!ref"] : null;
  if (ref) {
    const range = XLSX.utils.decode_range(ref);
    for (let c = range.s.c; c <= range.e.c; c++) {
      const addr = XLSX.utils.encode_cell({ r: 0, c });
      if (ws[addr]) ws[addr].s = EXPORT_HEADER_STYLE;
    }
    ws["!autofilter"] = { ref };
  }

  XLSX.utils.book_append_sheet(wb, ws, sheetName);
}

/* ── Main render ───────────────────────────────────────── */

export async function render({ route, me, api }) {
  // ── State ──────────────────────────────────────────────
  let conversations = [];         // analytics detail records
  const enriched = new Map();     // convId → { checklists, communicationId, completion }
  const queueNameCache = new Map(); // queueId → name
  const queueCopilotCache = new Map(); // queueId → copilot name
  const userNameCache = new Map();  // userId → name
  const wrapUpNameCache = new Map(); // wrapUpCodeId → name
  let statusFilter = STATUS_FILTER.ALL;
  let agentCheckedFilter = false;
  let enrichAbort = null;          // AbortController for in-flight enrichment
  let expandedRowId = null;       // conversationId currently drilled-down
  let searchTruncated = false;    // server hit its page ceiling on the last search

  // Aborted when the router tears this page down; every request the page makes
  // is tied to it so nothing outlives the view.
  const pageAbort = new AbortController();

  // Monotonic tickets for the cascades and searches. Responses can land out of
  // order, and a slow earlier one must not overwrite newer state.
  let copilotCascadeSeq = 0;
  let queueCascadeSeq = 0;
  let searchSeq = 0;

  // ── DOM skeleton ───────────────────────────────────────
  const root = document.createElement("div");
  root.className = "checklist-view";

  // Header (title + export button)
  const header = document.createElement("div");
  header.className = "checklist-header";
  header.innerHTML = `<h2>Checklists &amp; Summaries</h2>`;

  // ── Filter bar ─────────────────────────────────────────
  const filterBar = document.createElement("div");
  filterBar.className = "checklist-filters";

  // Copilot multi-select (with label wrapper)
  const copilotWrap = document.createElement("div");
  copilotWrap.className = "checklist-filter-group";
  const copilotLabel = document.createElement("label");
  copilotLabel.className = "checklist-filter-label";
  copilotLabel.textContent = "Agent Copilots";
  const copilotMs = createMultiSelect({
    placeholder: "Select copilot(s)…",
    onChange: onCopilotSelectionChanged,
  });
  copilotWrap.append(copilotLabel, copilotMs.el);

  // Queue multi-select (cascaded from copilot, with label)
  const queueWrap = document.createElement("div");
  queueWrap.className = "checklist-filter-group";
  const queueLabel = document.createElement("label");
  queueLabel.className = "checklist-filter-label";
  queueLabel.textContent = "Queues";
  const queueMs = createMultiSelect({
    placeholder: "Select queue(s)…",
    onChange: onQueueSelectionChanged,
  });
  queueMs.setEnabled(false);
  queueWrap.append(queueLabel, queueMs.el);

  // Agent multi-select (cascaded from queue, with label)
  const agentWrap = document.createElement("div");
  agentWrap.className = "checklist-filter-group";
  const agentLabel = document.createElement("label");
  agentLabel.className = "checklist-filter-label";
  agentLabel.textContent = "Agents";
  const agentMs = createMultiSelect({
    placeholder: "Select agent(s)…",
    onChange: () => {},
  });
  agentMs.setEnabled(false);
  agentWrap.append(agentLabel, agentMs.el);

  // Period toolbar
  const periodWrap = document.createElement("div");
  periodWrap.className = "checklist-period";

  const presetBtns = RANGE_PRESETS.map(({ label, days }) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-sm checklist-preset";
    btn.textContent = label;
    btn.dataset.days = days;
    btn.addEventListener("click", () => loadRange(days));
    return btn;
  });

  const fromInput = document.createElement("input");
  fromInput.type = "date";
  fromInput.className = "checklist-date";
  const toInput = document.createElement("input");
  toInput.type = "date";
  toInput.className = "checklist-date";

  const applyBtn = document.createElement("button");
  applyBtn.type = "button";
  applyBtn.className = "btn btn-sm checklist-preset";
  applyBtn.textContent = LABELS.applyBtn;
  applyBtn.addEventListener("click", () => {
    setActivePreset(null);
    searchFromInputs();
  });

  periodWrap.append(...presetBtns, fromInput, toInput, applyBtn);

  // Search button
  const searchBtn = document.createElement("button");
  searchBtn.type = "button";
  searchBtn.className = "btn btn-sm checklist-search-btn";
  searchBtn.textContent = LABELS.searchBtn;
  searchBtn.addEventListener("click", () => searchFromInputs());

  const filterRow1 = document.createElement("div");
  filterRow1.className = "checklist-filter-row";
  filterRow1.append(copilotWrap, queueWrap, agentWrap);

  const filterRow2 = document.createElement("div");
  filterRow2.className = "checklist-filter-row";
  filterRow2.append(periodWrap, searchBtn);

  // ── Status filter row (row 3 inside filterBar) ────────
  const statusBar = document.createElement("div");
  statusBar.className = "checklist-filter-row checklist-status-bar";

  const statusBtns = [
    { val: STATUS_FILTER.ALL, label: LABELS.statusAll },
    { val: STATUS_FILTER.COMPLETE, label: LABELS.statusComplete },
    { val: STATUS_FILTER.INCOMPLETE, label: LABELS.statusIncomplete },
    { val: STATUS_FILTER.SUMMARIES, label: LABELS.statusSummaries },
  ].map(({ val, label }) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-sm checklist-status-btn";
    btn.textContent = label;
    btn.dataset.status = val;
    btn.addEventListener("click", () => {
      statusFilter = val;
      syncStatusButtons();
      applyTableFilter();
    });
    return btn;
  });
  statusBar.append(...statusBtns);

  // Independent toggle: only show rows where agent ticked ≥1 item
  const agentCheckedSep = document.createElement("span");
  agentCheckedSep.className = "checklist-filter-sep";
  agentCheckedSep.setAttribute("aria-hidden", "true");
  agentCheckedSep.textContent = "|";

  const agentCheckedBtn = document.createElement("button");
  agentCheckedBtn.type = "button";
  agentCheckedBtn.className = "btn btn-sm checklist-agent-btn";
  agentCheckedBtn.textContent = LABELS.statusAgentChecked;
  agentCheckedBtn.addEventListener("click", () => {
    agentCheckedFilter = !agentCheckedFilter;
    agentCheckedBtn.classList.toggle("checklist-agent-btn--active", agentCheckedFilter);
    applyTableFilter();
  });

  statusBar.append(agentCheckedSep, agentCheckedBtn);

  filterBar.append(filterRow1, filterRow2, statusBar);

  // Export Excel button (hidden until enrichment completes)
  const exportBtn = document.createElement("button");
  exportBtn.type = "button";
  exportBtn.className = "btn btn-sm checklist-export-btn";
  exportBtn.textContent = LABELS.exportBtn;
  exportBtn.hidden = true;
  exportBtn.addEventListener("click", exportToExcel);
  header.append(exportBtn);

  function syncStatusButtons() {
    for (const btn of statusBtns) {
      btn.classList.toggle(
        "checklist-status-btn--active",
        btn.dataset.status === statusFilter,
      );
    }
  }
  syncStatusButtons();

  // ── Status / loading line ──────────────────────────────
  const statusEl = document.createElement("div");
  statusEl.className = "checklist-status";

  // ── Table ──────────────────────────────────────────────
  const tableWrap = document.createElement("div");
  tableWrap.className = "checklist-table-wrap";

  // Collapsible wrapper around the results table
  const resultsChevron = document.createElement("span");
  resultsChevron.className = "checklist-results-chevron";
  resultsChevron.textContent = "▼";

  const resultsToggle = document.createElement("button");
  resultsToggle.type = "button";
  resultsToggle.className = "checklist-results-toggle";
  resultsToggle.setAttribute("aria-expanded", "true");
  resultsToggle.append(resultsChevron, document.createTextNode(" Search Results"));
  resultsToggle.addEventListener("click", () => {
    const isOpen = !tableWrap.hidden;
    tableWrap.hidden = isOpen;
    resultsToggle.setAttribute("aria-expanded", String(!isOpen));
    resultsChevron.textContent = isOpen ? "▶" : "▼";
  });

  const resultsSection = document.createElement("div");
  resultsSection.className = "checklist-results-section";
  resultsSection.append(resultsToggle, tableWrap);

  // ── Chart ──────────────────────────────────────────────
  const chartWrap = document.createElement("div");
  chartWrap.className = "checklist-chart-wrap";
  chartWrap.hidden = true;
  const chartCanvas = document.createElement("canvas");
  chartCanvas.id = "checklistChart";
  chartWrap.append(chartCanvas);
  let chartInstance = null;

  // Re-render chart when OS theme changes so colours update.
  // Registered with the page's abort signal: this listener lives outside the
  // page's own subtree, so without cleanup it would survive every navigation
  // away and keep firing against a detached canvas.
  const themeMedia = window.matchMedia("(prefers-color-scheme: dark)");
  themeMedia.addEventListener("change", () => {
    if (chartInstance) { chartInstance.destroy(); chartInstance = null; }
    updateChart();
  }, { signal: pageAbort.signal });

  // ── Drill-down panel ───────────────────────────────────
  const drillPanel = document.createElement("div");
  drillPanel.className = "checklist-drilldown";
  drillPanel.hidden = true;

  // ── Top area: filters on left, chart in center ────────
  const topArea = document.createElement("div");
  topArea.className = "checklist-top-area";
  topArea.append(filterBar, chartWrap);

  root.append(header, topArea, statusEl, resultsSection, drillPanel);

  // ── Preset highlighting ────────────────────────────────
  function setActivePreset(days) {
    for (const btn of presetBtns) {
      btn.classList.toggle(
        "checklist-preset--active",
        btn.dataset.days === String(days),
      );
    }
  }

  // ── Search the range currently shown in the date inputs ─
  function searchFromInputs() {
    if (!fromInput.value || !toInput.value) {
      statusEl.textContent = "Please choose a start and end date.";
      return;
    }
    const { from, to } = intervalFromInputs(fromInput.value, toInput.value);
    if (to <= from) {
      statusEl.textContent = "The end date must be on or after the start date.";
      return;
    }
    doSearch(from, to);
  }

  // ── Load a preset range ────────────────────────────────
  // Writes the range into the inputs, then searches THOSE values, so the query
  // always matches the dates on screen.
  function loadRange(days) {
    const to = new Date();
    const from =
      days === 0 ? todayUTC() : new Date(to.getTime() - days * MS_PER_DAY);
    fromInput.value = toDateInputValue(from);
    toInput.value = toDateInputValue(to);
    setActivePreset(days);
    searchFromInputs();
  }

  // ── Copilot selection changed → cascade queues ─────────
  async function onCopilotSelectionChanged(selectedIds) {
    const ticket = ++copilotCascadeSeq;
    queueMs.setEnabled(false);
    queueMs.setItems([]);
    agentMs.setEnabled(false);
    agentMs.setItems([]);

    if (!selectedIds.size) return;

    try {
      // Copilot→queue cascade (fan-out + name resolution) is server-side when
      // backend orchestration is enabled; the direct client mirrors it 1:1.
      // Resolve per-copilot so each queue can be tagged with its copilot name.
      const selected = [...selectedIds];
      const labels = copilotMs.getItems?.() ?? [];
      const nameById = new Map(labels.map((it) => [it.id, it.label ?? it.name]));
      const perCopilot = await Promise.all(
        selected.map((id) =>
          api.getQueuesForCopilots([id], { signal: pageAbort.signal }),
        ),
      );
      if (ticket !== copilotCascadeSeq) return; // a newer selection won

      const seen = new Map();
      perCopilot.forEach((queues, i) => {
        const copilotName = nameById.get(selected[i]) ?? selected[i];
        for (const it of queues) {
          queueCopilotCache.set(it.id, copilotName);
          if (!seen.has(it.id)) seen.set(it.id, it);
        }
      });
      const queueItems = [...seen.values()];

      if (!queueItems.length) {
        queueMs.setItems([]);
        statusEl.textContent = "No queues assigned to the selected copilot(s).";
        return;
      }

      // Keep the local name cache warm for the results table + export.
      for (const it of queueItems) queueNameCache.set(it.id, it.label);

      queueMs.setItems(queueItems);
      queueMs.setEnabled(true);
    } catch (err) {
      if (isAborted(err) || ticket !== copilotCascadeSeq) return;
      console.error("Failed to load assistant queues:", err);
      statusEl.textContent = `Error loading queues: ${err.message}`;
    }
  }

  // ── Queue selection changed → cascade agents ───────────
  async function onQueueSelectionChanged(selectedQueueIds) {
    const ticket = ++queueCascadeSeq;
    agentMs.setEnabled(false);
    agentMs.setItems([]);

    if (!selectedQueueIds.size) return;

    try {
      // Queue→agent cascade (fan-out + de-dup) runs server-side.
      const sorted = await api.getAgentsForQueues([...selectedQueueIds], {
        signal: pageAbort.signal,
      });
      if (ticket !== queueCascadeSeq) return; // a newer selection won

      if (!sorted.length) {
        statusEl.textContent = "No agents found in the selected queue(s).";
        return;
      }

      // Keep the local name cache warm for the results table + export.
      for (const a of sorted) userNameCache.set(a.id, a.label);

      agentMs.setItems(sorted);
      agentMs.setEnabled(true);
    } catch (err) {
      if (isAborted(err) || ticket !== queueCascadeSeq) return;
      console.error("Failed to load queue members:", err);
      statusEl.textContent = `Error loading agents: ${err.message}`;
    }
  }

  // ── Search: query analytics ────────────────────────────
  async function doSearch(from, to) {
    const copilotIds = copilotMs.getSelected();
    const queueIds = queueMs.getSelected();
    const agentIds = agentMs.getSelected();

    if (!copilotIds.size) {
      statusEl.textContent = "Please select at least one copilot.";
      return;
    }
    if (!queueIds.size) {
      statusEl.textContent = "Please select at least one queue.";
      return;
    }

    // Validate interval does not exceed API limit
    const intervalMs = to.getTime() - from.getTime();
    const intervalDays = intervalMs / MS_PER_DAY;
    if (intervalDays > MAX_INTERVAL_DAYS) {
      statusEl.textContent =
        `The selected period spans ${Math.ceil(intervalDays)} days. ` +
        `Maximum allowed is ${MAX_INTERVAL_DAYS} days.`;
      return;
    }

    statusEl.textContent = "Loading…";
    tableWrap.innerHTML = "";
    exportBtn.hidden = true;
    drillPanel.hidden = true;
    expandedRowId = null;
    conversations = [];
    enriched.clear();
    searchTruncated = false;
    expandResults(); // always show table when new search starts

    // Cancel any in-flight enrichment from a previous search. The signal is
    // passed all the way down to fetch, so the requests really do stop.
    if (enrichAbort) enrichAbort.abort();
    enrichAbort = new AbortController();
    const signal = anySignal([enrichAbort.signal, pageAbort.signal]);
    const ticket = ++searchSeq;

    // Lock the search controls: a second search while one is running would
    // interleave two result sets into the same state.
    setSearchEnabled(false);

    try {
      // Backend orchestration: the analytics query shape + pagination run
      // server-side; the browser only sends the selected filters + interval.
      const result = await api.searchConversations({
        copilotIds: [...copilotIds],
        queueIds: [...queueIds],
        agentIds: [...agentIds],
        fromIso: from.toISOString(),
        toIso: to.toISOString(),
        signal,
      });
      if (ticket !== searchSeq) return; // superseded while in flight

      conversations = result.conversations;
      searchTruncated = result.truncated;

      if (!conversations.length) {
        statusEl.textContent =
          "No interactions found for this period and filters.";
        return;
      }

      statusEl.textContent =
        `${conversations.length} interaction${conversations.length !== 1 ? "s" : ""} found` +
        `${searchTruncated ? " (partial — narrow the period or filters for the full set)" : ""}` +
        ` — enriching checklist data…`;

      // Pre-load wrapup code names (best-effort; falls back to ID on failure)
      try {
        const codes = await api.getAllWrapupCodes({ signal });
        for (const c of codes) wrapUpNameCache.set(c.id, c.name);
      } catch (err) {
        if (isAborted(err)) return;
        /* non-fatal — the table falls back to raw wrap-up code IDs */
      }

      renderTable();

      // Enrichment continues in the background so the table is usable straight
      // away; a new search aborts it via `signal`.
      enrichConversations(signal).catch((err) => {
        if (!isAborted(err)) console.error("[Checklists] enrichment failed:", err);
      });
    } catch (err) {
      if (isAborted(err)) return;
      console.error("Analytics query failed:", err);
      statusEl.textContent = `Error: ${err.message}`;
    } finally {
      // Only the newest search may unlock the controls — an older one finishing
      // late must not re-enable them mid-flight.
      if (ticket === searchSeq) setSearchEnabled(true);
    }
  }

  /** Enable/disable everything that can start a new search. */
  function setSearchEnabled(on) {
    searchBtn.disabled = !on;
    applyBtn.disabled = !on;
    for (const btn of presetBtns) btn.disabled = !on;
  }

  // ── Render interaction table ───────────────────────────
  function renderTable() {
    tableWrap.innerHTML = "";

    const table = document.createElement("table");
    table.className = "checklist-table";

    const thead = document.createElement("thead");
    thead.innerHTML = `
      <tr>
        <th>Time</th>
        <th>Agent</th>
        <th>Queue</th>
        <th>Copilot</th>
        <th>Media</th>
        <th>Duration</th>
        <th>Checklist</th>
        <th>Wrapup</th>
        <th>Status</th>
      </tr>
    `;
    table.append(thead);

    const tbody = document.createElement("tbody");

    for (const conv of conversations) {
      const agents = findAllAgentParticipants(conv);
      const agent = agents[0] ?? null;
      const queueId = agent ? extractQueueId(agent) : null;
      const queueName = queueId
        ? (queueNameCache.get(queueId) ?? queueId)
        : "—";
      const copilotName = queueId ? (queueCopilotCache.get(queueId) ?? "—") : "—";
      // Show all agent names comma-separated
      const agentNames = agents
        .map((a) => a.participantName
          ?? (a.userId && userNameCache.get(a.userId))
          ?? a.userId)
        .filter(Boolean);
      const userName = agentNames.length ? agentNames.join(", ") : "—";
      const mediaType = agent ? extractMediaType(agent) : "—";
      const duration = extractTotalDuration(agents);
      const wrapUpCodes = agents.flatMap((a) => resolveWrapUpNames(extractWrapUpCodes(a), wrapUpNameCache));
      const wrapUpText = wrapUpCodes.length ? [...new Set(wrapUpCodes)].join(", ") : "—";

      // Cache user names from analytics data
      for (const a of agents) {
        if (a.userId && a.participantName) {
          userNameCache.set(a.userId, a.participantName);
        }
      }

      const tr = document.createElement("tr");
      tr.className = "checklist-row";
      tr.dataset.convId = conv.conversationId;
      // The row is the control that opens the drill-down, so it has to be
      // reachable and operable without a mouse.
      tr.tabIndex = 0;
      tr.setAttribute("role", "button");
      tr.setAttribute("aria-label", `Interaction details for ${userName}`);

      tr.innerHTML = `
        <td>${escapeHtml(fmtDate(new Date(conv.conversationStart)))}</td>
        <td>${escapeHtml(userName)}</td>
        <td>${escapeHtml(queueName)}</td>
        <td>${escapeHtml(copilotName)}</td>
        <td>${escapeHtml(mediaType)}</td>
        <td>${escapeHtml(fmtDuration(duration))}</td>
        <td class="checklist-cell-name">…</td>
        <td>${escapeHtml(wrapUpText)}</td>
        <td class="checklist-cell-status">
          <span class="checklist-badge checklist-badge--loading">…</span>
        </td>
      `;

      tr.addEventListener("click", () => onRowClick(conv.conversationId));
      tr.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault(); // Space would otherwise scroll the page
          onRowClick(conv.conversationId);
        }
      });
      tbody.append(tr);
    }

    table.append(tbody);
    tableWrap.append(table);
  }

  /**
   * The single definition of "is this interaction currently in scope".
   *
   * Used both to show/hide table rows and to pick the rows for the Excel
   * export, so the download can never disagree with what is on screen.
   *
   * @param {object|undefined} info enrichment record, if it has arrived yet
   */
  function passesFilters(info) {
    // Step 1: status filter (mutually exclusive)
    if (statusFilter === STATUS_FILTER.SUMMARIES) {
      if (!info?.summaries?.length) return false;
    } else if (statusFilter !== STATUS_FILTER.ALL) {
      // COMPLETE / INCOMPLETE — `completion: null` matches neither.
      if (info?.completion !== statusFilter) return false;
    }

    // Step 2: agent-checked filter (AND on top of status)
    if (agentCheckedFilter) {
      const agentTicked = info?.checklists?.some((cl) =>
        cl.checklistItems?.some((item) => item.stateFromAgent === TICK_STATE.TICKED),
      );
      if (!agentTicked) return false;
    }

    return true;
  }

  // ── Apply status filter visibility ─────────────────────
  function applyTableFilter() {
    const rows = tableWrap.querySelectorAll(".checklist-row");
    for (const row of rows) {
      row.hidden = !passesFilters(enriched.get(row.dataset.convId));
    }
    updateChart();
  }

  // ── Update completion bar chart ────────────────────────
  function updateChart() {
    // Count complete / incomplete from visible (filtered) rows
    let complete = 0;
    let incomplete = 0;
    const rows = tableWrap.querySelectorAll(".checklist-row");
    for (const row of rows) {
      if (row.hidden) continue;
      const info = enriched.get(row.dataset.convId);
      if (!info?.checklists?.length) continue;
      // Undetermined records (completion === null) belong in neither bar.
      if (info.completion === STATUS_FILTER.COMPLETE) complete++;
      else if (info.completion === STATUS_FILTER.INCOMPLETE) incomplete++;
    }

    const hasData = complete + incomplete > 0;
    chartWrap.hidden = !hasData;
    if (!hasData) {
      if (chartInstance) { chartInstance.destroy(); chartInstance = null; }
      return;
    }

    const cc = CHART_CONFIG;
    // Read theme-aware chart colours from CSS custom properties
    const cs = getComputedStyle(document.documentElement);
    const chartText  = cs.getPropertyValue("--chart-text").trim()  || cc.axisColor;
    const chartGrid  = cs.getPropertyValue("--chart-grid").trim()  || cc.gridColor;
    const chartTitle = cs.getPropertyValue("--chart-title").trim() || cc.titleColor;

    const data = {
      labels: [LABELS.chartLabelComplete, LABELS.chartLabelIncomplete],
      datasets: [{
        data: [complete, incomplete],
        backgroundColor: [cc.completeColor, cc.incompleteColor],
        borderColor: [cc.completeBorder, cc.incompleteBorder],
        borderWidth: cc.borderWidth,
        borderRadius: cc.borderRadius,
        barPercentage: cc.barPercentage,
      }],
    };

    const options = {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        title: {
          display: true,
          text: cc.title,
          color: chartTitle,
          font: { size: cc.titleFontSize, weight: "600" },
        },
      },
      scales: {
        x: {
          ticks: { color: chartText, font: { size: cc.axisFontSize } },
          grid: { display: false },
        },
        y: {
          beginAtZero: true,
          ticks: {
            color: chartText,
            font: { size: cc.axisFontSize },
            stepSize: 1,
            precision: 0,
          },
          grid: { color: chartGrid },
        },
      },
    };

    if (chartInstance) {
      chartInstance.data = data;
      chartInstance.options = options;
      chartInstance.update();
    } else {
      chartInstance = new Chart(chartCanvas, { type: "bar", data, options });
    }
  }

  // ── Update a single row after enrichment ───────────────
  function updateRowEnrichment(convId) {
    const row = tableWrap.querySelector(
      `tr[data-conv-id="${CSS.escape(convId)}"]`,
    );
    if (!row) return;

    const info = enriched.get(convId);
    const nameCell = row.querySelector(".checklist-cell-name");
    const statusCell = row.querySelector(".checklist-cell-status");

    if (!info || !info.checklists?.length) {
      nameCell.textContent = "—";
      if (info?._error) {
        statusCell.innerHTML =
          `<span class="checklist-badge checklist-badge--error" title="${escapeHtml(info._error)}">${LABELS.badgeError}</span>`;
      } else {
        statusCell.innerHTML =
          `<span class="checklist-badge checklist-badge--none">${LABELS.badgeNone}</span>`;
      }
      return;
    }

    nameCell.textContent = info.checklists.map((c) => c.name).join(", ");

    // completion is null when the checklists carry no items at all: that is
    // undetermined, not a failure, so it gets its own neutral badge.
    if (info.completion === STATUS_FILTER.COMPLETE) {
      statusCell.innerHTML =
        `<span class="checklist-badge checklist-badge--complete">${LABELS.badgeComplete}</span>`;
    } else if (info.completion === STATUS_FILTER.INCOMPLETE) {
      statusCell.innerHTML =
        `<span class="checklist-badge checklist-badge--incomplete">${LABELS.badgeIncomplete}</span>`;
    } else {
      statusCell.innerHTML =
        `<span class="checklist-badge checklist-badge--none">${LABELS.badgeNoItems}</span>`;
    }
  }

  // ── Background enrichment ──────────────────────────────
  async function enrichConversations(signal) {
    const batchConversations = conversations;

    for (let i = 0; i < batchConversations.length; i += ENRICHMENT_BATCH) {
      if (signal.aborted) return; // search was re-triggered
      const batch = batchConversations.slice(i, i + ENRICHMENT_BATCH);

      // Backend orchestration: the whole batch is enriched server-side in a
      // single call; the browser only stores the finished records.
      try {
        const records = await api.enrichConversationBatch(
          batch.map((c) => c.conversationId),
          { signal },
        );

        // Check BEFORE writing, not after. doSearch() clears `enriched` and
        // aborts; a batch that was already in flight would otherwise land in
        // the new search's state and show stale checklists for any
        // conversation the two searches have in common.
        if (signal.aborted) return;

        for (const conv of batch) {
          const rec = records?.[conv.conversationId];
          if (rec) {
            enriched.set(conv.conversationId, rec);
            updateRowEnrichment(conv.conversationId);
          }
        }
      } catch (err) {
        if (isAborted(err)) return;
        console.error("[Checklists] batch enrichment failed:", err);
      }

      if (signal.aborted) return;
      applyTableFilter();
    }

    if (signal.aborted) return;

    // Final status update
    const total = batchConversations.length;
    const withChecklist = [...enriched.values()].filter(
      (e) => e.checklists?.length,
    ).length;
    const withError = [...enriched.values()].filter(
      (e) => e._error,
    ).length;
    let statusText =
      `${total} interaction${total !== 1 ? "s" : ""} — ` +
      `${withChecklist} with checklist data`;
    if (withError) {
      statusText += ` — ${withError} failed (hover badge for details)`;
    }
    if (searchTruncated) {
      statusText +=
        " — partial result set (the period matched more interactions than can be returned at once)";
    }
    statusEl.textContent = statusText;

    // Show export button once enrichment is done
    exportBtn.hidden = !withChecklist;
    updateChart();
  }

  // ── Export to Excel (three-sheet XLSX) ─────────────────
  function exportToExcel() {
    try {
      if (typeof XLSX === "undefined") {
        statusEl.textContent = "⚠ Excel library not loaded. Please reload the page.";
        return;
      }

      // Only the interactions currently in scope — the export must match the
      // table and chart, not silently include rows the filters hid.
      const exportable = conversations.filter((conv) => {
        const info = enriched.get(conv.conversationId);
        return info?.checklists?.length && passesFilters(info);
      });

      // ── Sheet 2: Interactions ────────────────────────────
      const interactionRows = [];
      for (const conv of exportable) {
        const convId = conv.conversationId;
        const info = enriched.get(convId);

        const agents = findAllAgentParticipants(conv);
        const agent = agents[0] ?? null;
        const queueId = agent ? extractQueueId(agent) : null;
        const queueName = queueId ? (queueNameCache.get(queueId) ?? queueId) : "";
        const copilotName = queueId ? (queueCopilotCache.get(queueId) ?? "") : "";
        const agentNames = agents
          .map((a) => a.participantName
            ?? (a.userId && userNameCache.get(a.userId))
            ?? a.userId)
          .filter(Boolean);
        const userName = agentNames.join(", ");
        const mediaType = agent ? extractMediaType(agent) : "";
        const duration = extractTotalDuration(agents);
        const wrapUpExport = agents
          .flatMap((a) => resolveWrapUpNames(extractWrapUpCodes(a), wrapUpNameCache))
          .filter((v, i, arr) => arr.indexOf(v) === i)
          .join(", ");

        interactionRows.push({
          "Conversation ID": convId,
          "Time": conv.conversationStart ? new Date(conv.conversationStart) : "",
          "Agent": userName,
          "Queue": queueName,
          "Copilot": copilotName,
          "Media": mediaType ?? "",
          "Duration (s)": duration ? Math.round(duration / 1000) : 0,
          "Checklist": info.checklists.map((c) => c.name).join(", "),
          "Wrapup": wrapUpExport,
          "Status": exportStatus(info.completion),
        });
      }

      if (!interactionRows.length) {
        statusEl.textContent = "⚠ No checklist data to export for the current filters.";
        return;
      }

      // ── Sheet 3: Checklist Items ─────────────────────────
      const itemRows = [];
      for (const conv of exportable) {
        const convId = conv.conversationId;
        const info = enriched.get(convId);

        for (const cl of info.checklists) {
          for (const item of cl.checklistItems ?? []) {
            itemRows.push({
              "Conversation ID": convId,
              "Checklist": cl.name ?? "",
              "Agent": cl._agentName ?? "",
              "Item": item.name ?? "",
              "Description": item.description ?? "",
              "Agent Ticked": item.stateFromAgent === TICK_STATE.TICKED ? "Yes" : "No",
              "AI Ticked": item.stateFromModel === TICK_STATE.TICKED ? "Yes" : "No",
              "Important": item.important ? "Yes" : "No",
            });
          }
        }
      }

      // ── Sheet 1: Summary (pre-aggregated pivot) ──────────
      const summaryMap = new Map(); // key → { agent, queue, copilot, checklist, total, complete, incomplete }
      for (const row of interactionRows) {
        const key = `${row.Agent}|${row.Queue}|${row.Copilot}|${row.Checklist}`;
        if (!summaryMap.has(key)) {
          summaryMap.set(key, {
            Agent: row.Agent,
            Queue: row.Queue,
            Copilot: row.Copilot,
            Checklist: row.Checklist,
            Total: 0,
            Complete: 0,
            Incomplete: 0,
          });
        }
        const s = summaryMap.get(key);
        s.Total++;
        if (row.Status === "Complete") s.Complete++;
        else if (row.Status === "Incomplete") s.Incomplete++;
      }
      const summaryRows = [...summaryMap.values()].map((s) => ({
        ...s,
        // Percentage of the interactions that could be judged, so checklists
        // with no items don't drag the figure down.
        "Completion %": s.Complete + s.Incomplete
          ? Math.round((s.Complete / (s.Complete + s.Incomplete)) * 100) + "%"
          : "—",
      }));

      // ── Build workbook ───────────────────────────────────
      const wb = XLSX.utils.book_new();
      appendSheet(wb, "Summary", summaryRows);
      appendSheet(wb, "Interactions", interactionRows);
      appendSheet(wb, "Checklist Items", itemRows);

      // ── Download via URL-hash + helper page ─────────────────
      // The app runs inside a cross-origin Genesys Cloud iframe where
      // downloads, showSaveFilePicker, postMessage, and localStorage
      // are all blocked or partitioned. Solution: encode the file as
      // base64 in the URL hash of download.html. The hash fragment
      // never leaves the browser and Chrome supports ~2 MB URLs.
      const today = new Date().toISOString().slice(0, 10);
      const fileName = `${EXPORT_FILENAME_PREFIX}_${today}.xlsx`;
      const b64 = XLSX.write(wb, { bookType: "xlsx", type: "base64" });

      // Refuse rather than hand the browser a URL it will truncate into a
      // corrupt file.
      if (b64.length > EXPORT_MAX_B64_BYTES) {
        statusEl.textContent =
          `⚠ This export is too large to download (${Math.round(b64.length / 1024)} KB). ` +
          `Narrow the period or the filters and try again.`;
        return;
      }

      const helperUrl = new URL("download.html", document.baseURI);
      helperUrl.hash = encodeURIComponent(fileName) + "|" + b64;

      const popup = window.open(helperUrl.href, "_blank");
      if (!popup) {
        statusEl.textContent = "⚠ Pop-up blocked. Please allow pop-ups for this site and try again.";
        return;
      }
      statusEl.textContent =
        `⬇ Exported ${interactionRows.length} interaction${interactionRows.length !== 1 ? "s" : ""}` +
        ` — ${LABELS.exportFiltered}`;
    } catch (err) {
      statusEl.textContent = `⚠ Export failed: ${err.message}`;
    }
  }

  /** Excel-facing wording for a completion value (null = nothing to judge). */
  function exportStatus(completion) {
    if (completion === STATUS_FILTER.COMPLETE) return "Complete";
    if (completion === STATUS_FILTER.INCOMPLETE) return "Incomplete";
    return "No items";
  }

  // ── Row click → drill-down ─────────────────────────────
  function onRowClick(convId) {
    if (expandedRowId === convId) {
      drillPanel.hidden = true;
      expandedRowId = null;
      highlightRow(null);
      return;
    }

    expandedRowId = convId;
    highlightRow(convId);
    tableWrap.hidden = true;
    resultsToggle.setAttribute("aria-expanded", "false");
    resultsChevron.textContent = "▶";

    const info = enriched.get(convId);
    const hasChecklists = info?.checklists?.length > 0;
    const hasSummaries = info?.summaries?.length > 0;

    if (!info || (!hasChecklists && !hasSummaries)) {
      drillPanel.hidden = false;
      drillPanel.innerHTML = `
        <div class="checklist-drilldown__header">
          <h3>Interaction Detail</h3>
          <button type="button" class="btn btn-sm checklist-drilldown__close">✕</button>
        </div>
        <p class="checklist-drilldown__empty">
          ${info ? "No checklist or summary data for this interaction." : "Still loading data…"}
        </p>
      `;
      drillPanel
        .querySelector(".checklist-drilldown__close")
        ?.addEventListener("click", () => {
          drillPanel.hidden = true;
          expandedRowId = null;
          highlightRow(null);
          tableWrap.hidden = false;
          resultsToggle.setAttribute("aria-expanded", "true");
          resultsChevron.textContent = "▼";
        });
      return;
    }

    renderDrillDown(convId, info.checklists, info.summaries ?? []);
  }

  function highlightRow(convId) {
    for (const row of tableWrap.querySelectorAll(".checklist-row")) {
      row.classList.toggle(
        "checklist-row--active",
        row.dataset.convId === convId,
      );
    }
  }

  function expandResults() {
    tableWrap.hidden = false;
    resultsToggle.setAttribute("aria-expanded", "true");
    resultsChevron.textContent = "▼";
  }

  function makeCollapsible(title, content, expanded = true) {
    const wrap = document.createElement("div");
    wrap.className = "checklist-drilldown__collapsible";

    const chevron = document.createElement("span");
    chevron.className = "checklist-drilldown__collapsible-chevron";
    chevron.textContent = expanded ? "▼" : "▶";

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "checklist-drilldown__collapsible-toggle";
    toggle.setAttribute("aria-expanded", String(expanded));
    toggle.append(chevron, document.createTextNode(" " + title));

    const body = document.createElement("div");
    body.className = "checklist-drilldown__collapsible-body";
    body.hidden = !expanded;
    body.append(content);

    toggle.addEventListener("click", () => {
      const isOpen = !body.hidden;
      body.hidden = isOpen;
      toggle.setAttribute("aria-expanded", String(!isOpen));
      chevron.textContent = isOpen ? "▶" : "▼";
    });

    wrap.append(toggle, body);
    return wrap;
  }

  function renderDrillDown(convId, checklists, summaries) {
    drillPanel.hidden = false;
    drillPanel.innerHTML = "";

    // Header with close button
    const hdr = document.createElement("div");
    hdr.className = "checklist-drilldown__header";
    const h3 = document.createElement("h3");
    h3.textContent = "Interaction Detail";
    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "btn btn-sm checklist-drilldown__close";
    closeBtn.textContent = "✕";
    closeBtn.addEventListener("click", () => {
      drillPanel.hidden = true;
      expandedRowId = null;
      highlightRow(null);
      tableWrap.hidden = false;
      resultsToggle.setAttribute("aria-expanded", "true");
      resultsChevron.textContent = "▼";
    });
    hdr.append(h3, closeBtn);
    drillPanel.append(hdr);

    // ── Recording Section ────────────────────────────────
    const recSection = document.createElement("div");
    recSection.className = "checklist-drilldown__recording";

    const loadBtn = document.createElement("button");
    loadBtn.type = "button";
    loadBtn.className = "btn btn-sm checklist-drilldown__recording-btn";
    loadBtn.textContent = "🎧 Load Recordings";

    const fetchStubs = async () => {
      let stubs;
      try {
        stubs = await api.getConversationRecordings(convId, { signal: pageAbort.signal });
      } catch (e) {
        if (isAborted(e)) throw e;
        // 404 means the conversation has no recordings — treat as empty
        if (/\b404\b/.test(e.message)) return [];
        throw e;
      }
      const stubList = Array.isArray(stubs)
        ? stubs
        : Array.isArray(stubs?.entities) ? stubs.entities
        : stubs ? [stubs] : [];
      return stubList.filter(
        (r) => r.id && !r.deletedDate && r.fileState !== "DELETED",
      );
    };

    loadBtn.addEventListener("click", async () => {
      if (loadBtn.dataset.loaded) return;
      loadBtn.disabled = true;
      loadBtn.textContent = "⏳ Loading…";

      try {
        // Step 1: fetch stubs; retry up to 2 more times if Genesys hasn't indexed yet
        let available = await fetchStubs();
        for (let stubRetry = 0; !available.length && stubRetry < 2; stubRetry++) {
          loadBtn.textContent = "⏳ Retrying…";
          await sleep(3000, pageAbort.signal);
          available = await fetchStubs();
        }

        // Lock after all attempts so the button can't be clicked again
        loadBtn.dataset.loaded = "1";

        if (!available.length) {
          recSection.innerHTML = "";
          const msg = document.createElement("span");
          msg.className = "checklist-drilldown__recording-msg";
          msg.textContent = "No recordings for this interaction.";
          recSection.append(msg);
          return;
        }

        // Recordings found — clear section and build correct DOM order:
        // buttons row first, then player slots below
        recSection.innerHTML = "";
        const multiPart = available.length > 1;
        const btnRow = document.createElement("div");
        btnRow.className = "checklist-drilldown__recording-btns";
        const playerArea = document.createElement("div");
        playerArea.className = "checklist-drilldown__recording-player";

        // One button per recording — player is fetched and shown only on click
        for (let i = 0; i < available.length; i++) {
          const stub = available[i];
          const btnLabel = multiPart ? `🎧 Part ${i + 1}` : "🎧 Play Recording";

          const recBtn = document.createElement("button");
          recBtn.type = "button";
          recBtn.className = "btn btn-sm checklist-drilldown__recording-btn";
          recBtn.textContent = btnLabel;

          const playerSlot = document.createElement("div");
          playerSlot.className = "checklist-drilldown__recording-slot";
          playerSlot.hidden = true;

          btnRow.append(recBtn);
          playerArea.append(playerSlot);

          recBtn.addEventListener("click", async () => {
            // Toggle: already loaded and visible → hide
            if (playerSlot.dataset.loaded && !playerSlot.hidden) {
              playerSlot.hidden = true;
              recBtn.classList.remove("checklist-drilldown__recording-btn--active");
              return;
            }
            // Already loaded but hidden → just show
            if (playerSlot.dataset.loaded) {
              playerSlot.hidden = false;
              recBtn.classList.add("checklist-drilldown__recording-btn--active");
              return;
            }
            // First click — fetch URI with retry for transcoding
            recBtn.disabled = true;
            recBtn.textContent = "⏳ Transcoding…";
            const MAX_TRANSCODE_ATTEMPTS = 5;
            const TRANSCODE_RETRY_DELAY = 3000;
            try {
              if (stub.fileState === "ARCHIVED") {
                playerSlot.innerHTML = `<span class="checklist-drilldown__recording-msg">Archived — not directly playable.</span>`;
              } else {
                const isScreenStub = (stub.media ?? stub.mediaType ?? "").toLowerCase() === "screen";
                const formatId = isScreenStub ? "WEBM" : "MP3";

                let uri = null;
                let rec = null;
                for (let attempt = 0; attempt < MAX_TRANSCODE_ATTEMPTS; attempt++) {
                  rec = await api.getConversationRecording(convId, stub.id, formatId, {
                    signal: pageAbort.signal,
                  });
                  uri = rec?.mediaUris?.[formatId]?.mediaUri
                    ?? rec?.mediaUris?.MP3?.mediaUri
                    ?? rec?.mediaUris?.WEBM?.mediaUri
                    ?? rec?.mediaUris?.WAV?.mediaUri
                    ?? rec?.mediaUri
                    ?? Object.values(rec?.mediaUris ?? {})[0]?.mediaUri
                    ?? null;
                  if (uri) break;
                  if (attempt < MAX_TRANSCODE_ATTEMPTS - 1) {
                    await sleep(TRANSCODE_RETRY_DELAY, pageAbort.signal);
                  }
                }

                if (!uri) {
                  playerSlot.innerHTML = `<span class="checklist-drilldown__recording-msg">Recording not yet available (may still be processing).</span>`;
                } else {
                  const isScreen = isScreenStub || (rec.mediaType ?? rec.media ?? "").toLowerCase() === "screen";
                  const media = document.createElement(isScreen ? "video" : "audio");
                  media.controls = true;
                  media.src = uri;
                  media.className = "checklist-drilldown__recording-media";
                  playerSlot.append(media);
                }
              }
              playerSlot.dataset.loaded = "1";
            } catch (recErr) {
              if (isAborted(recErr)) return; // page was torn down
              playerSlot.innerHTML =
                `<span class="checklist-drilldown__recording-msg checklist-drilldown__recording-msg--error">` +
                `Could not load: ${escapeHtml(recErr.message ?? "Unknown error")}</span>`;
              playerSlot.dataset.loaded = "1";
            }
            playerSlot.hidden = false;
            recBtn.classList.add("checklist-drilldown__recording-btn--active");
            recBtn.textContent = btnLabel;
            recBtn.disabled = false;
          });
        }

        recSection.append(btnRow, playerArea);
      } catch (err) {
        if (isAborted(err)) return; // page was torn down
        recSection.innerHTML = "";
        loadBtn.dataset.loaded = "1";
        const msg = document.createElement("span");
        msg.className = "checklist-drilldown__recording-msg checklist-drilldown__recording-msg--error";
        msg.textContent = `Could not load recordings: ${escapeHtml(err.message ?? "Unknown error")}`;
        recSection.append(msg);
      }
    });

    recSection.append(loadBtn);

    drillPanel.append(makeCollapsible("🎧 Recording", recSection, true));

    const checklistsBody = document.createElement("div");
    for (const cl of checklists) {
      const section = document.createElement("div");
      section.className = "checklist-drilldown__section";

      const title = document.createElement("h4");
      title.className = "checklist-drilldown__title";
      const clLabel = cl.name || "Checklist";
      title.textContent = cl._agentName
        ? `${clLabel} (Agent: ${cl._agentName})`
        : clLabel;
      section.append(title);

      // Meta line (status + dates)
      const meta = document.createElement("div");
      meta.className = "checklist-drilldown__meta";
      const parts = [];
      if (cl.status) parts.push(`Status: ${cl.status}`);
      if (cl.evaluationStartDate)
        parts.push(`Started: ${fmtDate(new Date(cl.evaluationStartDate))}`);
      if (cl.evaluationFinalizedDate)
        parts.push(`Finalized: ${fmtDate(new Date(cl.evaluationFinalizedDate))}`);
      meta.textContent = parts.join(" · ");
      section.append(meta);

      // Checklist items
      const itemList = document.createElement("ul");
      itemList.className = "checklist-drilldown__items";

      for (const item of cl.checklistItems ?? []) {
        const agentTicked = item.stateFromAgent === TICK_STATE.TICKED;
        const modelTicked = item.stateFromModel === TICK_STATE.TICKED;
        const ticked = agentTicked || modelTicked;

        const li = document.createElement("li");
        li.className =
          "checklist-drilldown__item " +
          (ticked
            ? "checklist-drilldown__item--ticked"
            : "checklist-drilldown__item--unticked");

        li.innerHTML = `
          <span class="checklist-drilldown__icon">${ticked ? "✅" : "❌"}</span>
          <span class="checklist-drilldown__item-name">${escapeHtml(item.name)}</span>
          ${item.important ? `<span class="checklist-drilldown__important" title="Important">⚡</span>` : ""}
          <span class="checklist-drilldown__eval" title="Agent: ${agentTicked ? TICK_STATE.TICKED : TICK_STATE.UNTICKED}">
            Agent: <span class="${agentTicked ? 'checklist-drilldown__tick--green' : 'checklist-drilldown__tick--red'}">${agentTicked ? "✓" : "✗"}</span>
          </span>
          <span class="checklist-drilldown__eval" title="AI: ${modelTicked ? TICK_STATE.TICKED : TICK_STATE.UNTICKED}">
            AI: <span class="${modelTicked ? 'checklist-drilldown__tick--green' : 'checklist-drilldown__tick--red'}">${modelTicked ? "✓" : "✗"}</span>
          </span>
        `;

        if (item.description) {
          const desc = document.createElement("div");
          desc.className = "checklist-drilldown__item-desc";
          desc.textContent = item.description;
          li.append(desc);
        }

        itemList.append(li);
      }

      section.append(itemList);
      checklistsBody.append(section);
    }
    drillPanel.append(makeCollapsible("Checklists", checklistsBody, true));

    // ── Conversation Summaries ──────────────────────────
    if (summaries.length) {
      const sumTitle = summaries.length === 1
        ? "Conversation Summary"
        : `Conversation Summaries (${summaries.length})`;
      const sumBody = document.createElement("div");

      summaries.forEach((s, idx) => {
        const card = document.createElement("div");
        card.className = "checklist-drilldown__summary";

        // If multiple summaries, show an index label
        if (summaries.length > 1) {
          const label = document.createElement("div");
          label.className = "checklist-drilldown__sum-label";
          const labelParts = [`Summary ${idx + 1} of ${summaries.length}`];
          if (s._agentName) labelParts.push(`Agent: ${s._agentName}`);
          label.textContent = labelParts.join(" — ");
          card.append(label);
        } else if (s._agentName) {
          const label = document.createElement("div");
          label.className = "checklist-drilldown__sum-label";
          label.textContent = `Agent: ${s._agentName}`;
          card.append(label);
        }

        // Helper: extract text from either { text: "..." } or a plain string
        const txt = (v) => (typeof v === "string" ? v : v?.text ?? v?.value ?? null);
        // Helper: check if an edited object has content
        const hasEdited = (v) => v && typeof v === "object" && Object.keys(v).length > 0;

        // Helper: render a summary field with optional edited version
        const renderField = (label, original, edited) => {
          const origText = txt(original);
          const editText = hasEdited(edited) ? txt(edited) : null;
          if (!origText && !editText) return;

          if (editText) {
            // Show edited version as primary, original as struck-through
            const wrap = document.createElement("div");
            wrap.className = "checklist-drilldown__sum-field";
            wrap.innerHTML = `<strong>${escapeHtml(label)}:</strong> ${escapeHtml(editText)} <span class="checklist-drilldown__edited-badge" title="Edited by agent">✏️ Edited</span>`;
            card.append(wrap);
            if (origText && origText !== editText) {
              const orig = document.createElement("div");
              orig.className = "checklist-drilldown__sum-field checklist-drilldown__sum-field--original";
              orig.innerHTML = `<strong>Original:</strong> <span class="checklist-drilldown__strikethrough">${escapeHtml(origText)}</span>`;
              card.append(orig);
            }
          } else if (origText) {
            const r = document.createElement("div");
            r.className = "checklist-drilldown__sum-field";
            r.innerHTML = `<strong>${escapeHtml(label)}:</strong> ${escapeHtml(origText)}`;
            card.append(r);
          }
        };

        // Headline
        const headline = txt(s.headline);
        if (headline) {
          const hl = document.createElement("div");
          hl.className = "checklist-drilldown__sum-headline";
          hl.textContent = headline;
          card.append(hl);
        }

        // Helper: render a topic field (text with edited support) + optional description + outcome
        const renderTopicField = (label, original, edited) => {
          renderField(label, original, edited);
          if (original && typeof original === "object") {
            if (original.description) {
              const descEl = document.createElement("div");
              descEl.className = "checklist-drilldown__sum-field checklist-drilldown__sum-field--sub";
              descEl.textContent = original.description;
              card.append(descEl);
            }
            if (original.outcome) {
              const outcomeEl = document.createElement("div");
              outcomeEl.className = "checklist-drilldown__sum-field checklist-drilldown__sum-field--sub";
              outcomeEl.innerHTML = `<strong>Outcome:</strong> ${escapeHtml(original.outcome)}`;
              card.append(outcomeEl);
            }
          }
        };

        // Known fields: Reason, Resolution, Followup — with edited support + description/outcome
        renderTopicField("Reason", s.reason, s.editedReason);
        renderTopicField("Resolution", s.resolution, s.editedResolution);
        renderTopicField("Followup", s.followup, s.editedFollowup);

        // Edited summary (top-level text)
        const editedSummaryText = hasEdited(s.editedSummary) ? txt(s.editedSummary) : null;

        // Dynamic extra topics — render any remaining { text/... } objects
        // that aren't part of the known set
        const knownKeys = new Set([
          "id", "text", "description", "confidence", "status", "mediaType",
          "language", "headline", "reason", "resolution", "followup",
          "editedSummary", "editedReason", "editedResolution", "editedFollowup",
          "predictedWrapupCodes", "dateCreated", "extractedEntities",
          "communication", "participants", "selfUri", "conversation",
          "_agentName", // shown as the "Agent" label above; don't render as a stray topic
        ]);
        for (const [key, val] of Object.entries(s)) {
          if (knownKeys.has(key)) continue;
          // Only render objects/strings that look like topic fields
          const topicText = txt(val);
          if (!topicText) continue;
          // Check for a corresponding edited version (editedXxx)
          const editedKey = `edited${key.charAt(0).toUpperCase()}${key.slice(1)}`;
          renderTopicField(key.charAt(0).toUpperCase() + key.slice(1), val, s[editedKey]);
          knownKeys.add(editedKey); // don't re-render the edited key itself
        }

        // Full text / description
        const fullText = txt(s.text) || txt(s.description);
        if (editedSummaryText) {
          const t = document.createElement("div");
          t.className = "checklist-drilldown__sum-text";
          t.innerHTML = `${escapeHtml(editedSummaryText)} <span class="checklist-drilldown__edited-badge" title="Edited by agent">✏️ Edited</span>`;
          card.append(t);
          if (fullText && fullText !== editedSummaryText) {
            const orig = document.createElement("div");
            orig.className = "checklist-drilldown__sum-text checklist-drilldown__sum-text--original";
            orig.innerHTML = `<strong>Original:</strong> <span class="checklist-drilldown__strikethrough">${escapeHtml(fullText)}</span>`;
            card.append(orig);
          }
        } else if (fullText) {
          const t = document.createElement("div");
          t.className = "checklist-drilldown__sum-text";
          t.textContent = fullText;
          card.append(t);
        }

        // Confidence & status
        const meta = document.createElement("div");
        meta.className = "checklist-drilldown__sum-meta";
        const metaParts = [];
        if (s.status) metaParts.push(`Status: ${s.status}`);
        if (metaParts.length) {
          meta.textContent = metaParts.join(" · ");
          card.append(meta);
        }

        // Predicted wrapup codes
        if (Array.isArray(s.predictedWrapupCodes) && s.predictedWrapupCodes.length) {
          const wrapDiv = document.createElement("div");
          wrapDiv.className = "checklist-drilldown__sum-field";
          wrapDiv.innerHTML = `<strong>Suggested wrapup:</strong> ${escapeHtml(s.predictedWrapupCodes.map((w) => w.name).join(", "))}`;
          card.append(wrapDiv);
        }

        sumBody.append(card);
      });
      drillPanel.append(makeCollapsible(sumTitle, sumBody, false));
    }
  }

  // ── Teardown ───────────────────────────────────────────
  // Called by the router before this page is swapped out. Without it the theme
  // listener, the Chart.js instance and any in-flight request would outlive the
  // view (see the PAGE TEARDOWN note in router.js).
  root.dispose = () => {
    pageAbort.abort();
    enrichAbort?.abort();
    if (chartInstance) {
      chartInstance.destroy();
      chartInstance = null;
    }
  };

  // ── Bootstrap ──────────────────────────────────────────
  statusEl.textContent = "Loading copilot assistants…";

  try {
    const copilotsEnabled = await api.getCopilots({ signal: pageAbort.signal });

    if (!copilotsEnabled.length) {
      statusEl.textContent =
        "No copilot-enabled assistants found in this org.";
      return root;
    }

    copilotMs.setItems(
      copilotsEnabled.map((a) => ({ id: a.id, label: a.name })),
    );
    statusEl.textContent =
      `${copilotsEnabled.length} copilot assistant${copilotsEnabled.length !== 1 ? "s" : ""} available` +
      ` — select copilot(s) and queue(s), then search.`;

    // Set default date range
    const to = new Date();
    const from =
      DEFAULT_RANGE_DAYS === 0
        ? todayUTC()
        : new Date(to.getTime() - DEFAULT_RANGE_DAYS * MS_PER_DAY);
    fromInput.value = toDateInputValue(from);
    toInput.value = toDateInputValue(to);
    setActivePreset(DEFAULT_RANGE_DAYS);
  } catch (err) {
    if (isAborted(err)) return root;
    console.error("Failed to load assistants:", err);
    statusEl.textContent = `Error loading assistants: ${err.message}`;
  }

  return root;
}
