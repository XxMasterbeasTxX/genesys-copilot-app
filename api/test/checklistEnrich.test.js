// Unit tests for the pure parts of the checklist/summary enrichment.
//
// These two helpers encode the rules that are easiest to get subtly wrong and
// hardest to notice in the UI: what counts as a "complete" checklist, and how
// the two shapes the summaries API can return are flattened without dropping
// or duplicating a summary.
//
// Run with:  npm test   (node:test — no dependencies)

const test = require("node:test");
const assert = require("node:assert/strict");

const { checklistCompletion, parseSummaries } = require("../src/shared/checklistEnrich");

const ticked = (name) => ({ name, stateFromAgent: "Ticked", stateFromModel: "Unticked" });
const modelTicked = (name) => ({ name, stateFromAgent: "Unticked", stateFromModel: "Ticked" });
const unticked = (name) => ({ name, stateFromAgent: "Unticked", stateFromModel: "Unticked" });

test("checklistCompletion: all items ticked by the agent → complete", () => {
  const cl = { checklistItems: [ticked("a"), ticked("b")] };
  assert.equal(checklistCompletion([cl]), "complete");
});

test("checklistCompletion: a model tick counts as ticked", () => {
  const cl = { checklistItems: [ticked("a"), modelTicked("b")] };
  assert.equal(checklistCompletion([cl]), "complete");
});

test("checklistCompletion: one unticked item → incomplete", () => {
  const cl = { checklistItems: [ticked("a"), unticked("b")] };
  assert.equal(checklistCompletion([cl]), "incomplete");
});

test("checklistCompletion: spans every checklist, not just the first", () => {
  const done = { checklistItems: [ticked("a")] };
  const notDone = { checklistItems: [unticked("b")] };
  assert.equal(checklistCompletion([done, notDone]), "incomplete");
});

test("checklistCompletion: no checklists or no items → null, never 'incomplete'", () => {
  assert.equal(checklistCompletion([]), null);
  assert.equal(checklistCompletion([{ checklistItems: [] }]), null);
  assert.equal(checklistCompletion([{}]), null);
});

test("checklistCompletion: accepts a single checklist object", () => {
  assert.equal(checklistCompletion({ checklistItems: [ticked("a")] }), "complete");
});

test("parseSummaries: single session — the duplicated top-level summary is dropped", () => {
  const res = {
    summary: { id: "s1", text: "hello" },
    sessionSummaries: [{ id: "s1", text: "hello" }],
  };
  assert.deepEqual(parseSummaries(res).map((s) => s.id), ["s1"]);
});

test("parseSummaries: a distinct top-level summary is kept, first", () => {
  const res = {
    summary: { id: "top", text: "overall" },
    sessionSummaries: [{ id: "s1" }, { id: "s2" }],
  };
  assert.deepEqual(parseSummaries(res).map((s) => s.id), ["top", "s1", "s2"]);
});

test("parseSummaries: two sessions with no top-level summary stay intact", () => {
  const res = { sessionSummaries: [{ id: "s1" }, { id: "s2" }] };
  assert.deepEqual(parseSummaries(res).map((s) => s.id), ["s1", "s2"]);
});

test("parseSummaries: top-level summary alone is returned", () => {
  const res = { summary: { id: "only", text: "x" }, sessionSummaries: [] };
  assert.deepEqual(parseSummaries(res).map((s) => s.id), ["only"]);
});

test("parseSummaries: an empty top-level summary object is ignored", () => {
  assert.deepEqual(parseSummaries({ summary: {}, sessionSummaries: [] }), []);
});

test("parseSummaries: falls back to `entities` when nothing else is present", () => {
  const res = { entities: [{ id: "e1" }, { id: "e2" }] };
  assert.deepEqual(parseSummaries(res).map((s) => s.id), ["e1", "e2"]);
});

test("parseSummaries: tolerates junk input", () => {
  assert.deepEqual(parseSummaries(null), []);
  assert.deepEqual(parseSummaries(undefined), []);
  assert.deepEqual(parseSummaries("nope"), []);
  assert.deepEqual(parseSummaries({}), []);
});
