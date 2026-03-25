# Agent Copilot App

A standalone front-end dashboard for **Genesys Cloud Agent Copilot** — view agent checklists, conversation summaries, recordings, and completion analytics. No backend or build step required.

---

## Features

- **Agent Checklists & Summaries** — Search conversations by copilot assistant, queue, agent, and date range. Drill into checklist items with separate Agent / AI tick indicators and AI-generated conversation summaries. Transferred conversations show all agents and their checklists/summaries.
- **Recordings** — Inline audio and screen recording playback per conversation segment.
- **Completion Chart** — Bar chart showing complete vs incomplete checklist counts (Chart.js v4).
- **Excel Export** — Two-sheet XLSX export (interactions + checklist items) via SheetJS.
- **Cascading Filters** — Select a copilot → queues cascade → agents cascade. Status filters (All / Completed / Incomplete / Summaries) with an Agent Checked toggle.
- **Light / Dark Theme** — Automatically follows the OS / browser colour scheme.
- **OAuth PKCE** — Authorization Code + PKCE flow with cross-tab session handoff. No client secret needed.
- **Premium App Ready** — Can be embedded inside the Genesys Cloud client as an iframe.

## Tech Stack

| Component | Technology |
| --------- | ---------- |
| Front-end | Vanilla JS (ES modules), CSS custom properties |
| Charts | [Chart.js v4](https://www.chartjs.org/) (CDN) |
| Excel export | [SheetJS](https://sheetjs.com/) (`xlsx.full.min.js`, bundled) |
| Auth | OAuth 2.0 Authorization Code + PKCE |
| Hosting | Azure Static Web Apps (free tier) |
| CI/CD | GitHub Actions |

## Project Structure

```text
├── index.html                  # App shell
├── download.html               # Excel export helper (iframe-safe)
├── css/styles.css              # All styles (dark + light theme)
├── js/
│   ├── app.js                  # Bootstrap & auth init
│   ├── config.js               # Region, OAuth, and app settings
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
├── docs/
│   └── setup-guide.md          # Full deployment guide
└── .github/workflows/
    └── azure-static-web-apps.yml  # CI/CD pipeline
```

## Quick Start

1. Clone the repo
2. Create a Genesys Cloud OAuth client (Authorization Code, `routing` scope)
3. Create an Azure Static Web App linked to this repo
4. Update `js/config.js` with your region, Client ID, and SWA URL
5. Set the SWA deployment token as a GitHub secret (`AZURE_STATIC_WEB_APPS_API_TOKEN`)
6. Push to `main` — CI/CD deploys automatically

See [docs/setup-guide.md](docs/setup-guide.md) for the complete step-by-step guide.

## Configuration

All customer-specific values live in `js/config.js`:

```javascript
const REGION = "mypurecloud.de";

export const CONFIG = {
  region: REGION,
  authHost: `login.${REGION}`,
  apiBase: `https://api.${REGION}`,
  appName: "Agent Copilot",
  oauthClientId: "your-client-id-here",
  oauthRedirectUri: "https://your-swa-url.azurestaticapps.net",
  oauthScopes: ["openid", "profile", "email", "routing"],
  router: { mode: "hash" }
};
```

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

Push to `main` triggers automatic deployment via GitHub Actions — no build step involved. The app is served as static files from Azure Static Web Apps (free tier).

## License

Proprietary — all rights reserved.
