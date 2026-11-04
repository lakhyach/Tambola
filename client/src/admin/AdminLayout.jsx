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
import { assetUrl, usePlatformBranding } from "../platform-branding.js";
import AdminNotifications from "./AdminNotifications.jsx";

const NAV_ICONS = {
  overview: "M3 3h8v8H3zM13 3h8v5h-8zM13 10h8v11h-8zM3 13h8v8H3z",
  instances: "M4 21V5l8-3 8 3v16M2 21h20M8 8h1m6 0h1M8 12h1m6 0h1M10 21v-5h4v5",
  reports: "M4 20V12m5 8V4m5 16v-6m5 6V8M2 21h20",
  moderators: "M16 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2m15-6a4 4 0 0 1 3 4v2M9.5 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm7-7.8a4 4 0 0 1 0 7.6",
  bookings: "M4 4h16v16H4zM8 2v4m8-4v4M4 9h16m-11 4h2m3 0h2m-7 4h2",
  themes: "M12 3v3m0 12v3M3 12h3m12 0h3M5.6 5.6l2.1 2.1m8.6 8.6 2.1 2.1m0-12.8-2.1 2.1m-8.6 8.6-2.1 2.1M12 8l1.3 2.7L16 12l-2.7 1.3L12 16l-1.3-2.7L8 12l2.7-1.3z",
  posters: "M4 4h16v16H4zM4 15l4-4 4 4 3-3 5 5M9 8h.01",
  rooms: "M3 4h18v13H3zM8 21h8m-4-4v4M7 8h3v3H7zm7 0h3v3h-3zM7 13h3v2H7zm7 0h3v2h-3z",
  players: "M16 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2m15-6a4 4 0 0 1 3 4v2M9.5 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm7-7.8a4 4 0 0 1 0 7.6",
  history: "M3 12a9 9 0 1 0 2.6-6.4L3 8m0-5v5h5m4-1v5l3 2",
  settings: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm0-6v3m0 14v3m10-10h-3M5 12H2m17.1-7.1-2.1 2.1M7 17l-2.1 2.1m14.2 0L17 17M7 7 4.9 4.9",
  branding: "M12 3a9 9 0 1 0 9 9h-9zM15 3.5V9h5.5A9 9 0 0 0 15 3.5Z",
};

// eslint-disable-next-line react/prop-types
function NavIcon({ name }) {
  return <svg className="adm-nav__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d={NAV_ICONS[name] || NAV_ICONS.overview} /></svg>;
}

export default function AdminLayout() {
  const { owner, durable, signOut, toast } = useAdmin();
  const platformBrand = usePlatformBranding();
  const navigate = useNavigate();
  const base = window.location.pathname.startsWith("/super-admin") ? "/super-admin" : "/admin";
  const consoleLabel = base === "/super-admin" ? "Platform control" : "Owner console";
  const nav = [
    { to: base, label: "Overview", end: true, icon: "overview" },
    { to: `${base}/instances`, label: "Instances", icon: "instances" },
    { to: `${base}/reports`, label: "Reports", icon: "reports" },
    { to: `${base}/moderators`, label: "Moderators", icon: "moderators" },
    { to: `${base}/sessions`, label: "Bookings", icon: "bookings" },
    { to: `${base}/themes`, label: "Themes", icon: "themes" },
    { to: `${base}/posters`, label: "Posters", icon: "posters" },
    { to: `${base}/games`, label: "Rooms", icon: "rooms" },
    { to: `${base}/players`, label: "Players", icon: "players" },
    { to: `${base}/history`, label: "History", icon: "history" },
    { to: `${base}/settings`, label: "Settings", icon: "settings" },
    { to: `${base}/branding`, label: "Branding", icon: "branding" },
  ];
  const [signingOut, setSigningOut] = useState(false);
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);

  async function handleSignOut() {
    setSigningOut(true);
    await signOut();
    toast("Signed out.", "info");
    navigate(`${base}/signin`, { replace: true });
  }

  return (
    <div className="adm-shell">
      <a className="adm-skip" href="#adm-content">
        Skip to content
      </a>

      <aside className="adm-sidebar">
        <div className="adm-brand-row">
          <Link to={base} className="adm-brand">
            <img className="adm-brand__mark" src={assetUrl(platformBrand.logo)} alt="" width="34" height="34" />
            <span className="adm-brand__text">
              <span className="oh-display adm-brand__name">{platformBrand.name}</span>
              <span className="oh-eyebrow">{consoleLabel}</span>
            </span>
          </Link>
          <Badge tone={durable ? "gold" : "muted"}>{durable ? "Durable" : "Memory"}</Badge>
        </div>

        <Button
          className="adm-nav-toggle"
          variant="ghost"
          size="sm"
          aria-controls="adm-navigation"
          aria-expanded={mobileNavigationOpen}
          onClick={() => setMobileNavigationOpen((open) => !open)}
        >
          {mobileNavigationOpen ? "Close menu" : "Menu"}
        </Button>

        <nav
          className="adm-nav"
          id="adm-navigation"
          aria-label="Control centre sections"
          data-open={mobileNavigationOpen}
          onKeyDown={(event) => {
            if (event.key === "Escape" && mobileNavigationOpen) {
              setMobileNavigationOpen(false);
              event.currentTarget.closest(".adm-sidebar")?.querySelector(".adm-nav-toggle")?.focus();
            }
          }}
        >
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={Boolean(item.end)}
              onClick={() => setMobileNavigationOpen(false)}
            >
              <NavIcon name={item.icon} />
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

      <main className="adm-main" id="adm-content" tabIndex="-1">
        {durable ? <AdminNotifications base={base} /> : null}
        <Outlet />
      </main>
    </div>
  );
}
