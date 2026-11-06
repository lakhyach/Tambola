import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { assetUrl, usePlatformBranding } from "./platform-branding.js";
import { useBookingLanguage } from "./i18n/booking-language.js";

const HEADER_COPY = {
  en: { skip: "Skip to main content", menu: "Menu", close: "Close", navigation: "Primary navigation", instances: "Games", join: "Join" },
  hi: { skip: "मुख्य सामग्री पर जाएँ", menu: "मेनू", close: "मेनू बंद करें", navigation: "मुख्य नेविगेशन", instances: "खेल", join: "जुड़ें" },
};

/**
 * Shared public brand bar. Hall marks belong to each hall's content; the
 * navigation always carries the platform identity so the logo stays stable
 * while visitors move between halls, booking, and player entry.
 */
const Header = () => {
  const platformBrand = usePlatformBranding();
  const language = useBookingLanguage();
  const t = (key) => HEADER_COPY[language]?.[key] || HEADER_COPY.en[key];
  const [logoFailed, setLogoFailed] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => {
    if (!menuOpen) return undefined;
    const closeOnEscape = (event) => { if (event.key === "Escape") setMenuOpen(false); };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [menuOpen]);
  const logo = assetUrl(platformBrand.logo);
  const name = platformBrand.name;
  const isPlatformBrand = name === "Ninety Club";

  return (
    <header className="public-site-header">
      <a className="public-skip-link" href="#main-content">{t("skip")}</a>
      <div className="public-site-header__inner">
      <Link to="/" className="public-site-brand" onClick={() => setMenuOpen(false)} aria-label={`${name} home`}>
        {isPlatformBrand && !logoFailed ? (
          <img className="public-site-brand__lockup" src={assetUrl(platformBrand.horizontalLogo)} alt={name} width="240" height="64" onError={() => setLogoFailed(true)} />
        ) : <>
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
            width={38}
            height={38}
            onError={() => setLogoFailed(true)}
            style={{ width: 38, height: 38, objectFit: "contain", display: "block" }}
          />
        )}
        <span className="oh-display public-site-brand__name">{name}</span>
        </>}
      </Link>
      <button className="public-menu-toggle" type="button" aria-expanded={menuOpen} aria-controls="public-primary-navigation" onClick={() => setMenuOpen((open) => !open)}>
        <span aria-hidden="true">{menuOpen ? "×" : "☰"}</span><span>{menuOpen ? t("close") : t("menu")}</span>
      </button>
      <nav id="public-primary-navigation" className="public-site-nav" aria-label={t("navigation")} data-open={menuOpen ? "true" : "false"}>
        <Link to="/games" onClick={() => setMenuOpen(false)}>{t("instances")}</Link>
        <Link to="/player" onClick={() => setMenuOpen(false)}>{t("join")}</Link>
      </nav>
      </div>
    </header>
  );
};

export default Header;
