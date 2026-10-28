import { Link } from "react-router-dom";
import { APP_NAME } from "./brand.js";

/** Slim brand bar for the marketing / entry screens. */
const Header = () => (
  <nav
    className="flex items-center justify-between"
    style={{ padding: "18px clamp(16px, 5vw, 40px)", maxWidth: 1180, marginInline: "auto", width: "100%" }}
  >
    <Link to="/" className="flex items-center gap-2" style={{ textDecoration: "none", color: "var(--oh-ivory)" }}>
      <span
        aria-hidden="true"
        style={{ width: 10, height: 10, borderRadius: "50%", background: "var(--oh-gold)", boxShadow: "0 0 12px 2px rgba(207,171,99,.55)" }}
      />
      <span className="oh-display" style={{ fontSize: 18, letterSpacing: ".08em" }}>{APP_NAME}</span>
      <span className="oh-eyebrow" style={{ marginLeft: 6 }}>Obsidian Hall</span>
    </Link>
    <div className="flex items-center gap-4">
      <Link to="/host" style={{ color: "var(--oh-text-muted)", textDecoration: "none", fontSize: 14 }}>Host</Link>
      <Link to="/player" style={{ color: "var(--oh-text-muted)", textDecoration: "none", fontSize: 14 }}>Join</Link>
    </div>
  </nav>
);

export default Header;
