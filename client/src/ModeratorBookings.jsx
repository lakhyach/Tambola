import { useCallback, useEffect, useRef, useState } from "react";
import Header from "./Header.jsx";
import { Link } from "react-router-dom";
import BookingLanguageSelect from "./i18n/BookingLanguageSelect.jsx";
import { moderatorWorkspaceTabIds, preferredModeratorTab } from "./moderator-permissions.js";
import { bookingCopy, bookingStatus, formatBookingNumber, getBookingLanguage, moderatorActor, moderatorErrorText, moderatorEvent, moderatorMembershipStatus, moderatorRole, moderatorRoomStatus, setBookingLanguage, useBookingLanguage } from "./i18n/booking-locale.js";
import "./booking.css";
import "./moderator-bookings.css";
import "./moderator-festival.css";

async function request(path, { method = "GET", body, csrfToken } = {}) {
  const response = await fetch(`/api/moderator${path}`, {
    method,
    credentials: "same-origin",
    cache: "no-store",
    headers: { Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}), ...(csrfToken && method !== "GET" ? { "X-CSRF-Token": csrfToken } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok) {
    const error = new Error(moderatorErrorText(getBookingLanguage(), { code: data.code, message: data.error }));
    error.code = data.code;
    throw error;
  }
  return data;
}

function timeLabel(value, language = getBookingLanguage()) {
  if (!value) return "—";
  const date = new Date(value);
  const locale = language === "hi" ? "hi-IN" : undefined;
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export default function ModeratorBookings() {
  const language = useBookingLanguage();
  const t = (key, variables) => bookingCopy(language, key, variables);
  const [csrfToken, setCsrfToken] = useState("");
  const [session, setSession] = useState(null);
  const [instances, setInstances] = useState([]);
  const [instanceId, setInstanceId] = useState("");
  const [rows, setRows] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [activeTab, setActiveTab] = useState("bookings");
  const [rooms, setRooms] = useState([]);
  const [roomDetail, setRoomDetail] = useState(null);
  const [roomName, setRoomName] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [assignmentRooms, setAssignmentRooms] = useState([]);
  const [assignmentRoomSelection, setAssignmentRoomSelection] = useState({});
  const [playerId, setPlayerId] = useState("");
  const [players, setPlayers] = useState([]);
  const [playerDetail, setPlayerDetail] = useState(null);
  const [history, setHistory] = useState([]);
  const [report, setReport] = useState([]);
  const [description, setDescription] = useState("");
  const [detail, setDetail] = useState(null);
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [form, setForm] = useState({ username: "", password: "", code: "", challengeToken: "" });
  const [passwordForm, setPasswordForm] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const [enrollment, setEnrollment] = useState(null);
  const [enrollmentCode, setEnrollmentCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const sessionBootstrapStarted = useRef(false);

  const load = useCallback(async (id = instanceId, filters = {}, explicitGrants = null) => {
    if (!id) return;
    setBusy(true); setError("");
    try {
      const grants = explicitGrants || instances.find((item) => item.instance_id === id)?.permissions || [];
      if (grants.includes("bookings.read")) {
        const query = new URLSearchParams();
        if (filters.status ?? status) query.set("status", filters.status ?? status);
        if ((filters.search ?? search).trim()) query.set("search", (filters.search ?? search).trim());
        const data = await request(`/instances/${encodeURIComponent(id)}/bookings${query.size ? `?${query}` : ""}`);
        setRows(data.reservations || []);
      } else setRows([]);
      if (grants.includes("bookings.assign")) {
        const data = await request(`/instances/${encodeURIComponent(id)}/bookings/sessions`);
        setSessions(data.sessions || []);
        if (grants.includes("room.read")) {
          const roomData = await request(`/instances/${encodeURIComponent(id)}/rooms`);
          setAssignmentRooms(roomData.rooms || []);
        } else setAssignmentRooms([]);
      } else { setSessions([]); setAssignmentRooms([]); }
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }, [instanceId, instances, search, status]);

  const loadTab = useCallback(async function loadTab(tab = activeTab, id = instanceId, grants = []) {
    if (!id) return;
    if (tab === "bookings") return load(id, {}, grants);
    setBusy(true); setError("");
    try {
      if (tab === "rooms") {
        if (grants.includes("room.read")) { const data = await request(`/instances/${encodeURIComponent(id)}/rooms`); setRooms(data.rooms || []); }
        else setRooms([]);
      }
      else if (tab === "players") { const data = await request(`/instances/${encodeURIComponent(id)}/players`); setPlayers(data.players || []); }
      else if (tab === "history") { const data = await request(`/instances/${encodeURIComponent(id)}/history`); setHistory(data.history || []); }
      else if (tab === "reports") { const data = await request(`/instances/${encodeURIComponent(id)}/reports/summary`); setReport(data.summary || []); }
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }, [activeTab, instanceId, load]);

  const refreshSession = useCallback(async () => {
    const data = await request("/session");
    setCsrfToken(data.csrfToken || "");
    setSession(data.moderator ? { ...data.moderator, authenticated: data.authenticated } : { authenticated: false });
    if (data.authenticated && data.moderator?.mfaEnrolled) {
      const me = await request("/instances");
      setInstances(me.instances || []);
      const next = me.instances?.find((item) => item.instance_id === instanceId)?.instance_id || me.instances?.[0]?.instance_id || "";
      setInstanceId(next);
      if (next) {
        const item = me.instances?.find((entry) => entry.instance_id === next);
        setDescription(item?.description || "");
        const grants = item?.permissions || [];
        const firstTab = preferredModeratorTab(grants);
        if (firstTab) { setActiveTab(firstTab); await loadTab(firstTab, next, grants); }
      }
    }
  }, [instanceId, loadTab]);
  const refreshSessionRef = useRef(refreshSession);
  refreshSessionRef.current = refreshSession;

  // Bootstrap the current session once. Refresh callback identity changes when
  // booking filters change; rerunning bootstrap for those changes resets the
  // selected operations tab and interrupts the moderator's search workflow.
  // Authentication transitions below call the latest refreshSession directly.
  useEffect(() => {
    if (sessionBootstrapStarted.current) return;
    sessionBootstrapStarted.current = true;
    refreshSessionRef.current().catch((failure) => setError(failure.message));
  }, []);

  async function signIn(event) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const data = await request("/signin", { method: "POST", csrfToken, body: { username: form.username, password: form.password } });
      setForm((current) => ({ ...current, password: "", challengeToken: data.challengeToken || "" }));
      if (data.mfaRequired) { setNotice(t("modMfaCodePrompt")); }
      else await refreshSession();
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }

  async function finishMfa(event) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      await request("/signin/mfa", { method: "POST", csrfToken, body: { challengeToken: form.challengeToken, code: form.code } });
      setForm((current) => ({ ...current, code: "", challengeToken: "" }));
      setNotice(""); await refreshSession();
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }

  async function startEnrollment() {
    setBusy(true); setError("");
    try { setEnrollment(await request("/security/mfa/enroll", { method: "POST", csrfToken, body: {} })); }
    catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }

  async function confirmEnrollment(event) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      await request("/security/mfa/confirm", { method: "POST", csrfToken, body: { code: enrollmentCode } });
      setEnrollment(null); setEnrollmentCode(""); setNotice(t("modGrantReady")); await refreshSession();
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }

  async function inspect(id) {
    setBusy(true); setError("");
    try { const data = await request(`/instances/${encodeURIComponent(instanceId)}/bookings/${encodeURIComponent(id)}`); setDetail(data.reservation); }
    catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }

  async function cancel(row) {
    if (!window.confirm(t("modCancelConfirm", { count: formatBookingNumber(row.ticketCount, language), name: row.displayName }))) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await request(`/instances/${encodeURIComponent(instanceId)}/bookings/${encodeURIComponent(row.reservationId)}/cancel`, { method: "POST", csrfToken, body: {} });
      setNotice(t("modReservationCancelled")); await load();
      if (detail?.reservationId === row.reservationId) await inspect(row.reservationId);
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }

  async function assignSession(session) {
    const targetRoom = assignmentRoomSelection[session.sessionId];
    if (!targetRoom) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const data = await request(`/instances/${encodeURIComponent(instanceId)}/bookings/sessions/${encodeURIComponent(session.sessionId)}/room`, {
        method: "PUT", csrfToken, body: { roomCode: targetRoom },
      });
      setNotice(data.alreadyAssigned ? t("modSessionAlreadyAssigned") : t("modSessionAssigned", { room: data.roomCode }));
      setAssignmentRoomSelection((current) => ({ ...current, [session.sessionId]: "" }));
      await load(instanceId, {}, permissions);
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }

  async function signOut() {
    setBusy(true);
    try { await request("/signout", { method: "POST", csrfToken, body: {} }); setSession({ authenticated: false }); setInstances([]); setRows([]); setDetail(null); }
    catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }

  async function rotateSession() {
    setBusy(true); setError(""); setNotice("");
    try { await request("/session/rotate", { method: "POST", csrfToken, body: {} }); setNotice(t("modSecurityRefreshed")); }
    catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }

  async function changePassword(event) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setError(t("modPasswordMismatch")); setBusy(false); return;
    }
    try {
      await request("/account/password", { method: "POST", csrfToken, body: { currentPassword: passwordForm.currentPassword, newPassword: passwordForm.newPassword } });
      setPasswordForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
      setNotice(t("modPasswordChanged"));
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }

  async function operateRoom(room, action) {
    if (["end", "reset"].includes(action) && !window.confirm(t(action === "end" ? "modConfirmEnd" : "modConfirmReset", { room: room.room_code }))) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await request(`/instances/${encodeURIComponent(instanceId)}/rooms/${encodeURIComponent(room.room_code)}/${action}`, { method: "POST", csrfToken, body: {} });
      setNotice(t("modRoomActionCompleted", { room: room.room_code, action: t(`modAction${action[0].toUpperCase()}${action.slice(1)}`) })); setRoomDetail(null); await loadTab("rooms", instanceId, permissions);
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }

  async function createRoom(event) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try {
      const data = await request(`/instances/${encodeURIComponent(instanceId)}/rooms`, { method: "POST", csrfToken, body: { name: roomName } });
      setRoomName(""); setNotice(t("modRoomCreated", { room: data.roomId })); await loadTab("rooms", instanceId, permissions);
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }

  async function inspectRoom(room) {
    setBusy(true); setError("");
    try { const data = await request(`/instances/${encodeURIComponent(instanceId)}/rooms/${encodeURIComponent(room.room_code)}`); setRoomDetail(data.room); }
    catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }

  async function inspectPlayer(player) {
    setBusy(true); setError("");
    try { const data = await request(`/instances/${encodeURIComponent(instanceId)}/players/${encodeURIComponent(player.player_id)}`); setPlayerDetail(data.player); }
    catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }

  async function removePlayer(roomCode, player) {
    if (!window.confirm(t("modConfirmRemovePlayer", { player: player.displayName || player.display_name, room: roomCode }))) return;
    setBusy(true); setError("");
    try {
      await request(`/instances/${encodeURIComponent(instanceId)}/rooms/${encodeURIComponent(roomCode)}/players/${encodeURIComponent(player.playerId || player.player_id)}`, { method: "DELETE", csrfToken });
      setNotice(t("modPlayerRemoved"));
      if (permissions.includes("room.read")) { const data = await request(`/instances/${encodeURIComponent(instanceId)}/rooms/${encodeURIComponent(roomCode)}`); setRoomDetail(data.room); }
      if (permissions.includes("players.read")) await loadTab("players", instanceId, permissions);
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }

  async function saveDescription(event) {
    event.preventDefault(); setBusy(true); setError("");
    try { const data = await request(`/instances/${encodeURIComponent(instanceId)}/settings`, { method: "PATCH", csrfToken, body: { description } }); setDescription(data.instance.description || ""); setNotice(t("modDescriptionSaved")); }
    catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }

  const selected = instances.find((item) => item.instance_id === instanceId);
  const permissions = selected?.permissions || [];
  const workspaceTabIds = moderatorWorkspaceTabIds(permissions);
  const tabs = [
    ["settings", "modTabSettings"], ["rooms", "modTabRooms"], ["players", "modTabPlayers"],
    ["bookings", "modTabBookings"], ["history", "modTabHistory"], ["reports", "modTabReports"],
  ].filter(([id]) => workspaceTabIds.includes(id))
    .map(([id, label]) => ({ id, label: t(label) }));
  const currentTab = tabs.some((tab) => tab.id === activeTab) ? activeTab : tabs[0]?.id;

  return <div className="moderator-bookings-page"><Header /><main id="main-content" lang={language === "hi" ? "hi" : "en"} tabIndex="-1" className="moderator-bookings-shell">
    <div className="moderator-bookings-toolbar"><p className="oh-eyebrow">{t("modInstanceOperations")} · {session?.username}</p><BookingLanguageSelect language={language} onChange={setBookingLanguage} /></div><h1 className="oh-display">{t("modWorkspace")}</h1>
    <p className="moderator-bookings-lede">{t("modWorkspaceLede")}</p>
    {error ? <p className="moderator-bookings-error" role="alert">{error}</p> : null}
    {notice ? <p className="moderator-bookings-notice" role="status">{notice}</p> : null}
    {!session?.authenticated ? <section className="moderator-bookings-panel"><h2>{t("modSignIn")}</h2>
      {!form.challengeToken ? <><form className="moderator-bookings-form" onSubmit={signIn}><label>{t("modUsername")}<input autoComplete="username" required value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} /></label><label>{t("modPassword")}<input type="password" autoComplete="current-password" required value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} /></label><button disabled={busy}>{busy ? t("modSigningIn") : t("modContinue")}</button></form><p className="moderator-credential-links"><Link className="moderator-credential-link" to="/moderator/recovery">{t("modRecoverAccess")}</Link><Link className="moderator-credential-link" to="/moderator/accept">{t("modAcceptInvitation")}</Link></p></> : <form className="moderator-bookings-form" onSubmit={finishMfa}><label>{t("modAuthenticatorCode")}<input inputMode="numeric" autoComplete="one-time-code" required value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value })} /></label><button disabled={busy}>{busy ? t("modVerifying") : t("modVerifySignIn")}</button></form>}
    </section> : !session.mfaEnrolled ? <section className="moderator-bookings-panel"><h2>{t("modMfaSetup")}</h2><p>{t("modMfaRequired")}</p>{!enrollment ? <button disabled={busy} onClick={startEnrollment}>{t("modStartSetup")}</button> : <form className="moderator-bookings-form" onSubmit={confirmEnrollment}><p>{t("modSetupKey")} <code>{enrollment.secret}</code></p><label>{t("modCurrentAuthenticatorCode")}<input inputMode="numeric" autoComplete="one-time-code" required value={enrollmentCode} onChange={(event) => setEnrollmentCode(event.target.value)} /></label><button disabled={busy}>{t("modVerifyAuthenticator")}</button></form>}</section> : <>
      <div className="moderator-bookings-toolbar"><label>{t("modAssignedInstance")}<select value={instanceId} onChange={(event) => { const id = event.target.value; const next = instances.find((item) => item.instance_id === id); const grants = next?.permissions || []; const tab = preferredModeratorTab(grants); setInstanceId(id); setDescription(next?.description || ""); setDetail(null); setRoomDetail(null); setPlayerDetail(null); if (id && tab) { setActiveTab(tab); loadTab(tab, id, grants); } }}><option value="">{t("modSelectInstance")}</option>{instances.map((item) => <option key={item.instance_id} value={item.instance_id}>{item.display_name}</option>)}</select></label><button disabled={busy} onClick={rotateSession}>{t("modRefreshSession")}</button><button className="moderator-bookings-signout" disabled={busy} onClick={signOut}>{t("modSignOut")}</button></div>
      <section className="moderator-bookings-panel"><h2>{t("modAccountSecurity")}</h2><p>{t("modChangePasswordHelp")}</p><form className="moderator-bookings-form" onSubmit={changePassword}>
        <label>{t("modCurrentPassword")}<input type="password" autoComplete="current-password" minLength={8} maxLength={200} required value={passwordForm.currentPassword} onChange={(event) => setPasswordForm({ ...passwordForm, currentPassword: event.target.value })} /></label>
        <label>{t("modNewPassword")}<input type="password" autoComplete="new-password" minLength={12} maxLength={200} required value={passwordForm.newPassword} onChange={(event) => setPasswordForm({ ...passwordForm, newPassword: event.target.value })} /></label>
        <label>{t("modConfirmNewPassword")}<input type="password" autoComplete="new-password" minLength={12} maxLength={200} required value={passwordForm.confirmPassword} onChange={(event) => setPasswordForm({ ...passwordForm, confirmPassword: event.target.value })} /></label>
        <button disabled={busy}>{t("modChangePassword")}</button>
      </form></section>
      {!selected ? <section className="moderator-bookings-panel"><h2>{t("modNoInstance")}</h2><p>{t("modNoActiveGrant")}</p></section> : tabs.length === 0 ? <section className="moderator-bookings-panel"><h2>{t("modNoPermissions")}</h2><p>{t("modNoPermissionsHelp", { instance: selected.display_name })}</p></section> : <>
        <nav className="moderator-tabs" aria-label={t("modOperationsNav")}>{tabs.map((tab) => <button key={tab.id} type="button" aria-current={currentTab === tab.id ? "page" : undefined} className={currentTab === tab.id ? "is-active" : ""} onClick={() => { setActiveTab(tab.id); loadTab(tab.id, instanceId, permissions); }}>{tab.label}</button>)}</nav>
        {currentTab === "bookings" ? <>
        {permissions.includes("bookings.read") ? <section className="moderator-bookings-panel"><div className="moderator-bookings-toolbar"><label>{t("modStatus")}<select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">{t("modAllStatuses")}</option><option value="held">{bookingStatus(language, "held")}</option><option value="confirmed">{bookingStatus(language, "confirmed")}</option><option value="cancelled">{bookingStatus(language, "cancelled")}</option><option value="expired">{bookingStatus(language, "expired")}</option></select></label><label>{t("modNameOrReference")}<input value={search} maxLength={80} onChange={(event) => setSearch(event.target.value)} /></label><button disabled={busy} onClick={() => load(instanceId)}>{t("modSearch")}</button></div>
          {busy && rows.length === 0 ? <p role="status">{t("modLoadingReservations")}</p> : rows.length === 0 ? <p>{t("modNoReservations")}</p> : <div className="moderator-bookings-table-wrap moderator-bookings-table-wrap--bookings"><table><thead><tr><th scope="col">{t("modPlayer")}</th><th scope="col">{t("modSession")}</th><th scope="col">{t("modTickets")}</th><th scope="col">{t("modStatus")}</th><th scope="col">{t("modAllocation")}</th><th scope="col">{t("modActions")}</th></tr></thead><tbody>{rows.map((row) => <tr key={row.reservationId}><td data-label={t("modPlayer")}><span>{row.displayName}<small>{row.reservationId}</small></span></td><td data-label={t("modSession")}>{row.sessionTitle}</td><td data-label={t("modTickets")}>{formatBookingNumber(row.ticketCount, language)}</td><td data-label={t("modStatus")}>{bookingStatus(language, row.status)}</td><td data-label={t("modAllocation")}>{!permissions.includes("room.read") ? t("modRoomRestricted") : row.allocationStatus === "assigned" ? t("modJoinedRoom", { room: row.assignedRoomCode }) : row.allocationStatus === "awaiting-player-join" ? t("modStatusAwaitingJoin") : t("modStatusNotAllocated")}</td><td data-label={t("modActions")}><button disabled={busy} onClick={() => inspect(row.reservationId)}>{t("modDetails")}</button>{permissions.includes("bookings.manage") && ["held", "confirmed"].includes(row.status) && !row.assignedRoomCode ? <button disabled={busy} onClick={() => cancel(row)}>{t("modCancel")}</button> : null}</td></tr>)}</tbody></table></div>}
        </section> : null}
        {permissions.includes("bookings.assign") ? <section className="moderator-bookings-panel"><h2>{t("modAssignSessions")}</h2><p>{t("modAssignSessionsHelp")}</p>{!permissions.includes("room.read") ? <p role="status">{t("modRoomReadRequired")}</p> : sessions.length === 0 ? <p>{t("modNoSessions")}</p> : <div className="moderator-bookings-table-wrap moderator-bookings-table-wrap--cards"><table><thead><tr><th>{t("modSession")}</th><th>{t("modStatus")}</th><th>{t("modStartsAt")}</th><th>{t("modAvailability")}</th><th>{t("modRoom")}</th><th>{t("modActions")}</th></tr></thead><tbody>{sessions.map((session) => <tr key={session.sessionId}><td data-label={t("modSession")}>{session.title}</td><td data-label={t("modStatus")}>{bookingStatus(language, session.status)}</td><td data-label={t("modStartsAt")}>{timeLabel(session.startsAt)}</td><td data-label={t("modAvailability")}>{formatBookingNumber(session.available, language)} / {formatBookingNumber(session.capacity, language)}</td><td data-label={t("modRoom")}>{session.roomCode || t("modStatusNotAllocated")}</td><td data-label={t("modActions")}>{session.roomCode ? <span>{session.roomCode}</span> : ["draft", "open", "paused"].includes(session.status) ? <div className="moderator-bookings-row-actions"><label>{t("modSelectRoom")}<select value={assignmentRoomSelection[session.sessionId] || ""} onChange={(event) => setAssignmentRoomSelection((current) => ({ ...current, [session.sessionId]: event.target.value }))}><option value="">{t("modChooseWaitingRoom")}</option>{assignmentRooms.filter((room) => room.status === "WAITING" && Number(room.game_number) === 0).map((room) => <option key={room.room_code} value={room.room_code}>{room.name || room.room_code} · {room.room_code}</option>)}</select></label><button disabled={busy || !assignmentRoomSelection[session.sessionId]} onClick={() => assignSession(session)}>{t("modAssign")}</button></div> : <span>{bookingStatus(language, session.status)}</span>}</td></tr>)}</tbody></table></div>}</section> : null}
        {detail ? <section className="moderator-bookings-panel"><h2>{detail.displayName} · {detail.sessionTitle}</h2><p>{formatBookingNumber(detail.ticketCount, language)} {t("modTickets")} · {bookingStatus(language, detail.status)} · {permissions.includes("room.read") ? detail.allocationStatus === "assigned" ? t("modJoinedRoom", { room: detail.assignedRoomCode }) : detail.allocationStatus === "awaiting-player-join" ? t("modStatusAwaitingJoin") : t("modStatusNotAllocated") : t("modRoomRestricted")}</p><p>{t("bookingReference")}: <code>{detail.reservationId}</code></p><h3>{t("modActivity")}</h3><ol>{(detail.history || []).map((event) => <li key={event.eventId}>{timeLabel(event.occurredAt)} · {moderatorEvent(language, event.action)} · {moderatorActor(language, event.actorType)}</li>)}</ol></section> : null}
        </> : null}
        {currentTab === "rooms" ? <>
          {permissions.includes("room.create") ? <section className="moderator-bookings-panel"><h2>{t("modCreateRoom")}</h2><form className="moderator-bookings-toolbar" onSubmit={createRoom}><label>{t("modRoomName")}<input value={roomName} maxLength={40} onChange={(event) => setRoomName(event.target.value)} placeholder={t("modRoomPlaceholder")} /></label><button disabled={busy}>{busy ? t("modCreatingRoom") : t("modCreateRoom")}</button></form></section> : null}
          <section className="moderator-bookings-panel"><h2>{t("modRooms")}</h2>{!permissions.includes("room.read") ? <><p>{t("modRoomBrowseRequires")}</p><div className="moderator-bookings-toolbar"><label>{t("modRoomCode")}<input value={roomCode} maxLength={50} onChange={(event) => setRoomCode(event.target.value)} /></label>{permissions.includes("room.start") ? <button disabled={busy || !roomCode.trim()} onClick={() => operateRoom({ room_code: roomCode.trim() }, "start")}>{t("modStart")}</button> : null}{permissions.includes("room.pause") ? <><button disabled={busy || !roomCode.trim()} onClick={() => operateRoom({ room_code: roomCode.trim() }, "pause")}>{t("modPause")}</button><button disabled={busy || !roomCode.trim()} onClick={() => operateRoom({ room_code: roomCode.trim() }, "resume")}>{t("modResume")}</button></> : null}{permissions.includes("room.end") ? <button disabled={busy || !roomCode.trim()} onClick={() => operateRoom({ room_code: roomCode.trim() }, "end")}>{t("modEnd")}</button> : null}{permissions.includes("room.reset") ? <button disabled={busy || !roomCode.trim()} onClick={() => operateRoom({ room_code: roomCode.trim() }, "reset")}>{t("modReset")}</button> : null}</div>{permissions.includes("players.manage") ? <div className="moderator-bookings-toolbar"><label>{t("modPlayerId")}<input value={playerId} maxLength={80} onChange={(event) => setPlayerId(event.target.value)} /></label><button disabled={busy || !roomCode.trim() || !playerId.trim()} onClick={() => removePlayer(roomCode.trim(), { playerId: playerId.trim(), displayName: playerId.trim() })}>{t("modRemovePlayer")}</button></div> : null}</> : rooms.length === 0 ? <p>{t("modNoRooms")}</p> : <div className="moderator-bookings-table-wrap moderator-bookings-table-wrap--cards"><table><thead><tr><th>{t("modRoom")}</th><th>{t("modStatus")}</th><th>{t("modPlayersCount")}</th><th>{t("modUpdated")}</th><th>{t("modActions")}</th></tr></thead><tbody>{rooms.map((room) => <tr key={room.room_code}><td data-label={t("modRoom")}><span>{room.name || room.room_code}<small>{room.room_code}</small></span></td><td data-label={t("modStatus")}>{moderatorRoomStatus(language, room.status)}</td><td data-label={t("modPlayersCount")}>{room.players}</td><td data-label={t("modUpdated")}>{timeLabel(room.updated_at)}</td><td data-label={t("modActions")}><div className="moderator-bookings-row-actions"><button disabled={busy} onClick={() => inspectRoom(room)}>{t("modDetails")}</button>{room.status === "WAITING" && permissions.includes("room.start") ? <button disabled={busy} onClick={() => operateRoom(room, "start")}>{t("modStart")}</button> : null}{room.status === "RUNNING" && permissions.includes("room.pause") ? <button disabled={busy} onClick={() => operateRoom(room, "pause")}>{t("modPause")}</button> : null}{room.status === "PAUSED" && permissions.includes("room.pause") ? <button disabled={busy} onClick={() => operateRoom(room, "resume")}>{t("modResume")}</button> : null}{["RUNNING", "PAUSED", "WAITING"].includes(room.status) && permissions.includes("room.end") ? <button disabled={busy} onClick={() => operateRoom(room, "end")}>{t("modEnd")}</button> : null}{room.status === "COMPLETED" && permissions.includes("room.reset") ? <button disabled={busy} onClick={() => operateRoom(room, "reset")}>{t("modReset")}</button> : null}</div></td></tr>)}</tbody></table></div>}</section>
          {permissions.includes("players.manage") && permissions.includes("room.read") && !permissions.includes("players.read") ? <section className="moderator-bookings-panel"><h2>{t("modRemoveKnownMember")}</h2><p>{t("modPlayerNamesRestricted")}</p><div className="moderator-bookings-toolbar"><label>{t("modRoomCode")}<input value={roomCode} maxLength={50} onChange={(event) => setRoomCode(event.target.value)} /></label><label>{t("modPlayerId")}<input value={playerId} maxLength={80} onChange={(event) => setPlayerId(event.target.value)} /></label><button disabled={busy || !roomCode.trim() || !playerId.trim()} onClick={() => removePlayer(roomCode.trim(), { playerId: playerId.trim(), displayName: playerId.trim() })}>{t("modRemovePlayer")}</button></div></section> : null}
          {roomDetail ? <section className="moderator-bookings-panel"><h2>{t("modRoom")} {roomDetail.roomId}</h2><p>{moderatorRoomStatus(language, roomDetail.status)} · {t("modGameNumber", { number: formatBookingNumber(roomDetail.gameNumber, language) })}</p>{roomDetail.members?.length ? <><h3>{t("modMembers")}</h3><ul>{roomDetail.members.map((member) => <li key={member.playerId}>{member.displayName} · {moderatorRole(language, member.role)}{permissions.includes("players.manage") && member.role !== "host" && !member.leftAt ? <button disabled={busy} onClick={() => removePlayer(roomDetail.roomId, member)}>{t("modRemove")}</button> : null}</li>)}</ul></> : null}<p>{t("modRoomHistoryRestricted")}</p></section> : null}
          {roomDetail && permissions.includes("tickets.manage") ? <section className="moderator-bookings-panel"><h2>{t("modIssuedTickets")}</h2><p>{t("modTicketAuthority")}</p>{roomDetail.tickets?.length ? <ul>{roomDetail.tickets.map((ticket) => {
            const player = permissions.includes("players.read") ? roomDetail.members?.find((member) => member.playerId === ticket.playerId) : null;
            return <li key={ticket.ticketId}>{t("modGameNumber", { number: formatBookingNumber(ticket.gameNumber, language) })} · {player?.displayName || t("modTicketIdentityRestricted")} · {t("modIssued")} {timeLabel(ticket.assignedAt)}</li>;
          })}</ul> : <p>{t("modNoTicketsIssued")}</p>}</section> : null}
        </> : null}
        {currentTab === "players" && permissions.includes("players.read") ? <section className="moderator-bookings-panel"><h2>{t("modInstancePlayers")}</h2>{players.length === 0 ? <p>{t("modNoPlayers")}</p> : <div className="moderator-bookings-table-wrap moderator-bookings-table-wrap--cards"><table><thead><tr><th>{t("modPlayer")}</th><th>{t("modJoinedPlatform")}</th><th>{t("modMemberships")}</th></tr></thead><tbody>{players.map((player) => <tr key={player.player_id}><td data-label={t("modPlayer")}><button onClick={() => inspectPlayer(player)}>{player.display_name}</button></td><td data-label={t("modJoinedPlatform")}>{timeLabel(player.created_at)}</td><td data-label={t("modMemberships")}>{playerDetail?.player_id === player.player_id ? playerDetail.memberships?.length || 0 : "—"}</td></tr>)}</tbody></table></div>}{playerDetail ? <div><h3>{playerDetail.display_name}</h3><ul>{(playerDetail.memberships || []).map((membership) => <li key={`${membership.roomId}-${membership.joinedAt}`}>{membership.roomId} · {moderatorMembershipStatus(language, membership.status)} · {t("modJoined")} {timeLabel(membership.joinedAt)}{membership.leftAt ? ` · ${t("modLeft")} ${timeLabel(membership.leftAt)}` : ""}</li>)}</ul><p>{t("modPlayerRemovalHelp")}</p></div> : null}</section> : null}
        {currentTab === "history" && permissions.includes("history.read") ? <section className="moderator-bookings-panel"><h2>{t("modRoomHistory")}</h2>{history.length === 0 ? <p>{t("modNoHistory")}</p> : <div className="moderator-bookings-table-wrap moderator-bookings-table-wrap--cards"><table><thead><tr><th>{t("modRoom")}</th><th>{t("modLastStatus")}</th><th>{t("modGames")}</th><th>{t("modAwards")}</th><th>{t("modCreated")}</th><th>{t("modClosed")}</th></tr></thead><tbody>{history.map((item) => <tr key={item.room_code}><td data-label={t("modRoom")}>{item.room_code}</td><td data-label={t("modLastStatus")}>{moderatorRoomStatus(language, item.status)}</td><td data-label={t("modGamesCount")}>{item.rounds}</td><td data-label={t("modAwardsCount")}>{item.awards}</td><td data-label={t("modCreated")}>{timeLabel(item.created_at)}</td><td data-label={t("modClosed")}>{timeLabel(item.closed_at)}</td></tr>)}</tbody></table></div>}</section> : null}
        {currentTab === "reports" && permissions.includes("reports.read") ? <section className="moderator-bookings-panel"><h2>{t("modInstanceSummary")}</h2>{report.length === 0 ? <p>{t("modNoActivity")}</p> : <div className="moderator-bookings-table-wrap moderator-bookings-table-wrap--cards"><table><thead><tr><th>{t("modRoomStatus")}</th><th>{t("modRoomsCount")}</th><th>{t("modGamesCount")}</th><th>{t("modPlayersCount")}</th><th>{t("modAwardsCount")}</th></tr></thead><tbody>{report.map((item) => <tr key={item.status}><td data-label={t("modRoomStatus")}>{moderatorRoomStatus(language, item.status)}</td><td data-label={t("modRoomsCount")}>{item.rooms}</td><td data-label={t("modGamesCount")}>{item.games}</td><td data-label={t("modPlayersCount")}>{item.players}</td><td data-label={t("modAwardsCount")}>{item.awards}</td></tr>)}</tbody></table></div>}</section> : null}
        {currentTab === "settings" && permissions.includes("instance.settings.update") ? <section className="moderator-bookings-panel"><h2>{t("modInstanceDescription")}</h2><p>{t("modDescriptionOnly")}</p><form className="moderator-bookings-form" onSubmit={saveDescription}><label>{t("modDescription")}<textarea rows="5" maxLength={500} value={description} onChange={(event) => setDescription(event.target.value)} /></label><button disabled={busy}>{busy ? t("modSaving") : t("modSaveDescription")}</button></form></section> : null}
      </>}
    </>}
    <p className="moderator-bookings-foot">{t("modFootnote")}</p>
  </main></div>;
}
