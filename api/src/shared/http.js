// ============================================================================
// Small HTTP helpers shared by every BFF endpoint.
// ----------------------------------------------------------------------------
// Every orchestration response carries `Cache-Control: no-store` (the payloads
// are per-user conversation data) and either a JSON body or a bare
// `{ error: "<code>" }`. These helpers keep that consistent and keep the
// handlers focused on orchestration.
// ============================================================================

/** Build a no-store JSON response. */
function json(status, jsonBody) {
  return { status, headers: { "Cache-Control": "no-store" }, jsonBody };
}

/** Build a no-store `{ error }` response. */
function fail(status, error) {
  return json(status, { error });
}

/** Parse a JSON request body, treating anything unparseable as empty. */
async function readJson(request) {
  try {
    return (await request.json()) ?? {};
  } catch {
    return {};
  }
}

/**
 * Validate an incoming array of IDs.
 *
 * Endpoints fan out one or more upstream Genesys calls per ID, so an unbounded
 * list is a resource-exhaustion lever even for an authenticated caller.
 *
 * @returns {{ ok: true, ids: string[] } | { ok: false, response: object }}
 */
function readIdList(value, { max, field = "ids" }) {
  if (!Array.isArray(value)) {
    return { ok: false, response: fail(400, "missing_ids") };
  }
  const ids = value.filter((v) => typeof v === "string" && v.length);
  if (ids.length > max) {
    return { ok: false, response: fail(400, `too_many_${field}`) };
  }
  return { ok: true, ids };
}

/**
 * Map an upstream Genesys failure onto a client-facing response.
 * 401 is surfaced verbatim so the browser can re-login; everything else
 * becomes a 502 without leaking upstream detail.
 */
function upstreamFailure(context, label, err) {
  context?.error?.(`${label}: upstream error: ${err?.message ?? err}`);
  return err?.status === 401 ? fail(401, "unauthorized") : fail(502, "upstream_error");
}

module.exports = { json, fail, readJson, readIdList, upstreamFailure };
