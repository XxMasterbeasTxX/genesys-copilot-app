# Agent Copilot App — API Reference

This document lists every external API call the app makes. They all ultimately target the **Genesys Cloud Public API** using the logged-in user's own OAuth access token, but they travel by **two paths**:

- **Direct** — the browser calls Genesys (`https://api.{region}` / `https://login.{region}`) itself: OAuth login, identity (`/users/me`, `/organizations/me`), and recording playback.
- **Via the BFF** — the browser calls the app's own first-party Azure Functions backend (`/api/*`), which calls Genesys **server-side** with the forwarded token: copilots, queues, agents, wrap-up codes, the analytics search, and per-conversation checklist + summary enrichment.

The app uses **no third-party server**. The BFF is the app's own Azure Static Web Apps managed Functions; it holds no credentials, performs only read operations, and stores nothing.

---

## Table of Contents

1. [Authentication](#1-authentication)
2. [API Calls](#2-api-calls)
3. [External Resources](#3-external-resources)
4. [Data Handling & Privacy](#4-data-handling--privacy)
5. [Network Requirements](#5-network-requirements)

---

## 1. Authentication

The app uses **OAuth 2.0 Authorization Code + PKCE** — the most secure browser-based OAuth flow. There is no client secret.

> **Multi-customer:** before login, the app resolves which Genesys org to authenticate against from the `?org=<key>` URL parameter. It calls the app's own backend (`GET /api/org-config?org=<key>`), which returns only that org's public bootstrap values (`clientId` + `region` + `orgId`) from a **server-side** registry (`api/data/customers.js`) — the full customer list never reaches the browser. After login the app calls `/api/v2/organizations/me` and verifies the token's org GUID matches the configured `orgId` for that key; a mismatch blocks access. An unknown `?org=` is rejected before any login attempt.

### 1.1 Authorization Redirect

| Detail | Value |
| --- | --- |
| URL | `https://login.{region}/oauth/authorize` |
| Method | Browser redirect (GET) |
| Parameters | `response_type=code`, `client_id`, `redirect_uri`, `code_challenge` (S256), `state`, `scope` |
| Scopes requested | `openid`, `profile`, `email`, `routing` |

> The `redirect_uri` is the app's own origin (`window.location.origin`), so it automatically matches whichever URL the app is served from (DEV, PROD, or a customer host). Each such origin must be registered as an Authorized redirect URI on the Genesys OAuth client.

### 1.2 Token Exchange

| Detail | Value |
| --- | --- |
| URL | `https://login.{region}/oauth/token` |
| Method | POST |
| Content-Type | `application/x-www-form-urlencoded` |
| Parameters | `grant_type=authorization_code`, `client_id`, `code`, `redirect_uri`, `code_verifier` |
| Returns | `access_token`, `expires_in` |

### 1.3 Token Storage

| Item | Storage | Scope |
| --- | --- | --- |
| Access token | `sessionStorage` | Per-tab (cleared on tab close) |
| Expiry timestamp | `sessionStorage` | Per-tab |
| PKCE verifier | `sessionStorage` | Transient (deleted after exchange) |
| OAuth state | `sessionStorage` | Transient (deleted after exchange) |
| Cross-tab handoff | `localStorage` | Temporary (30-second TTL, then deleted) |

> No tokens are written to cookies or IndexedDB. The token is sent only to Genesys Cloud (directly) and, for orchestration, forwarded to the app's own first-party Azure Functions backend (`/api/*`) via the `X-Genesys-Token` header. It is never sent to any third-party server.

---

## 2. API Calls

**Direct calls** go to `https://api.{region}` with the header `Authorization: Bearer {access_token}`.

**BFF calls** go to the app's own `/api/*` endpoints (same origin). The browser sends the forwarded token in a custom **`X-Genesys-Token`** header plus an **`X-Org-Key`** header — **not** `Authorization`, because Azure Static Web Apps reserves and overwrites that header on the managed-Functions hop. The BFF resolves the org and region **server-side** (from `api/data/customers.js`, never from the client) and then makes the Genesys calls below with `Authorization: Bearer {forwarded token}`.

### BFF endpoint map

| BFF endpoint | Method | Genesys calls made server-side | Returns |
| --- | --- | --- | --- |
| `/api/org-config` | GET | *(none — reads the server-side registry)* | Active org's public bootstrap (`clientId`, `region`, `orgId`) |
| `/api/copilots` | GET | `GET /api/v2/assistants?expand=copilot` (cursor-paginated) | Copilot-enabled assistants `[{id,name}]` |
| `/api/queues` | POST | `GET /api/v2/assistants/{id}/queues` per copilot | Distinct queues across the selected copilots |
| `/api/agents` | POST | `GET /api/v2/routing/queues/{id}` + `/members` per queue | Distinct agents across the selected queues |
| `/api/wrapup-codes` | GET | `GET /api/v2/routing/wrapupcodes` (paginated) | Wrap-up code id → name map |
| `/api/conversations/search` | POST | `POST /api/v2/analytics/conversations/details/query` (paginated) | Conversation rows for the date range + filters |
| `/api/conversations/enrich` | POST | `GET /api/v2/conversations/{id}`, `/agentchecklists`, `/summaries` per conversation | Per-conversation checklists + summaries |

### 2.1 User Identity

> **Routing:** Direct (browser → Genesys, from `js/services/authService.js`).

| Endpoint | Method | Purpose | Permission |
| --- | --- | --- | --- |
| `/api/v2/users/me` | GET | Fetch the logged-in user's profile (name, email, org) | *(implicit — any authenticated user)* |
| `/api/v2/organizations/me` | GET | Verify the logged-in user's org matches the configured customer (multi-customer org-match check) | *(implicit — any authenticated user)* |

### 2.2 Assistants (Copilot)

> **Routing:** Via the BFF — the assistant list is fetched by `GET /api/copilots` and the per-assistant queues by `POST /api/queues`.

| Endpoint | Method | Purpose | Permission |
| --- | --- | --- | --- |
| `/api/v2/assistants?pageSize=200&expand=copilot` | GET | List all assistants with copilot configuration. Auto-paginates using cursor (`after`). | `assistants:assistant:view` |
| `/api/v2/assistants/{assistantId}/queues?pageSize=200` | GET | List queue IDs assigned to a specific assistant. Auto-paginates using cursor. | `assistants:queue:view` |

### 2.3 Routing

> **Routing:** Via the BFF — queue-name resolution and queue members are fetched by `POST /api/agents`; wrap-up codes by `GET /api/wrapup-codes`.

| Endpoint | Method | Purpose | Permission |
| --- | --- | --- | --- |
| `/api/v2/routing/queues/{queueId}` | GET | Fetch a single queue by ID (name resolution). Called in parallel batches of 10. | `routing:queue:view` |
| `/api/v2/routing/queues/{queueId}/members?pageNumber={n}&pageSize=100` | GET | List all members of a queue (for the agent filter dropdown). Auto-paginates. | `routing:queue:member:view` |
| `/api/v2/routing/wrapupcodes?pageNumber={n}&pageSize=500` | GET | Fetch all wrap-up codes (name resolution). Auto-paginates. Called once per search. | `routing:wrapupCode:view` |

### 2.4 Analytics

> **Routing:** Via the BFF — `POST /api/conversations/search`. The page size and 31-day interval limit are enforced server-side.

| Endpoint | Method | Purpose | Permission |
| --- | --- | --- | --- |
| `/api/v2/analytics/conversations/details/query` | POST | Query conversation history by date range, copilot assistant, queue, and optionally agent. Auto-paginates (100 per page). | `analytics:conversationDetail:view` |

**Request body structure:**

```json
{
  "interval": "2026-01-01T00:00:00Z/2026-01-31T23:59:59Z",
  "order": "desc",
  "orderBy": "conversationStart",
  "segmentFilters": [
    { "type": "or", "predicates": [{ "dimension": "agentAssistantId", "value": "..." }] },
    { "type": "or", "predicates": [{ "dimension": "queueId", "value": "..." }] },
    { "type": "or", "predicates": [{ "dimension": "userId", "value": "..." }] }
  ],
  "paging": { "pageSize": 100, "pageNumber": 1 }
}
```

> Maximum interval: **31 days** (Genesys API limit). The app enforces this client-side.

### 2.5 Conversations & Checklists

> **Routing:** Via the BFF — `POST /api/conversations/enrich` (the browser sends conversation IDs in batches; the server fetches the conversation, its agent checklists, and summaries, and returns the enriched result).

| Endpoint | Method | Purpose | Permission |
| --- | --- | --- | --- |
| `/api/v2/conversations/{conversationId}` | GET | Fetch full conversation (participants, communications). Used to find agent communication IDs and build the communication-to-agent mapping. | `conversation:communication:view` |
| `/api/v2/conversations/{conversationId}/communications/{communicationId}/agentchecklists` | GET | Fetch agent checklist data. The endpoint is conversation-scoped — a single conversation can hold **multiple** checklists, including several agents running the **same** checklist template (e.g. across transfers). Called for **every** agent communication to collect all checklists. Each checklist is attributed to its owning agent via its own `agentId` (falling back to the queried communication's agent). | `conversation:communication:view` |
| `/api/v2/conversations/{conversationId}/summaries` | GET | Fetch AI-generated conversation summaries (headline, reason, resolution, followup). Session summaries are tagged with the owning agent via communication ID mapping. | `conversation:summary:view` |

### 2.6 Recordings

> **Routing:** Direct (browser → Genesys). Recording stubs and presigned playback URLs are fetched straight from `api.{region}` so audio/video streams directly from Genesys S3 to the browser.

| Endpoint | Method | Purpose | Permission |
| --- | --- | --- | --- |
| `/api/v2/conversations/{conversationId}/recordings?maxWaitMs=5000` | GET | List recording stubs (metadata only — no audio). Returns id, fileState, mediaType, duration. | `recording:recording:view` |
| `/api/v2/conversations/{conversationId}/recordings/{recordingId}?formatId={format}&maxWaitMs=5000` | GET | Fetch a single recording with a presigned playable URL. Triggers server-side transcoding. Returns a time-limited S3 URL (~5 min validity). | `recording:recording:view` |

**Recording formats requested:**

| Media type | Format requested |
| --- | --- |
| Audio (calls) | `MP3` |
| Screen recordings | `WEBM` |

**Retry behaviour (recordings only):**

- **Stub fetch** (Load Recordings button): retries up to 2 additional times with 3-second delay if no stubs are returned (Genesys may not have indexed the recording yet).
- **Transcoding** (Part buttons): retries up to 4 additional times with 3-second delay if no `mediaUri` is returned (transcoding may still be in progress for long recordings).

### 2.7 Request Throttle & Retry

All Genesys calls — whether made server-side by the BFF or directly by the browser — are subject to a throttle and automatic retry mechanism. This prevents exceeding Genesys Cloud's rate limits (~300 requests/minute) during bulk operations such as checklist enrichment. The BFF throttle lives in `api/src/shared/genesysClient.js`; the browser throttle (for direct calls such as recordings) lives in `js/services/apiClient.js`. Both use the same settings:

**Throttle (proactive):**

| Setting | Value | Description |
| --- | --- | --- |
| `MAX_CONCURRENT` | `5` | Maximum in-flight requests at any time (semaphore) |
| `MIN_REQUEST_GAP_MS` | `210` | Minimum gap between consecutive request starts (~285 req/min) |

Requests that exceed the concurrency limit are queued and dispatched in FIFO order as slots become available.

**Retry (reactive):**

| Setting | Value | Description |
| --- | --- | --- |
| `MAX_RETRIES` | `3` | Maximum retry attempts per request |
| `RETRY_BASE_MS` | `1000` | Base backoff delay (doubles each attempt: 1 s → 2 s → 4 s) |
| Retryable status codes | `429`, `500`, `502`, `503`, `504` | Rate-limited or server errors |
| `Retry-After` header | Respected | If the API returns a `Retry-After` header, the longer of the header value or the exponential backoff is used |

Non-retryable errors (4xx other than 429) are thrown immediately.

**Error visibility:**

When enrichment of a specific conversation fails after all retries, the results table shows a red **⚠ Error** badge with a tooltip describing the failure. The status bar shows the total count of errors alongside the normal completion summary.

---

## 3. External Resources

The app loads two external resources:

| Resource | URL | Purpose | Loaded from |
| --- | --- | --- | --- |
| Chart.js v4 | `https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js` | Completion bar chart rendering | CDN (jsDelivr) |
| SheetJS (XLSX) | `/js/lib/xlsx.full.min.js` | Excel export | Bundled locally (no CDN call) |

> No other third-party scripts, tracking pixels, or analytics services are loaded.

---

## 4. Data Handling & Privacy

### What the app reads

- Conversation metadata (timestamps, participants, queue, media type, duration, wrap-up codes)
- Agent copilot checklist items and tick states (agent vs AI) — all checklists across all agent communications (including multiple checklists per conversation and the same template run by different agents on transfers)
- AI-generated conversation summaries (headline, reason, resolution, followup) — tagged with owning agent name
- Recording audio/video via presigned URLs (streamed directly from Genesys S3 to the browser)
- Queue names, agent names, wrap-up code names (for display)

### What the app does NOT do

- **No data storage** — nothing is written to any database, file system, or cloud storage (the BFF is stateless and caches nothing)
- **No third-party transmission** — data flows only between the browser, the app's own first-party Azure Functions backend (`/api/*`), and Genesys Cloud (`api.{region}`). No external/third-party server is involved.
- **No cookies** — authentication uses `sessionStorage` only
- **No telemetry** — no usage tracking, analytics, or error reporting services
- **No write operations** — the app (browser and BFF alike) only reads data; it never creates, updates, or deletes anything in Genesys Cloud

### Excel export

When the user exports data to Excel, the XLSX file is generated **entirely in the browser** using SheetJS. The file is passed to a helper page (`download.html`) via the URL hash fragment (which never leaves the browser) and saved via the browser's native file picker. No data is uploaded anywhere.

---

## 5. Network Requirements

### Domains to whitelist

The following domains must be accessible from the user's browser:

| Domain | Port | Purpose |
| --- | --- | --- |
| `login.{region}` (e.g. `login.mypurecloud.de`) | 443 | OAuth authorization & token exchange |
| `api.{region}` (e.g. `api.mypurecloud.de`) | 443 | Direct Genesys calls from the browser (identity, recordings); the BFF reaches Genesys server-side over the Azure network |
| `apps.{region}` (e.g. `apps.mypurecloud.de`) | 443 | Required if embedded as a Premium App |
| `cdn.jsdelivr.net` | 443 | Chart.js library (CDN) |
| Your SWA hostname (e.g. `*.azurestaticapps.net`) | 443 | The app itself |

> The `{region}` value depends on the customer's Genesys Cloud deployment (e.g. `mypurecloud.de` for Frankfurt, `mypurecloud.com` for US East). See the [setup guide](setup-guide.md) for the full region list.

### Recording playback

Recording audio/video is streamed from Genesys Cloud's internal presigned S3 URLs. These are returned dynamically by the recordings API and do not require explicit whitelisting — they are proxied through the `api.{region}` domain.

### CORS

The browser makes direct Genesys API calls (login, identity, recordings) and calls the app's own `/api/*` BFF endpoints (same origin, so no CORS). Genesys Cloud's API supports CORS for OAuth-authenticated requests from registered redirect URIs, and the BFF's own Genesys calls are server-to-server (no CORS involved). No CORS proxy is needed.
