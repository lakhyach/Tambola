/**
 * The winning-pattern approval ledger.
 *
 * These fixtures hold the line the five new categories sit on: they are
 * REGISTERED (the server can judge them) and SWITCHED OFF (no room pays for one
 * unless its host asks), while the names that still have no published definition
 * stay out of the registry entirely. A config entry naming an unregistered id
 * must never conjure a prize - registration is the gate, config only opens it.
 *
 * The rule itself (six, seven, eight called numbers on one ticket) is asserted
 * against the live registry in tests/early-seven.test.js.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { APPROVAL_STATES, PROPOSAL_STATUS, OPTIONAL_PATTERN_IDS } from "../server/game/proposed-patterns.js";
import {
  PATTERNS,
  DEFERRED_PATTERNS,
  getPattern,
  evaluateClaim,
  enabledPatternIds,
  optionalPatternIds,
} from "../server/game/patterns.js";
import { makeRoom, giveTicket, callSpecific, TICKET_A, ALL_FIFTEEN } from "./helpers.js";

const HOST_AUTH = (host) => ({ socketId: host.socketId });

const APPROVED = ["earlyFive", "topLine", "middleLine", "bottomLine", "corners", "fullHouse"];
const STILL_BLOCKED = ["middleNumber", "oneFourThree", "pyramid"];

test("the five new categories are registered and off until a room asks", () => {
  assert.deepEqual(OPTIONAL_PATTERN_IDS.slice().sort(), optionalPatternIds().sort(), "the ledger and the registry agree");
  for (const id of OPTIONAL_PATTERN_IDS) {
    const pattern = PATTERNS[id];
    assert.ok(pattern, id + " is in the registry, so the server can evaluate it");
    assert.equal(pattern.optional, true, id + " is marked optional");
    assert.equal(pattern.enabledByDefault, false, id + " is off by default");
    assert.ok(typeof pattern.definition === "string" && pattern.definition.length > 80, id + " has written player-facing copy");

    // off: the claim path refuses it, and the refusal says the pattern is unknown
    // to this room rather than leaving the browser to guess
    assert.equal(getPattern(id, {}), null, id + " is not claimable with default config");
    const refused = evaluateClaim(id, TICKET_A, ALL_FIFTEEN);
    assert.equal(refused.valid, false);
    assert.match(refused.reason, /unknown or disabled pattern/);
    assert.equal(enabledPatternIds({}).includes(id), false);

    // on: a room that names it gets a real pattern with a real award
    assert.ok(getPattern(id, { patterns: { [id]: true } }), id + " is claimable once the room opts in");
    assert.equal(enabledPatternIds({ patterns: { [id]: true } }).includes(id), true);
  }
});

test("the approved six are unchanged by the five new ones", () => {
  // the shipped rules must not have gained or lost anything in this work
  for (const id of APPROVED) {
    assert.ok(PATTERNS[id], id + " is still registered");
    assert.equal(PATTERNS[id].optional, undefined, id + " is not optional - it is the approved game");
    assert.equal(PATTERNS[id].enabledByDefault, true);
    assert.equal(getPattern(id, {}) && getPattern(id, {}).label, PATTERNS[id].label);
  }
  const approvedIds = Object.values(PATTERNS).filter((p) => !p.optional).map((p) => p.id);
  assert.deepEqual(approvedIds.slice().sort(), APPROVED.slice().sort(), "no new rule became approved");
});

test("names without a published definition stay unimplemented", () => {
  for (const id of STILL_BLOCKED) {
    assert.equal(PATTERNS[id], undefined, id + " must not be implemented on a guess");
    assert.equal(getPattern(id, { patterns: { [id]: true } }), null, "a config entry cannot register it either");
    assert.equal(evaluateClaim(id, TICKET_A, ALL_FIFTEEN, { patterns: { [id]: true } }).valid, false);
    assert.ok(DEFERRED_PATTERNS[id], id + " is documented as deferred");
    assert.ok(DEFERRED_PATTERNS[id].reason.length > 30, id + " says exactly what is unresolved");
  }
});

test("the ledger describes every registry entry and nothing invented", () => {
  for (const [id, status] of Object.entries(PROPOSAL_STATUS)) {
    assert.ok(APPROVAL_STATES.includes(status.state), id + " has a known state");
    if (status.state === "approval") assert.ok(status.blocker.length > 20, id + " states what is missing");
  }
  for (const pattern of Object.values(PATTERNS)) {
    const status = PROPOSAL_STATUS[pattern.id];
    assert.ok(status, pattern.id + " is accounted for in the ledger");
    assert.equal(status.state, pattern.optional ? "live-optional" : "live", pattern.id + " matches the registry");
    assert.equal(pattern.enabledByDefault, !pattern.optional);
  }
  for (const id of Object.keys(PROPOSAL_STATUS)) {
    const known = PATTERNS[id] || DEFERRED_PATTERNS[id];
    assert.ok(known, id + " in the ledger refers to a real pattern or a real deferral");
  }
  assert.equal(PROPOSAL_STATUS.earlyFive.state, "live", "the approved rules read as live, not pending");
});

test("a host can opt a waiting room in, and cannot opt the approved rules out", () => {
  const h = makeRoom();
  const host = h.host();
  const alice = h.player("Alice", "sock-a");

  const enabled = h.room.setPatterns({ patterns: { earlySeven: true, star: true }, socketId: host.socketId });
  assert.equal(enabled.ok, true);
  assert.ok(enabled.enabledPatterns.includes("earlySeven"));
  assert.ok(enabled.enabledPatterns.includes("star"));
  for (const id of APPROVED) assert.ok(enabled.enabledPatterns.includes(id), id + " is still on");

  // an approved rule is not a knob: switching one off is refused outright
  const tampered = h.room.setPatterns({ patterns: { corners: false }, socketId: host.socketId });
  assert.equal(tampered.ok, false);
  assert.equal(tampered.code, "BAD_PAYLOAD");
  assert.equal(h.room.stateView().enabledPatterns.includes("corners"), true, "the refusal changed nothing");

  // and a name that has no rule cannot be registered through the same door
  const ghost = h.room.setPatterns({ patterns: { pyramid: true }, socketId: host.socketId });
  assert.equal(ghost.ok, false);
  assert.equal(ghost.code, "BAD_PAYLOAD");

  // opting in has a real effect: the seat can now be judged for that prize
  h.room.start(HOST_AUTH(host));
  giveTicket(h.room, alice.playerId, TICKET_A);
  callSpecific(h.room, ALL_FIFTEEN.slice(0, 6));
  assert.equal(h.room.claimability(alice.playerId, "earlySeven").valid, false, "six numbers is not seven");
  callSpecific(h.room, [ALL_FIFTEEN[6]]);
  assert.equal(h.room.claimability(alice.playerId, "earlySeven").valid, true);
});

test("opting in is only possible before the round starts", () => {
  const h = makeRoom();
  const host = h.host();
  h.room.start(HOST_AUTH(host));
  const late = h.room.setPatterns({ patterns: { star: true }, socketId: host.socketId });
  assert.equal(late.ok, false);
  assert.equal(late.code, "INVALID_STATE");
  assert.match(late.error, /before the round starts/);
  assert.equal(enabledPatternIds(h.room.config).includes("star"), false, "the refusal left the room's prizes alone");
});

test("a player who is not the host cannot change the prizes", () => {
  const h = makeRoom();
  h.host();
  const guest = h.player("Guest", "sock-guest");
  const refused = h.room.setPatterns({ patterns: { box: true }, socketId: guest.socketId });
  assert.equal(refused.ok, false);
  assert.equal(refused.code, "NOT_HOST");
  assert.equal(enabledPatternIds(h.room.config).includes("box"), false);
});
