// ============================================================================
// Server-side Genesys Cloud client (token-forwarding BFF).
// ----------------------------------------------------------------------------
// Mirrors the throttle + retry behaviour of the browser apiClient.js, but runs
// inside the Azure Functions worker so the orchestration logic (which calls it)
// never ships to the browser.
//
//   - Token-forwarding: every call uses the agent's own forwarded access token.
//     The server adds no privileges of its own.
//   - Region is resolved server-side (see orgResolve.js) and passed in as
//     `apiBase`; it is never taken from client input.
//   - The throttle is process-wide: concurrent invocations sharing a worker
//     cooperate on the same rate budget, which is friendlier to the Genesys
//     API than each browser tab throttling independently.
// ============================================================================

/** Maximum number of retries for rate-limited (429) or server-error (5xx) responses. */
const MAX_RETRIES = 3;
/** Base delay in ms before the first retry (doubled each attempt). */
const RETRY_BASE_MS = 1000;

// ── Process-wide request throttle ────────────────────────────
/** Max concurrent in-flight API requests across this worker. */
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

/**
 * Perform a single throttled, retrying request to the Genesys API.
 *
 * @param {object}  args
 * @param {string}  args.apiBase  e.g. "https://api.mypurecloud.de" (server-resolved)
 * @param {string}  args.token    forwarded Genesys access token
 * @param {string}  args.path     e.g. "/api/v2/assistants?pageSize=200"
 * @param {string}  [args.method] HTTP method (default "GET")
 * @param {object}  [args.body]   JSON body for POST/PUT/PATCH
 * @param {object}  [args.context] Functions invocation context (for logging)
 * @returns {Promise<any|null>}   parsed JSON, or null for empty/non-JSON bodies
 */
async function genesysRequest({ apiBase, token, path, method = "GET", body, context }) {
  await acquireSlot();
  try {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(`${apiBase}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
      });

      // Retry on 429 (rate-limit) and 5xx (server errors)
      if ((res.status === 429 || res.status >= 500) && attempt < MAX_RETRIES) {
        const retryAfter = res.headers.get("retry-after");
        const delayMs = retryAfter
          ? Math.min(parseFloat(retryAfter) * 1000, 30_000)
          : RETRY_BASE_MS * 2 ** attempt;
        context?.warn?.(
          `[genesys] ${res.status} on ${method} ${path} — retry ${attempt + 1}/${MAX_RETRIES} in ${delayMs}ms`,
        );
        await new Promise((r) => setTimeout(r, delayMs));
        continue;
      }

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        const err = new Error(
          `Genesys ${method} ${path} failed: ${res.status} ${res.statusText} ${text}`,
        );
        err.status = res.status;
        throw err;
      }

      const contentType = res.headers.get("content-type") || "";
      if (!contentType.includes("application/json")) return null;
      return res.json();
    }
  } finally {
    releaseSlot();
  }
}

/**
 * Auto-paginate a cursor-paginated ("after"/nextUri) Genesys collection.
 *
 * @param {object} args                same shape as genesysRequest
 * @param {string} args.path           base path WITHOUT an `after` cursor; may include other query params
 * @param {number} [args.pageSize=200]
 * @returns {Promise<any[]>}           flattened `entities` across all pages
 */
async function genesysPaginateCursor({ apiBase, token, path, pageSize = 200, context }) {
  const all = [];
  let after;
  for (;;) {
    const sep = path.includes("?") ? "&" : "?";
    const qs = `pageSize=${pageSize}${after ? `&after=${encodeURIComponent(after)}` : ""}`;
    const res = await genesysRequest({ apiBase, token, path: `${path}${sep}${qs}`, context });
    if (res?.entities) all.push(...res.entities);
    if (!res?.nextUri) break;
    const next = new URL(res.nextUri, apiBase).searchParams.get("after");
    if (!next) break;
    after = next;
  }
  return all;
}

/**
 * Auto-paginate a page-numbered Genesys collection (pageNumber/pageSize/total),
 * e.g. queue members and wrap-up codes.
 *
 * @param {object} args                same shape as genesysRequest
 * @param {string} args.basePath       base path WITHOUT paging params; may include other query params
 * @param {number} [args.pageSize=100]
 * @returns {Promise<any[]>}           flattened `entities` across all pages
 */
async function genesysPaginatePage({ apiBase, token, basePath, pageSize = 100, context }) {
  const all = [];
  let page = 1;
  let total = Infinity;
  while (all.length < total) {
    const sep = basePath.includes("?") ? "&" : "?";
    const res = await genesysRequest({
      apiBase,
      token,
      path: `${basePath}${sep}pageNumber=${page}&pageSize=${pageSize}`,
      context,
    });
    total = res?.total ?? res?.entities?.length ?? 0;
    if (res?.entities) all.push(...res.entities);
    if (!res?.entities?.length) break;
    page++;
  }
  return all;
}

module.exports = { genesysRequest, genesysPaginateCursor, genesysPaginatePage };
