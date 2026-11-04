import React, { Suspense, useLayoutEffect, useMemo, useRef } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter as Router, Routes, Route, useLocation } from "react-router-dom";
import App from "./App.jsx";
import ThemeRuntime from "./ThemeRuntime.jsx";
import "./index.css";
import "./components.css";
import "./gameplay-festival.css";
import "./public-site.css";
import "./theme-atmosphere.css";
import { applyTheme } from "./config.js";
import { assetUrl, usePlatformBranding, applyPlatformBranding, loadPlatformBranding } from "./platform-branding.js";

// This counter lives for the document's lifetime so a lazy-route focus effect
// can detect keyboard/pointer input that happens while React is waiting for a
// route chunk to resolve.
let routeInteractionCount = 0;
let routeNavigationSnapshot = null;
if (typeof document !== "undefined") {
  const recordRouteInteraction = () => { routeInteractionCount += 1; };
  const recordRouteNavigation = () => {
    routeNavigationSnapshot = {
      pathname: window.location.pathname,
      interactionCount: routeInteractionCount,
      activeElement: document.activeElement,
    };
  };
  document.addEventListener("keydown", recordRouteInteraction, true);
  document.addEventListener("pointerdown", recordRouteInteraction, true);
  for (const method of ["pushState", "replaceState"]) {
    const original = window.history[method];
    window.history[method] = function (...args) {
      const result = original.apply(this, args);
      recordRouteNavigation();
      return result;
    };
  }
  window.addEventListener("popstate", recordRouteNavigation);
  window.addEventListener("hashchange", recordRouteNavigation);
}

// Route modules are loaded only when the visitor opens that experience. The
// base entry bundle therefore does not carry the game, owner console and
// moderator workspace payloads for every visitor.
/* eslint-disable react-refresh/only-export-components */
const Host = React.lazy(() => import("./Host.jsx"));
const HostRoom = React.lazy(() => import("./HostRoom.jsx"));
const HostGame = React.lazy(() => import("./HostGame.jsx"));
const Player = React.lazy(() => import("./Player.jsx"));
const PlayerRoom = React.lazy(() => import("./PlayerRoom.jsx"));
const PlayerGame = React.lazy(() => import("./PlayerGame.jsx"));
const AdminRoot = React.lazy(() => import("./admin/AdminProvider.jsx").then((module) => ({ default: module.AdminRoot })));
const AdminSignIn = React.lazy(() => import("./admin/AdminSignIn.jsx"));
const AdminGate = React.lazy(() => import("./admin/AdminGate.jsx"));
const AdminLayout = React.lazy(() => import("./admin/AdminLayout.jsx"));
const AdminOverview = React.lazy(() => import("./admin/AdminOverview.jsx"));
const AdminGames = React.lazy(() => import("./admin/AdminGames.jsx"));
const AdminGameDetail = React.lazy(() => import("./admin/AdminGameDetail.jsx"));
const AdminPlayers = React.lazy(() => import("./admin/AdminPlayers.jsx"));
const AdminHistory = React.lazy(() => import("./admin/AdminHistory.jsx"));
const AdminSettings = React.lazy(() => import("./admin/AdminSettings.jsx"));
const AdminBranding = React.lazy(() => import("./admin/AdminBranding.jsx"));
const AdminInstances = React.lazy(() => import("./admin/AdminInstances.jsx"));
const AdminReports = React.lazy(() => import("./admin/AdminReports.jsx"));
const AdminSessions = React.lazy(() => import("./admin/AdminSessions.jsx"));
const AdminThemes = React.lazy(() => import("./admin/AdminThemes.jsx"));
const AdminPosters = React.lazy(() => import("./admin/AdminPosters.jsx"));
const AdminModerators = React.lazy(() => import("./admin/AdminModerators.jsx"));
const AdminInstanceDetail = React.lazy(() => import("./admin/AdminInstanceDetail.jsx"));
const PublicInstances = React.lazy(() => import("./PublicInstances.jsx"));
const PublicInstance = React.lazy(() => import("./PublicInstance.jsx"));
const PublicSessions = React.lazy(() => import("./PublicSessions.jsx"));
const PublicBooking = React.lazy(() => import("./PublicBooking.jsx"));
const PublicThemeStore = React.lazy(() => import("./PublicThemeStore.jsx"));
const PublicPoster = React.lazy(() => import("./PublicPoster.jsx"));
const ModeratorBookings = React.lazy(() => import("./ModeratorBookings.jsx"));
const ModeratorCredential = React.lazy(() => import("./ModeratorCredential.jsx"));
const VoiceAudition = import.meta.env.DEV ? React.lazy(() => import("./components/internal/VoiceAudition.jsx")) : null;
/* eslint-enable react-refresh/only-export-components */

// Apply the client brand theme before first paint. Runtime identity remains
// public and small; each actual product workspace is fetched on route entry.
applyTheme();
applyPlatformBranding();
loadPlatformBranding();

// eslint-disable-next-line react-refresh/only-export-components
function RouteLoading() {
  const brand = usePlatformBranding();
  return <main className="route-loading" role="status" aria-live="polite" tabIndex="-1"><img src={assetUrl(brand.logo)} alt="" aria-hidden="true" style={{width:80,maxWidth:"30vw",marginBottom:12}} /><strong>{brand.name}</strong><span>Preparing your celebration...</span></main>;
}

// eslint-disable-next-line react-refresh/only-export-components
function RouteFocusManager() {
  const { pathname } = useLocation();
  const previousPath = useRef(pathname);
  const navigation = useMemo(() => routeNavigationSnapshot?.pathname === pathname
    ? routeNavigationSnapshot
    : { pathname, interactionCount: routeInteractionCount, activeElement: document.activeElement }, [pathname]);

  useLayoutEffect(() => {
    if (previousPath.current === pathname) return undefined;
    previousPath.current = pathname;

    // The booking page owns focus during same-component session changes so it
    // can focus its stable main landmark while session data reloads.
    if (/^\/sessions\//.test(pathname)) return undefined;

    let frame = 0;
    let timeout = 0;
    const root = document.getElementById("root");
    const userMovedFocus = () => {
      const active = document.activeElement;
      return routeInteractionCount !== navigation.interactionCount
        || (active !== document.body && active !== document.documentElement && active !== navigation.activeElement);
    };
    const focusHeading = () => {
      const heading = [...document.querySelectorAll("main:not(.route-loading) h1")]
        .find((candidate) => candidate.textContent.trim());
      if (!heading) return false;
      const main = heading.closest("main");
      const active = document.activeElement;
      // Suspense can commit the lazy route after the visitor has already tabbed
      // into one of its controls. In that case the destination is already
      // focused; moving back to its heading would interrupt keyboard use.
      if (active !== heading && active !== main && main?.contains(active)) return true;
      if (!heading.hasAttribute("tabindex")) heading.setAttribute("tabindex", "-1");
      heading.focus({ preventScroll: true });
      return true;
    };
    const observer = new MutationObserver(() => {
      // A lazy route may still be loading when its URL changes. If the visitor
      // has already tabbed into the newly rendered page, don't steal focus back
      // to the heading when a later subtree update happens to wake this observer.
      if (userMovedFocus()) {
        observer.disconnect();
        window.clearTimeout(timeout);
        return;
      }
      if (focusHeading()) {
        observer.disconnect();
        window.clearTimeout(timeout);
      }
    });

    frame = window.requestAnimationFrame(() => {
      if (!userMovedFocus() && focusHeading()) return;
      if (userMovedFocus()) return;
      if (!root) return;
      observer.observe(root, { childList: true, subtree: true, characterData: true });
      timeout = window.setTimeout(() => observer.disconnect(), 5000);
    });

    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timeout);
      observer.disconnect();
    };
  }, [pathname, navigation]);

  return null;
}

const ownerRoutes = <>
  <Route path="signin" element={<AdminSignIn />} />
  <Route element={<AdminGate><AdminLayout /></AdminGate>}>
    <Route index element={<AdminOverview />} />
    <Route path="instances" element={<AdminInstances />} />
    <Route path="instances/:instanceId" element={<AdminInstanceDetail />} />
    <Route path="reports" element={<AdminReports />} />
    <Route path="moderators" element={<AdminModerators />} />
    <Route path="sessions" element={<AdminSessions />} />
    <Route path="themes" element={<AdminThemes />} />
    <Route path="posters" element={<AdminPosters />} />
    <Route path="games" element={<AdminGames />} />
    <Route path="games/:roomId" element={<AdminGameDetail />} />
    <Route path="players" element={<AdminPlayers />} />
    <Route path="history" element={<AdminHistory />} />
    <Route path="settings" element={<AdminSettings />} />
    <Route path="branding" element={<AdminBranding />} />
  </Route>
</>;

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <Router>
      <ThemeRuntime />
      <RouteFocusManager />
      <Suspense fallback={<RouteLoading />}>
        <Routes>
          {import.meta.env.DEV ? <Route path="/__internal/voice-audition" element={<VoiceAudition />} /> : null}
          <Route path="/" element={<App />} />
          <Route path="/games" element={<PublicInstances />} />
          <Route path="/themes" element={<PublicThemeStore />} />
          <Route path="/poster/:posterId" element={<PublicPoster />} />
          <Route path="/games/:slug" element={<PublicInstance />} />
          <Route path="/games/:slug/sessions" element={<PublicSessions />} />
          <Route path="/sessions/:sessionId" element={<PublicBooking />} />
          <Route path="/moderator/bookings" element={<ModeratorBookings />} />
          <Route path="/moderator/accept" element={<ModeratorCredential kind="accept" />} />
          <Route path="/moderator/recovery" element={<ModeratorCredential kind="recovery" />} />
          <Route path="/host" element={<Host />}>
            <Route path="room" element={<HostRoom />} />
            <Route path="game" element={<HostGame />} />
          </Route>
          <Route path="/player" element={<Player />}>
            <Route path="room" element={<PlayerRoom />} />
            <Route path="game" element={<PlayerGame />} />
          </Route>
          <Route path="/admin" element={<AdminRoot />}>
            {ownerRoutes}
          </Route>
          <Route path="/super-admin" element={<AdminRoot />}>
            {ownerRoutes}
          </Route>
        </Routes>
      </Suspense>
    </Router>
  </React.StrictMode>
);
