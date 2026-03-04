# Agent Copilot App — API Reference

This document lists every external API call the app makes. All calls target the **Genesys Cloud Public API** and are made directly from the user's browser using their own OAuth access token. The app has **no backend** and does **not** store, cache, or transmit data to any third-party server.

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

### 1.1 Authorization Redirect

| Detail | Value |
| --- | --- |
| URL | `https://login.{region}/oauth/authorize` |
| Method | Browser redirect (GET) |
| Parameters | `response_type=code`, `client_id`, `redirect_uri`, `code_challenge` (S256), `state`, `scope` |
| Scopes requested | `openid`, `profile`, `email`, `routing` |

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

> No tokens are written to cookies, IndexedDB, or sent to any server other than Genesys Cloud.

---

## 2. API Calls

All calls go to `https://api.{region}` with the header `Authorization: Bearer {access_token}`.

### 2.1 User Identity

| Endpoint | Method | Purpose | Permission |
| --- | --- | --- | --- |
| `/api/v2/users/me` | GET | Fetch the logged-in user's profile (name, email, org) | *(implicit — any authenticated user)* |

### 2.2 Assistants (Copilot)

| Endpoint | Method | Purpose | Permission |
| --- | --- | --- | --- |
| `/api/v2/assistants?pageSize=200&expand=copilot` | GET | List all assistants with copilot configuration. Auto-paginates using cursor (`after`). | `assistants:assistant:view` |
| `/api/v2/assistants/{assistantId}/queues?pageSize=200` | GET | List queue IDs assigned to a specific assistant. Auto-paginates using cursor. | `assistants:queue:view` |

### 2.3 Routing

| Endpoint | Method | Purpose | Permission |
| --- | --- | --- | --- |
| `/api/v2/routing/queues/{queueId}` | GET | Fetch a single queue by ID (name resolution). Called in parallel batches of 10. | `routing:queue:view` |
| `/api/v2/routing/queues/{queueId}/members?pageNumber={n}&pageSize=100` | GET | List all members of a queue (for the agent filter dropdown). Auto-paginates. | `routing:queue:member:view` |
| `/api/v2/routing/wrapupcodes?pageNumber={n}&pageSize=500` | GET | Fetch all wrap-up codes (name resolution). Auto-paginates. Called once per search. | `routing:wrapupCode:view` |

### 2.4 Analytics

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

| Endpoint | Method | Purpose | Permission |
| --- | --- | --- | --- |
| `/api/v2/conversations/{conversationId}` | GET | Fetch full conversation (participants, communications). Used to find agent communication IDs. | `conversation:communication:view` |
| `/api/v2/conversations/{conversationId}/communications/{communicationId}/agentchecklists` | GET | Fetch agent checklist data for a specific communication. Tried for each agent communication until data is found. | `conversation:communication:view` |
| `/api/v2/conversations/{conversationId}/summaries` | GET | Fetch AI-generated conversation summaries (headline, reason, resolution, followup). | `conversation:summary:view` |

### 2.6 Recordings

| Endpoint | Method | Purpose | Permission |
| --- | --- | --- | --- |
| `/api/v2/conversations/{conversationId}/recordings?maxWaitMs=5000` | GET | List recording stubs (metadata only — no audio). Returns id, fileState, mediaType, duration. | `recording:recording:view` |
| `/api/v2/conversations/{conversationId}/recordings/{recordingId}?formatId={format}&maxWaitMs=5000` | GET | Fetch a single recording with a presigned playable URL. Triggers server-side transcoding. Returns a time-limited S3 URL (~5 min validity). | `recording:recording:view` |

**Recording formats requested:**

| Media type | Format requested |
| --- | --- |
| Audio (calls) | `MP3` |
| Screen recordings | `WEBM` |

**Retry behaviour:**
- **Stub fetch** (Load Recordings button): retries up to 2 additional times with 3-second delay if no stubs are returned (Genesys may not have indexed the recording yet).
- **Transcoding** (Part buttons): retries up to 4 additional times with 3-second delay if no `mediaUri` is returned (transcoding may still be in progress for long recordings).

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
- Agent copilot checklist items and tick states (agent vs AI)
- AI-generated conversation summaries (headline, reason, resolution, followup)
- Recording audio/video via presigned URLs (streamed directly from Genesys S3 to the browser)
- Queue names, agent names, wrap-up code names (for display)

### What the app does NOT do

- **No data storage** — nothing is written to any database, file system, or cloud storage
- **No data transmission** — data is never sent to any server other than Genesys Cloud (`api.{region}`)
- **No cookies** — authentication uses `sessionStorage` only
- **No telemetry** — no usage tracking, analytics, or error reporting services
- **No write operations** — the app only reads data; it never creates, updates, or deletes anything in Genesys Cloud

### Excel export

When the user exports data to Excel, the XLSX file is generated **entirely in the browser** using SheetJS. The file is passed to a helper page (`download.html`) via the URL hash fragment (which never leaves the browser) and saved via the browser's native file picker. No data is uploaded anywhere.

---

## 5. Network Requirements

### Domains to whitelist

The following domains must be accessible from the user's browser:

| Domain | Port | Purpose |
| --- | --- | --- |
| `login.{region}` (e.g. `login.mypurecloud.de`) | 443 | OAuth authorization & token exchange |
| `api.{region}` (e.g. `api.mypurecloud.de`) | 443 | All Genesys Cloud API calls |
| `apps.{region}` (e.g. `apps.mypurecloud.de`) | 443 | Required if embedded as a Premium App |
| `cdn.jsdelivr.net` | 443 | Chart.js library (CDN) |
| Your SWA hostname (e.g. `*.azurestaticapps.net`) | 443 | The app itself |

> The `{region}` value depends on the customer's Genesys Cloud deployment (e.g. `mypurecloud.de` for Frankfurt, `mypurecloud.com` for US East). See the [setup guide](setup-guide.md) for the full region list.

### Recording playback

Recording audio/video is streamed from Genesys Cloud's internal presigned S3 URLs. These are returned dynamically by the recordings API and do not require explicit whitelisting — they are proxied through the `api.{region}` domain.

### CORS

The app makes direct API calls from the browser. Genesys Cloud's API supports CORS for OAuth-authenticated requests from registered redirect URIs. No CORS proxy is needed.
