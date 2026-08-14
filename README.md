# Agent Copilot App

A dashboard for **Genesys Cloud Agent Copilot** — view agent checklists, conversation summaries, recordings, and completion analytics. The front-end is plain ES modules (no build step); an Azure Functions **backend-for-frontend (BFF)** (`api/`) serves per-org configuration **and runs all Genesys orchestration server-side**, forwarding the agent's own access token. The multi-step orchestration logic and Genesys API shapes never reach the browser.

---

## Features

- **Checklists & Summaries** — Search conversations by copilot assistant, queue, agent, and date range. Drill into checklist items with separate Agent / AI tick indicators and AI-generated conversation summaries. A single conversation can carry multiple checklists; transferred conversations show all agents and their checklists/summaries — including cases where several agents ran the *same* checklist template, each attributed to its owning agent.
- **Recordings** — Inline audio and screen recording playback per conversation segment.
- **Completion Chart** — Bar chart showing complete vs incomplete checklist counts (Chart.js v4).
- **Excel Export** — Three-sheet XLSX export (Summary + Interactions + Checklist Items) via xlsx-js-style, with styled header rows and per-column auto-filters. Interactions/Summary include a **Copilot** column. The export always reflects the filters currently applied, so the download matches the table and chart on screen.
- **Cascading Filters** — Select a copilot → queues cascade → agents cascade. Status filters (All / Completed / Incomplete / Summaries) with an Agent Checked toggle.
- **Backend-for-Frontend (BFF)** — The browser calls the app's own `/api/*` endpoints; the server forwards the agent's Genesys token and performs the copilot/queue/agent cascades, the analytics search, and per-conversation checklist + summary enrichment. The token is forwarded in a custom **`X-Genesys-Token`** header (Azure Static Web Apps reserves and overwrites the standard `Authorization` header on the managed-Functions hop). The org key is **bound to the token**: the server reads the token's real organization from Genesys (cached for 5 minutes) and rejects a mismatch with 403, so the key cannot be used to point a token at another region. Only login/identity and recording playback still call Genesys directly from the browser.
- **Rate-Limit Handling** — Per-org request throttle (5 concurrent, 210 ms gap) and automatic retry with exponential backoff on 429/5xx responses, applied both server-side (BFF) and in the browser (recording calls). Genesys rate limits are per organization, so one org's large search cannot slow another org sharing the same Functions worker.
- **Request Limits** — Every endpoint caps the work a single call can request (filter list sizes, conversations per enrichment batch, analytics pages, interval length). A search that hits the page ceiling returns `truncated: true` and the UI says the result set is partial rather than presenting it as complete.
- **Light / Dark Theme** — Automatically follows the OS / browser colour scheme.
- **Version & Release Notes** — The sidebar footer shows the current app version. Versions are maintained manually in `js/releaseNotes.js` (the single source of truth): each entry has an explicit two-number `version` (e.g. `1.0`, `1.1`, `2.0`), and the newest entry is exported as `APP_VERSION` for the footer. Clicking the footer opens an in-app Release Notes page (history-back button).
- **OAuth PKCE** — Authorization Code + PKCE flow, no client secret needed. The access token lives in `sessionStorage` only, so it is scoped to the tab that obtained it and never persisted; a new tab re-runs the flow, which is silent while the Genesys session is live.
- **Security Headers** — `staticwebapp.config.json` sets a Content-Security-Policy plus `X-Content-Type-Options`, `Referrer-Policy` and `Permissions-Policy`. Framing is controlled by CSP `frame-ancestors` (limited to Genesys Cloud origins) rather than `X-Frame-Options`, because the app must stay embeddable as a Premium App. CDN libraries are pinned to exact versions and verified with Subresource Integrity hashes.
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
├── css/
│   ├── styles.css              # All app styles (dark + light theme)
│   └── download.css            # Styles for the export helper page
├── js/
│   ├── app.js                  # Bootstrap & auth init
│   ├── config.js               # Static app settings; fetches active customer config
│   ├── orgContext.js           # Resolves the active org key from ?org=
│   ├── nav.js                  # Sidebar renderer
│   ├── navConfig.js            # Navigation tree definition
│   ├── releaseNotes.js         # Release notes content (newest first)
│   ├── pageRegistry.js         # Lazy page loader
│   ├── router.js               # Hash-based SPA router (+ page teardown contract)
│   ├── download.js             # Export helper page script
│   ├── utils.js                # Shared helpers
│   ├── components/
│   │   └── multiSelect.js      # Multi-select dropdown component
│   ├── pages/
│   │   ├── welcome.js          # Landing page
│   │   ├── releaseNotes.js     # Release Notes page (reached from the version footer)
│   │   ├── notfound.js         # 404 page
│   │   └── dashboards/
│   │       └── agent-copilot/
│   │           ├── agentChecklists.js   # Main feature page
│   │           ├── checklistConfig.js   # Feature tunables & labels
│   │           └── performance.js       # Stub (disabled)
│   └── services/
│       ├── apiClient.js        # Direct Genesys calls that must stay browser-side (recordings)
│       ├── bffClient.js        # BFF client — calls the app's own /api/* orchestration endpoints
│       └── authService.js      # OAuth PKCE + session management
├── api/                        # Azure Functions BFF (SWA managed; server-side)
│   ├── host.json
│   ├── package.json
│   ├── data/
│   │   └── customers.js        # Customer registry — SERVER-SIDE, never shipped to the browser
│   ├── test/
│   │   └── checklistEnrich.test.js      # node:test unit tests (npm test)
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
│           ├── orgResolve.js            # Resolve org + verify the forwarded token belongs to it
│           ├── genesysClient.js         # Server-side Genesys client (per-org throttle + retry + paginate)
│           ├── checklistEnrich.js       # Per-conversation checklist + summary enrichment
│           └── http.js                  # Shared response/validation helpers
├── staticwebapp.config.json    # SPA fallback + /api routing + security headers
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

The endpoint returns no customer-identifying `name`: it is reachable before login, so anything human-readable about an org would be handed to anyone who guesses a key. Give every entry an `orgId` — it powers both the post-login org-match check in the browser and the server-side token↔org binding.

Feature-level settings (date ranges, chart colours, export column widths, labels) are in `js/pages/dashboards/agent-copilot/checklistConfig.js`. Export column widths are keyed by column header, so adding a column cannot shift the widths of the ones after it.

## Tests

The pure server-side logic (checklist completion, summary flattening) has unit tests using Node's built-in test runner — no dependencies, no build step:

```bash
cd api && npm test
```

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
