import { useEffect, useState } from "react";
import Header from "./Header.jsx";
import ThemePreview from "./admin/ThemePreview.jsx";
import "./themes-public.css";

export default function PublicThemeStore() {
  const [themes, setThemes] = useState([]);
  const [active, setActive] = useState(null);
  const [state, setState] = useState("loading");

  useEffect(() => {
    const abort = new AbortController();
    Promise.all([
      fetch("/api/public/themes", { signal: abort.signal, headers: { Accept: "application/json" }, cache: "no-store" }).then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.ok) throw new Error(data.error || "Theme library unavailable");
        return data.themes || [];
      }),
      fetch("/api/public/themes/active", { signal: abort.signal, headers: { Accept: "application/json" }, cache: "no-store" }).then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.ok) throw new Error(data.error || "Current theme unavailable");
        return data.theme;
      }),
    ]).then(([library, current]) => {
      setThemes(library);
      setActive(current);
      setState("ready");
    }).catch((error) => {
      if (error.name !== "AbortError") setState("error");
    });
    return () => abort.abort();
  }, []);

  return <div className="public-page public-theme-store">
    <Header />
    <main id="main-content" tabIndex="-1" className="public-container">
      <p className="oh-eyebrow public-kicker">Theme library · reviewed designs</p>
      <h1 className="oh-display public-title">Festival looks for game night</h1>
      <p className="public-lede">Browse the reviewed looks used by game hosts. Theme selection and changes are managed by the host for each room.</p>
      {active ? <p className="theme-store-current">Current release: <strong>{active.name}</strong> · version {active.version}</p> : null}
      {state === "loading" ? <p className="public-state" role="status">Loading reviewed themes…</p> : null}
      {state === "error" ? <p className="public-state public-error" role="alert">The theme library could not be loaded. Please try again later.</p> : null}
      {state === "ready" && themes.length === 0 ? <section className="public-empty"><h2>No reviewed themes are available</h2><p>The platform administrator has not published a theme library yet.</p></section> : null}
      <div className="public-theme-grid">{themes.map((theme) => <article key={theme.themeVersionId} className="public-theme-card">
        <ThemePreview theme={theme} />
        <div className="public-theme-card__body"><p className="oh-eyebrow">{theme.category}{theme.isActive ? " · CURRENT" : ""}</p><h2>{theme.name} <small>v{theme.version}</small></h2><p>{theme.description}</p><p className="public-theme-card__label">Host-managed room theme</p></div>
      </article>)}</div>
    </main>
    <footer className="public-footer">Free to play · No purchases or cash prizes</footer>
  </div>;
}
