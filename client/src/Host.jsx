import { useEffect, useState } from "react";
import { useNavigate, useLocation, Outlet, useSearchParams } from "react-router-dom";
import { call, clearSession, saveSession, socket } from "./net.js";
import { OPTIONAL_PATTERNS } from "./brand.js";
import Header from "./Header";
import Panel from "./components/Panel.jsx";
import Button from "./components/Button.jsx";
import ConnectionIndicator from "./components/ConnectionIndicator.jsx";
import BookingLanguageSelect from "./i18n/BookingLanguageSelect.jsx";
import { bookingCopy, bookingRefusalText, setBookingLanguage, useBookingLanguage } from "./i18n/booking-locale.js";
import "./host-screen.css";

const MIN_NAME_LENGTH = 3;

const Host = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const requestedInstance = searchParams.get("instance");
  const language = useBookingLanguage();
  const t = (key, variables) => bookingCopy(language, key, variables);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [instances, setInstances] = useState([]);
  const [instanceSlug, setInstanceSlug] = useState(requestedInstance || "regular");

  useEffect(() => {
    const abort = new AbortController();
    fetch("/api/admin/public/instances", { signal: abort.signal, headers: { Accept: "application/json" } })
      .then((response) => response.ok ? response.json() : null)
      .then((data) => {
        if (!Array.isArray(data?.instances)) return;
        setInstances(data.instances);
        setInstanceSlug((current) => {
          const preferred = requestedInstance || current;
          if (data.instances.some((instance) => instance.slug === preferred)) return preferred;
          return data.instances.find((instance) => instance.slug === "regular")?.slug || data.instances[0]?.slug || "regular";
        });
      })
      .catch(() => {});
    return () => abort.abort();
  }, [requestedInstance]);

  const handleCreateRoom = async (e) => {
    e?.preventDefault?.();
    setError("");
    if (name.trim().length < MIN_NAME_LENGTH) {
      setError(t("nameTooShort"));
      return;
    }
    if (!socket.connected) {
      setError(t("notConnected"));
      return;
    }
    setBusy(true);
    // the room code is the server's to hand out, never the player's
    const created = await call("room:create", { name: name.trim(), instanceSlug });
    setBusy(false);
    if (!created.ok) {
      setError(bookingRefusalText(language, { ...created, error: created.error || t("actionFailed") }));
      return;
    }
    const patternSetup = await call("room:set-patterns", {
      patterns: Object.fromEntries(OPTIONAL_PATTERNS.map(({ id }) => [id, true])),
    });
    clearSession();
    saveSession({
      roomId: created.roomId,
      role: "host",
      name: name.trim(),
      playerId: created.playerId,
      sessionToken: created.sessionToken,
    });
    navigate(`/host/room?instance=${encodeURIComponent(instanceSlug)}${patternSetup.ok ? "" : "&patterns=review"}`);
  };

  if (location.pathname !== "/host") return <Outlet />;

  return (
    <div className="flex flex-col festival-host-route" style={{ minHeight: "100vh" }}>
      <Header />
      <main id="main-content" lang={language === "hi" ? "hi" : "en"} tabIndex="-1" className="flex-1 flex items-center justify-center festival-host-screen festival-host-screen--start" style={{ padding: 20 }}>
        <Panel className="p-6 sm:p-8 festival-host-card" style={{ width: "100%", maxWidth: 480 }}>
          <div className="flex justify-end mb-4"><BookingLanguageSelect language={language} onChange={setBookingLanguage} /></div>
          <h1 className="oh-display" style={{ fontSize: 30, margin: "0 0 4px" }}>
            {t("hostOpenTitle")}
          </h1>
          <p style={{ color: "var(--oh-text-muted)", margin: "0 0 20px", fontSize: 14 }}>
            {t("hostOpenHelp")}
          </p>
          <form onSubmit={handleCreateRoom}>
            {instances.length > 1 ? (
              <label className="oh-eyebrow" htmlFor="host-instance" style={{ display: "block", marginBottom: 6 }}>
                {t("hostChooseHall")}
                <select id="host-instance" className="oh-field" value={instanceSlug} onChange={(event) => setInstanceSlug(event.target.value)} style={{ display: "block", marginTop: 6 }}>
                  {instances.map((instance) => <option key={instance.slug} value={instance.slug}>{instance.display_name}</option>)}
                </select>
              </label>
            ) : null}
            <label className="oh-eyebrow" htmlFor="host-name" style={{ display: "block", marginBottom: 6 }}>
              {t("hostName")}
            </label>
            <input
              id="host-name"
              className="oh-field"
              value={name}
              maxLength={20}
              autoComplete="off"
              placeholder={t("hostNamePlaceholder")}
              onChange={(e) => setName(e.target.value)}
            />
            <Button type="submit" variant="gold" block className="mt-4" disabled={busy}>
              {busy ? t("hostOpeningRoom") : t("hostCreateRoom")}
            </Button>
          </form>
          {error ? (
            <p role="alert" className="mt-3" style={{ color: "var(--oh-danger)", fontSize: 13 }}>
              {error}
            </p>
          ) : null}
          <div className="mt-5 flex justify-between items-center">
            <ConnectionIndicator />
            <span className="oh-eyebrow" style={{ color: "var(--oh-text-faint)" }}>{t("freeToPlay")}</span>
          </div>
        </Panel>
      </main>
    </div>
  );
};

export default Host;
