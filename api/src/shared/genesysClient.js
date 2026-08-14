// ============================================================================
// Server-side Genesys Cloud client (token-forwarding BFF).
// ----------------------------------------------------------------------------
// Mirrors the throttle + retry behaviour of the browser apiClient.js, but runs
// inside the Azure Functions worker so the orchestration logic (which calls it)
// never ships to the browser.
//
//   - Token-forwarding: every call uses the agent's own forwarded access token.
//     The server adds no privileges of its own.
//   - Region is resolved server-side (see orgResolve.js) and carried on the
//     `org` context; it is never taken from client input.
//   - The throttle is PER-ORG and process-wide: Genesys rate limits are applied
//     per organization, so concurrent invocations for the same org cooperate on
//     one budget while a different org sharing the worker is unaffected.
//
// Every function takes the org context produced by resolveRequestOrg()
// ({ orgKey, apiBase, token }) so call sites stay short and no caller can
// accidentally pair one org's token with another org's host.
// ============================================================================

/** Maximum number of retries for rate-limited (429) or server-error (5xx) responses. */
const MAX_RETRIES = 3;
/** Base delay in ms before the first retry (doubled each attempt). */
const RETRY_BASE_MS = 1000;

// ── Per-org request throttle ─────────────────────────────────
/** Max concurrent in-flight API requests per org. */
const MAX_CONCURRENT = 5;
/** Minimum gap between request starts per org (ms). ~5 req/s = 200ms gap. */
const MIN_REQUEST_GAP_MS = 210;

/**
 * orgKey → throttle state. Bounded by the size of the customer registry:
 * resolveRequestOrg() rejects unknown keys before anything reaches here.
 * @type {Map<string, { inFlight: number, lastRequestTime: number, waitQueue: Function[] }>}
 */
const throttles = new Map();

function throttleFor(orgKey) {
  let t = throttles.get(orgKey);
  if (!t) {
    t = { inFlight: 0, lastRequestTime: 0, waitQueue: [] };
    throttles.set(orgKey, t);
  }
  return t;
}

/** Acquire a throttle slot for one org — resolves when it's safe to send. */
function acquireSlot(t) {
  return new Promise((resolve) => {
    const tryAcquire = () => {
      const now = Date.now();
      const gap = MIN_REQUEST_GAP_MS - (now - t.lastRequestTime);
      if (t.inFlight < MAX_CONCURRENT && gap <= 0) {
        t.inFlight++;
        t.lastRequestTime = Date.now();
        resolve();
      } else {
        const delay = Math.max(gap, 50);
        setTimeout(tryAcquire, delay);
      }
    };

    if (t.inFlight < MAX_CONCURRENT) {
      tryAcquire();
    } else {
      t.waitQueue.push(tryAcquire);
    }
  });
}

/** Release a throttle slot and wake the next waiter for that org. */
function releaseSlot(t) {
  t.inFlight--;
  if (t.waitQueue.length) {
    const next = t.waitQueue.shift();
    next();
  }
}

/**
 * Perform a single throttled, retrying request to the Genesys API.
 *
 * @param {object}  args
 * @param {{orgKey: string, apiBase: string, token: string}} args.org  server-resolved org context
 * @param {string}  args.path     e.g. "/api/v2/assistants?pageSize=200"
 * @param {string}  [args.method] HTTP method (default "GET")
 * @param {object}  [args.body]   JSON body for POST/PUT/PATCH
 * @param {object}  [args.context] Functions invocation context (for logging)
 * @returns {Promise<any|null>}   parsed JSON, or null for empty/non-JSON bodies
 */
async function genesysRequest({ org, path, method = "GET", body, context }) {
  const throttle = throttleFor(org.orgKey);
  await acquireSlot(throttle);
  try {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(`${org.apiBase}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${org.token}`,
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
    releaseSlot(throttle);
  }
}

/** Hard ceiling on pages any auto-paginator will walk (guards against a
 *  runaway cursor and against a single request outliving the SWA gateway). */
const DEFAULT_MAX_PAGES = 50;

/**
 * Auto-paginate a cursor-paginated ("after"/nextUri) Genesys collection.
 *
 * @param {object} args                same shape as genesysRequest
 * @param {string} args.path           base path WITHOUT an `after` cursor; may include other query params
 * @param {number} [args.pageSize=200]
 * @param {number} [args.maxPages=50]
 * @returns {Promise<any[]>}           flattened `entities` across all pages
 */
async function genesysPaginateCursor({
  org, path, pageSize = 200, maxPages = DEFAULT_MAX_PAGES, context,
}) {
  const all = [];
  let after;
  for (let page = 0; page < maxPages; page++) {
    const sep = path.includes("?") ? "&" : "?";
    const qs = `pageSize=${pageSize}${after ? `&after=${encodeURIComponent(after)}` : ""}`;
    const res = await genesysRequest({ org, path: `${path}${sep}${qs}`, context });
    if (res?.entities) all.push(...res.entities);
    if (!res?.nextUri) return all;
    const next = new URL(res.nextUri, org.apiBase).searchParams.get("after");
    if (!next) return all;
    after = next;
  }
  context?.warn?.(`[genesys] ${path}: hit maxPages=${maxPages}, result truncated`);
  return all;
}

/**
 * Auto-paginate a page-numbered Genesys collection (pageNumber/pageSize/total),
 * e.g. queue members and wrap-up codes.
 *
 * Termination is driven by SHORT PAGES, not by `total`: some collections omit
 * `total`, and keying off it caused a full first page to end the loop and
 * silently truncate the result. `total` is only used as an extra early exit.
 *
 * @param {object} args                same shape as genesysRequest
 * @param {string} args.basePath       base path WITHOUT paging params; may include other query params
 * @param {number} [args.pageSize=100]
 * @param {number} [args.maxPages=50]
 * @returns {Promise<any[]>}           flattened `entities` across all pages
 */
async function genesysPaginatePage({
  org, basePath, pageSize = 100, maxPages = DEFAULT_MAX_PAGES, context,
}) {
  const all = [];
  for (let page = 1; page <= maxPages; page++) {
    const sep = basePath.includes("?") ? "&" : "?";
    const res = await genesysRequest({
      org,
      path: `${basePath}${sep}pageNumber=${page}&pageSize=${pageSize}`,
      context,
    });

    const entities = res?.entities ?? [];
    all.push(...entities);

    // A page shorter than requested is the last page.
    if (entities.length < pageSize) return all;
    // Belt-and-braces: stop once we've seen everything the API says exists.
    if (Number.isFinite(res?.total) && all.length >= res.total) return all;
  }
  context?.warn?.(`[genesys] ${basePath}: hit maxPages=${maxPages}, result truncated`);
  return all;
}

module.exports = {
  genesysRequest,
  genesysPaginateCursor,
  genesysPaginatePage,
  DEFAULT_MAX_PAGES,
};
