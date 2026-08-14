import { CONFIG } from "../config.js";

// ============================================================================
// Direct Genesys API client (browser → Genesys).
// ----------------------------------------------------------------------------
// All orchestration (copilot/queue/agent cascades, analytics search, checklist
// + summary enrichment) now runs server-side in the BFF, so this client is
// deliberately SMALL: it covers only the calls that must stay in the browser.
//
// Recordings are the one remaining case. Playback needs a short-lived presigned
// media URL fetched on demand and handed straight to an <audio>/<video> element;
// proxying that through the BFF would buy nothing and add a hop. Login and
// identity are handled separately in authService.js.
//
// Do NOT re-add orchestration helpers here. A second copy of a rule like "what
// counts as copilot-enabled" is exactly the drift the BFF migration removed.
// ============================================================================

/** Maximum number of retries for rate-limited (429) or server-error (5xx) responses. */
const MAX_RETRIES = 3;
/** Base delay in ms before the first retry (doubled each attempt). */
const RETRY_BASE_MS = 1000;

// ── Global request throttle ──────────────────────────────────
/** Max concurrent in-flight API requests. */
const MAX_CONCURRENT = 5;
/** Minimum gap between request starts (ms). ~5 req/s = 200ms gap. */
const MIN_REQUEST_GAP_MS = 210;

let inFlight = 0;
let lastRequestTime = 0;
const waitQueue = [];

/** Acquire a throttle slot — resolves when it's safe to send. */
function acquireSlot() {
  return new Promise((resolve) => {
    const tryAcquire = () => {
      const now = Date.now();
      const gap = MIN_REQUEST_GAP_MS - (now - lastRequestTime);
      if (inFlight < MAX_CONCURRENT && gap <= 0) {
        inFlight++;
        lastRequestTime = Date.now();
        resolve();
      } else {
        const delay = Math.max(gap, 50);
        setTimeout(tryAcquire, delay);
      }
    };

    if (inFlight < MAX_CONCURRENT) {
      tryAcquire();
    } else {
      waitQueue.push(tryAcquire);
    }
  });
}

/** Release a throttle slot and wake next waiter. */
function releaseSlot() {
  inFlight--;
  if (waitQueue.length) {
    const next = waitQueue.shift();
    next();
  }
}

export function createApiClient(getAccessToken) {
  async function request(path, { method = "GET", headers = {}, body, signal } = {}) {
    const token = getAccessToken();
    if (!token) throw new Error("No access token available");

    await acquireSlot();
    try {
      for (let attempt = 0; ; attempt++) {
        const res = await fetch(`${CONFIG.apiBase}${path}`, {
          method,
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            ...headers,
          },
          body: body ? JSON.stringify(body) : undefined,
          signal,
        });

        // Retry on 429 (rate-limit) and 5xx (server errors)
        if ((res.status === 429 || res.status >= 500) && attempt < MAX_RETRIES) {
          const retryAfter = res.headers.get("retry-after");
          const delayMs = retryAfter
            ? Math.min(parseFloat(retryAfter) * 1000, 30_000)
            : RETRY_BASE_MS * 2 ** attempt;
          console.warn(
            `[API] ${res.status} on ${method} ${path} — retry ${attempt + 1}/${MAX_RETRIES} in ${delayMs}ms`,
          );
          await new Promise((r) => setTimeout(r, delayMs));
          continue;
        }

        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new Error(`API ${method} ${path} failed: ${res.status} ${res.statusText} ${text}`);
        }

        const contentType = res.headers.get("content-type") || "";
        if (!contentType.includes("application/json")) return null;
        return res.json();
      }
    } finally {
      releaseSlot();
    }
  }

  return {
    // ── Recordings (must stay browser-side: short-lived presigned URLs) ──
    /**
     * List all recording stubs for a conversation (no format/transcode requested).
     * Returns metadata: id, fileState, mediaType, durationMilliseconds, etc.
     * Does NOT include a playable mediaUri — use getConversationRecording() for that.
     * maxWaitMs is required; without it the API returns empty for un-cached recordings.
     */
    getConversationRecordings: (conversationId, { signal } = {}) =>
      request(
        `/api/v2/conversations/${encodeURIComponent(conversationId)}/recordings?maxWaitMs=5000`,
        { signal },
      ),

    /**
     * Fetch a single recording with a presigned playable URL.
     * Triggers transcoding to the requested format and waits up to maxWaitMs.
     * Returns a recording object with `mediaUri` (presigned S3 URL, valid ~5 min).
     * Always call on demand — never cache the URL.
     * @param {string} conversationId
     * @param {string} recordingId
     * @param {string} [formatId='MP3'] WAV | WEBM | WAV_ULAW | OGG_VORBIS | OGG_OPUS | MP3
     */
    getConversationRecording: (conversationId, recordingId, formatId = "MP3", { signal } = {}) =>
      request(
        `/api/v2/conversations/${encodeURIComponent(conversationId)}` +
          `/recordings/${encodeURIComponent(recordingId)}` +
          `?formatId=${encodeURIComponent(formatId)}&maxWaitMs=5000`,
        { signal },
      ),
  };
}
