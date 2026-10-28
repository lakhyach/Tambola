/**
 * Transport guards: payload shape, field validators, event budget.
 * Run with: npm test
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  sanePayload,
  asName,
  asRoomId,
  asToken,
  asPatternId,
  asChatText,
  asBoolean,
  asInteger,
  createBudget,
  LEGACY_EVENTS,
  ROOM_ID_PATTERN,
  TOKEN_PATTERN,
} from "../server/net/validate.js";

// ------------------------------------------------------------- payload gates

test("an omitted payload is normalised to an empty object", () => {
  for (const value of [undefined, null]) {
    const result = sanePayload(value);
    assert.equal(result.ok, true);
    assert.deepEqual(result.value, {});
  }
});

test("only plain objects are accepted as payloads", () => {
  class Point {
    constructor() {
      this.x = 1;
    }
  }
  const rejects = ["a string", 42, 7n, true, [1, 2, 3], new Point(), new Map(), new Set(), () => {}, Symbol("s")];
  for (const value of rejects) {
    const result = sanePayload(value);
    assert.equal(result.ok, false, "rejected " + typeof value);
    assert.match(result.error, /plain object/);
  }
});

test("a null-prototype object is readable and stays allowed", () => {
  const bare = Object.create(null);
  bare.name = "Alice";
  const result = sanePayload(bare);
  assert.equal(result.ok, true);
  assert.equal(result.value.name, "Alice");
});

test("an object with too many fields is refused before being read", () => {
  const wide = {};
  for (let i = 0; i < 13; i++) wide["field" + i] = i;
  assert.equal(sanePayload(wide).ok, false);
  assert.match(sanePayload(wide).error, /too many fields/);

  const narrow = { name: "Alice", roomId: "ABCD2345" };
  assert.equal(sanePayload(narrow).ok, true);
});

test("an oversized payload is refused", () => {
  const big = { text: "x".repeat(5000) };
  assert.equal(sanePayload(big).ok, false);
  assert.match(sanePayload(big).error, /too large/);
  const justRight = { text: "x".repeat(120) };
  assert.equal(sanePayload(justRight).ok, true);
});

test("a self-referencing payload cannot crash the gate", () => {
  const loop = { name: "Alice" };
  loop.self = loop;
  const result = sanePayload(loop);
  assert.equal(result.ok, false);
  assert.match(result.error, /serialisable/);
});

test("a nested object is measured by size, not silently trusted", () => {
  const small = { name: "Alice", ticket: Array.from({ length: 60 }, (_, i) => i) };
  assert.equal(sanePayload(small).ok, true, "a compact nested payload passes");
  const nested = { name: "Alice", ticket: Array.from({ length: 1500 }, (_, i) => i) };
  assert.equal(sanePayload(nested).ok, false, "a stuffed array busts the byte budget");
  assert.match(sanePayload(nested).error, /too large/);
});

// -------------------------------------------------------------- field rules

test("names are sanitised and length-bounded", () => {
  assert.equal(asName("Alice"), "Alice");
  assert.equal(asName("  Alice  "), "Alice");
  assert.equal(asName("Ali\u0000ce"), "Alice", "NUL stripped");
  assert.equal(asName("A".repeat(20)), "A".repeat(20));
  assert.equal(asName("A".repeat(21)), null);
  assert.equal(asName("Al"), null);
  assert.equal(asName(""), null);
  assert.equal(asName("   "), null);
  assert.equal(asName(123), null);
  assert.equal(asName(["Alice"]), null);
  assert.equal(asName(undefined), null);
});

test("room codes follow the server alphabet, in any case", () => {
  assert.equal(asRoomId("ABCD2345"), "ABCD2345");
  assert.equal(asRoomId("  abcd2345  "), "ABCD2345");
  assert.equal(asRoomId("abcdef23"), "ABCDEF23", "a-f are ordinary letters here");
  for (const bad of ["ABC", "ABCDEFGHI", "ABCD234I", "ABCD234O", "ABCD2340", "ABCD2341", "ABCD2345!", "  ", null, 42]) {
    assert.equal(asRoomId(bad), null, "rejected " + JSON.stringify(bad));
  }
  assert.equal(ROOM_ID_PATTERN.test("__proto__"), false);
  assert.equal(ROOM_ID_PATTERN.test("toString"), false);
});

test("credentials are lower-case hex of a sane length", () => {
  assert.equal(asToken("a".repeat(12)), "a".repeat(12));
  assert.equal(asToken("A".repeat(48)), "a".repeat(48));
  for (const bad of ["a".repeat(11), "a".repeat(65), "z".repeat(24), "admin", "0", "", null, 5, {}, "a".repeat(12) + "!!"]) {
    assert.equal(asToken(bad), null, "rejected " + JSON.stringify(bad));
  }
  assert.equal(TOKEN_PATTERN.test("../../etc/passwd"), false);
});

test("pattern ids are short identifiers, nothing else", () => {
  assert.equal(asPatternId("topLine"), "topLine");
  assert.equal(asPatternId(" full_House "), "full_House");
  for (const bad of ["", " ", "1leading", "a".repeat(33), "top line", "topLine; DROP", "<script>", null, 7]) {
    assert.equal(asPatternId(bad), null, "rejected " + JSON.stringify(bad));
  }
});

test("chat text keeps its length bound", () => {
  assert.equal(asChatText("hello"), "hello");
  assert.equal(asChatText("  hello  "), "hello");
  assert.equal(asChatText(""), null);
  assert.equal(asChatText("   "), null);
  assert.equal(asChatText("x".repeat(121)), null);
  assert.equal(asChatText("x".repeat(30), 20), null, "per-room cap respected");
  assert.equal(asChatText("x".repeat(20), 20).length, 20);
  assert.equal(asChatText(42), null);
});

test("booleans and integers are not coerced from junk", () => {
  assert.equal(asBoolean(true), true);
  assert.equal(asBoolean(false), false);
  assert.equal(asBoolean("true"), undefined);
  assert.equal(asBoolean(1), undefined);
  assert.equal(asBoolean(undefined), undefined);

  const bounds = { min: 500, max: 120000 };
  assert.equal(asInteger(500, bounds), 500);
  assert.equal(asInteger(120000, bounds), 120000);
  assert.equal(asInteger(undefined, bounds), undefined);
  for (const bad of [499, 120001, 500.5, "500", null, NaN, Infinity, {}, []]) {
    assert.equal(asInteger(bad, bounds), null, "rejected " + String(bad));
  }
});

// ---------------------------------------------------------------- event budget

test("a burst of events is capped and then refilled", async () => {
  const take = createBudget({ burst: 3, perSecond: 10 });
  assert.equal(take(), true);
  assert.equal(take(), true);
  assert.equal(take(), true);
  assert.equal(take(), false, "burst exhausted");
  await new Promise((resolve) => setTimeout(resolve, 350));
  assert.equal(take(), true, "refilled at 10/s");
  assert.equal(take(), true);
  assert.equal(take(), true);
  assert.equal(take(), false, "and never above the burst ceiling");
});

test("a costly event can be rejected wholesale", () => {
  const take = createBudget({ burst: 5, perSecond: 1 });
  assert.equal(take(5), true);
  assert.equal(take(1), false);
});

// ------------------------------------------------------------------ legacy set

test("every event the old client used is on the deny list", () => {
  assert.deepEqual(
    [...LEGACY_EVENTS].sort(),
    ["claimfromplayer", "create-room", "generate-number", "join-room", "sm", "start-game"]
  );
  // and none of them collide with the v2 contract
  const v2 = [
    "room:create",
    "room:join",
    "room:leave",
    "room:state",
    "session:resume",
    "game:start",
    "game:call-next",
    "game:pause",
    "game:resume",
    "game:end",
    "game:reset",
    "game:set-autocall",
    "claim:submit",
    "chat:send",
  ];
  for (const name of v2) assert.equal(LEGACY_EVENTS.includes(name), false, name + " is a live event");
});
