# Agent Copilot App — Setup Guide

Complete step-by-step guide for deploying the Agent Copilot app at a new customer environment. This is a **standalone front-end app** — no Azure Functions, Storage Accounts, or backend OAuth clients are needed.

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [GitHub Repository Setup](#2-github-repository-setup)
3. [Genesys Cloud Configuration](#3-genesys-cloud-configuration)
4. [User Role Permissions](#4-user-role-permissions)
5. [Azure Static Web App (SPA Hosting)](#5-azure-static-web-app-spa-hosting)
6. [Application Configuration](#6-application-configuration)
7. [Feature Configuration](#7-feature-configuration)
8. [GitHub Secrets & CI/CD](#8-github-secrets--cicd)
9. [First Deployment](#9-first-deployment)
10. [Verification Checklist](#10-verification-checklist)
11. [Genesys Cloud Premium App Integration](#11-genesys-cloud-premium-app-integration)
12. [Ongoing Maintenance](#12-ongoing-maintenance)
13. [Troubleshooting](#13-troubleshooting)

---

## 1. Prerequisites

Before starting, ensure you have:

| Requirement | Details |
| --- | --- |
| **Genesys Cloud org** | Admin access to create OAuth clients and manage user roles |
| **Azure subscription** | With permissions to create Resource Groups and Static Web Apps |
| **GitHub account** | Repository access and admin permissions to configure secrets |

> **Note:** This app does **not** require Azure Functions, Azure Storage, or a backend OAuth client. All API calls are made directly from the browser using the user's own OAuth token.

---

## 2. GitHub Repository Setup

### 2.1 Create the Repository

1. Create a new **private** repository on GitHub (e.g. `genesys-copilot-app`)
2. Push all source code to the `main` branch
3. Verify the repository has this structure:

```text
├── index.html
├── download.html
├── .github/workflows/
│   └── azure-static-web-apps.yml
├── css/
│   └── styles.css
└── js/
    ├── app.js
    ├── config.js
    ├── nav.js
    ├── navConfig.js
    ├── pageRegistry.js
    ├── router.js
    ├── utils.js
    ├── components/
    │   └── multiSelect.js
    ├── lib/
    │   └── xlsx.full.min.js
    ├── pages/
    │   ├── welcome.js
    │   ├── notfound.js
    │   ├── placeholder.js
    │   └── dashboards/
    │       └── agent-copilot/
    │           ├── agentChecklists.js
    │           ├── checklistConfig.js
    │           └── performance.js
    └── services/
        ├── apiClient.js
        └── authService.js
```

### 2.2 Branch Protection (Recommended)

- Go to **Settings → Branches → Add rule**
- Branch name pattern: `main`
- Enable: *Require a pull request before merging* (optional for small teams)

---

## 3. Genesys Cloud Configuration

### 3.1 OAuth Client (PKCE)

This app uses a single OAuth client that authenticates users via the browser using Authorization Code + PKCE.

1. Go to **Admin → Integrations → OAuth**
2. Click **Add Client**
3. Configure:

| Field | Value |
| --- | --- |
| App Name | `Agent Copilot` (or customer preference) |
| Grant Type | **Authorization Code** |
| Authorized redirect URI | The SWA URL (set after Step 5), e.g. `https://<swa-hostname>.azurestaticapps.net` |

4. Under **Scope**, enable:
   - `routing` — required for queue, skill, and wrap-up code lookups

> **Note:** The OIDC scopes (`openid`, `profile`, `email`) used in the authorization URL are implicit and do **not** appear in the OAuth client scope list. They are always available for Authorization Code grants.

5. Click **Save**
6. **Copy the Client ID** — you'll need it for `js/config.js`

> **Important:** Authorization Code / PKCE clients do **not** have a client secret and do **not** support assigning roles. The Client ID is public and safe to store in front-end code. All API permissions are determined by the **logged-in user's own Genesys Cloud role** (see [Step 4](#4-user-role-permissions)).

### 3.2 Identify the Region

Determine the customer's Genesys Cloud region:

| Region | Domain |
| --- | --- |
| EMEA (Frankfurt) | `mypurecloud.de` |
| US East | `mypurecloud.com` |
| US West | `usw2.pure.cloud` |
| AP (Sydney) | `mypurecloud.com.au` |
| AP (Tokyo) | `mypurecloud.jp` |
| EU (Ireland) | `mypurecloud.ie` |
| EU (London) | `euw2.pure.cloud` |
| Canada | `cac1.pure.cloud` |
| AP (Mumbai) | `aps1.pure.cloud` |
| AP (Seoul) | `apne2.pure.cloud` |
| SA (São Paulo) | `sae1.pure.cloud` |

You'll use this value in `js/config.js`.

---

## 4. User Role Permissions

Since this app uses Authorization Code + PKCE, every API call is made with the **logged-in user's own access token**. The OAuth client does not carry any roles — the user's Genesys Cloud role determines what data they can access.

Each user who will use this app must have a role that includes the following permissions. You can either add these to an existing role or create a dedicated role (e.g. `Agent Copilot User`).

### 4.1 Required Permissions

| Permission Category | Permission | Purpose |
| --- | --- | --- |
| **Analytics** | `analytics:conversationDetail:view` | Query conversation history by date range |
| **Conversation** | `conversation:communication:view` | Fetch conversation participants and checklist data |
| **Conversation** | `conversation:summary:view` | Display AI-generated conversation summaries |
| **Assistants** | `assistants:assistant:view` | List copilot-enabled assistants |
| **Assistants** | `assistants:queue:view` | List queue assignments per assistant |
| **Routing** | `routing:queue:view` | Resolve queue names |
| **Routing** | `routing:queue:member:view` | List queue members for the agent filter |
| **Routing** | `routing:wrapupCode:view` | Resolve wrap-up code names in results |

### 4.2 Optional Permissions

| Permission Category | Permission | Purpose |
| --- | --- | --- |
| **Recording** | `recording:recording:view` | Inline audio playback in the drill-down |
| **Recording** | `recording:screenRecording:view` | Screen recording playback |

> **Note:** Recording permissions are optional. If a user lacks them, the "Load Recordings" button will show an error but all other functionality will work normally.

### 4.3 Assigning the Role

1. Go to **Admin → Roles / Permissions**
2. Create a new role (e.g. `Agent Copilot User`) or edit an existing one
3. Add the permissions listed above
4. Go to **Admin → People** and assign the role to each user who needs access

---

## 5. Azure Static Web App (SPA Hosting)

### 5.1 Create the Static Web App

1. Go to **Azure Portal → Create a resource → Static Web App**
2. Configure:

| Field | Value |
| --- | --- |
| Subscription | Customer subscription |
| Resource group | Create new or use existing (e.g. `copilot-app-rg`) |
| Name | e.g. `genesys-copilot-app` |
| Plan type | **Free** (sufficient for this app) |
| Region | Closest to the customer |
| Source | **GitHub** |
| Organisation | Your GitHub org/account |
| Repository | The repo from Step 2 |
| Branch | `main` |

1. In **Build Details**:

| Field | Value |
| --- | --- |
| Build Preset | **Custom** |
| App location | `/` |
| API location | *(leave empty)* |
| Output location | *(leave empty)* |

1. Click **Review + Create → Create**

Azure will automatically create a GitHub Actions workflow file. If it does, you can either use the auto-generated workflow or replace it with the one already included in the repository (`.github/workflows/azure-static-web-apps.yml`).

### 5.2 Note the SWA URL

After creation, go to **Overview** and copy the **URL**, e.g.:

```text
https://happy-rock-0a1b2c3d4.2.azurestaticapps.net
```

You'll need this for:

- Genesys OAuth redirect URI (Step 3.1)
- `oauthRedirectUri` in `js/config.js` (Step 6)

### 5.3 Verify the Workflow

The workflow file should include `skip_app_build: true` since there is no build step. Check `.github/workflows/azure-static-web-apps.yml`:

```yaml
skip_app_build: true
```

If Azure auto-generated a different workflow file, either delete it and keep the included one, or ensure it has `skip_app_build: true`.

---

## 6. Application Configuration

### 6.1 Front-End Config — `js/config.js`

Update these values for the customer:

```javascript
const REGION = "mypurecloud.de";              // ← Customer's Genesys region

export const CONFIG = {
  region: REGION,
  authHost: `login.${REGION}`,                // Auto-derived from REGION
  apiBase: `https://api.${REGION}`,           // Auto-derived from REGION
  appName: "Agent Copilot",                   // ← Customise if needed

  oauthClientId: "xxxxxxxx-xxxx-...",         // ← PKCE Client ID from Step 3.1

  oauthRedirectUri: "https://...",            // ← Exact SWA URL from Step 4.2

  oauthScopes: ["openid", "profile", "email", "routing"],

  router: { mode: "hash" }
};
```

**Values to change per customer:**

| Property | Source |
| --- | --- |
| `REGION` | Customer's Genesys region (Step 3.2) |
| `oauthClientId` | PKCE OAuth Client ID (Step 3.1) |
| `oauthRedirectUri` | SWA URL (Step 5.2) — must match **exactly** |

> **Important:** The `oauthRedirectUri` must match the Authorized redirect URI in the Genesys OAuth client configuration exactly (including protocol, no trailing slash).

### 6.2 Navigation — `js/navConfig.js`

The navigation tree is pre-configured for Agent Copilot only. Enable or disable pages by setting `enabled: true/false` on any node.

Currently included:

| Page | Status | Description |
| --- | --- | --- |
| Agent Checklists & Summaries | ✅ Enabled | Main feature page |
| Performance | ⛔ Disabled | Stub page — set `enabled: true` when ready |

### 6.3 Light / Dark Theme

The app automatically follows the browser / OS colour scheme. No configuration is needed — it works out of the box via `@media (prefers-color-scheme: light)` in `css/styles.css`.

- **CSS variables** (`--bg`, `--panel`, `--text`, `--border`, etc.) are overridden inside the light-mode media query.
- **Chart.js** axis labels, grid lines, and title colours are read from CSS custom properties (`--chart-text`, `--chart-grid`, `--chart-title`) at render time.
- A `matchMedia` change listener automatically destroys and re-creates the chart when the OS theme switches, so colours update without a page reload.

To **customise** light-mode colours, edit the `@media (prefers-color-scheme: light)` block at the bottom of `css/styles.css`.

---

## 7. Feature Configuration

### 7.1 Checklist Config — `js/pages/dashboards/agent-copilot/checklistConfig.js`

This file contains all feature-level tunables and labels for the Agent Checklists page:

| Setting | Default | Description |
| --- | --- | --- |
| `DEFAULT_RANGE_DAYS` | `7` | Default date range shown on page load |
| `RANGE_PRESETS` | Today, 7d, 30d | Preset period buttons shown in the toolbar |
| `MAX_INTERVAL_DAYS` | `31` | Maximum query interval (Genesys API limit) |
| `QUERY_PAGE_SIZE` | `100` | Max conversations per analytics query page |
| `ENRICHMENT_BATCH` | `10` | Number of conversations enriched in parallel |
| `QUEUE_RESOLVE_BATCH` | `10` | Number of queue-name lookups run in parallel |
| `MEDIA_KEYS` | 7 media types | Communication keys to extract from conversation participants |
| `TICK_STATE` | `Ticked/Unticked` | API tick state values (frozen enum) |
| `STATUS_FILTER` | `all/complete/incomplete` | Client-side filter values (frozen enum) |

**Chart configuration** (`CHART_CONFIG`):

| Setting | Default | Description |
| --- | --- | --- |
| `title` | `Checklist Completion` | Bar chart heading text |
| `titleColor` | `#e0e0e0` | Chart title colour (dark-mode fallback; CSS variable overrides) |
| `titleFontSize` | `13` | Chart title font size (px) |
| `axisColor` | `#aaa` | Axis tick/label colour (dark-mode fallback; CSS variable overrides) |
| `axisFontSize` | `11` | Axis tick font size (px) |
| `gridColor` | `rgba(255,255,255,0.06)` | Grid line colour (dark-mode fallback; CSS variable overrides) |
| `completeColor` | `rgba(74,222,128,0.7)` | "Complete" bar fill colour |
| `incompleteColor` | `rgba(251,191,36,0.7)` | "Incomplete" bar fill colour |
| `borderRadius` | `4` | Bar corner radius (px) |
| `barPercentage` | `0.6` | Fraction of width each bar occupies |

**Excel export configuration**:

| Setting | Default | Description |
| --- | --- | --- |
| `EXPORT_FILENAME_PREFIX` | `Agent_Checklists` | Filename prefix (date is appended automatically) |
| `EXPORT_INTERACTION_COLS` | 8 columns | Column widths for Sheet 1 (Interactions) |
| `EXPORT_ITEM_COLS` | 7 columns | Column widths for Sheet 2 (Checklist Items) |

**UI labels** (`LABELS`):

| Setting | Default | Description |
| --- | --- | --- |
| `statusAgentChecked` | `✋ Agent Checked` | Label for the Agent Checked toggle filter button |
| *(various others)* | *(see file)* | All button text, badge labels, chart axis labels |

---

## 8. GitHub Secrets & CI/CD

### 8.1 Add the GitHub Secret

Go to the GitHub repository → **Settings → Secrets and variables → Actions → New repository secret**:

| Secret Name | Value | Purpose |
| --- | --- | --- |
| `AZURE_STATIC_WEB_APPS_API_TOKEN` | Deployment token from Azure SWA | SPA deployment |

To get the token:

1. Go to **Azure Portal → Static Web App → Manage deployment token**
2. Copy the token value
3. Add it as the GitHub secret above

> If Azure auto-created a workflow with a different secret name (e.g. `AZURE_STATIC_WEB_APPS_API_TOKEN_HAPPY_ROCK_0A1B2C3D4`), either rename the secret to match, or update the workflow file to use `AZURE_STATIC_WEB_APPS_API_TOKEN`.

### 8.2 CI/CD Workflow

One workflow is included:

| Workflow | File | Trigger | Deploys |
| --- | --- | --- | --- |
| SPA | `.github/workflows/azure-static-web-apps.yml` | Push to `main` | Front-end to Azure SWA |

No backend deployment workflow is needed.

---

## 9. First Deployment

### 9.1 Commit and Push

After updating `js/config.js` with the customer's values:

```bash
git add -A
git commit -m "feat: configure for customer deployment"
git push origin main
```

### 9.2 Monitor Deployment

1. Go to **GitHub → Actions** tab
2. Verify the `Azure Static Web Apps CI/CD` workflow completes successfully (green checkmark)

### 9.3 Update Genesys OAuth Redirect URI

If you didn't set the redirect URI in Step 3.1 (because the SWA URL wasn't known yet):

1. Go to **Genesys Admin → Integrations → OAuth → your PKCE client**
2. Set the **Authorized redirect URI** to the exact SWA URL
3. Save

---

## 10. Verification Checklist

Run through these checks after deployment:

### Authentication

- [ ] Open the SWA URL in a browser
- [ ] Confirm the OAuth login redirects to Genesys Cloud
- [ ] After login, verify the sidebar navigation appears with "Agent Copilot" section

### Theme

- [ ] Switch the browser / OS to light mode → confirm the app switches to a light colour scheme automatically (and back to dark when reverted)

### Agent Checklists

- [ ] Navigate to **Dashboards → Agent Copilot → Agent Checklists & Summaries**
- [ ] Verify copilot assistants load in the first dropdown
- [ ] Select a copilot → verify queues cascade into the second dropdown
- [ ] Select a queue → verify agents cascade into the third dropdown
- [ ] Click a period preset or set custom dates (max 31 days) and click Search
- [ ] Confirm interactions appear and enrich with checklist data
- [ ] Click a row with a checklist → verify drill-down shows checklist items with separate **Agent** and **AI** tick indicators (green ✓ / red ✗)
- [ ] Verify the Interaction Detail panel opens with three collapsible sections: **🎧 Recording** (expanded), **Checklists** (expanded), **Conversation Summary** (collapsed)

### Recordings (if recording permissions are configured)

- [ ] Click the **🎧 Load Recordings** button → verify it loads stubs and either shows "No recordings for this interaction." or reveals per-segment buttons
- [ ] Click a segment button → verify the audio player appears; click again to toggle it off

### Conversation Summaries

- [ ] If the conversation has an AI-generated summary, verify it appears in the drill-down panel (headline, reason, resolution, followup, full text)
- [ ] If the agent edited any summary fields, verify the edited version shows a ✏️ Edited badge and the original appears with strikethrough
- [ ] Verify additional AI-detected topics beyond reason/resolution/followup are rendered dynamically
- [ ] For transferred calls, verify multiple summaries are shown ("Summary 1 of N")

### Filters

- [ ] Test status filter buttons (All / Completed / Incomplete / Summaries)
- [ ] Verify "All" shows every interaction, "Summaries" shows only interactions with AI summaries
- [ ] Verify the **✋ Agent Checked** toggle button ANDs with the active status filter (e.g. "Incomplete" + Agent Checked → only incomplete interactions where the agent manually ticked an item)

### Collapsible UI

- [ ] Verify selecting a row **collapses the search results table** automatically
- [ ] Closing the detail panel (✕) **re-expands** the table
- [ ] The **▼ Search Results** toggle header collapses/expands the table independently without resetting filters or data

### Chart

- [ ] Verify the completion bar chart appears above the table showing Complete vs Incomplete counts

### Excel Export

- [ ] After enrichment completes, verify the **⬇ Export Excel** button appears in the top-right header
- [ ] Click Export Excel → a new tab opens with a Save button → click Save → verify a two-sheet XLSX downloads
- [ ] If pop-ups are blocked, allow pop-ups for the site and retry

---

## 11. Genesys Cloud Premium App Integration

To embed the app inside the Genesys Cloud client interface:

1. Go to **Admin → Integrations → Integrations**
2. Click **+ Add Integration**
3. Search for **Premium App** and install it
4. Configure:

| Field | Value |
| --- | --- |
| Application URL | The SWA URL (e.g. `https://happy-rock-0a1b2c3d4.2.azurestaticapps.net`) |
| Application Type | `iframe` |
| Sandbox | `allow-scripts allow-same-origin allow-forms allow-popups` |

1. Under **Configuration → Properties**, set:
   - **Display Type**: `standalone` or `widget` depending on where it should appear

2. Activate the integration

> The app detects whether it's running inside a Genesys Cloud iframe or a standalone browser tab and adapts its fullscreen behaviour accordingly.

---

## 12. Ongoing Maintenance

### Updating the App

1. Make code changes locally
2. Commit and push to `main`
3. CI/CD deploys automatically — there is no build step

### Rotating Secrets

| Secret | How to Rotate |
| --- | --- |
| SWA Deploy Token | Get new token from Azure Portal → Static Web App → **Manage deployment token** → update `AZURE_STATIC_WEB_APPS_API_TOKEN` in GitHub Secrets |

> The PKCE OAuth Client ID is not a secret (no client secret exists for PKCE clients). If the OAuth client is recreated, update `oauthClientId` in `js/config.js` and push.

### Cost Estimates

| Resource | Free Tier Limit | Estimated Usage |
| --- | --- | --- |
| Azure Static Web App | Free plan | Well within limits |

This app has no backend resources, so hosting costs are effectively **zero** on the Azure SWA free tier.

---

## 13. Troubleshooting

### OAuth redirect fails

- **Cause**: Redirect URI mismatch between `config.js` and the Genesys OAuth client
- **Fix**: The `oauthRedirectUri` in `config.js` must match **exactly** what is configured in Genesys Admin → OAuth client → Authorized redirect URIs (including protocol, no trailing slash).

### "No copilot-enabled assistants found"

- **Cause**: No assistants with copilot enabled exist, or the logged-in user lacks `assistants:assistant:view` permission
- **Fix**: Verify copilot assistants are configured in Genesys Admin → Performance → Agent Copilot. Ensure the user’s role includes the **Assistants** permissions (see [Step 4](#4-user-role-permissions)).

### All interactions show "No checklist"

- **Cause**: Missing `conversation:communication:view` permission on the user’s role
- **Fix**: Ensure the user’s Genesys Cloud role includes `conversation:communication:view` (see [Step 4](#4-user-role-permissions)). Check the browser DevTools console for `[Checklists]` log entries with 403/404 errors.

### "The selected period spans X days"

- **Cause**: The Genesys analytics API rejects intervals exceeding 31 days
- **Fix**: Select a shorter date range. The maximum is enforced client-side via `MAX_INTERVAL_DAYS` in `checklistConfig.js`.

### Excel export opens blank tab or nothing happens

- **Cause**: Pop-ups are blocked by the browser, or the `download.html` helper page is missing
- **Fix**: The app runs inside a cross-origin Genesys Cloud iframe where direct downloads are blocked. The export works by opening `download.html` in a new tab, which uses `showSaveFilePicker()` on a real user click. Ensure:
  1. Pop-ups are allowed for the site
  2. `download.html` exists in the repository root
  3. `js/lib/xlsx.full.min.js` is present (SheetJS library)

### Bar chart not visible

- **Cause**: No enriched checklist data yet, or Chart.js not loaded
- **Fix**: The chart only appears after at least one interaction has been enriched with checklist data. Verify Chart.js loads from the CDN (`cdn.jsdelivr.net/npm/chart.js@4`). Chart styling can be adjusted in `CHART_CONFIG` within `checklistConfig.js`; chart container sizing is in `css/styles.css` (`.checklist-chart-wrap`).

### "Load Recordings" shows "No recordings for this interaction."

- **Cause**: The user’s role lacks `recording:recording:view` permission, the recording is archived/deleted, or Genesys hasn't finished indexing it yet
- **Fix**: Ensure the user’s Genesys Cloud role includes `recording:recording:view`. For screen recordings also add `recording:screenRecording:view` (see [Step 4](#4-user-role-permissions)). Archived recordings show "Archived — not directly playable." per segment button.

### Conversation summary not showing

- **Cause**: The conversation has no AI-generated summary, or the user lacks `conversation:summary:view` permission
- **Fix**: Summaries are only generated for conversations where Agent Copilot is active and the conversation has ended. Check the browser DevTools console for `[Summaries]` log entries — a 404 means no summary exists; a 403 means the permission is missing. Ensure the user’s role includes `conversation:summary:view` (see [Step 4](#4-user-role-permissions)).

### GitHub Actions deploy fails

- **Cause**: SWA deployment token is missing or invalid
- **Fix**: Verify the `AZURE_STATIC_WEB_APPS_API_TOKEN` secret exists in the GitHub repository settings. Re-copy the token from Azure Portal → Static Web App → **Manage deployment token** if needed.

---

## Quick Reference — All Customer-Specific Values

| Value | Where It Goes | Example |
| --- | --- | --- |
| Genesys region | `js/config.js` → `REGION` | `mypurecloud.de` |
| PKCE OAuth Client ID | `js/config.js` → `oauthClientId` | `3b89b95c-...` |
| SWA URL | `js/config.js` → `oauthRedirectUri` and Genesys OAuth redirect URI | `https://happy-rock-0a1b2c3d4.2.azurestaticapps.net` |
| SWA Deploy Token | GitHub Secret → `AZURE_STATIC_WEB_APPS_API_TOKEN` | *(token string)* |

---

## Architecture Notes

This app is a **static SPA** (Single Page Application) with:

- **No build step** — all JS/CSS is shipped directly to the browser
- **No backend** — all Genesys Cloud API calls are made from the browser using the user's OAuth token
- **Hash-based routing** — URLs use `#/path` format for client-side navigation
- **Chart.js v4** (loaded from CDN) — used for the completion bar chart
- **SheetJS** (`xlsx.full.min.js`, bundled locally) — used for Excel export
- **OAuth PKCE** — Authorization Code flow with Proof Key for Code Exchange (no client secret)

The app is derived from the full Genesys Client App but contains **only** the Agent Copilot feature. It does not include Trunk Dashboards, Data Tables, Azure Functions, or notification services.
