# Agent Copilot App — User Manual

Welcome to the Agent Copilot dashboard. This app lets you review conversations that used Genesys Cloud Agent Copilot — including checklists, AI summaries, and recordings.

---

## Table of Contents

1. [Logging In](#1-logging-in)
2. [Navigation](#2-navigation)
3. [Agent Checklists & Summaries](#3-agent-checklists--summaries)
   - [Selecting Filters](#31-selecting-filters)
   - [Searching](#32-searching)
   - [Reading the Results Table](#33-reading-the-results-table)
   - [Filtering Results](#34-filtering-results)
   - [Completion Chart](#35-completion-chart)
4. [Interaction Detail (Drill-Down)](#4-interaction-detail-drill-down)
   - [Recordings](#41-recordings)
   - [Checklists](#42-checklists)
   - [Conversation Summaries](#43-conversation-summaries)
5. [Excel Export](#5-excel-export)
6. [Theme (Light / Dark)](#6-theme-light--dark)
7. [Session & Security](#7-session--security)
8. [FAQ](#8-faq)

---

## 1. Logging In

When you open the app, you'll be redirected to the Genesys Cloud login page. Sign in with your normal Genesys Cloud credentials.

After logging in, you'll be returned to the app. Your name and organisation will appear in the top-right corner.

> **Session duration:** Your session lasts as long as the Genesys Cloud access token is valid (typically several hours). The app will warn you 2 minutes before your session expires and automatically redirect you to log in again when it does.
> **Multiple tabs:** If you open the app in a new tab while already logged in, the session is shared automatically — you won't need to log in again.

---

## 2. Navigation

The left sidebar contains the navigation menu. Currently, one main page is available:

- **Dashboards → Agent Copilot → Agent Checklists & Summaries**

Click on it to open the search and analysis view.

---

## 3. Agent Checklists & Summaries

This is the main page. It lets you search for historical conversations that used Agent Copilot and review their checklist completion and AI summaries.

### 3.1 Selecting Filters

The filter bar at the top has three cascading dropdowns:

1. **Agent Copilots** — Select one or more copilot assistants. This loads the queues assigned to those copilots.
2. **Queues** — Select one or more queues. This loads the agents assigned to those queues.
3. **Agents** *(optional)* — Narrow results to specific agents. Leave empty to include all agents in the selected queues.

> The dropdowns cascade: selecting a copilot populates the queue list, and selecting a queue populates the agent list.

### 3.2 Searching

Choose a date range using either:

- **Preset buttons:** "Today", "7 days", or "30 days"
- **Custom dates:** Enter a start and end date, then click **Search**

> The maximum date range is **31 days** (a Genesys Cloud API limit).

Once you click a preset or Search, the app queries Genesys Cloud for all matching conversations and displays them in a table.

### 3.3 Reading the Results Table

Each row represents one interaction:

| Column | Description |
| --- | --- |
| **Time** | When the conversation started |
| **Agent** | The agent who handled the interaction |
| **Queue** | The queue the interaction was routed through |
| **Media** | Communication type (voice, chat, email, etc.) |
| **Duration** | Handle time |
| **Checklist** | Name of the copilot checklist (shows "…" while loading, "—" if none) |
| **Wrapup** | Wrap-up code(s) applied by the agent |
| **Status** | Completion status: **Complete** (green), **Incomplete** (amber), or **No checklist** (grey) |

> After the table loads, the app automatically fetches checklist data in the background. You'll see the Checklist and Status columns update as data arrives.

### 3.4 Filtering Results

Below the filter bar, four status filter buttons let you narrow the visible rows:

| Button | Shows |
| --- | --- |
| **All** | Every interaction |
| **Completed** | Only interactions where all checklist items were ticked |
| **Incomplete** | Only interactions where at least one item was not ticked |
| **Summaries** | Only interactions that have an AI-generated conversation summary |

**Agent Checked toggle (✋):** This is an independent toggle that can be combined with any status filter. When active, it shows only interactions where the agent manually ticked at least one checklist item (as opposed to items ticked only by the AI).

> Example: Selecting "Incomplete" + "✋ Agent Checked" shows only incomplete interactions where the agent was actively engaged with the checklist.

### 3.5 Completion Chart

A bar chart appears above the results table showing the count of **Complete** vs **Incomplete** interactions (based on the current filter). The chart updates automatically as you change filters.

---

## 4. Interaction Detail (Drill-Down)

Click any row in the results table to open the **Interaction Detail** panel. The results table collapses automatically to give you more space.

The detail panel has three collapsible sections:

### 4.1 Recordings

The **🎧 Recording** section is expanded by default but recordings are not loaded automatically (to save bandwidth).

1. Click **🎧 Load Recordings** to fetch available recordings for this interaction.
2. If recordings exist, you'll see one or more buttons:
   - **🎧 Play Recording** — if there is a single recording
   - **🎧 Part 1**, **🎧 Part 2**, etc. — if the call had multiple segments (e.g. transfers)
3. Click a button to load and play the recording. The first click triggers transcoding on the Genesys Cloud side — you'll see "⏳ Transcoding…" while it processes. This may take a few seconds, especially for longer calls.
4. Click the same button again to **hide** the player. Click once more to **show** it again (without re-loading).

> **Archived recordings** will show "Archived — not directly playable." instead of a player.
> **Screen recordings** are displayed as video instead of audio.

### 4.2 Checklists

The **Checklists** section shows every checklist item for the interaction:

- **✅** — Item is ticked (complete)
- **❌** — Item is not ticked (incomplete)
- **⚡** — Item is marked as important
- **Agent: ✓/✗** — Whether the agent manually ticked this item
- **AI: ✓/✗** — Whether the AI model detected this item as addressed

Each item may also show a description underneath explaining what the checklist item covers.

Metadata at the top shows the checklist name, when evaluation started, and when it was finalised.

### 4.3 Conversation Summaries

The **Conversation Summary** section (collapsed by default) shows the AI-generated summary, if one exists. It includes:

| Field | Description |
| --- | --- |
| **Headline** | Brief one-line summary of the conversation |
| **Reason** | Why the customer contacted support |
| **Resolution** | How the issue was resolved |
| **Followup** | Any follow-up actions needed |

**Edited summaries:** If the agent edited any summary fields, you'll see:

- The edited version with a **✏️ Edited** badge
- The original text shown with ~~strikethrough~~ below it

**Multiple summaries:** For transferred calls, multiple summaries may appear (one per call leg), labelled "Summary 1 of N", "Summary 2 of N", etc.

**Additional topics:** The AI may detect additional topics beyond Reason/Resolution/Followup. These are rendered dynamically with their own labels.

**Suggested wrap-up codes:** If the AI suggested wrap-up codes, they appear at the bottom of the summary.

### Closing the Detail Panel

Click the **✕** button in the top-right corner of the detail panel to close it. The results table will re-expand automatically.

You can also use the **▼ Search Results** toggle above the table to manually expand/collapse the table without closing the detail panel.

---

## 5. Excel Export

After a search completes and checklist data has been loaded, an **⬇ Export Excel** button appears in the top-right header.

1. Click **⬇ Export Excel**
2. A new browser tab opens with a **Save** button
3. Click **Save** and choose where to save the file

The exported file contains three sheets:

| Sheet | Contents |
| --- | --- |
| **Summary** | Aggregated completion statistics per agent, queue, and checklist (total, complete, incomplete, completion %) |
| **Interactions** | One row per interaction with conversation ID, time, agent, queue, media, duration, checklist name, wrap-up code, and status |
| **Checklist Items** | One row per checklist item with conversation ID, checklist name, item name, description, agent ticked, AI ticked, and important flag |

> **Pop-up blocker:** The export opens in a new tab. If your browser blocks it, allow pop-ups for the app's URL and try again.

---

## 6. Theme (Light / Dark)

The app automatically matches your operating system or browser's colour scheme:

- **Dark mode** — dark background with light text (default on most systems)
- **Light mode** — light background with dark text

To switch, change your OS or browser theme setting. The app updates instantly without needing to reload.

---

## 7. Session & Security

- **Your data stays in your browser.** All API calls go directly from your browser to Genesys Cloud. No data passes through any intermediate server.
- **Nothing is stored permanently.** The app uses session storage (cleared when you close the tab). No cookies are used.
- **Read-only.** The app never creates, modifies, or deletes anything in Genesys Cloud — it only reads data.
- **Your access = your permissions.** You can only see data that your Genesys Cloud role allows. If you're missing a permission, that specific feature will show an error — everything else continues to work.

---

## 8. FAQ

### Why do I see "No copilot-enabled assistants found"?

No assistants with Agent Copilot enabled exist in your Genesys Cloud organisation, or your user role does not have the `assistants:assistant:view` permission. Contact your administrator.

### Why do some interactions show "No checklist"?

Not all conversations use copilot checklists. "No checklist" means the copilot did not generate a checklist for that interaction, or your role lacks the `conversation:communication:view` permission.

### Why is the "Summaries" filter showing fewer interactions?

The Summaries filter only shows interactions where Genesys Cloud generated an AI conversation summary. Summaries are only created when Agent Copilot is active and the conversation has ended.

### The recording says "Recording not yet available"

Genesys Cloud needs time to process (transcode) recordings. The app retries automatically, but for very long recordings it may time out. Wait a few minutes and try again by clicking on a different interaction and coming back.

### The recording says "Archived — not directly playable"

This recording has been moved to archive storage. Archived recordings cannot be played back directly.

### Excel export doesn't work / blank tab appears

Your browser may be blocking pop-ups. Allow pop-ups for the app's URL and click Export Excel again.

### "The selected period spans X days"

The Genesys Cloud API limits queries to a maximum of 31 days. Select a shorter date range.

### I can see some features but not others

Each feature requires specific Genesys Cloud permissions on your user role. Contact your administrator to verify your role includes the required permissions. See the [setup guide](setup-guide.md) for the full permissions list.
