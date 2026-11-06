import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import Header from "./Header.jsx";
import PublicBack from "./components/PublicBack.jsx";
import { instanceBrandingStyles, safeInstanceLogo } from "./theme-runtime.js";

export default function PublicInstance() {
  const { slug = "" } = useParams();
  const [instance, setInstance] = useState(null);
  const [state, setState] = useState("loading");

  useEffect(() => {
    const abort = new AbortController();
    fetch(`/api/admin/public/instances/${encodeURIComponent(slug)}`, {
      signal: abort.signal,
      headers: { Accept: "application/json" },
    }).then(async (response) => {
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok || !data.instance) throw new Error("This game hall is unavailable.");
      return data.instance;
    }).then((row) => {
      setInstance(row);
      setState("ready");
    }).catch((error) => {
      if (error.name !== "AbortError") setState("error");
    });
    return () => abort.abort();
  }, [slug]);

  return (
    <div className="public-page">
      <Header />
      <main id="main-content" tabIndex="-1" className="public-container public-instance">
        <PublicBack to="/games">← All game halls</PublicBack>
        {state === "loading" ? <p className="public-state" role="status">Loading game hall…</p> : null}
        {state === "error" ? (
          <section className="public-empty" role="alert">
            <p className="oh-eyebrow">Unavailable</p>
            <h1>This game hall is not available</h1>
            <p>It may be private, paused, or archived.</p>
          </section>
        ) : null}
        {state === "ready" && instance ? (
          <section className="instance-feature" style={instanceBrandingStyles(instance.branding)}>
            <div className="instance-feature__art" aria-hidden="true">
              <div className="instance-number-grid">{Array.from({ length: 90 }, (_, i) => <span key={i}>{i + 1}</span>)}</div>
              <div className="instance-feature__orb">90</div>
            </div>
            <div className="instance-feature__copy">
              {safeInstanceLogo(instance.branding?.logo) ? <img className="instance-feature__logo" src={safeInstanceLogo(instance.branding.logo)} alt={`${instance.display_name} logo`} /> : null}
              <h1 className="oh-display">{instance.display_name}</h1>
              <p className="public-lede">{instance.description || "Join a host’s room and play live Tambola with friends."}</p>
              <ul className="instance-points">
                <li>Server-run 1–90 calls</li>
                <li>Your tickets and marks return when you reconnect</li>
                <li>Winners are decided by the game server</li>
              </ul>
              <div className="instance-feature__actions">
                <Link className="public-link-button public-link-button--primary" to={`/player?instance=${encodeURIComponent(instance.slug)}`}>
                  Join with a room code
                </Link>
                <Link className="public-link-button" to={`/games/${encodeURIComponent(instance.slug)}/sessions`}>
                  Browse scheduled sessions
                </Link>
              </div>
              <p className="instance-help">Ask your host for the room code. This hall does not publish private room codes.</p>
            </div>
          </section>
        ) : null}
      </main>
      <footer className="public-footer">Free to play · No purchases or cash prizes</footer>
    </div>
  );
}
