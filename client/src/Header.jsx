import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { assetUrl, usePlatformBranding } from "./platform-branding.js";
import { useBookingLanguage } from "./i18n/booking-language.js";

const HEADER_COPY = {
  en: { skip: "Skip to main content", menu: "Menu", close: "Close", navigation: "Primary navigation", instances: "Instances", themes: "Themes", host: "Host", join: "Join" },
  hi: { skip: "मुख्य सामग्री पर जाएँ", menu: "मेनू", close: "मेनू बंद करें", navigation: "मुख्य नेविगेशन", instances: "इंस्टेंस", themes: "थीम", host: "होस्ट", join: "जुड़ें" },
};

/**
 * Slim brand bar for the marketing / entry screens.
 *
 * The mark follows the active instance identity when present and otherwise
 * uses the owner-managed platform mark. A failed image falls back to the dot.
 */
const Header = () => {
  const location = useLocation();
  const platformBrand = usePlatformBranding();
  const language = useBookingLanguage();
  const t = (key) => HEADER_COPY[language]?.[key] || HEADER_COPY.en[key];
  const [logoFailed, setLogoFailed] = useState(false);
  const [instanceBrand, setInstanceBrand] = useState({ active: false, name: "", logoUrl: "" });
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => {
    const update = (event) => { setInstanceBrand(event.detail || { active: false, name: "", logoUrl: "" }); setLogoFailed(false); };
    document.addEventListener("instance-branding-change", update);
    return () => document.removeEventListener("instance-branding-change", update);
  }, []);
  useEffect(() => {
    if (!menuOpen) return undefined;
    const closeOnEscape = (event) => { if (event.key === "Escape") setMenuOpen(false); };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [menuOpen]);
  const logo = instanceBrand.active ? instanceBrand.logoUrl : assetUrl(platformBrand.logo);
  const name = instanceBrand.active ? instanceBrand.name : platformBrand.name;
  const isPlayerFlow = location.pathname === "/player" || location.pathname.startsWith("/player/");

  return (
    <header className="public-site-header">
      <a className="public-skip-link" href="#main-content">{t("skip")}</a>
      <div className="public-site-header__inner">
      <Link to="/" className="public-site-brand" onClick={() => setMenuOpen(false)}>
        {logoFailed || !logo ? (
          <span
            aria-hidden="true"
            style={{ width: 10, height: 10, borderRadius: "50%", background: "var(--oh-gold)", boxShadow: "0 0 12px 2px rgba(207,171,99,.55)" }}
          />
        ) : (
          <img
            src={logo}
            alt=""
            aria-hidden="true"
            width={22}
            height={22}
            onError={() => setLogoFailed(true)}
            style={{ width: 22, height: 22, borderRadius: 6, objectFit: "contain", display: "block" }}
          />
        )}
        <span className="oh-display public-site-brand__name">{name}</span>
        <span className="oh-eyebrow public-site-brand__mark">{platformBrand.mark}</span>
      </Link>
      <button className="public-menu-toggle" type="button" aria-expanded={menuOpen} aria-controls="public-primary-navigation" onClick={() => setMenuOpen((open) => !open)}>
        <span aria-hidden="true">{menuOpen ? "×" : "☰"}</span><span>{menuOpen ? t("close") : t("menu")}</span>
      </button>
      <nav id="public-primary-navigation" className="public-site-nav" aria-label={t("navigation")} data-open={menuOpen ? "true" : "false"}>
        <Link to="/games" onClick={() => setMenuOpen(false)}>{t("instances")}</Link>
        {!isPlayerFlow ? <Link to="/themes" onClick={() => setMenuOpen(false)}>{t("themes")}</Link> : null}
        <Link to="/host" onClick={() => setMenuOpen(false)}>{t("host")}</Link>
        <Link to="/player" onClick={() => setMenuOpen(false)}>{t("join")}</Link>
      </nav>
      </div>
    </header>
  );
};

export default Header;
