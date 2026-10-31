/**
 * Seat credentials in the browser — §5 (a player must never lose their seat).
 *
 * A seat is the only thing a browser holds that says "this tab is Ravi, in room
 * ABC123". These tests pin down where it is remembered, because the wrong answer
 * here is a player silently losing their ticket or a host losing the draw
 * controls:
 *   - two tabs of one browser hold two DIFFERENT seats (the host in one, a player
 *     in the other). This was the bug: both lived in one shared localStorage slot,
 *     so a second window resumed the first window's seat;
 *   - a refresh in the same tab still finds its own seat;
 *   - a tab with no seat of its own (a phone browser that dropped and rebuilt the
 *     tab) falls back to the device-level copy;
 *   - but a brand-new tab is NOT silently seated as the last player on that
 *     device: the join page distinguishes its own seat from a remembered one and
 *     asks first, so N tabs really are N players;
 *   - leaving one seat cannot erase a neighbouring seat;
 *   - storage that is missing, corrupt or throws is survived, never trusted.
 *
 * Run with: npm test
 */

import test from "node:test";
import assert from "node:assert/strict";
import { browserSlots, createSeatStore, isSeat, SEAT_KEY } from "../client/src/lib/seatStore.js";
import { offeredSeatLabel, planJoinEntry } from "../client/src/lib/joinSeat.js";

/** Minimal Storage-like object; `mode` lets a test simulate a broken browser. */
function memoryStorage(mode = "ok") {
  const map = new Map();
  const guard = () => {
    if (mode === "throws") throw new Error("SecurityError: storage disabled");
  };
  return {
    map,
    getItem(key) {
      guard();
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      guard();
      map.set(key, String(value));
    },
    removeItem(key) {
      guard();
      map.delete(key);
    },
    /** What the browser would actually hold, for asserting on side effects. */
    peek() {
      return map.has(SEAT_KEY) ? JSON.parse(map.get(SEAT_KEY)) : null;
    },
  };
}

/**
 * One device: a shared localStorage ("device copy") plus one sessionStorage per
 * browser tab. Each tab gets a fresh store so a reload can be modelled by
 * building a second store over the same tab slot.
 */
function device(tabCount = 1) {
  const deviceSlot = memoryStorage();
  const tabs = Array.from({ length: tabCount }, () => {
    const tab = memoryStorage();
    return { tab, store: createSeatStore({ tab, device: deviceSlot }) };
  });
  return { deviceSlot, tabs };
}

const HOST_SEAT = { roomId: "HOSTEL1", sessionToken: "tok-host", role: "host", playerId: "h1", name: "Priya" };
const RAVI_SEAT = { roomId: "HOSTEL1", sessionToken: "tok-ravi", role: "player", playerId: "p2", name: "Ravi" };

// ------------------------------------------------------------- tab isolation

test("two tabs of one browser hold two different seats", () => {
  const { tabs } = device(2);
  tabs[0].store.save(HOST_SEAT);
  tabs[1].store.save(RAVI_SEAT);

  assert.equal(tabs[0].store.load().sessionToken, "tok-host", "the host tab keeps the host seat");
  assert.equal(tabs[1].store.load().sessionToken, "tok-ravi", "the player tab keeps its own seat");
  assert.equal(tabs[0].store.load().role, "host");
  assert.equal(tabs[1].store.load().role, "player", "a host is not turned into a player by another tab");
});

test("a host who opens their own invite link in a second tab does not lose the draw controls", () => {
  // the regression: the invite-link tab wrote the shared slot, and after Start the
  // host tab re-read it and became that player.
  const { deviceSlot, tabs } = device(2);
  tabs[0].store.save(HOST_SEAT);
  tabs[1].store.save(RAVI_SEAT);
  const hostTabAfterStart = createSeatStore({ tab: tabs[0].tab, device: deviceSlot });
  assert.equal(hostTabAfterStart.load().role, "host");
  assert.equal(hostTabAfterStart.load().sessionToken, "tok-host");
});

test("a refresh in the same tab resumes exactly that seat", () => {
  const { deviceSlot, tabs } = device(1);
  tabs[0].store.save(HOST_SEAT);
  const reloaded = createSeatStore({ tab: tabs[0].tab, device: deviceSlot });
  assert.equal(reloaded.load().sessionToken, "tok-host", "sessionStorage survives a reload");
  assert.equal(reloaded.load().playerId, "h1");
});

test("a rebuilt tab with no seat of its own falls back to the device copy", () => {
  const { deviceSlot } = device(0);
  const droppedTab = memoryStorage();
  createSeatStore({ tab: droppedTab, device: deviceSlot }).save(RAVI_SEAT);

  // the phone browser dropped the tab: a brand new sessionStorage, same device
  const freshTab = memoryStorage();
  const resumed = createSeatStore({ tab: freshTab, device: deviceSlot }).load();
  assert.equal(resumed.sessionToken, "tok-ravi", "the landing-page promise holds across a dropped tab");
});

test("this tab's seat always wins over the device copy", () => {
  const { deviceSlot } = device(0);
  deviceSlot.setItem(SEAT_KEY, JSON.stringify(RAVI_SEAT));
  const tab = memoryStorage();
  const store = createSeatStore({ tab, device: deviceSlot });
  store.save(HOST_SEAT);
  assert.equal(store.load().sessionToken, "tok-host", "a tab never resumes somebody else's seat");
});

// ----------------------------------------------------------------- leaving

test("one tab leaving does not disturb a neighbouring tab's seat", () => {
  const { tabs } = device(2);
  tabs[0].store.save(HOST_SEAT);
  tabs[1].store.save(RAVI_SEAT);

  tabs[1].store.clear();
  assert.equal(tabs[1].store.load().sessionToken, undefined, "the leaving tab has no seat");
  assert.equal(tabs[0].store.load().sessionToken, "tok-host", "the other tab still has its own");
});

test("clearing drops the device copy only when it is the same seat", () => {
  const tab = memoryStorage();
  const deviceSlot = memoryStorage();
  const store = createSeatStore({ tab, device: deviceSlot });
  store.save(HOST_SEAT);
  // another tab's seat is now what the device copy remembers
  deviceSlot.setItem(SEAT_KEY, JSON.stringify(RAVI_SEAT));

  store.clear();
  assert.equal(tab.peek(), null, "this tab is forgotten");
  assert.equal(deviceSlot.peek().sessionToken, "tok-ravi", "a seat belonging to someone else is left alone");
});

test("clearing removes both copies when this tab's seat IS the device copy", () => {
  const { deviceSlot, tabs } = device(1);
  tabs[0].store.save(RAVI_SEAT);
  tabs[0].store.clear();
  assert.equal(deviceSlot.peek(), null, "a closed room cannot ghost-resume");
  assert.deepEqual(tabs[0].store.load(), {});
});

// ------------------------------------------------------------- hostile input

test("a slot that is not a seat is ignored, never resumed", () => {
  for (const value of [{ roomId: "ONLYROOM" }, { sessionToken: "ONLYTOKEN" }, {}, { name: "x" }]) {
    const tab = memoryStorage();
    const deviceSlot = memoryStorage();
    tab.setItem(SEAT_KEY, JSON.stringify(value));
    deviceSlot.setItem(SEAT_KEY, JSON.stringify(value));
    const store = createSeatStore({ tab, device: deviceSlot });
    assert.equal(isSeat(store.load()), false, "not a seat: " + JSON.stringify(value));
  }
});

test("corrupt or non-object JSON never throws and never resumes", () => {
  for (const raw of ["{not json", "[]", '"a-string"', "42", "", "null"]) {
    const tab = memoryStorage();
    const deviceSlot = memoryStorage();
    tab.setItem(SEAT_KEY, raw);
    deviceSlot.setItem(SEAT_KEY, raw);
    const store = createSeatStore({ tab, device: deviceSlot });
    assert.deepEqual(store.load(), {}, "survived " + JSON.stringify(raw));
  }
});

test("storage that throws is survived", () => {
  const blocked = createSeatStore({ tab: memoryStorage("throws"), device: memoryStorage("throws") });
  assert.deepEqual(blocked.load(), {});
  assert.equal(blocked.save(RAVI_SEAT).sessionToken, "tok-ravi", "the caller still gets its seat back");
  blocked.clear();

  const usableTab = memoryStorage();
  const brokenDevice = memoryStorage("throws");
  const store = createSeatStore({ tab: usableTab, device: brokenDevice });
  store.save(HOST_SEAT);
  assert.equal(store.load().sessionToken, "tok-host", "the tab slot works even when the device slot is broken");
});

test("a missing or hostile window yields empty slots instead of a crash", () => {
  assert.deepEqual(browserSlots(undefined), { tab: null, device: null });
  assert.deepEqual(browserSlots({}), { tab: null, device: null });
  assert.deepEqual(browserSlots({ sessionStorage: {}, localStorage: null }).tab, {});
  const hostile = {
    get sessionStorage() {
      throw new Error("blocked");
    },
    get localStorage() {
      throw new Error("blocked");
    },
  };
  assert.deepEqual(browserSlots(hostile), { tab: null, device: null });
  const store = createSeatStore(browserSlots(undefined));
  assert.deepEqual(store.load(), {});
  store.save(HOST_SEAT); // must not throw with nowhere to write
  store.clear();
});

test("saving a patch keeps the credential and updates only what changed", () => {
  const { tabs } = device(1);
  tabs[0].store.save({ roomId: "R1", sessionToken: "t1" });
  const next = tabs[0].store.save({ role: "player", playerId: "p9" });
  assert.equal(next.roomId, "R1");
  assert.equal(next.sessionToken, "t1", "the credential survives a role refresh");
  assert.equal(next.role, "player");
  assert.equal(next.playerId, "p9");
  assert.equal(tabs[0].store.load().role, "player", "and is remembered");
});

// ------------------------------------------- a new tab is not the last player
//
// Found in the browser, not on paper: with the join page reading load(), a
// brand-new tab with an empty sessionStorage silently adopted the seat another
// player had last written to localStorage, so three tabs were never three
// players — the second one was somebody already seated. The join page now has to
// distinguish "my tab is coming back" from "this browser remembers somebody".

test("loadOwn never sees another tab's seat", () => {
  const deviceSlot = memoryStorage();
  deviceSlot.setItem(SEAT_KEY, JSON.stringify(RAVI_SEAT));
  const freshTab = createSeatStore({ tab: memoryStorage(), device: deviceSlot });

  assert.deepEqual(freshTab.loadOwn(), {}, "a tab with no seat of its own holds none");
  assert.equal(freshTab.load().sessionToken, "tok-ravi", "load() still offers the recovery copy");
});

test("loadPending reports the remembered seat only while this tab has none", () => {
  const deviceSlot = memoryStorage();
  deviceSlot.setItem(SEAT_KEY, JSON.stringify(RAVI_SEAT));
  const freshTab = createSeatStore({ tab: memoryStorage(), device: deviceSlot });
  assert.equal(freshTab.loadPending().sessionToken, "tok-ravi");

  // once this tab sits down somewhere of its own, the memory is nobody else's
  freshTab.save(HOST_SEAT);
  assert.deepEqual(freshTab.loadPending(), {}, "a seated tab is never offered another seat");
});

test("loadPending ignores a half seat and refuses to throw on rubbish", () => {
  const partial = memoryStorage();
  partial.setItem(SEAT_KEY, JSON.stringify({ roomId: "HOSTEL1" }));
  assert.deepEqual(createSeatStore({ tab: memoryStorage(), device: partial }).loadPending(), {});

  for (const raw of ["{not json", "[]", "7", '"text"', "null"]) {
    const junk = memoryStorage();
    junk.setItem(SEAT_KEY, raw);
    assert.deepEqual(createSeatStore({ tab: memoryStorage(), device: junk }).loadPending(), {}, "survived " + raw);
  }
});

test("reclaiming an offered seat makes it this tab's own", () => {
  const deviceSlot = memoryStorage();
  deviceSlot.setItem(SEAT_KEY, JSON.stringify(RAVI_SEAT));
  const newTab = createSeatStore({ tab: memoryStorage(), device: deviceSlot });
  const offered = newTab.loadPending();
  assert.equal(isSeat(offered), true);

  newTab.save(offered); // what Player.jsx does on "Take that seat"
  assert.equal(newTab.loadOwn().sessionToken, "tok-ravi", "a refresh now resumes without asking");
});

// --------------------------------------------------------- the join page's plan

test("the join page resumes a seat this tab already holds", () => {
  const plan = planJoinEntry({ pathname: "/player", own: RAVI_SEAT, pending: null });
  assert.equal(plan.action, "resume");
  assert.equal(plan.seat.sessionToken, "tok-ravi");
});

test("the join page asks instead of taking a remembered seat — the bug found in the browser", () => {
  const plan = planJoinEntry({ pathname: "/player", own: {}, pending: RAVI_SEAT });
  assert.equal(plan.action, "offer", "a brand-new tab must not be seated as somebody else");
  assert.equal(plan.seat.name, RAVI_SEAT.name);
});

test("a remembered host seat is never offered on the player join page", () => {
  const plan = planJoinEntry({ pathname: "/player", own: {}, pending: HOST_SEAT });
  assert.equal(plan.action, "none", "a stranger opening the app does not get the host credential");
});

test("the host's own tab is not bounced into a player lobby by the join page", () => {
  // seen in the browser: a host tab visiting /player was redirected to the
  // player room and told "You're Seated" while it holds the draw controls.
  const plan = planJoinEntry({ pathname: "/player", own: HOST_SEAT });
  assert.equal(plan.action, "none", "the host route resumes the host seat, not this one");
});

test("an invite link prefills the code and keeps the join page a join page", () => {
  for (const raw of ["hostel1", "HOSTEL1", " hostel1 "]) {
    const plan = planJoinEntry({ pathname: "/player", searchTerm: raw, own: {}, pending: RAVI_SEAT });
    assert.equal(plan.action, "none", "the person who opens a link joins as themselves: " + raw);
    assert.equal(plan.code, "HOSTEL1");
  }
  // even when this tab has a seat, the room the link points at is the question
  const seated = planJoinEntry({ pathname: "/player", searchTerm: "abc123", own: RAVI_SEAT });
  assert.equal(seated.action, "none", "a shared code is a request to join, not a request to resume");
  assert.equal(seated.code, "ABC123");
});

test("the in-game routes plan nothing; they resume their own seat", () => {
  for (const pathname of ["/player/room", "/player/game"]) {
    const plan = planJoinEntry({ pathname, own: {}, pending: RAVI_SEAT });
    assert.deepEqual(plan, { action: "none" }, pathname + " stays out of the way");
  }
});

test("an empty join page with nothing remembered just shows the form", () => {
  assert.equal(planJoinEntry({}).action, "none");
  assert.equal(planJoinEntry({ pathname: "/player", own: {}, pending: {} }).action, "none");
  assert.equal(planJoinEntry({ pathname: "/player", own: { roomId: "X" }, pending: { sessionToken: "t" } }).action, "none");
});

test("the offered seat is described in words a player recognises", () => {
  assert.equal(offeredSeatLabel({ name: "Ravi", roomId: "wdtn6y9q" }), "Ravi · room WDTN6Y9Q");
  assert.equal(offeredSeatLabel({ roomId: "WDTN6Y9Q" }), "a player · room WDTN6Y9Q", "no name is not no seat");
  assert.equal(offeredSeatLabel({ name: "  Meena  " }), "Meena");
  assert.equal(offeredSeatLabel(null), "a player");
});
