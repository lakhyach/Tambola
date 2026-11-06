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
import { assetUrl, usePlatformBranding } from "../platform-branding.js";

function refusalMessage(error) {
  const code = error && error.code;
  if (code === "INVALID_CREDENTIALS") return "That username and password did not match.";
  if (code === "INVALID_INPUT") return "Enter your username and a password of at least 8 characters.";
  if (code === "OWNER_NOT_CONFIGURED") {
    return "Owner sign-in is not available right now. Please contact platform support.";
  }
  if (code === "MFA_INVALID_CODE") return "That code is not valid right now. Check the device and start again.";
  if (code === "MFA_REPLAY") return "That code has already been used. Wait for a new one and start again.";
  if (code === "MFA_CHALLENGE_INVALID" || code === "MFA_CHALLENGE_USED" || code === "MFA_CHALLENGE_EXPIRED" || code === "MFA_CHALLENGE_LOCKED") {
    return "This sign-in attempt has expired. Enter your password again.";
  }
  if (code === "MFA_UNAVAILABLE") {
    return "This account’s secure sign-in is temporarily unavailable. Please contact platform support.";
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
  const platformBrand = usePlatformBranding();
  const { status, owner, setupRequired, mfa, error: bootError, signIn, reloadSession } = useAdmin();
  const navigate = useNavigate();
  const location = useLocation();
  const requestedSuperAdmin = location.pathname.startsWith("/super-admin");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState(null);
  const [checking, setChecking] = useState(false);
  const [challenge, setChallenge] = useState(null);
  const [code, setCode] = useState("");
  const [recoveryStage, setRecoveryStage] = useState(null);
  const [recoveryAuthorization, setRecoveryAuthorization] = useState("");
  const [recoveryEnrollment, setRecoveryEnrollment] = useState(null);
  const [recoveryCode, setRecoveryCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState(null);
  const codeRef = useRef(null);

  const remembered = location.state && typeof location.state.from === "string" ? location.state.from : null;
  const destination = (role) => {
    if (role !== "super_admin") return "/admin/settings";
    if (remembered?.startsWith("/super-admin/") && remembered !== "/super-admin/signin") return remembered;
    if (remembered?.startsWith("/admin/") && remembered !== "/admin/signin") return remembered.replace(/^\/admin/, "/super-admin");
    return "/super-admin";
  };

  if (status === "loading") return <Boot label="Checking the session…" />;
  if (status === "authenticated") return <Navigate to={destination(owner?.role)} replace />;

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
      navigate(destination(result?.owner?.role), { replace: true });
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
      const session = await reloadSession();
      navigate(destination(session?.owner?.role), { replace: true });
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

  function generateRecoveryAuthorization() {
    if (!window.crypto?.getRandomValues) {
      setFailure(new Error("This browser cannot safely generate a recovery code. Use a current browser over HTTPS."));
      return;
    }
    const bytes = new Uint8Array(32);
    window.crypto.getRandomValues(bytes);
    setRecoveryAuthorization(Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(""));
    setFailure(null);
  }

  async function copyRecoveryAuthorization() {
    if (!recoveryAuthorization) return;
    await navigator.clipboard.writeText(recoveryAuthorization);
  }

  async function beginRecovery(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setFailure(null);
    try {
      await api.mfaRecoveryAuthorize(username.trim(), password, recoveryAuthorization.trim());
      setPassword(""); setRecoveryAuthorization("");
      const result = await api.mfaRecoveryEnroll();
      setRecoveryEnrollment(result); setRecoveryStage("setup");
    } catch (error) { setFailure(error); }
    finally { setBusy(false); }
  }

  async function confirmRecovery(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setFailure(null);
    try {
      const result = await api.mfaRecoveryConfirm(recoveryCode.trim());
      setRecoveryCodes(result.recoveryCodes); setRecoveryEnrollment(null); setRecoveryCode(""); setRecoveryStage("codes");
    } catch (error) { setFailure(error); }
    finally { setBusy(false); }
  }

  async function cancelRecovery() {
    try { await api.mfaRecoveryCancel(); } catch { /* short-lived server flow also expires */ }
    setRecoveryStage(null); setRecoveryEnrollment(null); setRecoveryCodes(null); setRecoveryCode(""); setFailure(null);
  }

  async function copyRecoveryCodes() {
    if (!recoveryCodes) return;
    await navigator.clipboard.writeText(recoveryCodes.join("\n"));
  }

  function downloadRecoveryCodes() {
    if (!recoveryCodes) return;
    const blob = new Blob([`Ninety Club owner recovery codes\nKeep private. Each code works once.\n\n${recoveryCodes.join("\n")}\n`], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a"); link.href = url; link.download = "ninety-club-recovery-codes.txt"; link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="adm-signin">
      <main id="adm-content" tabIndex="-1" className="adm-signin__panel oh-panel">
        <div className="adm-signin__brand">
          <img className="adm-brand__mark" src={assetUrl(platformBrand.logo)} alt="" width="42" height="42" />
          <span>
            <span className="oh-display adm-brand__name">{platformBrand.name}</span>
            <span className="oh-eyebrow adm-signin__eyebrow">{requestedSuperAdmin ? "Super Admin platform console" : "Owner account settings"}</span>
          </span>
        </div>

        <hr className="oh-rule" />

        <h1 className="oh-display adm-signin__title">{recoveryStage === "setup" ? "Set up your new authenticator" : recoveryStage === "codes" ? "Save your recovery codes" : recoveryStage === "start" ? "Recover owner access" : challenge ? "Confirm it is you" : "Sign in"}</h1>
        <p className="adm-signin__lede">
          {requestedSuperAdmin
            ? "Platform-wide operations require a separately provisioned Super Admin account and a confirmed second factor."
            : "Owner access is limited to this account’s credentials and security settings. Host and player sessions cannot open it."}
        </p>

        {setupRequired && !challenge ? (
          <Banner tone="warn" title="Owner sign-in unavailable">
            Please contact platform support for assistance.
            <div className="adm-actions adm-actions--tight">
              <Button variant="ghost" size="sm" onClick={handleRecheck} disabled={checking}>
                {checking ? "Checking…" : "Check again"}
              </Button>
            </div>
          </Banner>
        ) : null}

        {bootError ? <ErrorNote title="The control centre is unavailable" error={bootError} /> : null}
        {failure ? <ErrorNote title={challenge ? "The code was not accepted" : "Sign-in refused"} error={refusalMessage(failure)} /> : null}

        {recoveryStage === "start" ? (
          <form className="adm-form" onSubmit={beginRecovery} noValidate>
            <p>Generate a one-time code here, then paste it into the interactive owner recovery command on the server. The code is not active until that command verifies your password and confirmation.</p>
            <Field label="Owner username" htmlFor="adm-recovery-username"><input id="adm-recovery-username" className="oh-field" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required disabled={busy} /></Field>
            <Field label="Current owner password" htmlFor="adm-recovery-password"><input id="adm-recovery-password" className="oh-field" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required disabled={busy} /></Field>
            <div className="adm-actions">
              <Button type="button" variant="ghost" block onClick={generateRecoveryAuthorization} disabled={busy}>Generate one-time code</Button>
              {recoveryAuthorization ? <Button type="button" variant="ghost" block onClick={copyRecoveryAuthorization} disabled={busy}>Copy code for the server terminal</Button> : null}
            </div>
            <Field label="One-time recovery authorization" htmlFor="adm-recovery-auth" hint="Paste this code into the interactive server command. It expires 15 minutes after registration and works once.">
              <input id="adm-recovery-auth" className="oh-field" autoComplete="off" spellCheck="false" value={recoveryAuthorization} onChange={(e) => setRecoveryAuthorization(e.target.value)} required disabled={busy} />
            </Field>
            <Button type="submit" variant="gold" block disabled={busy || !username || !password || !/^[0-9a-f]{64}$/.test(recoveryAuthorization)}>{busy ? "Verifying…" : "Verify and continue"}</Button>
            <Button type="button" variant="ghost" block onClick={() => { setRecoveryStage(null); setPassword(""); setRecoveryAuthorization(""); setFailure(null); }} disabled={busy}>Back to sign in</Button>
          </form>
        ) : recoveryStage === "setup" && recoveryEnrollment ? (
          <div className="adm-form">
            <p>Scan this genuine one-time setup QR in Google Authenticator. The original factor remains active until this replacement is confirmed.</p>
            <p><strong>Issuer:</strong> {recoveryEnrollment.issuer}<br /><strong>Account:</strong> {recoveryEnrollment.account}</p>
            <img src={recoveryEnrollment.qr} alt="One-time Google Authenticator enrollment QR code" width="240" height="240" />
            <details><summary>Enter setup key manually</summary><code>{recoveryEnrollment.secret}</code></details>
            <form onSubmit={confirmRecovery}>
              <Field label="Six-digit authenticator code" htmlFor="adm-recovery-code"><input id="adm-recovery-code" className="oh-field adm-mfa-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={recoveryCode} onChange={(e) => setRecoveryCode(e.target.value)} required disabled={busy} /></Field>
              <Button type="submit" variant="gold" block disabled={busy || recoveryCode.replace(/\D/g, "").length !== 6}>{busy ? "Confirming…" : "Confirm replacement"}</Button>
            </form>
            <Button type="button" variant="ghost" block onClick={cancelRecovery} disabled={busy}>Cancel recovery</Button>
          </div>
        ) : recoveryStage === "codes" && recoveryCodes ? (
          <div className="adm-form">
            <p>These codes are shown once. Store them in a secure place. Each can be used once in place of an authenticator code.</p>
            <pre>{recoveryCodes.join("\n")}</pre>
            <Button type="button" variant="gold" block onClick={copyRecoveryCodes}>Copy recovery codes</Button>
            <Button type="button" variant="ghost" block onClick={downloadRecoveryCodes}>Download recovery codes</Button>
            <Button type="button" variant="ghost" block onClick={cancelRecovery}>Continue to sign in</Button>
          </div>
        ) : challenge ? (
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
            {!requestedSuperAdmin ? <Button type="button" variant="ghost" block onClick={() => { setRecoveryStage("start"); setFailure(null); }} disabled={busy}>Lost access to your authenticator?</Button> : null}
          </form>
        )}

        {mfa && mfa.state === "unavailable" && !challenge ? (
          <p className="adm-signin__note">
            Secure sign-in is temporarily unavailable. Please contact platform support.
          </p>
        ) : null}

        <Link to="/" className="adm-signin__back">
          Back to the game
        </Link>
      </main>
    </div>
  );
}
