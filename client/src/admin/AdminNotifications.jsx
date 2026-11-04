/* eslint-disable react/prop-types */
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Button from "../components/Button.jsx";
import { api } from "./api.js";

function formatWhen(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export default function AdminNotifications({ base }) {
  const [notifications, setNotifications] = useState([]);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState(null);

  const refresh = useCallback(async () => {
    if (document.visibilityState === "hidden") return;
    try {
      const result = await api.themeNotifications();
      setNotifications(Array.isArray(result.notifications) ? result.notifications : []);
      setError("");
    } catch (failure) {
      if (failure.status !== 401) setError(failure.message || "Notifications could not be loaded.");
    }
  }, []);

  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, 60_000);
    const onVisible = () => { if (document.visibilityState === "visible") refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  async function markRead(notificationId) {
    setBusyId(notificationId);
    setError("");
    try {
      await api.markThemeNotificationRead(notificationId);
      setNotifications((current) => current.filter((item) => item.notificationId !== notificationId));
    } catch (failure) {
      setError(failure.message || "The notification could not be acknowledged.");
      refresh();
    } finally {
      setBusyId(null);
    }
  }

  if (!notifications.length && !error) return null;
  return (
    <section className="adm-notifications" aria-label="Platform notifications" aria-live="polite">
      <div className="adm-notifications__head">
        <div>
          <p className="oh-eyebrow">Platform activity</p>
          <h2 className="oh-display">New notifications <span>{notifications.length}</span></h2>
        </div>
        <Button size="sm" variant="ghost" onClick={refresh}>Refresh</Button>
      </div>
      {error ? <p className="adm-notifications__error" role="status">{error}</p> : null}
      {notifications.length ? <ul className="adm-notifications__list">
        {notifications.map((notification) => (
          <li key={notification.notificationId}>
            <div className="adm-notifications__copy">
              <strong>{notification.title}</strong>
              <p>{notification.body}</p>
              <time dateTime={notification.createdAt}>{formatWhen(notification.createdAt)}</time>
            </div>
            <div className="adm-notifications__actions">
              <Button as={Link} to={`${base}/themes`} size="sm" variant="ghost">Review release</Button>
              <Button size="sm" variant="ghost" disabled={busyId === notification.notificationId} onClick={() => markRead(notification.notificationId)}>
                {busyId === notification.notificationId ? "Saving…" : "Mark read"}
              </Button>
            </div>
          </li>
        ))}
      </ul> : null}
    </section>
  );
}
