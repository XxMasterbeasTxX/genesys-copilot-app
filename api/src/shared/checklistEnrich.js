const { genesysRequest } = require("./genesysClient");

// ============================================================================
// Server-side checklist + summary enrichment (the "crown jewel" orchestration).
// ----------------------------------------------------------------------------
// Ports the browser's enrichOne(): given a conversation ID it fetches the full
// conversation, walks the media-specific communication keys to find the agent
// legs, pulls per-communication agent checklists and conversation summaries,
// attributes each checklist to its owning agent, de-duplicates across legs, and
// computes overall completion. The Genesys API paths, the media-key traversal,
// the checklist normalization/dedup rules, and the completion logic all stay
// server-side.
//
// Names are derived from the conversation's own participants (the browser's
// userNameCache is not available here, and is only ever a secondary fallback).
//
// The pure helpers below (checklistCompletion, parseSummaries) are exported for
// unit tests — see api/test/checklistEnrich.test.js.
// ============================================================================

/**
 * Media-specific keys under which communications are nested inside a
 * conversation participant (the API does NOT use a generic key).
 */
const MEDIA_KEYS = [
  "messages", "calls", "chats",
  "callbacks", "emails", "socialExpressions", "videos",
  "cobrowsesessions", "screenshares", "internalMessages",
];

/** Participant purpose value for agent participants. */
const PURPOSE_AGENT = "agent";

/** Checklist tick state values returned by the API. */
const TICK_STATE = { TICKED: "Ticked", UNTICKED: "Unticked" };

/** Completion status values (mirror of the client STATUS_FILTER subset). */
const STATUS = { COMPLETE: "complete", INCOMPLETE: "incomplete" };

/**
 * Determine completion across ALL checklists: "complete" only if every item in
 * every checklist is ticked (by agent or model).
 *
 * Returns null when there is nothing to judge (no checklists, or checklists
 * that carry no items). Callers must treat null as "undetermined" rather than
 * folding it into "incomplete" — an empty checklist is not a failed one.
 */
function checklistCompletion(checklists) {
  const all = (Array.isArray(checklists) ? checklists : [checklists]).filter(Boolean);
  const items = all.flatMap((cl) => cl.checklistItems ?? []);
  if (!items.length) return null;
  const allTicked = items.every(
    (it) => it.stateFromAgent === TICK_STATE.TICKED || it.stateFromModel === TICK_STATE.TICKED,
  );
  return allTicked ? STATUS.COMPLETE : STATUS.INCOMPLETE;
}

/**
 * Parse the conversation summaries API response into a flat array.
 *
 * The API returns { summary: {...}, sessionSummaries: [{...}] }, where
 * `summary` is the conversation-level summary and `sessionSummaries` holds one
 * entry per session. For a single-session conversation the two are the same
 * record, so de-duplicate by id and only fall back to a count-based rule when
 * ids are absent.
 */
function parseSummaries(res) {
  if (!res || typeof res !== "object") return [];

  const out = [];
  if (Array.isArray(res.sessionSummaries)) {
    out.push(...res.sessionSummaries.filter(Boolean));
  }

  const top = res.summary;
  if (top && typeof top === "object" && Object.keys(top).length) {
    const alreadyPresent = top.id
      ? out.some((s) => s.id === top.id)
      : out.length > 0; // no id to compare on — assume the session copies cover it
    if (!alreadyPresent) out.unshift(top);
  }

  if (!out.length && Array.isArray(res.entities)) {
    out.push(...res.entities.filter(Boolean));
  }
  return out;
}

/** Tag each summary with `_agentName` based on its communication ID. */
function tagSummariesWithAgent(summaries, commAgentMap) {
  for (const s of summaries) {
    const commId = s.communication?.id ?? s.communicationId ?? null;
    if (commId && commAgentMap.has(commId)) {
      s._agentName = commAgentMap.get(commId);
    }
  }
}

/**
 * Enrich a single conversation. Never throws — failures are returned as an
 * `_error` field on the record so a batch can continue (mirrors enrichOne).
 *
 * @param {object} args
 * @param {{orgKey: string, apiBase: string, token: string}} args.org server-resolved org context
 * @param {string} args.convId
 * @param {object} [args.context]
 * @returns {Promise<{checklists: any[], communicationId: string|null,
 *                     completion: string|null, summaries: any[], _error?: string}>}
 */
async function enrichConversation({ org, convId, context }) {
  try {
    // Step 1: full conversation → agent communication IDs.
    const fullConv = await genesysRequest({
      org, path: `/api/v2/conversations/${encodeURIComponent(convId)}`, context,
    });
    const agentParts = (fullConv.participants ?? []).filter(
      (p) => p.purpose === PURPOSE_AGENT,
    );

    const commAgentMap = new Map();
    const userIdName = new Map();
    for (const p of agentParts) {
      const name = p.name ?? p.participantName ?? p.userId ?? "Unknown";
      if (p.userId) userIdName.set(p.userId, name);
      for (const k of MEDIA_KEYS) {
        for (const c of p[k] ?? []) commAgentMap.set(c.id, name);
      }
    }

    const commIds = [...commAgentMap.keys()];

    // Step 2: summaries (best-effort).
    let summaries = [];
    try {
      const sumRes = await genesysRequest({
        org, path: `/api/v2/conversations/${encodeURIComponent(convId)}/summaries`, context,
      });
      summaries = parseSummaries(sumRes);
      tagSummariesWithAgent(summaries, commAgentMap);
    } catch {
      /* no summaries */
    }

    if (!commIds.length) {
      return { checklists: [], communicationId: null, completion: null, summaries };
    }

    // Step 3: checklists across ALL agent communications.
    let allChecklists = [];
    const firstCommId = commIds[0] ?? null;

    for (const commId of commIds) {
      try {
        const checklistRes = await genesysRequest({
          org,
          path: `/api/v2/conversations/${encodeURIComponent(convId)}` +
                `/communications/${encodeURIComponent(commId)}/agentchecklists`,
          context,
        });
        let list;
        if (Array.isArray(checklistRes)) {
          list = checklistRes;
        } else if (Array.isArray(checklistRes?.entities)) {
          list = checklistRes.entities;
        } else if (checklistRes && typeof checklistRes === "object" && checklistRes.id) {
          list = [checklistRes];
        } else {
          list = [];
        }

        const commAgentName = commAgentMap.get(commId) ?? "Unknown";
        for (const cl of list) {
          const byAgentId = cl.agentId
            ? (userIdName.get(cl.agentId) ?? cl.agentId)
            : null;
          cl._agentName = byAgentId ?? commAgentName;
        }

        if (list.length) allChecklists.push(...list);
      } catch (innerErr) {
        // 404 = no checklists for this communication — expected, try next.
        if (innerErr.status !== 404) {
          context?.warn?.(
            `enrich: checklist comm ${commId} for ${convId}: ${innerErr.message ?? innerErr}`,
          );
        }
      }
    }

    // De-dup by id + owning agent + participant leg (keep each agent's copy).
    const seen = new Set();
    allChecklists = allChecklists.filter((cl) => {
      if (!cl.id) return true;
      const key = `${cl.id}__${cl.agentId ?? ""}__${cl.participantId ?? ""}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    const completion = allChecklists.length ? checklistCompletion(allChecklists) : null;
    return { checklists: allChecklists, communicationId: firstCommId, completion, summaries };
  } catch (err) {
    return {
      checklists: [],
      communicationId: null,
      completion: null,
      summaries: [],
      _error: err.message ?? String(err),
    };
  }
}

module.exports = { enrichConversation, checklistCompletion, parseSummaries, STATUS, TICK_STATE };
