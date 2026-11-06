import { useState, useEffect } from "react";
import { Link, useLocation, useNavigate, Outlet, useSearchParams } from "react-router-dom";
import { call, clearPendingSession, clearSession, isSeatGone, loadOwnSession, loadPendingSession, saveSession, socket } from "./net.js";
import { offeredSeatLabel, planJoinEntry } from "./lib/joinSeat.js";
import Header from "./Header";
import PublicBack from "./components/PublicBack.jsx";
import { hallMark } from "./lib/hall-mark.js";
import Panel from "./components/Panel.jsx";
import Button from "./components/Button.jsx";
import ConnectionIndicator from "./components/ConnectionIndicator.jsx";
import BookingLanguageSelect from "./i18n/BookingLanguageSelect.jsx";
import { bookingCopy, bookingRefusalText, setBookingLanguage, useBookingLanguage } from "./i18n/booking-locale.js";

const Player = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const language = useBookingLanguage();
  const t = (key, variables) => bookingCopy(language, key, variables);
  const searchTerm = searchParams.get("id");
  const instanceSlug = searchParams.get("instance");
  const joinHallMark = hallMark(instanceSlug);
  const roomParam = searchParams.get("room") || "";
  const resumeRequested = searchParams.get("resume") === "1";
  const pendingSeat = loadPendingSession();
  const resumeHref = `/player?resume=1${pendingSeat.instanceSlug ? `&instance=${encodeURIComponent(pendingSeat.instanceSlug)}` : ""}`;

  const [name, setName] = useState("");
  const [instanceName, setInstanceName] = useState("");
  const [code, setCode] = useState(searchParams.get("room") || "");
  const [bookingReference, setBookingReference] = useState("");
  const [bookingToken, setBookingToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // A seat this browser remembers while this tab holds none. Not taken silently:
  // see lib/joinSeat.js for why a new tab must ask before becoming that player.
  const [offer, setOffer] = useState(null);

  useEffect(() => {
    let active = true;
    if (!instanceSlug) {
      setInstanceName("");
      return () => { active = false; };
    }
    fetch(`/api/admin/public/instances/${encodeURIComponent(instanceSlug)}`, { headers: { Accept: "application/json" } })
      .then((response) => response.ok ? response.json() : null)
      .then((data) => { if (active && data?.instance?.display_name) setInstanceName(data.instance.display_name); })
      .catch(() => {});
    return () => { active = false; };
  }, [instanceSlug]);

  useEffect(() => {
    const plan = planJoinEntry({
      pathname: location.pathname,
      searchTerm,
      roomCode: roomParam,
      instanceSlug,
      resumeRequested,
      own: loadOwnSession(),
      pending: loadPendingSession(),
    });
    if (plan.code) setCode(plan.code);
    // This tab's own seat is the only one that may be resumed without asking.
    // The component is also the layout for /player/room and /player/game, and
    // those screens re-claim their seat themselves — so the plan ignores them,
    // otherwise a seated player would be bounced out of the game they are in.
    if (plan.action === "resume") navigate(`/player/room`);
    else if (plan.action === "offer") {
      let active = true;
      setOffer(null);
      call("session:check", {
        roomId: plan.seat.roomId,
        sessionToken: plan.seat.sessionToken,
        ...(plan.seat.instanceSlug ? { instanceSlug: plan.seat.instanceSlug } : {}),
      }).then((checked) => {
        if (!active) return;
        if (!checked.ok || (instanceSlug && checked.instanceSlug !== instanceSlug)) {
          if (isSeatGone(checked.code) || checked.code === "ROOM_CLOSED" || checked.code === "NOT_PLAYER") clearPendingSession();
          setOffer(null);
          return;
        }
        setOffer({ ...plan.seat, instanceSlug: checked.instanceSlug || plan.seat.instanceSlug || null });
      });
      return () => { active = false; };
    }
    return undefined;
  }, [navigate, searchTerm, roomParam, instanceSlug, resumeRequested, location.pathname]);

  const reclaimSeat = () => {
    if (!offer) return;
    // Make it this tab's seat, then let the room screen do the resuming it
    // already does on every reconnect — one resume path, not two.
    saveSession(offer);
    setOffer(null);
    navigate(`/player/room`);
  };

  const declineSeat = () => {
    clearPendingSession();
    setOffer(null);
    setError("");
    navigate("/player", { replace: true });
  };

  const handleJoinClick = async (e) => {
    e?.preventDefault?.();
    setError("");
    const hasBookingCredentials = Boolean(bookingReference.trim() && bookingToken.trim());
    if (Boolean(bookingReference.trim()) !== Boolean(bookingToken.trim())) {
      setError(t("enterBookingCredentials"));
      return;
    }
    if (!hasBookingCredentials && name.trim().length < 3) {
      setError(t("nameTooShort"));
      return;
    }
    if (!code.trim()) {
      setError(t("enterRoomCode"));
      return;
    }
    if (!socket.connected) {
      setError(t("notConnected"));
      return;
    }
    setBusy(true);
    // one ack, one truth: the server hands back the identity this session uses
    const joined = await call("room:join", {
      roomId: code.trim(),
      name: name.trim(),
      ...(instanceSlug ? { instanceSlug } : {}),
      ...(hasBookingCredentials ? { reservationId: bookingReference.trim(), bookingToken: bookingToken.trim() } : {}),
    });
    setBusy(false);
    if (!joined.ok) {
      setError(bookingRefusalText(language, { ...joined, error: joined.error || t("joinFailed") }));
      return;
    }
    clearSession();
    saveSession({
      roomId: joined.snapshot.roomId,
      role: "player",
      name: joined.name,
      playerId: joined.playerId,
      sessionToken: joined.sessionToken,
      instanceSlug: joined.instanceSlug || instanceSlug || null,
    });
    navigate(`/player/room`);
  };

  if (location.pathname !== "/player") return <Outlet />;

  return (
    <div className="flex flex-col" style={{ minHeight: "100vh" }}>
      <Header />
      <main id="main-content" lang={language === "hi" ? "hi" : "en"} tabIndex="-1" className="player-entry-main flex-1 flex items-center justify-center" style={{ padding: 20 }}>
        <Panel className="player-entry-panel p-6 sm:p-8" style={{ width: "100%", maxWidth: 460 }}>
          <PublicBack to={instanceSlug ? `/games/${encodeURIComponent(instanceSlug)}` : "/games"}>← Back to game hall</PublicBack>
          <div className="player-entry-art" aria-hidden="true">{joinHallMark ? <img className="player-entry-art__hall-mark" src={joinHallMark.src} alt="" /> : <span className="player-entry-art__ball">90</span>}<span className="player-entry-art__label">YOUR NEXT GREAT GAME</span><span className="player-entry-art__spark player-entry-art__spark--one" /><span className="player-entry-art__spark player-entry-art__spark--two" /></div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 10 }}>
            <h1 className="oh-display" style={{ fontSize: 30, margin: 0 }}>
              {instanceSlug ? t("playerJoinInstance", { name: instanceName || instanceSlug.replaceAll("-", " ") }) : t("playerJoinTitle")}
            </h1>
            <BookingLanguageSelect language={language} onChange={setBookingLanguage} />
          </div>
          <p style={{ color: "var(--oh-text-muted)", margin: "0 0 20px", fontSize: 14 }}>
            {t("playerJoinIntro")}
          </p>
          {offer ? (
            <div
              className="mb-5"
              role="status"
              style={{
                padding: "12px 14px",
                borderRadius: 14,
                background: "var(--oh-inset)",
                border: "1px solid var(--oh-line-gold)",
              }}
            >
              <div className="oh-eyebrow" style={{ color: "var(--oh-gold)", marginBottom: 6 }}>
                {t("rememberedSeat")}
              </div>
              <p style={{ margin: "0 0 10px", fontSize: 14 }}>
                {offeredSeatLabel(offer)} {t("isThisYou")}
              </p>
              <div className="flex gap-2 flex-wrap">
                <Button variant="gold" size="sm" onClick={reclaimSeat}>
                  {t("takeSeat")}
                </Button>
                <Button variant="ghost" size="sm" onClick={declineSeat}>
                  {t("newPlayer")}
                </Button>
              </div>
            </div>
          ) : null}
          <form onSubmit={handleJoinClick}>
            <label className="oh-eyebrow" htmlFor="player-name" style={{ display: "block", marginBottom: 6 }}>
              {t("yourName")}
            </label>
            <input
              id="player-name"
              className="oh-field"
              value={name}
              maxLength={20}
              autoComplete="off"
              placeholder={t("exampleName")}
              onChange={(e) => setName(e.target.value)}
            />
            <label className="oh-eyebrow" htmlFor="player-code" style={{ display: "block", margin: "16px 0 6px" }}>
              {t("roomCode")}
            </label>
            <input
              id="player-code"
              className="oh-field oh-num"
              value={code}
              maxLength={12}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              placeholder="ABC123"
              style={{ letterSpacing: ".2em", textTransform: "uppercase" }}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
            />
            <details style={{ marginTop: 18 }}>
              <summary className="oh-eyebrow" style={{ cursor: "pointer", color: "var(--oh-gold-bright)" }}>{t("bookingJoin")}</summary>
              <p style={{ color: "var(--oh-text-faint)", fontSize: 12, lineHeight: 1.5 }}>{t("bookingJoinHelp")}</p>
              <label className="oh-eyebrow" htmlFor="booking-reference" style={{ display: "block", margin: "12px 0 6px" }}>{t("bookingReference")}</label>
              <input id="booking-reference" className="oh-field" value={bookingReference} maxLength={80} autoComplete="off" onChange={(event) => setBookingReference(event.target.value)} />
              <label className="oh-eyebrow" htmlFor="booking-token" style={{ display: "block", margin: "12px 0 6px" }}>{t("privateBookingCode")}</label>
              <input id="booking-token" className="oh-field" type="password" value={bookingToken} maxLength={128} autoComplete="off" onChange={(event) => setBookingToken(event.target.value)} />
            </details>
            {!resumeRequested ? <p className="player-resume-link"><Link to={resumeHref}>Returning player? Check for an active seat saved on this browser.</Link></p> : null}
            <Button type="submit" variant="gold" block className="mt-4" disabled={busy}>
              {busy ? t("joiningRoom") : t("joinRoom")}
            </Button>
          </form>
          {error ? (
            <p role="alert" className="mt-3" style={{ color: "var(--oh-danger)", fontSize: 13 }}>
              {error}
            </p>
          ) : null}
          <div className="player-entry-footer mt-5">
            <ConnectionIndicator />
            <span className="oh-eyebrow player-entry-footer__note" style={{ color: "var(--oh-text-faint)" }}>{t("chooseTicketsBeforeRound")}</span>
          </div>
        </Panel>
      </main>
    </div>
  );
};

export default Player;
