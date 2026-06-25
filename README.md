# Agent Copilot App

A front-end dashboard for **Genesys Cloud Agent Copilot** — view agent checklists, conversation summaries, recordings, and completion analytics. A small Azure Functions API (`api/`) serves per-org configuration; the front-end is plain ES modules with no build step.

---

## Features

- **Agent Checklists & Summaries** — Search conversations by copilot assistant, queue, agent, and date range. Drill into checklist items with separate Agent / AI tick indicators and AI-generated conversation summaries. A single conversation can carry multiple checklists; transferred conversations show all agents and their checklists/summaries — including cases where several agents ran the *same* checklist template, each attributed to its owning agent.
- **Recordings** — Inline audio and screen recording playback per conversation segment.
- **Completion Chart** — Bar chart showing complete vs incomplete checklist counts (Chart.js v4).
- **Excel Export** — Two-sheet XLSX export (interactions + checklist items) via SheetJS.
- **Cascading Filters** — Select a copilot → queues cascade → agents cascade. Status filters (All / Completed / Incomplete / Summaries) with an Agent Checked toggle.
- **Rate-Limit Handling** — Global request throttle (5 concurrent, 210 ms gap) and automatic retry with exponential backoff on 429/5xx responses.
- **Light / Dark Theme** — Automatically follows the OS / browser colour scheme.
- **OAuth PKCE** — Authorization Code + PKCE flow with cross-tab session handoff. No client secret needed.
- **Multi-Customer** — one deployment serves many Genesys orgs. The active org is resolved at runtime from a `?org=<key>` URL parameter against a **server-side** registry (`api/data/customers.js`); the browser only ever receives its own org's public config via `GET /api/org-config`. Includes a post-login org-match check and a hard-fail screen for unknown orgs.
- **Premium App Ready** — Can be embedded inside the Genesys Cloud client as an iframe.

## Tech Stack

| Component | Technology |
| --------- | ---------- |
| Front-end | Vanilla JS (ES modules), CSS custom properties |
| Backend | Azure Functions (Node, SWA managed) — per-org config endpoint |
| Charts | [Chart.js v4](https://www.chartjs.org/) (CDN) |
| Excel export | [SheetJS](https://sheetjs.com/) (`xlsx.full.min.js`, bundled) |
| Auth | OAuth 2.0 Authorization Code + PKCE |
| Hosting | Azure Static Web Apps |
| CI/CD | GitHub Actions |

## Project Structure

```text
├── index.html                  # App shell
├── download.html               # Excel export helper (iframe-safe)
├── css/styles.css              # All styles (dark + light theme)
├── js/
│   ├── app.js                  # Bootstrap & auth init
│   ├── config.js               # Static app settings; fetches active customer config
│   ├── orgContext.js           # Resolves the active org key from ?org=
│   ├── nav.js                  # Sidebar renderer
│   ├── navConfig.js            # Navigation tree definition
│   ├── pageRegistry.js         # Lazy page loader
│   ├── router.js               # Hash-based SPA router
│   ├── utils.js                # Shared helpers
│   ├── components/
│   │   └── multiSelect.js      # Multi-select dropdown component
│   ├── lib/
│   │   └── xlsx.full.min.js    # SheetJS library
│   ├── pages/
│   │   ├── welcome.js          # Landing page
│   │   ├── notfound.js         # 404 page
│   │   ├── placeholder.js      # Stub for disabled pages
│   │   └── dashboards/
│   │       └── agent-copilot/
│   │           ├── agentChecklists.js   # Main feature page
│   │           ├── checklistConfig.js   # Feature tunables & labels
│   │           └── performance.js       # Stub (disabled)
│   └── services/
│       ├── apiClient.js        # Genesys Cloud API wrapper
│       └── authService.js      # OAuth PKCE + session management
├── api/                        # Azure Functions API (SWA managed; server-side)
│   ├── host.json
│   ├── package.json
│   ├── data/
│   │   └── customers.js        # Customer registry — SERVER-SIDE, never shipped to the browser
│   └── src/functions/
│       └── orgConfig.js        # GET /api/org-config — returns the active org's public config
├── staticwebapp.config.json    # SPA fallback + /api routing
├── docs/
│   └── setup-guide.md          # Full deployment guide
└── .github/workflows/
    └── azure-static-web-apps-*.yml  # CI/CD pipelines (one per environment)
```

## Quick Start

1. Clone the repo
2. Create a Genesys Cloud OAuth client (Authorization Code + PKCE, `routing` scope) **in the customer's org**
3. Create an Azure Static Web App linked to this repo (Azure auto-creates the workflow and deploy-token secret)
4. Add the customer to the **server-side** registry in `api/data/customers.js` (region, Client ID, org GUID); the redirect URI is derived automatically
5. Register the Static Web App URL as an Authorized redirect URI in the Genesys OAuth client, and set that org's integration Application URL to `…/?org=<key>`
6. Push to `main` — CI/CD deploys automatically

See [docs/setup-guide.md](docs/setup-guide.md) for the complete step-by-step guide.

## Configuration

The app is **multi-customer aware**, and the registry lives **server-side**. Each Genesys org (customer) is one entry in `api/data/customers.js`, keyed by a short `org` key. At startup the browser calls `GET /api/org-config?org=<key>` and receives **only that org's** public bootstrap values (region + Client ID + org GUID) — the full customer list never reaches the browser:

```javascript
// api/data/customers.js  (server-side — never shipped to the browser)
const CUSTOMERS = {
  demo: {
    name: "Demo Organization",
    region: "mypurecloud.de",
    clientId: "your-client-id-here",  // public in PKCE — not a secret
    orgId: "org-guid-here",           // enables the post-login org-match check
  },
  // …one entry per customer
};

// Fallback org key when ?org= is absent. Set to null to hard-fail instead.
const DEFAULT_ORG_KEY = "demo";

module.exports = { CUSTOMERS, DEFAULT_ORG_KEY };
```

On the client, `js/config.js` fetches that endpoint and derives `region`, `authHost`, `apiBase`, and `oauthClientId`, always using `oauthRedirectUri: window.location.origin`. To onboard a customer you add a registry line on the server and point that org's integration at `…/?org=<key>` — no client changes.

Feature-level settings (date ranges, chart colours, export columns, labels) are in `js/pages/dashboards/agent-copilot/checklistConfig.js`.

## User Permissions

This app uses the logged-in user's own access token. Each user needs a Genesys Cloud role with these permissions:

| Permission | Purpose |
| --- | --- |
| `analytics:conversationDetail:view` | Query conversations |
| `conversation:communication:view` | Checklist data |
| `conversation:summary:view` | AI summaries |
| `assistants:assistant:view` | List copilot assistants |
| `assistants:queue:view` | Queue assignments |
| `routing:queue:view` | Queue names |
| `routing:queue:member:view` | Agent filter |
| `routing:wrapupCode:view` | Wrap-up codes |
| `recording:recording:view` | Audio playback *(optional)* |
| `recording:screenRecording:view` | Screen recording *(optional)* |

## Deployment

The app uses a branch-per-environment model on Azure Static Web Apps — no build step involved:

| Branch | Environment |
| --- | --- |
| `main` | DEV |
| `production` | PROD |

Pushing to `main` auto-deploys to DEV. Promote tested code to PROD by merging `main → production`. Because the redirect URI is derived from `window.location.origin`, the **same code** runs unchanged in both environments. See [docs/setup-guide.md](docs/setup-guide.md) for details.

## License

Proprietary — all rights reserved.
