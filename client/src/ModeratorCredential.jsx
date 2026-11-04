import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import Header from "./Header.jsx";
import "./moderator-bookings.css";
import "./moderator-festival.css";

/* eslint-disable react/prop-types */

async function moderatorRequest(path, { method = "GET", body, csrfToken } = {}) {
  const response = await fetch(`/api/moderator${path}`, {
    method,
    credentials: "same-origin",
    cache: "no-store",
    headers: {
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(method !== "GET" && csrfToken ? { "X-CSRF-Token": csrfToken } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok) throw new Error(data.error || "The request could not be completed.");
  return data;
}

export default function ModeratorCredential({ kind }) {
  const location = useLocation();
  const navigate = useNavigate();
  const query = useMemo(() => new URLSearchParams(location.hash.startsWith("#") ? location.hash.slice(1) : location.search.slice(1)), [location.hash, location.search]);
  const [token, setToken] = useState(() => query.get(kind === "accept" ? "token" : "recovery") || "");
  const [csrfToken, setCsrfToken] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [complete, setComplete] = useState(false);
  const accepting = kind === "accept";

  useEffect(() => {
    if (query.has("token") || query.has("recovery") || location.hash) navigate(location.pathname, { replace: true });
    moderatorRequest("/session").then((data) => setCsrfToken(data.csrfToken || "")).catch((failure) => setError(failure.message));
  }, [location.hash, location.pathname, navigate, query]);

  async function submit(event) {
    event.preventDefault();
    setError("");
    if (!token) return setError(`This ${accepting ? "invitation" : "recovery link"} is missing its one-time token.`);
    if (password !== confirmation) return setError("The passwords do not match.");
    setBusy(true);
    try {
      await moderatorRequest(accepting ? "/invite/accept" : "/recovery/complete", {
        method: "POST",
        csrfToken,
        body: accepting ? { token, password } : { recoveryToken: token, password },
      });
      setToken("");
      setPassword("");
      setConfirmation("");
      setComplete(true);
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }

  return <div className="moderator-bookings-page"><Header /><main id="main-content" tabIndex="-1" className="moderator-bookings-shell moderator-credential-shell">
    <p className="oh-eyebrow">Moderator account security</p>
    <h1 className="oh-display">{accepting ? "Accept your invitation" : "Recover moderator access"}</h1>
    <p className="moderator-bookings-lede">{accepting
      ? "Set a password to activate your account. Your Super Admin will assign instance access separately."
      : "Choose a new password with your one-time recovery link. You’ll need to enroll an authenticator again before using instance access."}</p>
    {error ? <p className="moderator-bookings-error" role="alert">{error}</p> : null}
    {complete ? <section className="moderator-bookings-panel" role="status"><h2>{accepting ? "Invitation accepted" : "Password reset complete"}</h2><p>{accepting ? "You can now sign in. If your account has no active instance grant, contact the Super Admin." : "Sign in with your new password, then set up your authenticator before continuing."}</p><Link className="moderator-credential-link" to="/moderator/bookings">Continue to moderator sign in</Link></section> : <section className="moderator-bookings-panel">
      <h2>{accepting ? "Create password" : "Set a new password"}</h2>
      {!token ? <p role="alert">No one-time token was found. Open the complete link provided by your Super Admin.</p> : null}
      <form className="moderator-bookings-form" onSubmit={submit}>
        <label>New password<input type="password" autoComplete="new-password" minLength={12} maxLength={200} required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
        <label>Confirm password<input type="password" autoComplete="new-password" minLength={12} maxLength={200} required value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></label>
        <button disabled={busy || !token || !csrfToken}>{busy ? "Saving…" : accepting ? "Accept invitation" : "Reset password"}</button>
      </form>
    </section>}
    <p className="moderator-credential-back"><Link className="moderator-credential-link" to="/moderator/bookings">Back to moderator sign in</Link></p>
  </main></div>;
}
