import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { call, clearSession, isSeatGone, on, resumeSession, socket } from "./net.js";
import Header from "./Header";
import { INVITE_TITLE } from "./brand.js";
import Panel from "./components/Panel.jsx";
import Button from "./components/Button.jsx";
import PlayerRoster from "./components/PlayerRoster.jsx";
import TicketPicker from "./components/TicketPicker.jsx";
import TambolaTicket from "./components/TambolaTicket.jsx";
import PatternDiagram from "./components/PatternDiagram.jsx";
import BookingLanguageSelect from "./i18n/BookingLanguageSelect.jsx";
import { bookingClaimNote, bookingCopy, bookingPatternHint, bookingPatternName, bookingRefusalText, formatBookingNumber, setBookingLanguage, useBookingLanguage } from "./i18n/booking-locale.js";
import "./host-screen.css";

const HostRoom = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const language = useBookingLanguage();
  const t = (key, variables) => bookingCopy(language, key, variables);
  const [players, setPlayers] = useState([]);
  const [roomCode, setRoomCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [removalBusy, setRemovalBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [tickets, setTickets] = useState({ count: 1, max: 1 });
  const [previews, setPreviews] = useState([]);
  // The host's prize picker. `patternCatalog` (hostSnapshot only) lists every
  // pattern the server knows with its live on/off state; `patternExample` is the
  // ticket the diagram coordinates are drawn on. Optional prizes can only be
  // switched before the round starts, so this surface is WAITING-only by design.
  const [catalog, setCatalog] = useState([]);
  const [patternExample, setPatternExample] = useState(null);
  const [patternBusy, setPatternBusy] = useState(false);

  const togglePattern = async (id, next) => {
    if (patternBusy) return;
    setPatternBusy(true);
    setError("");
    const result = await call("room:set-patterns", { patterns: { [id]: next } });
    if (result.ok && Array.isArray(result.enabledPatterns)) {
      const on = new Set(result.enabledPatterns);
      setCatalog((prev) => prev.map((p) => (p.optional ? { ...p, enabled: on.has(p.id) } : p)));
    } else {
      setError(bookingRefusalText(language, { ...result, error: result.error || t("actionFailed") }));
    }
    setPatternBusy(false);
  };

  const pickCount = async (count) => {
    const result = await call("tickets:select", { count });
    if (result.ok) {
      setTickets({ count: result.ticketCount, max: result.maxTickets });
      setPreviews(Array.isArray(result.tickets) ? result.tickets : []);
    } else setError(bookingRefusalText(language, result));
  };

  useEffect(() => {
    let alive = true;
    let resuming = false;

    const enter = (snapshot) => {
      if (!snapshot) return;
      // The host view is the only snapshot carrying `hostConnected`. If the
      // server answered with a player snapshot, this seat is not the room's
      // host — keep the (valid) player session and move to the player room
      // rather than showing host controls the server would refuse.
      if (snapshot.hostConnected === undefined) {
        navigate("/player/room", { replace: true });
        return;
      }
      setRoomCode(snapshot.roomId);
      setPlayers(snapshot.players || []);
      setTickets({ count: snapshot.ticketCount ?? 1, max: snapshot.maxTickets ?? 1 });
      setPreviews(Array.isArray(snapshot.tickets) ? snapshot.tickets : []);
      setCatalog(Array.isArray(snapshot.patternCatalog) ? snapshot.patternCatalog : []);
      setPatternExample(Array.isArray(snapshot.patternExample) ? snapshot.patternExample : null);
      // The waiting room is only honest while the round is WAITING. Once it has
      // started - RUNNING, PAUSED, or even COMPLETED - the caller console is the
      // surface that reports that truth and offers the controls the server will
      // actually accept. Leaving a host on here shows "Start Game" and editable
      // prize toggles for a round already under way, which the server would only
      // refuse, so route to the console for any non-WAITING state.
      if (snapshot.state && snapshot.state !== "WAITING") navigate("/host/game");
    };

    // Server-backed restoration: the saved host credential re-claims the room,
    // at mount and again after any transport reconnect (a fresh socket carries
    // no session). Only a definitively-dead seat drops the credential; a
    // transient failure (still connecting, a timeout) keeps it and retries.
    const resume = async () => {
      if (resuming || !alive) return;
      resuming = true;
      try {
        const resumed = await resumeSession();
        if (!alive) return;
        if (resumed.ok) enter(resumed.snapshot);
        else if (isSeatGone(resumed.code)) {
          clearSession();
          navigate("/host");
        }
      } finally {
        resuming = false;
      }
    };

    const stopUpdated = on("room:updated", (data) => setPlayers(data.players || []));
    const stopStarted = on("game:state", (data) => {
      if (data.state && data.state !== "WAITING") navigate("/host/game");
    });
    const stopClosed = on("room:closed", () => {
      clearSession();
      navigate("/host");
    });
    const stopRemoved = on("room:removed", () => {
      clearSession();
      navigate("/player");
    });
    const stopConnected = on("connect", () => resume());

    resume();

    return () => {
      alive = false;
      [stopUpdated, stopStarted, stopClosed, stopRemoved, stopConnected].forEach((stop) => stop());
    };
  }, [navigate]);

  const shareLink = `${window.location.origin}/player?id=${roomCode}`;

  const handleStartGame = async () => {
    if (!roomCode || busy) return;
    if (!socket.connected) {
      setError(t("notConnected"));
      return;
    }
    setBusy(true);
    setError("");
    const started = await call("game:start");
    if (!started.ok) {
      setBusy(false);
      setError(bookingRefusalText(language, { ...started, error: started.error || t("actionFailed") }));
      return;
    }
    navigate("/host/game");
  };

  const removePlayer = async (playerId) => {
    if (removalBusy) return;
    setRemovalBusy(true);
    setError("");
    setNotice("");
    const player = players.find((candidate) => candidate.id === playerId);
    const result = await call("room:remove-player", { playerId });
    if (!result.ok) setError(bookingRefusalText(language, result));
    else setNotice(bookingCopy(language, "participantRemoved", { name: player?.name || "Player" }));
    setRemovalBusy(false);
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setError(t("hostCopyFailed"));
    }
  };

  const nativeShare = () => {
    if (navigator.share) {
      navigator.share({ title: INVITE_TITLE, text: t("hostShareMessage", { brand: INVITE_TITLE }), url: shareLink }).catch(() => {});
    } else {
      copyLink();
    }
  };

  return (
    <div className="flex flex-col festival-host-route" style={{ minHeight: "100vh" }}>
      <Header />
      <main id="main-content" lang={language === "hi" ? "hi" : "en"} tabIndex="-1"
        className="flex-1 w-full festival-host-screen festival-host-screen--room"
        style={{ maxWidth: 640, marginInline: "auto", padding: "12px 20px 40px" }}
      >
        {searchParams.get("patterns") === "review" ? <p role="status" className="oh-caller-note mt-2">
          {language === "hi" ? "सभी जीतने वाले पैटर्न अपने आप चालू नहीं हो सके। खेल शुरू करने से पहले सूची जाँचें।" : "All winning patterns could not be enabled automatically. Review the list before starting."}
        </p> : null}
        <Panel className="p-6 festival-host-card festival-host-intro">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <h1 className="oh-display" style={{ fontSize: 24, margin: 0 }}>
                {t("hostHallOpen")}
              </h1>
              <p style={{ color: "var(--oh-text-muted)", fontSize: 14, margin: "2px 0 0" }}>
                {t("hostWaitingPlayers")}
              </p>
            </div>
            <div
              className="oh-num text-right"
              style={{
                padding: "8px 14px",
                borderRadius: 14,
                background: "var(--oh-inset)",
                border: "1px solid var(--oh-line-gold)",
              }}
            >
              <div className="oh-eyebrow">{t("hostRoomCode")}</div>
              <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: ".18em", color: "var(--oh-gold-bright)" }}>
                {roomCode || "…"}
              </div>
            </div>
          </div>

          <BookingLanguageSelect language={language} onChange={setBookingLanguage} />
          <div className="flex flex-wrap gap-2 mt-4">
            <Button variant="ghost" size="sm" onClick={copyLink}>
              {copied ? t("hostLinkCopied") : t("hostCopyInvite")}
            </Button>
            <Button variant="ghost" size="sm" onClick={nativeShare}>
              {t("hostShareInvite")}
            </Button>
          </div>
        </Panel>

        <div className="mt-4">
          <TicketPicker value={tickets.count} max={tickets.max} disabled={busy} language={language} onPick={pickCount} />
        </div>

        {previews.length > 0 ? (
          <div className="mt-5">
            <div className="oh-eyebrow" style={{ marginBottom: 8, color: "var(--oh-text-faint)" }}>
              {t("hostPreviewTickets")}
            </div>
            <div className="flex flex-col gap-3">
              {previews.map((t) => (
                <TambolaTicket
                  key={`pv-${t.no}`}
                  ticket={t.grid}
                  calledNumbers={[]}
                  ticketNo={t.no}
                  ticketTotal={previews.length}
                  language={language}
                />
              ))}
            </div>
          </div>
        ) : null}

        {catalog.length > 0 ? (
          <Panel className="p-5 mt-4 festival-host-card">
            <div className="oh-eyebrow" style={{ color: "var(--oh-text-faint)" }}>
              {language === "hi" ? "होस्ट पैटर्न सेटिंग" : "HOST PATTERN SETTINGS"}
            </div>
            <h2 className="oh-display" style={{ fontSize: 18, margin: "2px 0 4px" }}>
              {t("hostPrizesHeading")}
            </h2>
            <p style={{ color: "var(--oh-text-muted)", fontSize: 13, margin: "0 0 12px", maxWidth: "52ch" }}>
              {language === "hi"
                ? "हर लागू पुरस्कार पैटर्न यहां दिखता है। अतिरिक्त पैटर्न खेल शुरू होने से पहले बदले जा सकते हैं।"
                : "Every supported pattern is listed here. Host-selectable patterns can be changed before the game starts."}
            </p>
            <ul className="flex flex-col gap-3" style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {catalog.map((p) => (
                  <li key={p.id} className="oh-prize" data-on={String(Boolean(p.enabled))}>
                    <div className="oh-prize__head">
                      {p.optional ? (
                        <label className="oh-prize__toggle">
                          <input
                            type="checkbox"
                            checked={Boolean(p.enabled)}
                            disabled={patternBusy || busy}
                            onChange={() => togglePattern(p.id, !p.enabled)}
                            aria-label={t("hostPlayForPattern", { pattern: bookingPatternName(language, p.id, p.label) })}
                          />
                          <span>
                            <span className="oh-prize__name">{bookingPatternName(language, p.id, p.label)}</span>
                            <span className="oh-num oh-prize__points">+{formatBookingNumber(p.points, language)}</span>
                          </span>
                        </label>
                      ) : (
                        <div role="group" className="oh-prize__toggle" style={{ cursor: "default" }} aria-label={`${bookingPatternName(language, p.id, p.label)}${language === "hi" ? ": शामिल" : ": included"}`}>
                          <span>
                            <span className="oh-prize__name">{bookingPatternName(language, p.id, p.label)}</span>
                            <span className="oh-num oh-prize__points">+{formatBookingNumber(p.points, language)}</span>
                          </span>
                          <span className="oh-prize__included">{language === "hi" ? "शामिल" : "Included"}</span>
                        </div>
                      )}
                    </div>
                    <p className="oh-prize__hint">{bookingPatternHint(language, p.id, p.hint)}</p>
                    {p.cells ? (
                      <PatternDiagram cells={p.cells} example={patternExample} note={bookingClaimNote(language, p.diagramNote)} label={bookingPatternName(language, p.id, p.label)} language={language} />
                    ) : (
                      <div className="oh-pattern-count">{t("hostAnyTicketNumbers", { need: formatBookingNumber(p.need, language) })}</div>
                    )}
                  </li>
                ))}
            </ul>
          </Panel>
        ) : null}

        <div className="mt-4">
          <PlayerRoster players={players} leaderboard={[]} language={language} onRemovePlayer={removePlayer} removalBusy={removalBusy} />
          {notice ? <p role="status" className="oh-caller-note mt-2">{notice}</p> : null}
        </div>

        <Button variant="gold" block className="mt-5" onClick={handleStartGame} disabled={busy}>
          {busy ? t("hostStarting") : t("hostStartGame")}
        </Button>
        {error ? (
          <p role="alert" className="mt-3 text-center" style={{ color: "var(--oh-danger)", fontSize: 13 }}>
            {error}
          </p>
        ) : null}
      </main>
    </div>
  );
};

export default HostRoom;
