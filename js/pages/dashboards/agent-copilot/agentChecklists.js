/**
 * Dashboards › Agent Copilot › Agent Checklists & Summaries
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
  QUERY_PAGE_SIZE,
  ENRICHMENT_BATCH,
  QUEUE_RESOLVE_BATCH,
  MS_PER_DAY,
  MEDIA_KEYS,
  PURPOSE_AGENT,
  METRIC_HANDLE_TIME,
  TICK_STATE,
  STATUS_FILTER,
  TABLE_DATE_FORMAT,
  CHART_CONFIG,
  EXPORT_FILENAME_PREFIX,
  EXPORT_SUMMARY_COLS,
  EXPORT_INTERACTION_COLS,
  EXPORT_ITEM_COLS,
  LABELS,
} from "./checklistConfig.js";

/* ── Helpers ───────────────────────────────────────────── */

function todayUTC() {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
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

/** Find the agent participant in an analytics conversation record. */
function findAgentParticipant(conv) {
  return (conv.participants ?? []).find((p) => p.purpose === PURPOSE_AGENT);
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
 * Determine completion across ALL checklists: "complete" only if
 * every item in every checklist is ticked (by agent or model).
 */
function checklistCompletion(checklists) {
  const all = (Array.isArray(checklists) ? checklists : [checklists]).filter(Boolean);
  const items = all.flatMap((cl) => cl.checklistItems ?? []);
  if (!items.length) return null;
  const allTicked = items.every(
    (it) => it.stateFromAgent === TICK_STATE.TICKED || it.stateFromModel === TICK_STATE.TICKED,
  );
  return allTicked ? STATUS_FILTER.COMPLETE : STATUS_FILTER.INCOMPLETE;
}

/**
 * Parse the conversation summaries API response into a flat array.
 * The API returns { summary: {...}, sessionSummaries: [{...}] } — not { entities: [...] }.
 * `sessionSummaries` contains per-session summaries (e.g. one per transfer leg).
 * The top-level `summary` is the overall/combined summary.
 */
function parseSummaries(res) {
  if (!res || typeof res !== "object") return [];
  const out = [];
  // Per-session summaries (one per transfer leg)
  if (Array.isArray(res.sessionSummaries)) {
    out.push(...res.sessionSummaries);
  }
  // Top-level combined summary (add only if there are no session summaries,
  // or add it as the overall summary when there are multiple sessions)
  if (res.summary && typeof res.summary === "object" && Object.keys(res.summary).length) {
    // Avoid duplicating if the top-level summary is identical to the only session summary
    if (out.length !== 1) {
      out.unshift(res.summary);
    }
  }
  // Fallback: entities array (some API versions)
  if (!out.length && Array.isArray(res.entities)) {
    out.push(...res.entities);
  }
  return out;
}

/* ── Main render ───────────────────────────────────────── */

export async function render({ route, me, api }) {
  // ── State ──────────────────────────────────────────────
  let conversations = [];         // analytics detail records
  const enriched = new Map();     // convId → { checklists, communicationId, completion }
  const queueNameCache = new Map(); // queueId → name
  const userNameCache = new Map();  // userId → name
  const wrapUpNameCache = new Map(); // wrapUpCodeId → name
  let statusFilter = STATUS_FILTER.ALL;
  let agentCheckedFilter = false;
  let enrichAbort = null;          // AbortController for in-flight enrichment
  let expandedRowId = null;       // conversationId currently drilled-down

  // ── DOM skeleton ───────────────────────────────────────
  const root = document.createElement("div");
  root.className = "checklist-view";

  // Header (title + export button)
  const header = document.createElement("div");
  header.className = "checklist-header";
  header.innerHTML = `<h2>Agent Checklists &amp; Summaries</h2>`;

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
    if (fromInput.value && toInput.value) {
      setActivePreset(null);
      doSearch(
        new Date(fromInput.value + "T00:00:00Z"),
        new Date(toInput.value + "T23:59:59Z"),
      );
    }
  });

  periodWrap.append(...presetBtns, fromInput, toInput, applyBtn);

  // Search button
  const searchBtn = document.createElement("button");
  searchBtn.type = "button";
  searchBtn.className = "btn btn-sm checklist-search-btn";
  searchBtn.textContent = LABELS.searchBtn;
  searchBtn.addEventListener("click", () => {
    if (fromInput.value && toInput.value) {
      doSearch(
        new Date(fromInput.value + "T00:00:00Z"),
        new Date(toInput.value + "T23:59:59Z"),
      );
    }
  });

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

  // Re-render chart when OS theme changes so colours update
  const themeMedia = window.matchMedia("(prefers-color-scheme: dark)");
  themeMedia.addEventListener("change", () => {
    if (chartInstance) { chartInstance.destroy(); chartInstance = null; }
    updateChart();
  });

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

  // ── Load a preset range ────────────────────────────────
  function loadRange(days) {
    const to = new Date();
    const from =
      days === 0 ? todayUTC() : new Date(to.getTime() - days * MS_PER_DAY);
    fromInput.value = from.toISOString().slice(0, 10);
    toInput.value = to.toISOString().slice(0, 10);
    setActivePreset(days);
    doSearch(from, to);
  }

  // ── Copilot selection changed → cascade queues ─────────
  async function onCopilotSelectionChanged(selectedIds) {
    queueMs.setEnabled(false);
    queueMs.setItems([]);
    agentMs.setEnabled(false);
    agentMs.setItems([]);

    if (!selectedIds.size) return;

    try {
      // Fetch queues for every selected assistant in parallel
      const results = await Promise.all(
        [...selectedIds].map((id) => api.getAssistantQueues(id)),
      );

      // Collect unique queue IDs
      const queueIdSet = new Set();
      for (const queues of results) {
        for (const q of queues) queueIdSet.add(q.id);
      }

      if (!queueIdSet.size) {
        queueMs.setItems([]);
        statusEl.textContent = "No queues assigned to the selected copilot(s).";
        return;
      }

      // Resolve queue names (parallel, with cache)
      const queueItems = await resolveQueueNames([...queueIdSet]);
      queueMs.setItems(queueItems);
      queueMs.setEnabled(true);
    } catch (err) {
      console.error("Failed to load assistant queues:", err);
      statusEl.textContent = `Error loading queues: ${err.message}`;
    }
  }

  /** Resolve an array of queue IDs to [{ id, label }], using cache. */
  async function resolveQueueNames(ids) {
    const uncached = ids.filter((id) => !queueNameCache.has(id));

    // Fetch uncached in parallel batches
    for (let i = 0; i < uncached.length; i += QUEUE_RESOLVE_BATCH) {
      const batch = uncached.slice(i, i + QUEUE_RESOLVE_BATCH);
      const results = await Promise.allSettled(
        batch.map((id) => api.getQueue(id)),
      );
      results.forEach((r, idx) => {
        const name =
          r.status === "fulfilled" && r.value?.name
            ? r.value.name
            : batch[idx];
        queueNameCache.set(batch[idx], name);
      });
    }

    return ids.map((id) => ({ id, label: queueNameCache.get(id) ?? id }));
  }

  // ── Queue selection changed → cascade agents ───────────
  async function onQueueSelectionChanged(selectedQueueIds) {
    agentMs.setEnabled(false);
    agentMs.setItems([]);

    if (!selectedQueueIds.size) return;

    try {
      const results = await Promise.all(
        [...selectedQueueIds].map((id) => api.getQueueMembers(id)),
      );

      // Collect unique agents across all selected queues
      const agentMap = new Map();
      for (const members of results) {
        for (const m of members) {
          const userId = m.id ?? m.user?.id;
          const userName = m.name ?? m.user?.name ?? userId;
          if (userId) {
            agentMap.set(userId, userName);
            userNameCache.set(userId, userName);
          }
        }
      }

      if (!agentMap.size) {
        statusEl.textContent = "No agents found in the selected queue(s).";
        return;
      }

      const sorted = [...agentMap.entries()]
        .map(([id, label]) => ({ id, label }))
        .sort((a, b) => a.label.localeCompare(b.label));
      agentMs.setItems(sorted);
      agentMs.setEnabled(true);
    } catch (err) {
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
    expandResults(); // always show table when new search starts

    // Cancel any in-flight enrichment from a previous search
    if (enrichAbort) enrichAbort.abort();
    enrichAbort = new AbortController();

    const interval = `${from.toISOString()}/${to.toISOString()}`;

    // Build segment filter predicates
    const copilotPredicates = [...copilotIds].map((id) => ({
      dimension: "agentAssistantId",
      value: id,
    }));
    const queuePredicates = [...queueIds].map((id) => ({
      dimension: "queueId",
      value: id,
    }));

    const segmentFilters = [
      { type: "or", predicates: copilotPredicates },
      { type: "or", predicates: queuePredicates },
    ];

    // Optional agent filter
    if (agentIds.size) {
      segmentFilters.push({
        type: "or",
        predicates: [...agentIds].map((id) => ({
          dimension: "userId",
          value: id,
        })),
      });
    }

    const body = {
      interval,
      order: "desc",
      orderBy: "conversationStart",
      segmentFilters,
      paging: { pageSize: QUERY_PAGE_SIZE, pageNumber: 1 },
    };

    try {
      // Auto-paginate to collect ALL matching conversations
      let page = 1;
      for (;;) {
        body.paging.pageNumber = page;
        statusEl.textContent = page === 1
          ? "Loading…"
          : `Loading page ${page}…`;

        const res = await api.queryConversationDetails(body);
        const batch = res?.conversations ?? [];
        conversations.push(...batch);

        // Stop when we received fewer than a full page or no results
        if (batch.length < QUERY_PAGE_SIZE) break;
        page++;
      }

      if (!conversations.length) {
        statusEl.textContent =
          "No interactions found for this period and filters.";
        return;
      }

      statusEl.textContent = `${conversations.length} interaction${conversations.length !== 1 ? "s" : ""} found — enriching checklist data…`;

      // Pre-load wrapup code names (best-effort; falls back to ID on failure)
      try {
        const codes = await api.getAllWrapupCodes();
        for (const c of codes) wrapUpNameCache.set(c.id, c.name);
      } catch (_) { /* non-fatal */ }

      renderTable();
      enrichConversations(enrichAbort.signal);
    } catch (err) {
      console.error("Analytics query failed:", err);
      statusEl.textContent = `Error: ${err.message}`;
    }
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
      const agent = findAgentParticipant(conv);
      const queueId = agent ? extractQueueId(agent) : null;
      const queueName = queueId
        ? (queueNameCache.get(queueId) ?? queueId)
        : "—";
      const userName = agent?.participantName
        ?? (agent?.userId && userNameCache.get(agent.userId))
        ?? agent?.userId
        ?? "—";
      const mediaType = agent ? extractMediaType(agent) : "—";
      const duration = agent ? extractDuration(agent) : 0;
      const wrapUpCodes = agent ? resolveWrapUpNames(extractWrapUpCodes(agent), wrapUpNameCache) : [];
      const wrapUpText = wrapUpCodes.length ? wrapUpCodes.join(", ") : "—";

      // Cache user name from analytics data
      if (agent?.userId && agent.participantName) {
        userNameCache.set(agent.userId, agent.participantName);
      }

      const tr = document.createElement("tr");
      tr.className = "checklist-row";
      tr.dataset.convId = conv.conversationId;

      tr.innerHTML = `
        <td>${escapeHtml(fmtDate(new Date(conv.conversationStart)))}</td>
        <td>${escapeHtml(userName)}</td>
        <td>${escapeHtml(queueName)}</td>
        <td>${escapeHtml(mediaType)}</td>
        <td>${escapeHtml(fmtDuration(duration))}</td>
        <td class="checklist-cell-name">…</td>
        <td>${escapeHtml(wrapUpText)}</td>
        <td class="checklist-cell-status">
          <span class="checklist-badge checklist-badge--loading">…</span>
        </td>
      `;

      tr.addEventListener("click", () => onRowClick(conv.conversationId));
      tbody.append(tr);
    }

    table.append(tbody);
    tableWrap.append(table);
  }

  // ── Apply status filter visibility ─────────────────────
  function applyTableFilter() {
    const rows = tableWrap.querySelectorAll(".checklist-row");
    for (const row of rows) {
      const info = enriched.get(row.dataset.convId);

      // Step 1: status filter (mutually exclusive)
      if (statusFilter === STATUS_FILTER.ALL) {
        row.hidden = false;
      } else if (statusFilter === STATUS_FILTER.SUMMARIES) {
        row.hidden = !info ? true : !info.summaries?.length;
      } else {
        // COMPLETE / INCOMPLETE
        row.hidden = !info ? true : info.completion !== statusFilter;
      }

      // Step 2: agent-checked filter (AND on top of status)
      if (agentCheckedFilter && !row.hidden) {
        row.hidden = !info?.checklists?.some(
          (cl) => cl.checklistItems?.some((item) => item.stateFromAgent === TICK_STATE.TICKED),
        );
      }
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
      if (info.completion === STATUS_FILTER.COMPLETE) complete++;
      else incomplete++;
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
      statusCell.innerHTML =
        `<span class="checklist-badge checklist-badge--none">${LABELS.badgeNone}</span>`;
      return;
    }

    nameCell.textContent = info.checklists.map((c) => c.name).join(", ");

    if (info.completion === STATUS_FILTER.COMPLETE) {
      statusCell.innerHTML =
        `<span class="checklist-badge checklist-badge--complete">${LABELS.badgeComplete}</span>`;
    } else {
      statusCell.innerHTML =
        `<span class="checklist-badge checklist-badge--incomplete">${LABELS.badgeIncomplete}</span>`;
    }
  }

  // ── Background enrichment ──────────────────────────────
  async function enrichConversations(signal) {
    for (let i = 0; i < conversations.length; i += ENRICHMENT_BATCH) {
      if (signal?.aborted) return; // search was re-triggered
      const batch = conversations.slice(i, i + ENRICHMENT_BATCH);
      await Promise.allSettled(batch.map((conv) => enrichOne(conv)));
      if (signal?.aborted) return;
      applyTableFilter();
    }

    // Final status update
    const total = conversations.length;
    const withChecklist = [...enriched.values()].filter(
      (e) => e.checklists?.length,
    ).length;
    statusEl.textContent =
      `${total} interaction${total !== 1 ? "s" : ""} — ` +
      `${withChecklist} with checklist data`;

    // Show export button once enrichment is done
    exportBtn.hidden = !withChecklist;
    updateChart();
  }

  async function enrichOne(conv) {
    const convId = conv.conversationId;
    try {
      // Step 1: Get full conversation to find agent communicationId(s)
      const fullConv = await api.getConversation(convId);
      const agentParts = (fullConv.participants ?? []).filter(
        (p) => p.purpose === PURPOSE_AGENT,
      );
      // Communications live under media-specific keys, NOT a generic key.
      const commIds = agentParts.flatMap((p) =>
        MEDIA_KEYS.flatMap((k) => (p[k] ?? []).map((c) => c.id)),
      );
      if (!commIds.length) {
        // Still fetch summaries even when no agent communications
        let summaries = [];
        try {
          const sumRes = await api.getConversationSummaries(convId);
          summaries = parseSummaries(sumRes);
        } catch (_) { /* no summaries */ }
        enriched.set(convId, {
          checklists: [],
          communicationId: null,
          completion: null,
          summaries,
        });
        updateRowEnrichment(convId);
        return;
      }

      // Step 2: Fetch conversation summaries in parallel with checklists
      let summaries = [];
      try {
        const sumRes = await api.getConversationSummaries(convId);
        summaries = parseSummaries(sumRes);
      } catch (sumErr) {
        console.debug(`[Summaries] No summaries for ${convId}:`, sumErr.message ?? sumErr);
      }

      // Step 3: Try each communication until we find checklists
      for (const commId of commIds) {
        try {
          const checklistRes = await api.getConversationChecklists(convId, commId);
          // Normalise response – API may return { entities: [...] }, an array, or a single object
          let list;
          if (Array.isArray(checklistRes)) {
            list = checklistRes;
          } else if (Array.isArray(checklistRes?.entities)) {
            list = checklistRes.entities;
          } else if (checklistRes && typeof checklistRes === "object" && checklistRes.id) {
            // Single checklist object returned
            list = [checklistRes];
          } else {
            list = [];
          }

          if (list.length) {
            const completion = checklistCompletion(list);
            enriched.set(convId, { checklists: list, communicationId: commId, completion, summaries });
            updateRowEnrichment(convId);
            return;
          }
        } catch (innerErr) {
          // 404 means no checklists for this communication – try next
          console.debug(`[Checklists] No data on comm ${commId} for ${convId}:`, innerErr.message ?? innerErr);
        }
      }

      // None of the communications had checklists
      enriched.set(convId, {
        checklists: [],
        communicationId: commIds[0],
        completion: null,
        summaries,
      });
      updateRowEnrichment(convId);
    } catch (err) {
      console.error(`[Checklists] enrichOne failed for ${convId}:`, err);
      enriched.set(convId, {
        checklists: [],
        communicationId: null,
        completion: null,
        summaries: [],
      });
      updateRowEnrichment(convId);
    }
  }

  // ── Export to Excel (two-sheet XLSX) ───────────────────
  function exportToExcel() {
    try {
      if (typeof XLSX === "undefined") {
        statusEl.textContent = "⚠ Excel library not loaded. Please reload the page.";
        return;
      }

      // ── Sheet 1: Interactions ────────────────────────────
      const interactionRows = [];
      for (const conv of conversations) {
        const convId = conv.conversationId;
        const info = enriched.get(convId);
        if (!info?.checklists?.length) continue;

        const agent = findAgentParticipant(conv);
        const queueId = agent ? extractQueueId(agent) : null;
        const queueName = queueId ? (queueNameCache.get(queueId) ?? queueId) : "";
        const userName = agent?.participantName
          ?? (agent?.userId && userNameCache.get(agent.userId))
          ?? agent?.userId
          ?? "";
        const mediaType = agent ? extractMediaType(agent) : "";
        const duration = agent ? extractDuration(agent) : 0;
        const wrapUpExport = agent
          ? resolveWrapUpNames(extractWrapUpCodes(agent), wrapUpNameCache).join(", ")
          : "";

        interactionRows.push({
          "Conversation ID": convId,
          "Time": conv.conversationStart ? new Date(conv.conversationStart) : "",
          "Agent": userName,
          "Queue": queueName,
          "Media": mediaType ?? "",
          "Duration (s)": duration ? Math.round(duration / 1000) : 0,
          "Checklist": info.checklists.map((c) => c.name).join(", "),
          "Wrapup": wrapUpExport,
          "Status": info.completion === STATUS_FILTER.COMPLETE ? "Complete" : "Incomplete",
        });
      }

      if (!interactionRows.length) {
        statusEl.textContent = "⚠ No checklist data to export.";
        return;
      }

      // ── Sheet 2: Checklist Items ─────────────────────────
      const itemRows = [];
      for (const conv of conversations) {
        const convId = conv.conversationId;
        const info = enriched.get(convId);
        if (!info?.checklists?.length) continue;

        for (const cl of info.checklists) {
          for (const item of cl.checklistItems ?? []) {
            itemRows.push({
              "Conversation ID": convId,
              "Checklist": cl.name ?? "",
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
      const summaryMap = new Map(); // key → { agent, queue, checklist, total, complete, incomplete }
      for (const row of interactionRows) {
        const key = `${row.Agent}|${row.Queue}|${row.Checklist}`;
        if (!summaryMap.has(key)) {
          summaryMap.set(key, {
            Agent: row.Agent,
            Queue: row.Queue,
            Checklist: row.Checklist,
            Total: 0,
            Complete: 0,
            Incomplete: 0,
          });
        }
        const s = summaryMap.get(key);
        s.Total++;
        if (row.Status === "Complete") s.Complete++;
        else s.Incomplete++;
      }
      const summaryRows = [...summaryMap.values()].map((s) => ({
        ...s,
        "Completion %": s.Total ? Math.round((s.Complete / s.Total) * 100) + "%" : "0%",
      }));

      // ── Build workbook ───────────────────────────────────
      const wb = XLSX.utils.book_new();

      const wsSummary = XLSX.utils.json_to_sheet(summaryRows);
      wsSummary["!cols"] = EXPORT_SUMMARY_COLS;
      XLSX.utils.book_append_sheet(wb, wsSummary, "Summary");

      const ws1 = XLSX.utils.json_to_sheet(interactionRows);
      ws1["!cols"] = EXPORT_INTERACTION_COLS;
      XLSX.utils.book_append_sheet(wb, ws1, "Interactions");

      const ws2 = XLSX.utils.json_to_sheet(itemRows);
      ws2["!cols"] = EXPORT_ITEM_COLS;
      XLSX.utils.book_append_sheet(wb, ws2, "Checklist Items");

      // ── Download via URL-hash + helper page ─────────────────
      // The app runs inside a cross-origin Genesys Cloud iframe where
      // downloads, showSaveFilePicker, postMessage, and localStorage
      // are all blocked or partitioned. Solution: encode the file as
      // base64 in the URL hash of download.html. The hash fragment
      // never leaves the browser and Chrome supports ~2 MB URLs.
      const today = new Date().toISOString().slice(0, 10);
      const fileName = `${EXPORT_FILENAME_PREFIX}_${today}.xlsx`;
      const b64 = XLSX.write(wb, { bookType: "xlsx", type: "base64" });

      const helperUrl = new URL("download.html", document.baseURI);
      helperUrl.hash = encodeURIComponent(fileName) + "|" + b64;

      const popup = window.open(helperUrl.href, "_blank");
      if (!popup) {
        statusEl.textContent = "⚠ Pop-up blocked. Please allow pop-ups for this site and try again.";
        return;
      }
    } catch (err) {
      statusEl.textContent = `⚠ Export failed: ${err.message}`;
    }
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
      const stubs = await api.getConversationRecordings(convId);
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
        // Step 1: fetch stubs; retry once after 3s if Genesys hasn't indexed yet
        let available = await fetchStubs();
        if (!available.length) {
          loadBtn.textContent = "⏳ Retrying…";
          await new Promise((r) => setTimeout(r, 3000));
          available = await fetchStubs();
        }

        // Lock after both attempts so the button can't be clicked again
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
            // First click — fetch URI
            recBtn.disabled = true;
            recBtn.textContent = "⏳…";
            try {
              if (stub.fileState === "ARCHIVED") {
                playerSlot.innerHTML = `<span class="checklist-drilldown__recording-msg">Archived — not directly playable.</span>`;
              } else {
                const isScreenStub = (stub.media ?? stub.mediaType ?? "").toLowerCase() === "screen";
                const formatId = isScreenStub ? "WEBM" : "MP3";
                const rec = await api.getConversationRecording(convId, stub.id, formatId);
                const uri = rec?.mediaUris?.[formatId]?.mediaUri
                  ?? rec?.mediaUris?.MP3?.mediaUri
                  ?? rec?.mediaUris?.WEBM?.mediaUri
                  ?? rec?.mediaUris?.WAV?.mediaUri
                  ?? rec?.mediaUri
                  ?? Object.values(rec?.mediaUris ?? {})[0]?.mediaUri
                  ?? null;
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
      title.textContent = cl.name || "Checklist";
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
          label.textContent = `Summary ${idx + 1} of ${summaries.length}`;
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

  // ── Bootstrap ──────────────────────────────────────────
  statusEl.textContent = "Loading copilot assistants…";

  try {
    const allAssistants = await api.getAllAssistants();
    const copilotsEnabled = allAssistants.filter(
      (a) => a.copilot?.enabled === true || a.copilot?.liveOnQueue === true,
    );

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
    fromInput.value = from.toISOString().slice(0, 10);
    toInput.value = to.toISOString().slice(0, 10);
    setActivePreset(DEFAULT_RANGE_DAYS);
  } catch (err) {
    console.error("Failed to load assistants:", err);
    statusEl.textContent = `Error loading assistants: ${err.message}`;
  }

  return root;
}
