import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Header from "./Header.jsx";
import { APP_NAME } from "./brand.js";
import { instanceBrandingStyles, safeInstanceLogo } from "./theme-runtime.js";

async function loadInstances(signal) {
  const response = await fetch("/api/admin/public/instances", { signal, headers: { Accept: "application/json" } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok || !Array.isArray(data.instances)) {
    throw new Error(data.error || "The public game directory is unavailable right now.");
  }
  return data.instances;
}

export default function PublicInstances() {
  const [instances, setInstances] = useState([]);
  const [state, setState] = useState("loading");

  useEffect(() => {
    const abort = new AbortController();
    loadInstances(abort.signal).then((rows) => {
      setInstances(rows);
      setState("ready");
    }).catch((error) => {
      if (error.name !== "AbortError") setState("error");
    });
    return () => abort.abort();
  }, []);

  return (
    <div className="public-page">
      <Header />
      <main id="main-content" tabIndex="-1" className="public-container">
        <section className="public-hero" aria-labelledby="games-title">
          <div className="public-hero__copy">
            <p className="oh-eyebrow public-kicker"><span className="public-kicker__spark" aria-hidden="true" /> Play by instance</p>
            <h1 id="games-title" className="oh-display public-title">Choose your game hall</h1>
            <p className="public-lede">Each hall has its own rooms and game history. To join a live room, use the code shared by its host.</p>
          </div>
          <div className="public-hero__art" aria-hidden="true">
            <div className="public-hero__ticket">
              <span className="public-hero__ticket-label">TAMBOLA</span>
              <div className="public-hero__ticket-grid">{[7, 14, 22, 31, 39, 46, 54, 63, 71, 80, 88, 90].map((number, index) => <span className={index % 4 === 1 ? "is-marked" : ""} key={number}>{number}</span>)}</div>
              <span className="public-hero__ticket-note">ONE MORE ROUND</span>
            </div>
            <span className="public-hero__ball public-hero__ball--one">90</span>
            <span className="public-hero__ball public-hero__ball--two">7</span>
            <span className="public-hero__orbit" />
          </div>
        </section>

        {state === "loading" ? <p className="public-state" role="status">Loading active game halls…</p> : null}
        {state === "error" ? <p className="public-state public-error" role="alert">The game directory could not be loaded. Please try again in a moment.</p> : null}
        {state === "ready" && instances.length === 0 ? (
          <section className="public-empty" aria-live="polite">
            <h2>No public game halls are available</h2>
            <p>{APP_NAME} will show a hall here when its owner makes it public and active.</p>
          </section>
        ) : null}

        {state === "ready" && instances.length > 0 ? (
          <section className="public-discovery" aria-label="Available game halls">
          <div className="public-discovery__heading"><p className="oh-eyebrow">Find your people</p><span>{instances.length} {instances.length === 1 ? "hall" : "halls"} open</span></div>
          <div className="instance-grid">
            {instances.map((instance) => (
              <article className="instance-card" key={instance.slug} style={instanceBrandingStyles(instance.branding)}>
                <div className="instance-card__mark" aria-hidden="true">{safeInstanceLogo(instance.branding?.logo) ? <img src={safeInstanceLogo(instance.branding.logo)} alt="" /> : "90"}</div>
                <div className="instance-card__body">
                  <p className="oh-eyebrow">{instance.branding?.tagline || "Game instance"}</p>
                  <h2>{instance.display_name}</h2>
                  <p>{instance.description || "A free-to-play Tambola game hall."}</p>
                  <Link className="public-link-button public-link-button--primary" to={`/games/${encodeURIComponent(instance.slug)}`}>
                    View hall <span aria-hidden="true">→</span>
                  </Link>
                </div>
              </article>
            ))}
          </div>
          </section>
        ) : null}
      </main>
      <footer className="public-footer">Free to play · No purchases or cash prizes</footer>
    </div>
  );
}
