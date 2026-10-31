import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import App from "./App.jsx";
import Host from "./Host.jsx";
import HostRoom from "./HostRoom.jsx";
import HostGame from "./HostGame.jsx";
import Player from "./Player.jsx";
import PlayerRoom from "./PlayerRoom.jsx";
import PlayerGame from "./PlayerGame.jsx";
import { AdminRoot } from "./admin/AdminProvider.jsx";
import AdminSignIn from "./admin/AdminSignIn.jsx";
import AdminGate from "./admin/AdminGate.jsx";
import AdminLayout from "./admin/AdminLayout.jsx";
import AdminOverview from "./admin/AdminOverview.jsx";
import AdminGames from "./admin/AdminGames.jsx";
import AdminGameDetail from "./admin/AdminGameDetail.jsx";
import AdminPlayers from "./admin/AdminPlayers.jsx";
import AdminHistory from "./admin/AdminHistory.jsx";
import AdminSettings from "./admin/AdminSettings.jsx";
import "./index.css";
import "./components.css";
import "./admin/admin.css";
import { applyTheme } from "./config.js";
import { APP_NAME, APP_SUBTITLE } from "./brand.js";

// Apply the client brand theme (accent colours) once, before first paint, so a
// re-brand via VITE_* vars needs no CSS rebuild. See config.js.
applyTheme();

// The static shell in index.html cannot read build-time config, so the browser
// tab and any shared preview take the configured product name here.
document.title = APP_NAME;
const metaDescription = document.querySelector('meta[name="description"]');
if (metaDescription) metaDescription.setAttribute("content", APP_SUBTITLE);

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <Router>
      <Routes>
        <Route path="/" element={<App />} />
        <Route path="/host" element={<Host />}>
          <Route path="room" element={<HostRoom />} />
          <Route path="game" element={<HostGame />} />
        </Route>
        <Route path="/player" element={<Player />}>
          <Route path="room" element={<PlayerRoom />} />
          <Route path="game" element={<PlayerGame />} />
        </Route>
        <Route path="/admin" element={<AdminRoot />}>
          <Route path="signin" element={<AdminSignIn />} />
          <Route
            element={
              <AdminGate>
                <AdminLayout />
              </AdminGate>
            }
          >
            <Route index element={<AdminOverview />} />
            <Route path="games" element={<AdminGames />} />
            <Route path="games/:roomId" element={<AdminGameDetail />} />
            <Route path="players" element={<AdminPlayers />} />
            <Route path="history" element={<AdminHistory />} />
            <Route path="settings" element={<AdminSettings />} />
          </Route>
        </Route>
      </Routes>
    </Router>
  </React.StrictMode>
);
