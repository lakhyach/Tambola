/**
 * Owner sign-in.
 *
 * There is no registration path here. When no owner account exists the screen
 * says so and points at the documented server-side bootstrap command; it never
 * offers to create the first account from the browser.
 *
 * Two steps, because the server may stop the first one short:
 *   1. username + password. Without a second factor this returns a session.
 *   2. with a second factor enrolled it returns ONLY a short-lived challenge,
 *      and this screen asks for the authenticator code. The challenge is spent
 *      whichever way the code check goes, so a wrong code sends the owner back to
 *      step one rather than allowing an unlimited guess against one token.
 *
 * The password is never kept after a step transition, and the challenge token
 * lives only in this component's state: reloading the page starts over.
 */
import { useRef, useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import Button from "../components/Button.jsx";
import { api } from "./api.js";
import { useAdmin } from "./useAdmin.js";
import { Banner, Boot, ErrorNote, Field } from "./ui.jsx";

function refusalMessage(error) {
  const code = error && error.code;
  if (code === "INVALID_CREDENTIALS") return "That username and password did not match.";
  if (code === "INVALID_INPUT") return "Enter your username and a password of at least 8 characters.";
  if (code === "OWNER_NOT_CONFIGURED") {
    return "No owner account exists yet. Create one on the server with: npm run owner:create";
  }
  if (code === "MFA_INVALID_CODE") return "That code is not valid right now. Check the device and start again.";
  if (code === "MFA_REPLAY") return "That code has already been used. Wait for a new one and start again.";
  if (code === "MFA_CHALLENGE_INVALID" || code === "MFA_CHALLENGE_USED" || code === "MFA_CHALLENGE_EXPIRED" || code === "MFA_CHALLENGE_LOCKED") {
    return "This sign-in attempt has expired. Enter your password again.";
  }
  if (code === "MFA_UNAVAILABLE") {
    return "This account needs a second factor, but the server has no OWNER_MFA_KEY configured. See server/RUNBOOK.md.";
  }
  if (code === "RATE_LIMITED") {
    const seconds = Math.ceil(Number(error.payload && error.payload.retryAfterMs) / 1000);
    const wait = Number.isFinite(seconds) && seconds > 0 ? ` Try again in about ${Math.ceil(seconds / 60)} minute(s).` : " Try again later.";
    return `Too many sign-in attempts.${wait}`;
  }
  if (code === "ADMIN_UNAVAILABLE") return "The control centre cannot reach its database right now.";
  if (code === "NETWORK") return "The server could not be reached. Check the connection and try again.";
  return (error && error.message) || "Sign-in failed.";
}

export default function AdminSignIn() {
  const { status, setupRequired, mfa, error: bootError, signIn, reloadSession } = useAdmin();
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState(null);
  const [checking, setChecking] = useState(false);
  const [challenge, setChallenge] = useState(null);
  const [code, setCode] = useState("");
  const codeRef = useRef(null);

  const remembered = location.state && typeof location.state.from === "string" ? location.state.from : null;
  const destination = remembered && remembered.startsWith("/admin") && remembered !== "/admin/signin" ? remembered : "/admin";

  if (status === "loading") return <Boot label="Checking the session…" />;
  if (status === "authenticated") return <Navigate to={destination} replace />;

  async function handleSubmit(event) {
    event.preventDefault();
    if (busy) return;
    setFailure(null);
    setBusy(true);
    try {
      const result = await signIn(username.trim(), password);
      if (result && result.mfaRequired) {
        // No session exists yet: drop the password and ask for the code.
        setPassword("");
        setChallenge({ token: result.challengeToken, expiresAt: result.expiresAt });
        window.setTimeout(() => codeRef.current && codeRef.current.focus(), 0);
        return;
      }
      navigate(destination, { replace: true });
    } catch (error) {
      setFailure(error);
    } finally {
      setBusy(false);
    }
  }

  async function handleCodeSubmit(event) {
    event.preventDefault();
    if (busy || !challenge) return;
    setFailure(null);
    setBusy(true);
    try {
      await api.signInMfa(challenge.token, code.trim());
      // The cookie is set by the step above; re-read the session so the provider
      // picks up the owner and the storage mode together.
      await reloadSession();
      navigate(destination, { replace: true });
    } catch (error) {
      // The challenge is consumed by any answer, so step one starts over.
      setChallenge(null);
      setCode("");
      setFailure(error);
    } finally {
      setBusy(false);
    }
  }

  async function handleRecheck() {
    setChecking(true);
    setFailure(null);
    await reloadSession();
    setChecking(false);
  }

  function cancelChallenge() {
    setChallenge(null);
    setCode("");
    setFailure(null);
  }

  return (
    <div className="adm-signin">
      <div className="adm-signin__panel oh-panel">
        <div className="adm-signin__brand">
          <span className="adm-brand__dot" aria-hidden="true" />
          <span>
            <span className="oh-display adm-brand__name">Tambola</span>
            <span className="oh-eyebrow adm-signin__eyebrow">Owner control centre</span>
          </span>
        </div>

        <hr className="oh-rule" />

        <h1 className="oh-display adm-signin__title">{challenge ? "Confirm it is you" : "Sign in"}</h1>
        <p className="adm-signin__lede">
          This area is restricted to the owner of this game server. Host and player sessions cannot open it.
        </p>

        {setupRequired && !challenge ? (
          <Banner tone="warn" title="No owner account yet">
            An owner account can only be created on the server. Run <code className="adm-code">npm run owner:create</code>{" "}
            with <code className="adm-code">OWNER_USERNAME</code> and <code className="adm-code">OWNER_PASSWORD</code> set,
            then check again.
            <div className="adm-actions adm-actions--tight">
              <Button variant="ghost" size="sm" onClick={handleRecheck} disabled={checking}>
                {checking ? "Checking…" : "Check again"}
              </Button>
            </div>
          </Banner>
        ) : null}

        {bootError ? <ErrorNote title="The control centre is unavailable" error={bootError} /> : null}
        {failure ? <ErrorNote title={challenge ? "The code was not accepted" : "Sign-in refused"} error={refusalMessage(failure)} /> : null}

        {challenge ? (
          <form className="adm-form" onSubmit={handleCodeSubmit} noValidate>
            <Field label="Authenticator code" htmlFor="adm-mfa-code" hint="Six digits from your authenticator app.">
              <input
                ref={codeRef}
                id="adm-mfa-code"
                className="oh-field adm-mfa-code"
                name="code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9 ]*"
                maxLength={8}
                required
                value={code}
                onChange={(event) => setCode(event.target.value)}
                disabled={busy}
              />
            </Field>
            <Button type="submit" variant="gold" block disabled={busy || code.replace(/\D/g, "").length !== 6}>
              {busy ? "Checking…" : "Verify and sign in"}
            </Button>
            <Button type="button" variant="ghost" block onClick={cancelChallenge} disabled={busy}>
              Use a different password
            </Button>
          </form>
        ) : (
          <form className="adm-form" onSubmit={handleSubmit} noValidate>
            <Field label="Username" htmlFor="adm-username">
              <input
                id="adm-username"
                className="oh-field"
                name="username"
                type="text"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck="false"
                maxLength={40}
                required
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                disabled={busy}
              />
            </Field>

            <Field label="Password" htmlFor="adm-password">
              <input
                id="adm-password"
                className="oh-field"
                name="password"
                type="password"
                autoComplete="current-password"
                minLength={8}
                maxLength={200}
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                disabled={busy}
              />
            </Field>

            <Button type="submit" variant="gold" block disabled={busy}>
              {busy ? "Signing in…" : "Sign in"}
            </Button>
          </form>
        )}

        {mfa && mfa.state === "unavailable" && !challenge ? (
          <p className="adm-signin__note">
            Two-factor protection is not configured on this server. Set <code className="adm-code adm-code--inline">OWNER_MFA_KEY</code>{" "}
            to enable it under Settings.
          </p>
        ) : null}

        <p className="adm-signin__note">
          Sessions expire after a period of inactivity. If you have lost the password, reset it on the server with{" "}
          <code className="adm-code">npm run owner:reset</code>. If you have lost the authenticator, use{" "}
          <code className="adm-code">npm run owner:mfa-reset</code>.
        </p>

        <Link to="/" className="adm-signin__back">
          Back to the game
        </Link>
      </div>
    </div>
  );
}
