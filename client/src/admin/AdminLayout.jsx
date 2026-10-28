/**
 * The control-centre shell: persistent section navigation, the signed-in owner
 * and sign-out. Everything inside the protected area renders through the
 * outlet, so each page owns only its own content.
 */
import { useState } from "react";
import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import Button from "../components/Button.jsx";
import { useAdmin } from "./useAdmin.js";
import { Badge } from "./ui.jsx";

const NAV = [
  { to: "/admin", label: "Overview", end: true },
  { to: "/admin/games", label: "Games" },
  { to: "/admin/players", label: "Players" },
  { to: "/admin/history", label: "History" },
  { to: "/admin/settings", label: "Settings" },
];

export default function AdminLayout() {
  const { owner, durable, signOut, toast } = useAdmin();
  const navigate = useNavigate();
  const [signingOut, setSigningOut] = useState(false);

  async function handleSignOut() {
    setSigningOut(true);
    await signOut();
    toast("Signed out.", "info");
    navigate("/admin/signin", { replace: true });
  }

  return (
    <div className="adm-shell">
      <a className="adm-skip" href="#adm-content">
        Skip to content
      </a>

      <aside className="adm-sidebar">
        <div className="adm-brand-row">
          <Link to="/admin" className="adm-brand">
            <span className="adm-brand__dot" aria-hidden="true" />
            <span className="adm-brand__text">
              <span className="oh-display adm-brand__name">Tambola</span>
              <span className="oh-eyebrow">Control Centre</span>
            </span>
          </Link>
          <Badge tone={durable ? "gold" : "muted"}>{durable ? "Durable" : "Memory"}</Badge>
        </div>

        <nav className="adm-nav" aria-label="Control centre sections">
          {NAV.map((item) => (
            <NavLink key={item.to} to={item.to} end={Boolean(item.end)}>
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="adm-sidebar__foot">
          <div className="adm-session">
            <span className="oh-eyebrow">Signed in</span>
            <span className="adm-session__name">{owner ? owner.username : "owner"}</span>
          </div>
          <Button variant="ghost" size="sm" block onClick={handleSignOut} disabled={signingOut}>
            {signingOut ? "Signing out…" : "Sign out"}
          </Button>
        </div>
      </aside>

      <main className="adm-main" id="adm-content">
        <Outlet />
      </main>
    </div>
  );
}
