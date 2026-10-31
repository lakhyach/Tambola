/**
 * The second-click guard on the host's destructive controls.
 *
 * "End game" and "Reset" end a round for everyone in the room. They used to be
 * confirmed with `window.confirm()`, which works for a human and is a wall for
 * everything else: assistive technology cannot read a native dialog, an automated
 * browser stops responding until someone clicks one by hand, and the wording
 * cannot follow the room's state. The guard is now part of the interface, so the
 * rule that replaces it has to be pinned here instead.
 *
 * These tests drive client/src/lib/confirmAction.js — the whole rule, extracted
 * as pure functions — plus a simulation of the panel's own state machine, so a
 * double-click sequence is checked as a sequence and not just as four returns.
 *
 * Run with: npm test
 */

import test from "node:test";
import assert from "node:assert/strict";
import { CONFIRM_COPY, DESTRUCTIVE, disarm, press } from "../client/src/lib/confirmAction.js";

// ---------------------------------------------------------------- the single click

test("the first click on a destructive action arms it and sends nothing", () => {
  for (const action of DESTRUCTIVE) {
    const step = press(null, action);
    assert.equal(step.fire, false, action + " never fires on the first click");
    assert.equal(step.armed, action);
  }
});

test("the second click fires it once and leaves nothing armed", () => {
  for (const action of DESTRUCTIVE) {
    const step = press(action, action);
    assert.equal(step.fire, true, action + " needs a way to actually happen");
    assert.equal(step.armed, null, "an action that just fired is not still armed — a third click must not fire again");
  }
});

test("arming the other destructive action re-arms instead of firing", () => {
  const [end, reset] = DESTRUCTIVE;
  const step = press(end, reset);
  assert.equal(step.fire, false, "a click on a different control is not a confirmation");
  assert.equal(step.armed, reset, "only one confirmation can be armed at a time");
});

test("nothing else on the panel is a destructive action", () => {
  // the safe host intents must pass straight through: arming them would swallow
  // the click, and firing them from `press` would bypass the button's own handler
  for (const action of ["game:start", "game:pause", "game:resume", "game:call-next", "game:end-all", "", null, undefined]) {
    const step = press(null, action);
    assert.equal(step.fire, false, "not destructive: " + String(action));
    assert.equal(step.armed, null);
    const armedStep = press("game:end", action);
    assert.equal(armedStep.armed, "game:end", "a stray click does not clear an armed confirmation by accident");
    assert.equal(armedStep.fire, false);
  }
});

test("disarm leaves an empty panel", () => {
  assert.equal(disarm(), null);
});

// -------------------------------------------------------------------- the wording

test("every destructive action has copy for both states of its control", () => {
  assert.deepEqual(Object.keys(CONFIRM_COPY).sort(), [...DESTRUCTIVE].sort(), "no action can be armed without words, no words without an action");
  for (const action of DESTRUCTIVE) {
    const copy = CONFIRM_COPY[action];
    assert.match(copy.armed, /^Confirm: /, "the button must say it is confirming: " + action);
    assert.match(copy.confirm, /Click again to confirm/, "and the panel must say how to confirm: " + action);
    assert.ok(copy.confirm.length > 40, "the sentence has to name what is lost: " + copy.confirm);
    assert.notEqual(copy.armed, copy.confirm);
  }
});

// ------------------------------------------------------- the panel as a sequence

/** Mirrors HostControls' own state machine: armed + a click → armed + what was sent. */
function panel(armsFirst = null) {
  let armed = armsFirst;
  const sent = [];
  return {
    sent,
    get armed() {
      return armed;
    },
    click(action) {
      const step = press(armed, action);
      armed = step.armed;
      if (step.fire) sent.push(action);
    },
    cancel() {
      armed = disarm();
    },
    serverMoved() {
      armed = disarm();
    },
  };
}

test("a hurried double click sends exactly one destructive action", () => {
  for (const action of DESTRUCTIVE) {
    const p = panel();
    p.click(action);
    p.click(action);
    p.click(action);
    assert.deepEqual(p.sent, [action], "the second click fired; the third did not: " + action);
    assert.equal(p.armed, action, "a third click starts a fresh confirmation rather than re-firing silently");

    // The panel also drops the arm as soon as the server reports the new state,
    // which is what stops a mashed button destroying a room twice.
    p.serverMoved();
    p.click(action);
    assert.deepEqual(p.sent, [action], action + " happens once to a room, not once per pair of clicks");
  }
});

test("a change of mind, or of state, sends nothing", () => {
  const cancelled = panel();
  cancelled.click("game:end");
  cancelled.cancel();
  cancelled.click("game:end");
  assert.deepEqual(cancelled.sent, [], "Cancel then clicking the control again is a fresh arm, not a confirmation");

  const moved = panel("game:end");
  moved.serverMoved();
  moved.click("game:end");
  assert.deepEqual(moved.sent, [], "the arm did not survive the round moving on");
});

test("arming End and then clicking Reset cannot end the game", () => {
  const [end, reset] = DESTRUCTIVE;
  const p = panel();
  p.click(end);
  p.click(reset);
  assert.deepEqual(p.sent, []);
  p.click(reset);
  assert.deepEqual(p.sent, [reset], "only the control that was clicked twice runs");
});
