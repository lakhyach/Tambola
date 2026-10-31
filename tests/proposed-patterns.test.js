/**
 * Early Seven as a PROPOSAL, not a live prize.
 *
 * The point of these tests is twofold: the rule is pinned down precisely enough
 * to hand to a client, and the live registry is proven unchanged so no game can
 * pay for it before approval.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { PROPOSED_PATTERNS, PROPOSAL_STATUS } from "../server/game/proposed-patterns.js";
import { PATTERNS, DEFERRED_PATTERNS, getPattern, evaluateClaim } from "../server/game/patterns.js";
import { TICKET_A, TICKET_B, ALL_FIFTEEN } from "./helpers.js";

const earlySeven = PROPOSED_PATTERNS.earlySeven;

test("early seven is a proposal: the live registry cannot award it", () => {
  assert.equal(PATTERNS.earlySeven, undefined, "not registered");
  assert.ok(DEFERRED_PATTERNS.earlySeven, "still documented as deferred in the shipped registry");
  assert.equal(getPattern("earlySeven", {}), null, "not claimable with default config");
  assert.equal(
    getPattern("earlySeven", { patterns: { earlySeven: true } }),
    null,
    "not claimable even when a room config names it: registration is the gate, not config"
  );
  const verdict = evaluateClaim("earlySeven", TICKET_A, ALL_FIFTEEN);
  assert.equal(verdict.valid, false);
  assert.match(verdict.reason, /unknown or disabled pattern/);
});

test("early seven is exactly seven of the ticket's own numbers", () => {
  const six = earlySeven.check(TICKET_A, ALL_FIFTEEN.slice(0, 6));
  assert.equal(six.valid, false);
  assert.equal(six.needed, 1, "one more number would complete it");

  const seven = earlySeven.check(TICKET_A, ALL_FIFTEEN.slice(0, 7));
  assert.equal(seven.valid, true);
  assert.equal(seven.completedOnCall, 7, "completion is the seventh call");
});

test("an eighth or fifteenth call never moves the completion ordinal", () => {
  const seven = earlySeven.check(TICKET_A, ALL_FIFTEEN.slice(0, 7));
  const twelve = earlySeven.check(TICKET_A, ALL_FIFTEEN.slice(0, 12));
  const all = earlySeven.check(TICKET_A, ALL_FIFTEEN);
  assert.equal(twelve.completedOnCall, seven.completedOnCall);
  assert.equal(all.completedOnCall, seven.completedOnCall);
  // the claim window is arithmetic on this ordinal: with claimWindowCalls = 2
  // the claim is still valid after two further calls and late on the third
  const lateBy = (calledCount, completedOnCall) => calledCount - completedOnCall;
  assert.equal(lateBy(9, seven.completedOnCall), 2, "two calls after completion: inside a 2-call window");
  assert.equal(lateBy(10, seven.completedOnCall), 3, "three calls after completion: outside it");
});

test("another player's numbers never count towards this ticket", () => {
  const own = TICKET_A.flat().filter((n) => n !== null);
  const foreign = TICKET_B.flat().filter((n) => n !== null && !own.includes(n));
  assert.ok(foreign.length >= 7, "the fixture tickets differ by at least seven numbers");
  const verdict = earlySeven.check(TICKET_A, foreign);
  assert.equal(verdict.valid, false);
  assert.equal(verdict.needed, 7);
});

test("call order does not matter, only which numbers were called", () => {
  const firstSeven = ALL_FIFTEEN.slice(0, 6).concat(ALL_FIFTEEN[10]);
  const shuffled = [ALL_FIFTEEN[10], ...ALL_FIFTEEN.slice(0, 6)];
  const a = earlySeven.check(TICKET_A, firstSeven);
  const b = earlySeven.check(TICKET_A, shuffled);
  assert.equal(a.valid, true);
  assert.equal(b.valid, true);
  assert.equal(a.completedOnCall, 7);
  assert.equal(b.completedOnCall, 7);
});

test("the proposal carries a written definition, evidence and a proposal state", () => {
  assert.ok(earlySeven.definition.length > 80, "definition is usable as client-facing copy");
  assert.match(earlySeven.evidence, /S[234]/);
  assert.ok(Number.isInteger(earlySeven.proposedPoints) && earlySeven.proposedPoints > 0);
  assert.equal(earlySeven.exclusive, true);

  assert.equal(PROPOSAL_STATUS.earlySeven.state, "points", "rule defined, prize weight still needs sign-off");
  for (const id of ["star", "middleNumber", "oneFourThree", "pyramid"]) {
    assert.equal(PROPOSAL_STATUS[id].state, "approval", id + " has no exact definition yet");
    assert.equal(PROPOSED_PATTERNS[id], undefined, id + " must not be implemented on a guess");
    assert.ok(PROPOSAL_STATUS[id].blocker.length > 20);
  }
});
