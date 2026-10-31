/**
 * Refusal wording — §5 ("fix misleading interface text").
 *
 * A refusal is a promise about the server. The bug this file pins down: an
 * unverified claim is refused with code INVALID_STATE *plus* the real reason
 * ("full house incomplete"), and the client printed only the generic sentence for
 * INVALID_STATE — "the game is not running right now" — to a player sitting in a
 * running game. The player reasonably concluded the game was broken.
 *
 * The specific server reason always wins; the generic mapping stays for the cases
 * where the state really is the problem.
 *
 * Run with: npm test
 */

import test from "node:test";
import assert from "node:assert/strict";
import { REFUSAL, refusalText } from "../client/src/lib/refusals.js";
import { evaluateClaim } from "../server/game/patterns.js";
import { TICKET_A, TOP_LINE } from "./helpers.js";

// --------------------------------------------------------- reason beats code

test("a refused claim says why instead of blaming the game state", () => {
  const refused = { ok: false, code: "INVALID_STATE", error: "invalid claim: full house incomplete", reason: "full house incomplete" };
  const text = refusalText(refused);
  assert.equal(text, "Not this time - full house incomplete");
  assert.doesNotMatch(text, /not running/, "a running game is never reported as stopped");
});

test("a state refusal with no reason keeps the generic sentence", () => {
  // e.g. game:start on a room that is already running: no claim reason exists
  const paused = { ok: false, code: "INVALID_STATE", error: "invalid state" };
  assert.equal(refusalText(paused), REFUSAL.INVALID_STATE);
  assert.equal(refusalText({ ok: false, code: "INVALID_TRANSITION" }), "that is not possible in this state");
});

test("a blank reason does not produce a half sentence", () => {
  for (const blank of ["", "   ", undefined, null, 42]) {
    const text = refusalText({ ok: false, code: "RATE_LIMITED", reason: blank });
    assert.equal(text, REFUSAL.RATE_LIMITED, "fell back for " + JSON.stringify(blank));
  }
});

// ------------------------------------------- the real server verdicts read well

test("every reason the pattern rules can produce becomes a readable sentence", () => {
  const noCallsYet = [];
  const oneCallOnMyTopRow = [TOP_LINE[0]];
  const cases = [
    { verdict: evaluateClaim("topLine", TICKET_A, oneCallOnMyTopRow), expect: /line incomplete/ },
    { verdict: evaluateClaim("fullHouse", TICKET_A, noCallsYet), expect: /full house incomplete/ },
    { verdict: evaluateClaim("corners", TICKET_A, noCallsYet), expect: /corners incomplete/ },
    { verdict: evaluateClaim("earlyFive", TICKET_A, noCallsYet), expect: /fewer than five/ },
    { verdict: evaluateClaim("topLine", TICKET_A, noCallsYet, { patterns: { topLine: false } }), expect: /disabled/ },
  ];
  for (const { verdict, expect } of cases) {
    assert.equal(verdict.valid, false, "the server really does refuse this");
    const text = refusalText({ ok: false, code: "INVALID_STATE", error: "invalid claim: " + verdict.reason, reason: verdict.reason });
    assert.match(text, expect, "surfaced in the UI: " + text);
    assert.match(text, /^Not this time - /, "and never as a bare code");
  }

  // the early-five window is a rules decision, so the player must be told so:
  // five of TICKET_A's numbers are called, but not until the 9th call
  const outside = [3, 4, 11, 12, 24, 25, 31, 32, 50, 51, 7, 15];
  const verdict = evaluateClaim("earlyFive", TICKET_A, outside, { earlyFiveMaxCalls: 5 });
  assert.equal(verdict.valid, false, verdict.reason);
  assert.match(refusalText({ ok: false, code: "INVALID_STATE", reason: verdict.reason }), /window of 5 calls/);
});

// ----------------------------------------------------------------- fallbacks

test("an unmapped code still says something a human can act on", () => {
  assert.equal(refusalText({ ok: false, code: "SOME_NEW_CODE", error: "the server had a problem" }), "the server had a problem");
  assert.equal(refusalText({ ok: false, code: "SOME_NEW_CODE" }), "the server said no");
  assert.equal(refusalText(null), "the server said no");
  assert.equal(refusalText(undefined), "the server said no");
  assert.equal(refusalText({}), "the server said no");
});

test("no refusal string leaks a code name or reads as an error dump", () => {
  for (const [code, text] of Object.entries(REFUSAL)) {
    assert.equal(typeof text, "string", code + " has wording");
    assert.ok(text.length > 8, code + " says something useful");
    assert.doesNotMatch(text, /_/g, code + " does not echo the code");
    assert.notEqual(text, code);
    assert.equal(text, text.trim(), code + " is not padded");
  }
});

test("a timeout is reported as a timeout, not as a rules loss", () => {
  // net.js synthesises this when the server never answers; it has no code mapping
  const timedOut = { ok: false, code: "TIMEOUT", error: "the server did not answer" };
  assert.equal(refusalText(timedOut), "the server did not answer");
  assert.match(refusalText(timedOut), /server/, "points at the connection, not the player's ticket");
});
