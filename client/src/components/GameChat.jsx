import { useEffect, useRef, useState } from "react";
import Panel from "./Panel.jsx";
import { call, on } from "../net.js";

const MAX_LEN = 120;

/**
 * Room chat, kept from the previous build but rebuilt to the new identity. It
 * only speaks the documented contract: send `chat:send`, listen `chat:message`.
 * The server rate-limits per player, so the input shows a short cooldown rather
 * than pretending every keystroke will land.
 */
const GameChat = () => {
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [cool, setCool] = useState(false);
  const scroller = useRef(null);

  useEffect(() => {
    const stop = on("chat:message", (data) => {
      setMessages((prev) => [...prev.slice(-49), { id: Date.now() + Math.random(), from: data.from, text: data.text }]);
    });
    return stop;
  }, []);

  useEffect(() => {
    if (scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight;
  }, [messages]);

  const send = async () => {
    const trimmed = text.trim();
    if (!trimmed || cool) return;
    const res = await call("chat:send", { text: trimmed });
    if (!res.ok) return;
    setText("");
    setCool(true);
    setTimeout(() => setCool(false), 1200);
  };

  return (
    <Panel className="p-4 flex flex-col">
      <h2 className="oh-eyebrow mb-2">Room Chat</h2>
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
          <span style={{ color: "var(--oh-text-faint)" }}>No messages yet.</span>
        ) : (
          messages.map((m) => (
            <div key={m.id}>
              <span style={{ color: "var(--oh-gold)", fontWeight: 600 }}>{m.from}: </span>
              <span style={{ color: "var(--oh-text)" }}>{m.text}</span>
            </div>
          ))
        )}
      </div>
      <div className="flex gap-2 mt-2">
        <input
          className="oh-field"
          value={text}
          maxLength={MAX_LEN}
          placeholder={cool ? "…" : "Say something"}
          aria-label="Chat message"
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
          Send
        </button>
      </div>
    </Panel>
  );
};

export default GameChat;
