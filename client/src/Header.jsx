import { useState } from "react";
import { Link } from "react-router-dom";
import { APP_LOGO, APP_MARK, APP_NAME } from "./brand.js";

/**
 * Slim brand bar for the marketing / entry screens.
 *
 * The mark is the configurable logo (VITE_APP_LOGO). A path that does not
 * resolve falls back to the gold dot instead of a broken-image icon, so a
 * mis-set branding variable is a cosmetic miss and never a ruined first screen.
 */
const Header = () => {
  const [logoFailed, setLogoFailed] = useState(false);

  return (
    <nav
      className="flex items-center justify-between"
      style={{ padding: "18px clamp(16px, 5vw, 40px)", maxWidth: 1180, marginInline: "auto", width: "100%" }}
    >
      <Link to="/" className="flex items-center gap-2" style={{ textDecoration: "none", color: "var(--oh-ivory)" }}>
        {logoFailed || !APP_LOGO ? (
          <span
            aria-hidden="true"
            style={{ width: 10, height: 10, borderRadius: "50%", background: "var(--oh-gold)", boxShadow: "0 0 12px 2px rgba(207,171,99,.55)" }}
          />
        ) : (
          <img
            src={APP_LOGO}
            alt=""
            aria-hidden="true"
            width={22}
            height={22}
            onError={() => setLogoFailed(true)}
            style={{ width: 22, height: 22, borderRadius: 6, objectFit: "contain", display: "block" }}
          />
        )}
        <span className="oh-display" style={{ fontSize: 18, letterSpacing: ".08em" }}>{APP_NAME}</span>
        <span className="oh-eyebrow" style={{ marginLeft: 6 }}>{APP_MARK}</span>
      </Link>
      <div className="flex items-center gap-4">
        <Link to="/host" style={{ color: "var(--oh-text-muted)", textDecoration: "none", fontSize: 14 }}>Host</Link>
        <Link to="/player" style={{ color: "var(--oh-text-muted)", textDecoration: "none", fontSize: 14 }}>Join</Link>
      </div>
    </nav>
  );
};

export default Header;
