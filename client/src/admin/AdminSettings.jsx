/**
 * Owner settings: identity, second factor, session count, invitation origin,
 * runtime health and password rotation.
 *
 * Passwords are never displayed and never stored in the browser. Rotation is
 * performed by the API, which hashes the new secret, revokes every owner
 * session (including this one) and audit-records the change. With a second
 * factor active, rotation also asks for a code - the session cookie alone is
 * not treated as proof of identity for a credential change.
 *
 * The TOTP secret and its QR arrive once, from the enroll call, and live only in
 * this component's state: they are never cached, never written to storage, and
 * gone as soon as the owner leaves the screen.
 */
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import Button from "../components/Button.jsx";
import { api } from "./api.js";
import { useAdmin } from "./useAdmin.js";
import { formatDateTime, formatInterval, formatNumber, healthLabel, healthTone } from "./format.js";
import { Badge, Banner, ConfirmDialog, CopyButton, Empty, ErrorNote, Field, KeyValue, Loading, Section, Table } from "./ui.jsx";

const MIN_PASSWORD = 8;

/** One readable line for whatever the server said the second factor is doing. */
function mfaSummary(mfa) {
  if (!mfa) return { tone: "muted", label: "Unknown", detail: "The server did not report a second-factor state." };
  switch (mfa.state) {
    case "enrolled":
      return { tone: "gold", label: "On", detail: "Every sign-in needs the authenticator as well as the password." };
    case "pending":
      return {
        tone: "warn",
        label: "Enrollment not finished",
        detail: "A device has been offered but never confirmed. Finish it or start again - until then MFA is not required.",
      };
    case "unavailable":
      return {
        tone: "muted",
        label: "Not configured",
        detail: "Set OWNER_MFA_KEY on the server to store and check a second factor.",
      };
    default:
      return { tone: "muted", label: "Off", detail: "Sign-in depends on the password alone." };
  }
}

function isCodeReady(value) {
  return String(value || "").replace(/\D/g, "").length === 6;
}

export default function AdminSettings() {
  const { owner, toast, reloadSession } = useAdmin();
  const navigate = useNavigate();

  const [state, setState] = useState({ loading: true, error: null, data: null });

  const load = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const data = await api.settings();
      setState({ loading: false, error: null, data });
    } catch (error) {
      setState((prev) => ({ loading: false, error, data: prev.data }));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const [passwordForm, setPasswordForm] = useState({ current: "", next: "", confirm: "", code: "" });
  const [passwordError, setPasswordError] = useState(null);
  const [changing, setChanging] = useState(false);

  const [enrollment, setEnrollment] = useState(null);
  const [enrollCode, setEnrollCode] = useState("");
  const [enrollBusy, setEnrollBusy] = useState(false);
  const [enrollError, setEnrollError] = useState(null);
  const [disableOpen, setDisableOpen] = useState(false);
  const [disableCode, setDisableCode] = useState("");
  const [disableBusy, setDisableBusy] = useState(false);
  const [disableError, setDisableError] = useState(null);

  async function handlePasswordChange(event) {
    event.preventDefault();
    if (changing) return;
    setPasswordError(null);
    if (passwordForm.next.length < MIN_PASSWORD) {
      setPasswordError(new Error(`The new password must be at least ${MIN_PASSWORD} characters.`));
      return;
    }
    if (passwordForm.next !== passwordForm.confirm) {
      setPasswordError(new Error("The two new passwords do not match."));
      return;
    }
    setChanging(true);
    try {
      await api.changePassword(passwordForm.current, passwordForm.next, passwordForm.code.trim());
      toast("Password changed. Every owner session was revoked.", "success");
      setPasswordForm({ current: "", next: "", confirm: "", code: "" });
      await reloadSession();
      navigate("/admin/signin", { replace: true });
    } catch (error) {
      setPasswordError(error);
    } finally {
      setChanging(false);
    }
  }

  async function handleEnrollStart() {
    if (enrollBusy) return;
    setEnrollError(null);
    setEnrollBusy(true);
    try {
      const result = await api.mfaEnroll();
      setEnrollment({ secret: result.secret, uri: result.uri, qr: result.qr, issuer: result.issuer, account: result.account });
    } catch (error) {
      setEnrollError(error);
    } finally {
      setEnrollBusy(false);
    }
  }

  async function handleEnrollConfirm(event) {
    event.preventDefault();
    if (enrollBusy) return;
    setEnrollError(null);
    setEnrollBusy(true);
    try {
      await api.mfaConfirm(enrollCode.trim());
      setEnrollment(null);
      setEnrollCode("");
      toast("Second factor enabled. You will need a code at every sign-in now.", "success");
      await load();
    } catch (error) {
      setEnrollError(error);
    } finally {
      setEnrollBusy(false);
    }
  }

  function handleEnrollCancel() {
    // Abandoning leaves a pending, inert secret behind: MFA stays off until a
    // code proves the device works, so this is safe to do at any point.
    setEnrollment(null);
    setEnrollCode("");
    setEnrollError(null);
    load();
  }

  async function handleDisable() {
    if (disableBusy) return;
    setDisableError(null);
    setDisableBusy(true);
    try {
      await api.mfaDisable(disableCode.trim());
      setDisableOpen(false);
      setDisableCode("");
      toast("Second factor turned off.", "success");
      await load();
    } catch (error) {
      setDisableError(error);
    } finally {
      setDisableBusy(false);
    }
  }

  const data = state.data;
  const invitation = (data && data.invitation) || {};
  const health = (data && data.health) || {};
  const runtime = (data && data.runtime) || {};
  const defaults = (data && data.defaults) || {};
  const owners = (data && data.owners) || [];
  const throttle = (data && data.throttle) || {};
  const mfaView = mfaSummary(data && data.mfa);
  const mfaEnrolled = Boolean(data && data.mfa && data.mfa.state === "enrolled");
  const mfaPending = Boolean(data && data.mfa && data.mfa.state === "pending");

  return (
    <div className="adm-page">
      <header className="adm-page-head">
        <div>
          <p className="oh-eyebrow">Settings</p>
          <h1 className="oh-display adm-page-title">Owner and runtime</h1>
          <p className="adm-sub">Account recovery is server-side only. There is no public registration.</p>
        </div>
        <div className="adm-actions">
          {data ? <Badge tone={data.durable ? "gold" : "muted"}>{data.durable ? "Durable records" : "Memory only"}</Badge> : null}
          <Button variant="ghost" size="sm" onClick={() => load()} disabled={state.loading}>
            {state.loading ? "Refreshing…" : "Refresh"}
          </Button>
        </div>
      </header>

      {state.loading && !data ? <Loading block label="Reading settings…" /> : null}
      {state.error && !data ? <ErrorNote title="Settings could not load" error={state.error} onRetry={() => load()} /> : null}
      {state.error && data ? <ErrorNote title="The last refresh failed" error={state.error} onRetry={() => load()} /> : null}

      {data ? (
        <>
          {invitation.warning ? (
            <Banner tone="warn" title="Invitation links need a public origin">
              {invitation.warning}
            </Banner>
          ) : null}

          <div className="adm-columns">
            <Section eyebrow="Identity" title="Signed-in owner">
              <KeyValue
                items={[
                  ["Username", owner ? owner.username : data.owner && data.owner.username],
                  ["Active owner sessions", formatNumber(data.activeSessions)],
                  ["Persistence", runtime.persistence === "durable" ? "Durable (Postgres)" : "Memory only"],
                  ["Environment", runtime.production ? "production" : "development"],
                  ["Node runtime", runtime.node],
                ]}
              />
              <p className="adm-note">
                Sessions are stored as hashes and expire after a period of inactivity. Signing out revokes only this
                session; rotating the password revokes every session.
              </p>
            </Section>

            <Section eyebrow="Invitations" title="Public origin">
              <KeyValue
                items={[
                  ["Configured origin", invitation.originConfigured ? invitation.origin : "not configured"],
                  ["Fallback origin", invitation.origin || "—"],
                  ["Default call interval", formatInterval(defaults.callIntervalMs)],
                  ["Max players per room", formatNumber(defaults.maxPlayers)],
                ]}
              />
              <p className="adm-note">
                In production set <code className="adm-code adm-code--inline">PUBLIC_ORIGIN</code> to the exact public
                URL, and <code className="adm-code adm-code--inline">TRUST_PROXY=1</code> when a reverse proxy terminates
                TLS. Without it the invite link falls back to the request host.
              </p>
            </Section>
          </div>

          <div className="adm-columns">
            <Section eyebrow="Accounts" title="Owner accounts" actions={<Badge tone="muted">{owners.length}</Badge>}>
              {owners.length ? (
                <Table>
                  <thead>
                    <tr>
                      <th scope="col">Username</th>
                      <th scope="col">Created</th>
                      <th scope="col">Last sign-in</th>
                      <th scope="col">Password updated</th>
                      <th scope="col">Second factor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {owners.map((account) => (
                      <tr key={account.username}>
                        <td>{account.username}</td>
                        <td>{formatDateTime(account.createdAt)}</td>
                        <td>{account.lastLoginAt ? formatDateTime(account.lastLoginAt) : "never"}</td>
                        <td>{account.passwordUpdatedAt ? formatDateTime(account.passwordUpdatedAt) : "—"}</td>
                        <td>
                          {account.mfaEnrolled ? (
                            <Badge tone="gold">On</Badge>
                          ) : account.mfaPending ? (
                            <Badge tone="warn">Pending</Badge>
                          ) : (
                            <Badge tone="muted">Off</Badge>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              ) : (
                <Empty title="No owner accounts readable">The owner store could not be listed.</Empty>
              )}
              <p className="adm-note">
                Add or recover an account on the server: <code className="adm-code adm-code--inline">npm run owner:create</code>,{" "}
                <code className="adm-code adm-code--inline">npm run owner:reset</code>,{" "}
                <code className="adm-code adm-code--inline">npm run owner:list</code>. Passwords are never printed or
                stored in plain text.
              </p>
            </Section>

            <Section eyebrow="Runtime" title="Health">
              <KeyValue
                items={[
                  ["Database", <Badge key="db" tone={healthTone(health.database)}>{healthLabel(health.database)}</Badge>],
                  ["Application", <Badge key="app" tone={healthTone(health.app)}>{healthLabel(health.app)}</Badge>],
                  ["Data source", data.durable ? "Durable records" : "Live process only"],
                  ["Sign-in limits", throttle.backend === "database" ? "Shared (survives a restart)" : "Process memory only"],
                ]}
              />
              {!data.durable ? (
                <Banner tone="warn" title="No durable storage">
                  History, audit records and lifetime totals require a database. The game and this dashboard still run
                  on live process state.
                </Banner>
              ) : null}
            </Section>
          </div>

          <Section eyebrow="Security" title="Two-factor sign-in" actions={<Badge tone={mfaView.tone}>{mfaView.label}</Badge>}>
            <p className="adm-note">{mfaView.detail}</p>

            {enrollment ? (
              <div className="adm-invite">
                <div className="adm-invite__grid">
                  <div className="adm-invite__details">
                    <p className="adm-field__label">1. Add this account to your authenticator app</p>
                    <p className="adm-note">
                      Scan the code, or copy the key. It is shown once and never stored in the browser - finishing or
                      leaving this screen destroys the copy you are looking at.
                    </p>
                    <code className="adm-code adm-code--inline adm-mfa-secret">{enrollment.secret}</code>
                    <div className="adm-actions adm-actions--tight">
                      <CopyButton value={enrollment.secret} label="Copy key" onResult={(ok) => toast(ok ? "Key copied." : "Could not copy.", ok ? "success" : "danger")} />
                    </div>
                  </div>
                  <figure className="adm-invite__qr">
                    <img className="adm-qr" src={enrollment.qr} alt={`Provisioning QR for ${enrollment.account}`} width={168} height={168} />
                  </figure>
                </div>
                <hr className="oh-rule" />
                <form className="adm-form" onSubmit={handleEnrollConfirm}>
                  <p className="adm-field__label">2. Confirm with a current code</p>
                  <div className="adm-form-row">
                    <Field label="Authenticator code" htmlFor="adm-enroll-code" hint="Six digits. The second factor only turns on once this matches.">
                      <input
                        id="adm-enroll-code"
                        className="oh-field adm-mfa-code"
                        type="text"
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        pattern="[0-9 ]*"
                        maxLength={8}
                        value={enrollCode}
                        onChange={(event) => setEnrollCode(event.target.value)}
                        disabled={enrollBusy}
                        required
                      />
                    </Field>
                  </div>
                  {enrollError ? <ErrorNote title="The code was not accepted" error={enrollError} /> : null}
                  <div className="adm-actions">
                    <Button type="submit" variant="gold" disabled={enrollBusy || !isCodeReady(enrollCode)}>
                      {enrollBusy ? "Checking…" : "Enable two-factor"}
                    </Button>
                    <Button type="button" variant="ghost" onClick={handleEnrollCancel} disabled={enrollBusy}>
                      Cancel
                    </Button>
                  </div>
                </form>
              </div>
            ) : (
              <>
                {enrollError ? <ErrorNote title="Enrollment could not start" error={enrollError} /> : null}
                <div className="adm-actions">
                  {!mfaEnrolled ? (
                    <Button variant="gold" size="sm" onClick={handleEnrollStart} disabled={enrollBusy || !(data.mfa && data.mfa.keyConfigured)}>
                      {enrollBusy ? "Preparing…" : mfaPending ? "Restart enrollment" : "Start enrollment"}
                    </Button>
                  ) : null}
                  {mfaEnrolled ? (
                    <Button variant="danger" size="sm" onClick={() => { setDisableError(null); setDisableOpen(true); }}>
                      Turn off two-factor
                    </Button>
                  ) : null}
                </div>
                <p className="adm-footnote">
                  Lost the device? Recover on the server with{" "}
                  <code className="adm-code adm-code--inline">{(data.mfa && data.mfa.recoveryCommand) || "npm run owner:mfa-reset -- <username>"}</code>{" "}
                  which destroys the secret, revokes every owner session and writes an audit record.
                </p>
              </>
            )}
          </Section>

          <Section eyebrow="Security" title="Rotate the owner password">
            <form className="adm-form" onSubmit={handlePasswordChange}>
              <div className="adm-form-row">
                <Field label="Current password" htmlFor="adm-current-password">
                  <input
                    id="adm-current-password"
                    className="oh-field"
                    type="password"
                    autoComplete="current-password"
                    value={passwordForm.current}
                    onChange={(event) => setPasswordForm((prev) => ({ ...prev, current: event.target.value }))}
                    disabled={changing}
                    required
                  />
                </Field>
                <Field label="New password" htmlFor="adm-new-password" hint={`At least ${MIN_PASSWORD} characters.`}>
                  <input
                    id="adm-new-password"
                    className="oh-field"
                    type="password"
                    autoComplete="new-password"
                    minLength={MIN_PASSWORD}
                    value={passwordForm.next}
                    onChange={(event) => setPasswordForm((prev) => ({ ...prev, next: event.target.value }))}
                    disabled={changing}
                    required
                  />
                </Field>
                <Field label="Repeat new password" htmlFor="adm-confirm-password">
                  <input
                    id="adm-confirm-password"
                    className="oh-field"
                    type="password"
                    autoComplete="new-password"
                    minLength={MIN_PASSWORD}
                    value={passwordForm.confirm}
                    onChange={(event) => setPasswordForm((prev) => ({ ...prev, confirm: event.target.value }))}
                    disabled={changing}
                    required
                  />
                </Field>
                {mfaEnrolled ? (
                  <Field label="Authenticator code" htmlFor="adm-rotate-code" hint="Required while two-factor sign-in is on.">
                    <input
                      id="adm-rotate-code"
                      className="oh-field adm-mfa-code"
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      pattern="[0-9 ]*"
                      maxLength={8}
                      value={passwordForm.code}
                      onChange={(event) => setPasswordForm((prev) => ({ ...prev, code: event.target.value }))}
                      disabled={changing}
                      required
                    />
                  </Field>
                ) : null}
              </div>
              <p className="adm-note">
                Rotating the password revokes every owner session, including this one, and is recorded in the audit
                trail. You will be asked to sign in again.
              </p>
              {passwordError ? <ErrorNote title="The password was not changed" error={passwordError} /> : null}
              <div className="adm-actions">
                <Button type="submit" variant="gold" disabled={changing || (mfaEnrolled && !isCodeReady(passwordForm.code))}>
                  {changing ? "Rotating…" : "Rotate password"}
                </Button>
              </div>
            </form>
          </Section>

          <ConfirmDialog
            open={disableOpen}
            title="Turn off two-factor sign-in?"
            description="Sign-in will depend on the password alone until you enroll a device again. This is recorded in the audit trail."
            confirmLabel="Turn it off"
            tone="danger"
            busy={disableBusy}
            onConfirm={handleDisable}
            onCancel={() => { setDisableOpen(false); setDisableCode(""); }}
            detail={
              <Field label="Confirm with a current code" htmlFor="adm-disable-code">
                <input
                  id="adm-disable-code"
                  className="oh-field adm-mfa-code"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9 ]*"
                  maxLength={8}
                  value={disableCode}
                  onChange={(event) => setDisableCode(event.target.value)}
                  disabled={disableBusy}
                />
                {disableError ? <ErrorNote title="The code was not accepted" error={disableError} /> : null}
              </Field>
            }
          />
        </>
      ) : null}
    </div>
  );
}
