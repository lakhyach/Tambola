/* eslint-disable react/prop-types */
/**
 * Owner session provider for the /admin route tree.
 *
 * It resolves the session once on mount, exposes sign-in/sign-out, and owns the
 * toast surface the pages use for success and failure feedback. No page repeats
 * the "am I still signed in?" check: a 401 from any API call flips the provider
 * back to anonymous and the gate routes to sign-in.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Outlet } from "react-router-dom";
import { api, setUnauthenticatedHandler } from "./api.js";
import { AdminContext } from "./context.js";

const LOADING = { status: "loading", owner: null, setupRequired: false, durable: false, mfa: null, error: null };
const ANONYMOUS = { status: "anonymous", owner: null, setupRequired: false, durable: false, mfa: null, error: null };

function ToastStack({ toasts }) {
  if (!toasts.length) return null;
  return (
    <div className="adm-toasts" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className="adm-toast" data-tone={toast.tone}>
          <span>{toast.message}</span>
        </div>
      ))}
    </div>
  );
}

function AdminProvider({ children }) {
  const [state, setState] = useState(LOADING);
  const [toasts, setToasts] = useState([]);
  const timers = useRef(new Map());

  const toast = useCallback((message, tone = "info") => {
    if (!message) return;
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    setToasts((list) => [...list.slice(-3), { id, message, tone }]);
    const timer = window.setTimeout(() => {
      timers.current.delete(id);
      setToasts((list) => list.filter((item) => item.id !== id));
    }, 4200);
    timers.current.set(id, timer);
  }, []);

  useEffect(
    () => () => {
      for (const timer of timers.current.values()) window.clearTimeout(timer);
      timers.current.clear();
    },
    []
  );

  const applySession = useCallback((session) => {
    if (session && session.authenticated) {
      setState({
        status: "authenticated",
        owner: session.owner || null,
        setupRequired: Boolean(session.setupRequired),
        durable: Boolean(session.durable),
        // The server's second-factor state, passed through untouched: this client
        // never decides whether MFA is required, it only renders what it was told.
        mfa: session.mfa || null,
        error: null,
      });
    } else {
      setState({
        status: "anonymous",
        owner: null,
        setupRequired: Boolean(session && session.setupRequired),
        durable: Boolean(session && session.durable),
        mfa: (session && session.mfa) || null,
        error: null,
      });
    }
  }, []);

  const reloadSession = useCallback(async () => {
    try {
      const session = await api.session();
      applySession(session);
      return session;
    } catch (error) {
      setState({
        status: "anonymous",
        owner: null,
        setupRequired: false,
        durable: false,
        mfa: null,
        error: error && error.message ? error.message : "The control centre is unavailable.",
      });
      return null;
    }
  }, [applySession]);

  useEffect(() => {
    setUnauthenticatedHandler(() => setState(ANONYMOUS));
    reloadSession();
    return () => setUnauthenticatedHandler(() => {});
  }, [reloadSession]);

  const signIn = useCallback(
    async (username, password) => {
      const result = await api.signIn(username, password);
      // An MFA-protected account gets a challenge, not a session. Nothing is
      // applied here: the caller stays on step one until the code is verified.
      if (result && result.mfaRequired) return result;
      // The sign-in answer carries the owner and the CSRF token but not the
      // storage mode; re-read the session so the shell badge never says
      // "Memory" over a durable server.
      try {
        const session = await api.session();
        applySession(session);
        return session;
      } catch {
        applySession({ authenticated: true, owner: { username } });
        return { ok: true, authenticated: true, owner: { username } };
      }
    },
    [applySession]
  );

  const signOut = useCallback(async () => {
    try {
      await api.signOut();
    } catch {
      // The owner cookie is cleared by the server on sign-out; a failed call
      // still leaves us signed out locally, which is the safe direction.
    }
    setState((prev) => ({ ...ANONYMOUS, durable: prev.durable, mfa: prev.mfa }));
  }, []);

  const value = useMemo(
    () => ({ ...state, toast, reloadSession, signIn, signOut }),
    [state, toast, reloadSession, signIn, signOut]
  );

  return (
    <AdminContext.Provider value={value}>
      {children}
      <ToastStack toasts={toasts} />
    </AdminContext.Provider>
  );
}

/** Route element: one provider for sign-in and the protected pages alike. */
function AdminRoot() {
  return (
    <AdminProvider>
      <Outlet />
    </AdminProvider>
  );
}

export { AdminRoot, AdminProvider };
