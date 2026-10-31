/**
 * The chat panel's list, built only from what the server said.
 *
 * Two sources feed one list: the history a seat asks for when it arrives
 * (`chat:history`) and the live broadcast of every message after that
 * (`chat:message`). They overlap — a message sent while the history request was
 * in flight arrives twice — so the list is keyed by the server's message id and
 * a repeated id is ignored rather than shown twice.
 *
 * Nothing here invents a message, a sender or a timestamp: an entry without text
 * is dropped, and a sender the server did not name is displayed as "Player".
 *
 * Run: npm test (tests/chat-feed.test.js).
 */

/** How many lines the panel keeps on screen. The server caps history lower. */
export const CHAT_WINDOW = 60;

/**
 * Stable identity for one chat line.
 *
 * The server's id when it has one. Without it (an older server, or a hand-built
 * payload) the sender + timestamp + text is the fingerprint — the rate limit
 * makes a genuine repeat of all three impossible, and a wrong "already seen"
 * would swallow a real message, which is worse than showing a duplicate.
 */
export function chatKey(data) {
  if (!data || typeof data.text !== "string" || !data.text) return null;
  const from = typeof data.from === "string" && data.from ? data.from : "Player";
  if (data.id) return "id:" + data.id;
  return "at:" + from + "|" + (data.at ?? "") + "|" + data.text;
}

/** One message, in the shape the panel renders. */
function toLine(data) {
  return {
    key: chatKey(data),
    id: data.id || null,
    from: typeof data.from === "string" && data.from ? data.from : "Player",
    text: data.text,
    at: typeof data.at === "number" ? data.at : null,
  };
}

/**
 * Append a live message. Returns the SAME array reference when there is nothing
 * new, so React does not re-render a list that did not change.
 */
export function withChatMessage(messages, data, { limit = CHAT_WINDOW } = {}) {
  const list = Array.isArray(messages) ? messages : [];
  const key = chatKey(data);
  if (!key) return list;
  if (list.some((line) => line.key === key)) return list;
  const next = [...list, toLine(data)];
  return next.length > limit ? next.slice(next.length - limit) : next;
}

/**
 * Seed the panel with what the room already said, keeping anything this panel
 * already showed. History is older, so it goes first; a message that is in both
 * lists appears once, in its original position.
 */
export function withChatHistory(messages, history, { limit = CHAT_WINDOW } = {}) {
  const existing = Array.isArray(messages) ? messages : [];
  const lines = Array.isArray(history) ? history : [];
  let out = [];
  for (const data of lines) out = withChatMessage(out, data, { limit });
  for (const line of existing) {
    if (out.some((entry) => entry.key === line.key)) continue;
    out = [...out, line];
    if (out.length > limit) out = out.slice(out.length - limit);
  }
  return out;
}
