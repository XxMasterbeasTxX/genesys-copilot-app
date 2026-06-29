# Agent Copilot App

A dashboard for **Genesys Cloud Agent Copilot** — view agent checklists, conversation summaries, recordings, and completion analytics. The front-end is plain ES modules (no build step); an Azure Functions **backend-for-frontend (BFF)** (`api/`) serves per-org configuration **and runs all Genesys orchestration server-side**, forwarding the agent's own access token. The multi-step orchestration logic and Genesys API shapes never reach the browser.

---

## Features

- **Agent Checklists & Summaries** — Search conversations by copilot assistant, queue, agent, and date range. Drill into checklist items with separate Agent / AI tick indicators and AI-generated conversation summaries. A single conversation can carry multiple checklists; transferred conversations show all agents and their checklists/summaries — including cases where several agents ran the *same* checklist template, each attributed to its owning agent.
- **Recordings** — Inline audio and screen recording playback per conversation segment.
- **Completion Chart** — Bar chart showing complete vs incomplete checklist counts (Chart.js v4).
- **Excel Export** — Three-sheet XLSX export (Summary + Interactions + Checklist Items) via xlsx-js-style, with styled header rows and per-column auto-filters. Interactions/Summary include a **Copilot** column.
- **Cascading Filters** — Select a copilot → queues cascade → agents cascade. Status filters (All / Completed / Incomplete / Summaries) with an Agent Checked toggle.
- **Backend-for-Frontend (BFF)** — The browser calls the app's own `/api/*` endpoints; the server forwards the agent's Genesys token and performs the copilot/queue/agent cascades, the analytics search, and per-conversation checklist + summary enrichment. The token is forwarded in a custom **`X-Genesys-Token`** header (Azure Static Web Apps reserves and overwrites the standard `Authorization` header on the managed-Functions hop). Only login/identity and recording playback still call Genesys directly from the browser.
- **Rate-Limit Handling** — Request throttle (5 concurrent, 210 ms gap) and automatic retry with exponential backoff on 429/5xx responses, applied both server-side (BFF) and in the browser (direct calls).
- **Light / Dark Theme** — Automatically follows the OS / browser colour scheme.
- **OAuth PKCE** — Authorization Code + PKCE flow with cross-tab session handoff. No client secret needed.
- **Multi-Customer** — one deployment serves many Genesys orgs. The active org is resolved at runtime from a `?org=<key>` URL parameter against a **server-side** registry (`api/data/customers.js`); the browser only ever receives its own org's public config via `GET /api/org-config`. Includes a post-login org-match check and a hard-fail screen for unknown orgs.
- **Premium App Ready** — Can be embedded inside the Genesys Cloud client as an iframe.

## Tech Stack

| Component | Technology |
| --------- | ---------- |
| Front-end | Vanilla JS (ES modules), CSS custom properties |
| Backend | Azure Functions (Node, v4 programming model, SWA managed) — BFF: per-org config + token-forwarding orchestration |
| Charts | [Chart.js v4](https://www.chartjs.org/) (CDN) |
| Excel export | [xlsx-js-style](https://github.com/gitbrent/xlsx-js-style) (CDN) |
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
│   │   └── xlsx.full.min.js    # SheetJS fallback (export now uses xlsx-js-style via CDN)
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
│       ├── apiClient.js        # Low-level Genesys API wrapper (direct browser calls)
│       ├── bffClient.js        # BFF client — calls the app's own /api/* orchestration endpoints
│       └── authService.js      # OAuth PKCE + session management
├── api/                        # Azure Functions BFF (SWA managed; server-side)
│   ├── host.json
│   ├── package.json
│   ├── data/
│   │   └── customers.js        # Customer registry — SERVER-SIDE, never shipped to the browser
│   └── src/
│       ├── functions/
│       │   ├── orgConfig.js             # GET  /api/org-config            — active org's public config
│       │   ├── copilots.js              # GET  /api/copilots              — copilot-enabled assistants
│       │   ├── queues.js                # POST /api/queues                — copilot → queue cascade
│       │   ├── agents.js                # POST /api/agents                — queue → agent cascade
│       │   ├── wrapupCodes.js           # GET  /api/wrapup-codes          — wrap-up code names
│       │   ├── conversationsSearch.js   # POST /api/conversations/search  — analytics query
│       │   └── conversationsEnrich.js   # POST /api/conversations/enrich  — checklists + summaries
│       └── shared/
│           ├── orgResolve.js            # Resolve org + forwarded token from request headers
│           ├── genesysClient.js         # Server-side Genesys client (throttle + retry + paginate)
│           └── checklistEnrich.js       # Per-conversation checklist + summary enrichment
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

// Hard-fail when ?org= is absent: every integration URL must include it.
// Set to an existing key (e.g. "demo") only to restore a temporary fallback.
const DEFAULT_ORG_KEY = null;

module.exports = { CUSTOMERS, DEFAULT_ORG_KEY };
```

On the client, `js/config.js` fetches that endpoint and derives `region`, `authHost`, `apiBase`, and `oauthClientId`, always using `oauthRedirectUri: window.location.origin`. To onboard a customer you add a registry line on the server and point that org's integration at `…/?org=<key>` — no client changes.

Feature-level settings (date ranges, chart colours, export columns, labels) are in `js/pages/dashboards/agent-copilot/checklistConfig.js`.

## User Permissions

Every Genesys call is made with the **logged-in user's own access token** — whether issued directly from the browser (login, identity, recordings) or forwarded to the BFF and used server-side (copilot/queue/agent cascades, search, enrichment). The backend adds **no privileges of its own**, so the user's Genesys Cloud role still determines what data they can access. Each user needs a role with these permissions:

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
