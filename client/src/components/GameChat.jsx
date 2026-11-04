import { useEffect, useRef, useState } from "react";
import Panel from "./Panel.jsx";
import { call, on, socket } from "../net.js";
import { CATEGORIES, QUICK_MESSAGES, pickerLanguages } from "../i18n/messages.js";
import { refusalText } from "../lib/refusals.js";
import { withChatHistory, withChatMessage } from "../lib/chatFeed.js";
import { bookingCopy, bookingRefusalText, useBookingLanguage } from "../i18n/booking-locale.js";

const MAX_LEN = 120;

/**
 * Room chat, kept from the previous build but rebuilt to the new identity. It
 * only speaks the documented contract: send `chat:send`, listen `chat:message`,
 * ask `chat:history` when this panel comes into existence. The server
 * rate-limits per player, so the input shows a short cooldown rather than
 * pretending every keystroke will land.
 *
 * The list is assembled by lib/chatFeed.js from those two sources and keyed by
 * the server's message id, because a message that arrives while the history
 * request is in flight would otherwise be shown twice.
 *
 * A one-tap quick-reply picker sits above the free-text box. Every picker tap
 * sends a normal `chat:send` (never a privileged event), so quick messages
 * inherit the same rate-limit, room isolation and payload validation as typed
 * chat. The catalogue (EN/हिन्दी) lives in i18n/messages.js — nothing here is
 * hard-coded, so it is easy to extend or translate.
 *
 * A refused message is never swallowed: the server's answer is shown and the text
 * stays in the box, because the browser's cooldown cannot know the room's exact
 * `chatIntervalMs` and a silent "it just didn't send" is indistinguishable from a
 * broken game.
 */
// eslint-disable-next-line react/prop-types
const GameChat = ({ sessionResumeCount = 0 }) => {
  const appLanguage = useBookingLanguage();
  const t = (key) => bookingCopy(appLanguage, key);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [cool, setCool] = useState(false);
  const [note, setNote] = useState("");
  const [lang, setLang] = useState(appLanguage);
  const [openCat, setOpenCat] = useState(CATEGORIES[0]?.id ?? null);
  const scroller = useRef(null);
  const noteTimer = useRef(null);
  const langs = pickerLanguages();

  useEffect(() => setLang(appLanguage), [appLanguage]);

  useEffect(() => {
    const stop = on("chat:message", (data) => {
      setMessages((prev) => withChatMessage(prev, data));
    });
    return stop;
  }, []);

  /**
   * Ask the room what was said before this panel existed. A seat that joins
   * mid-round otherwise stares at "No messages yet." while the room is chatting —
   * which looks exactly like a broken chat, and is the one thing this panel can
   * be wrong about without the server having done anything wrong at all.
   *
   * Read on demand rather than pushed on join: at the moment the server seats
   * this socket, this panel does not exist yet and there is nothing to receive
   * the messages into. A reply to a question the panel asked always lands.
   */
  useEffect(() => {
    let alive = true;

    const loadHistory = async () => {
      const res = await call("chat:history");
      if (!alive || !res.ok || !Array.isArray(res.messages)) return;
      setMessages((prev) => withChatHistory(prev, res.messages));
    };

    const stopConnected = on("connect", () => loadHistory());
    if (socket.connected) loadHistory();

    return () => {
      alive = false;
      stopConnected();
    };
  }, [sessionResumeCount]);

  useEffect(() => {
    if (scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight;
  }, [messages]);

  useEffect(() => () => clearTimeout(noteTimer.current), []);

  const say = (message, ms = 2600) => {
    setNote(message);
    clearTimeout(noteTimer.current);
    noteTimer.current = setTimeout(() => setNote(""), ms);
  };

  // Shared sender for typed + quick messages; both respect the cooldown.
  const sendText = async (raw) => {
    const trimmed = (raw || "").trim();
    if (!trimmed || cool) return false;
    const res = await call("chat:send", { text: trimmed });
    if (!res.ok) {
      // keep what they typed: nothing is lost, and the room's own answer is shown
      say(appLanguage === "hi" ? bookingRefusalText(appLanguage, res) : refusalText(res));
      if (res.code === "RATE_LIMITED") {
        setCool(true);
        setTimeout(() => setCool(false), 2000);
      }
      return false;
    }
    setText("");
    setCool(true);
    setTimeout(() => setCool(false), 1200);
    return true;
  };

  const send = () => sendText(text);

  const table = QUICK_MESSAGES[lang] || {};
  const quick = table[openCat] || [];

  return (
    <Panel className="p-4 flex flex-col" lang={appLanguage === "hi" ? "hi" : "en"}>
      <h2 className="oh-eyebrow mb-2">{t("roomChat")}</h2>
      <div
        ref={scroller}
        className="flex flex-col gap-1.5"
        style={{
          height: 128,
          overflowY: "auto",
          padding: "6px 2px",
          fontSize: 13,
        }}
        aria-live="polite"
      >
        {messages.length === 0 ? (
          <span style={{ color: "var(--oh-text-faint)" }}>{t("noMessages")}</span>
        ) : (
          messages.map((m) => (
            <div key={m.key} className="festival-chat-message">
              <span className="festival-chat-avatar" aria-hidden="true">{String(m.from || "").trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("")}</span>
              <div><span className="festival-chat-name">{m.from}</span><span className="festival-chat-text">{m.text}</span></div>
            </div>
          ))
        )}
      </div>

      {/* Quick-reply picker */}
      <div className="mt-2 flex flex-col gap-2" role="group" aria-label={t("quickMessages")}>
        <div className="flex items-center gap-1.5 flex-wrap">
          <div className="flex gap-1 flex-wrap" role="tablist" aria-label={t("messageCategories")}>
            {CATEGORIES.map((cat) => (
              <button
                key={cat.id}
                role="tab"
                aria-selected={openCat === cat.id}
                className={"oh-chip" + (openCat === cat.id ? " oh-chip--active" : "")}
                onClick={() => setOpenCat(cat.id)}
              >
                {cat.label[lang] || cat.label.en}
              </button>
            ))}
          </div>
          {langs.length > 1 && (
            <div className="flex gap-1 ml-auto" role="group" aria-label={t("chatLanguage")}>
              {langs.map((l) => (
                <button
                  key={l}
                  className={"oh-chip oh-chip--lang" + (lang === l ? " oh-chip--active" : "")}
                  aria-pressed={lang === l}
                  onClick={() => setLang(l)}
                >
                  {l === "hi" ? "Hindi" : "EN"}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {quick.map((msg) => (
            <button
              key={msg}
              className="oh-chip oh-chip--quick"
              disabled={cool}
              onClick={() => sendText(msg)}
              title={msg}
            >
              {msg}
            </button>
          ))}
        </div>
      </div>

      <div className="flex gap-2 mt-2">
        <input
          className="oh-field"
          value={text}
          maxLength={MAX_LEN}
          placeholder={cool ? t("holdMoment") : t("saySomething")}
          aria-label={t("chatMessage")}
          aria-describedby={note ? "oh-chat-note" : undefined}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") send();
          }}
        />
        <button
          className="oh-btn oh-btn--gold"
          onClick={send}
          disabled={cool || !text.trim()}
          style={{ padding: "0 16px" }}
        >
          {t("send")}
        </button>
      </div>
      {note ? (
        <p
          id="oh-chat-note"
          role="status"
          aria-live="polite"
          style={{ color: "var(--oh-warn)", fontSize: 12, margin: "6px 0 0" }}
        >
          {note}
        </p>
      ) : null}
    </Panel>
  );
};

export default GameChat;
