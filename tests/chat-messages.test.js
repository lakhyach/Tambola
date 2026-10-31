/**
 * Quick-message catalogue (English + हिन्दी) — §2.
 *
 * Two guarantees this file pins down:
 *   1. The catalogue itself is well-formed for BOTH languages, so a maintainer
 *      cannot accidentally ship an empty/oversized/duplicated or half-translated
 *      category.
 *   2. Every catalogue string survives the *real* server chat path untouched —
 *      the same `chat()` that strips control characters, trims to maxChatLength
 *      and rate-limits per player — so a one-tap Hindi/emoji message is
 *      delivered exactly as written. This is deliberately run through the engine
 *      rather than trusting the client component.
 *
 * The transport-level guarantees (room isolation, cross-room leak, unknown
 * sender) are already covered in realtime.test.js; here we add the catalogue's
 * authorization + rate-limit behaviour on top, and the in-memory tail a seat
 * that joins mid-round can read (§5: an empty chat panel beside a lively room
 * looks exactly like broken chat).
 * Run with: npm test
 */

import test from "node:test";
import assert from "node:assert/strict";
import { CHAT_HISTORY, ErrorCodes } from "../server/game/engine.js";
import { makeRoom } from "./helpers.js";
import {
  CATEGORIES,
  QUICK_MESSAGES,
  CELEBRATION,
  quickMessagesFor,
  celebrate,
} from "../client/src/i18n/messages.js";

const MAX_LEN = 120; // matches DEFAULT_CONFIG.maxChatLength
const LANGS = ["en", "hi"];
const CONTROL = /[\u0000-\u001f]/;

/** Every message across both languages, tagged by language. */
function allMessages() {
  const out = [];
  for (const lang of LANGS) {
    for (const cat of CATEGORIES) {
      for (const text of QUICK_MESSAGES[lang][cat.id]) out.push({ lang, category: cat.id, text });
    }
  }
  return out;
}

// --------------------------------------------------------------- catalogue shape

test("both languages ship the full set of categories, each populated", () => {
  for (const lang of LANGS) {
    const table = QUICK_MESSAGES[lang];
    assert.ok(table, `catalogue missing language: ${lang}`);
    for (const cat of CATEGORIES) {
      const list = table[cat.id];
      assert.ok(Array.isArray(list) && list.length >= 2, `${lang}/${cat.id} needs at least 2 messages`);
    }
  }
});

test("every quick message is non-empty, control-char free and within the chat limit", () => {
  for (const { lang, text } of allMessages()) {
    assert.equal(typeof text, "string");
    assert.equal(text.trim().length > 0, true, `${lang}: blank message`);
    assert.equal(text, text.trim(), `${lang}: '${text}' has leading/trailing whitespace`);
    assert.equal(CONTROL.test(text), false, `${lang}: '${text}' contains a control character`);
    assert.ok([...text].length <= MAX_LEN, `${lang}: '${text}' exceeds ${MAX_LEN} code points`);
  }
});

test("quick messages are unique within a language (no duplicated taps)", () => {
  for (const lang of LANGS) {
    const seen = new Set();
    for (const { text } of allMessages().filter((m) => m.lang === lang)) {
      assert.equal(seen.has(text), false, `${lang}: duplicate message '${text}'`);
      seen.add(text);
    }
  }
});

test("every category has a display label in every supported language", () => {
  for (const cat of CATEGORIES) {
    for (const lang of LANGS) {
      assert.ok(cat.label[lang], `category ${cat.id} has no ${lang} label`);
    }
  }
});

test("the two languages carry the same message count per category (translation parity)", () => {
  for (const cat of CATEGORIES) {
    const en = QUICK_MESSAGES.en[cat.id].length;
    const hi = QUICK_MESSAGES.hi[cat.id].length;
    assert.equal(en, hi, `${cat.id}: en has ${en}, hi has ${hi}`);
  }
});

test("celebration catalogue covers both languages with identical keys", () => {
  const enKeys = Object.keys(CELEBRATION.en).sort();
  const hiKeys = Object.keys(CELEBRATION.hi).sort();
  assert.deepEqual(hiKeys, enKeys, "hi celebration strings drift from en");
  for (const key of enKeys) {
    for (const lang of LANGS) assert.ok(CELEBRATION[lang][key].trim().length, `${lang}/${key} empty`);
  }
});

test("quickMessagesFor flattens a language and celebrate interpolates variables", () => {
  const flat = quickMessagesFor("en");
  assert.equal(flat.length, allMessages().filter((m) => m.lang === "en").length);
  assert.ok(flat.every((m) => m.text && m.category));
  assert.equal(celebrate("en", "patternWin", { name: "Ravi", label: "Full House" }), "Ravi wins Full House! 🎉");
  assert.equal(celebrate("hi", "patternWin", { name: "रवि", label: "फुल हाउस" }), "रवि ने फुल हाउस जीता! 🎉");
  // unknown language falls back to the default template rather than crashing
  assert.equal(celebrate("fr", "patternWin", { name: "X", label: "Y" }), "X wins Y! 🎉");
});

// ------------------------------------------------------ catalogue through engine

test("the real chat pipeline accepts and delivers every catalogue message verbatim", () => {
  const h = makeRoom(); // chatIntervalMs 0 so we can flood it deliberately
  h.host();
  const alice = h.player("Alice", "sock-a");

  for (const { text } of allMessages()) {
    const before = h.eventsNamed("chat:message").length;
    const res = h.room.chat({ playerId: alice.playerId, playerToken: alice.playerToken, text });
    assert.equal(res.ok, true, `server rejected catalogue message: ${text}`);
    const emitted = h.eventsNamed("chat:message");
    assert.equal(emitted.length, before + 1);
    const delivered = emitted[emitted.length - 1].payload;
    // Devanagari + emoji + Latin all survive the control-char strip / trim / slice
    assert.equal(delivered.text, text, `mangled on delivery: ${text}`);
    assert.equal(delivered.from, "Alice");
  }
});

test("quick messages respect sender authorization like typed chat", () => {
  const h = makeRoom();
  h.host();
  const alice = h.player("Alice", "sock-a");
  const hindi = QUICK_MESSAGES.hi.greetings[0];

  // an outsider cannot broadcast a catalogue message
  assert.equal(
    h.room.chat({ playerId: "deadbeef", text: hindi }).code,
    ErrorCodes.NOT_PLAYER,
    "unknown seat rejected",
  );
  // a bad credential on a real seat is rejected too
  assert.equal(
    h.room.chat({ playerId: alice.playerId, playerToken: "wrong", text: hindi }).ok,
    false,
    "credential checked",
  );
  // the legitimate seat succeeds
  assert.equal(h.room.chat({ playerId: alice.playerId, playerToken: alice.playerToken, text: hindi }).ok, true);
});

test("quick messages are rate-limited per player exactly like typed chat", () => {
  const h = makeRoom({ config: { chatIntervalMs: 5000 } });
  h.host();
  const alice = h.player("Alice", "sock-a");
  const bob = h.player("Bob", "sock-b");

  const first = h.room.chat({ playerId: alice.playerId, playerToken: alice.playerToken, text: QUICK_MESSAGES.en.greetings[0] });
  assert.equal(first.ok, true);
  const second = h.room.chat({ playerId: alice.playerId, playerToken: alice.playerToken, text: QUICK_MESSAGES.hi.greetings[0] });
  assert.equal(second.ok, false);
  assert.equal(second.code, ErrorCodes.RATE_LIMITED, "second tap inside the cooldown is throttled");
  // another player is unaffected by Alice's flood
  const bobMsg = h.room.chat({ playerId: bob.playerId, playerToken: bob.playerToken, text: QUICK_MESSAGES.hi.goodLuck[0] });
  assert.equal(bobMsg.ok, true, "a different seat is not throttled by Alice");
});

// ------------------------------------------------------ the tail a newcomer reads
//
// Chat is not game state: it is never persisted and never part of a snapshot. But
// a seat that joins mid-round has seen none of it, and an empty panel beside a
// lively room is indistinguishable from broken chat. So the room keeps a short
// in-memory tail, and `chat:history` hands it to the one connection that asks.

/** Send `n` messages from one seat with the throttle switched off. */
function flood(h, player, n, prefix = "m") {
  const sent = [];
  for (let i = 0; i < n; i++) {
    const res = h.room.chat({ playerId: player.playerId, playerToken: player.playerToken, text: prefix + i });
    assert.equal(res.ok, true, "flood message " + i + " refused: " + res.error);
    sent.push(res);
  }
  return sent;
}

test("a room remembers a short tail of what was said, oldest first", () => {
  const h = makeRoom({ config: { chatIntervalMs: 0 } });
  h.host();
  const alice = h.player("Alice", "sock-a");
  const sent = flood(h, alice, 6);

  const tail = h.room.recentChat();
  assert.equal(tail.length, 6);
  assert.deepEqual(tail.map((m) => m.text), ["m0", "m1", "m2", "m3", "m4", "m5"], "the order a reader expects");
  assert.equal(tail[0].from, "Alice", "attributed, because an anonymous tail is gossip");
  assert.deepEqual(
    tail.map((m) => m.id),
    sent.map((res) => res.id),
    "the id the sender was told is the id in the history — one identity per message",
  );
});

test("the tail is capped and drops from the oldest end", () => {
  const h = makeRoom({ config: { chatIntervalMs: 0 } });
  h.host();
  const alice = h.player("Alice", "sock-a");
  flood(h, alice, CHAT_HISTORY + 10);

  const tail = h.room.recentChat();
  assert.equal(tail.length, CHAT_HISTORY, "a room that chats all night does not grow without bound");
  assert.equal(tail[0].text, "m10", "the oldest ten are gone, not the newest");
  assert.equal(tail[tail.length - 1].text, "m" + (CHAT_HISTORY + 9));
});

test("a reader cannot edit the room's conversation through the tail", () => {
  const h = makeRoom({ config: { chatIntervalMs: 0 } });
  h.host();
  const alice = h.player("Alice", "sock-a");
  flood(h, alice, 3);
  const tail = h.room.recentChat();
  tail.length = 0;
  tail.push({ text: "injected" });
  assert.equal(h.room.recentChat().length, 3, "recentChat is a copy");
  assert.equal(h.room.recentChat()[0].text, "m0");
});

test("only messages that were actually sent enter the history", () => {
  const h = makeRoom({ config: { chatIntervalMs: 5000 } });
  h.host();
  const alice = h.player("Alice", "sock-a");
  const bob = h.player("Bob", "sock-b");

  assert.equal(h.room.chat({ playerId: alice.playerId, playerToken: alice.playerToken, text: "first" }).ok, true);
  // refused for rate limiting, for emptiness, for an unknown seat
  assert.equal(h.room.chat({ playerId: alice.playerId, playerToken: alice.playerToken, text: "second" }).code, ErrorCodes.RATE_LIMITED);
  assert.equal(h.room.chat({ playerId: bob.playerId, playerToken: "wrong", text: "forged" }).ok, false);
  assert.equal(h.room.chat({ playerId: "deadbeef", text: "outsider" }).ok, false);
  assert.equal(h.room.chat({ playerId: alice.playerId, playerToken: alice.playerToken, text: "   " }).code, ErrorCodes.BAD_PAYLOAD);

  const tail = h.room.recentChat();
  assert.deepEqual(tail.map((m) => m.text), ["first"], "a refusal never becomes somebody's message");
});

test("every message has its own id, including a repeated line", () => {
  const h = makeRoom({ config: { chatIntervalMs: 0 } });
  h.host();
  const alice = h.player("Alice", "sock-a");
  const ids = new Set();
  for (let i = 0; i < 8; i++) {
    const res = h.room.chat({ playerId: alice.playerId, playerToken: alice.playerToken, text: "same words" });
    assert.equal(res.ok, true);
    ids.add(res.id);
  }
  assert.equal(ids.size, 8, "an identical text is still two different messages");
  for (const message of h.room.recentChat()) assert.match(message.id, /^c-[0-9a-f]{20}$/);
});

test("chat never rides along in a snapshot, and survives into the next round", () => {
  const h = makeRoom({ config: { chatIntervalMs: 0 } });
  const host = h.host();
  const alice = h.player("Alice", "sock-a");
  h.room.selectTickets({ playerId: alice.playerId, playerToken: alice.playerToken, count: 1 });
  h.room.start({ socketId: host.socketId });
  flood(h, alice, 3, "qqzz-");

  // the payload every player re-read on every number call stays small
  const snapshot = JSON.stringify(h.room.playerSnapshot(alice.playerId));
  assert.equal(snapshot.includes("qqzz-0"), false, "chat is not in the snapshot");
  assert.equal(snapshot.includes("recentChat"), false);
  assert.equal(h.room.recentChat().length, 3, "it is only there when somebody asks for it");

  // a new round in the same room is the same conversation
  h.room.end({ socketId: host.socketId });
  h.room.reset({ socketId: host.socketId });
  assert.equal(h.room.recentChat().length, 3, "the room's chat outlives the round, not the process");
});
