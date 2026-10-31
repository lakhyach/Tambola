/**
 * The chat panel's list logic — §2 + §5.
 *
 * The panel now hears about messages from two places: the history it asks for
 * when it mounts, and the live broadcast after that. They overlap — a message
 * sent while the history request was in flight arrives on both paths — and a
 * panel that showed every arrival twice would be its own kind of broken. So the
 * list is keyed by the server's message id and deduped here, in one pure module,
 * rather than in three `setState` callbacks.
 *
 * Run with: npm test
 */

import test from "node:test";
import assert from "node:assert/strict";
import { CHAT_WINDOW, chatKey, withChatHistory, withChatMessage } from "../client/src/lib/chatFeed.js";

const msg = (over = {}) => ({ id: "c-aaa", from: "Ravi", text: "hi", at: 1000, ...over });

test("a live message is appended with the sender the server named", () => {
  const list = withChatMessage([], msg({ text: "all the best" }));
  assert.equal(list.length, 1);
  assert.equal(list[0].from, "Ravi");
  assert.equal(list[0].text, "all the best");
  assert.equal(list[0].id, "c-aaa");
});

test("the same id is never shown twice, however many times it arrives", () => {
  let list = withChatMessage([], msg());
  for (let i = 0; i < 5; i++) list = withChatMessage(list, msg({ text: "different words" }));
  assert.equal(list.length, 1, "the id is the identity of a message, not its text");
});

test("identical words from the same person are two messages when the server says two", () => {
  let list = withChatMessage([], msg({ id: "c-1" }));
  list = withChatMessage(list, msg({ id: "c-2" }));
  assert.equal(list.length, 2, "a repeated cheer is not a duplicate delivery");
});

test("a message with no id falls back to sender, time and words", () => {
  const noId = { from: "Meena", text: "nice", at: 5 };
  let list = withChatMessage([], noId);
  list = withChatMessage(list, noId);
  assert.equal(list.length, 1, "the same payload twice is still one line");
  list = withChatMessage(list, { ...noId, at: 6 });
  assert.equal(list.length, 2, "a second later is a second message");
});

test("nothing the server did not say is ever rendered", () => {
  for (const junk of [null, undefined, {}, { from: "Bob" }, { text: "" }, { text: 42 }, "a string", 7]) {
    assert.equal(chatKey(junk), null, "not a message: " + JSON.stringify(junk));
    assert.deepEqual(withChatMessage([], junk), [], "nothing appended for " + JSON.stringify(junk));
  }
});

test("an unnamed sender is shown as Player rather than invented", () => {
  const list = withChatMessage([], { id: "c-9", text: "hello" });
  assert.equal(list[0].from, "Player");
  assert.equal(list[0].at, null, "no timestamp is not a timestamp of zero");
});

test("an unchanged list is the same array, so React does not repaint", () => {
  const first = withChatMessage([], msg());
  const again = withChatMessage(first, msg());
  assert.equal(again, first, "a duplicate delivery is literally a no-op");
});

test("the panel keeps a window of lines and drops the oldest", () => {
  let list = [];
  for (let i = 0; i < CHAT_WINDOW + 20; i++) list = withChatMessage(list, msg({ id: "c-" + i, text: "m" + i }));
  assert.equal(list.length, CHAT_WINDOW, "a long game does not grow the DOM forever");
  assert.equal(list[0].text, "m20", "the oldest lines fall off the top");
  assert.equal(list[list.length - 1].text, "m" + (CHAT_WINDOW + 19));
});

test("history arrives first and never duplicates what the panel already showed", () => {
  const history = [msg({ id: "c-1", text: "one" }), msg({ id: "c-2", text: "two" })];
  // a live message landed while the history request was still in flight
  const live = withChatMessage([], msg({ id: "c-3", text: "three" }));
  const merged = withChatHistory(live, history);
  assert.deepEqual(merged.map((m) => m.text), ["one", "two", "three"], "the conversation reads in order");

  const twice = withChatHistory(merged, history);
  assert.deepEqual(twice.map((m) => m.text), ["one", "two", "three"], "a second fetch changes nothing");
});

test("a panel with no history request outstanding keeps exactly what it had", () => {
  assert.deepEqual(withChatHistory([], []), []);
  const one = withChatMessage([], msg());
  assert.deepEqual(withChatHistory(one, []), one);
});

test("garbage from the wire cannot corrupt the list", () => {
  const history = [null, { text: "" }, msg({ id: "c-5" }), "nope", 12];
  const list = withChatHistory([], history);
  assert.equal(list.length, 1, "only the one real message survives");
  assert.equal(list[0].id, "c-5");
});

test("an unreadable existing list is treated as empty, not thrown", () => {
  for (const bad of [undefined, null, "text", 5]) {
    assert.doesNotThrow(() => withChatMessage(bad, msg()));
    assert.equal(withChatMessage(bad, msg()).length, 1);
    assert.equal(withChatHistory(bad, [msg()]).length, 1);
  }
});
