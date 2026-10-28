/* eslint-disable react/prop-types */
/**
 * Route gate for the owner pages.
 *
 * The provider resolves the session before this renders; an anonymous visitor
 * is redirected to sign-in and the visited path is remembered so sign-in lands
 * where they were going. This is a convenience, not the security boundary — the
 * server refuses every admin request without a valid owner session.
 */
import { Navigate, useLocation } from "react-router-dom";
import { useAdmin } from "./useAdmin.js";
import { Boot } from "./ui.jsx";

export default function AdminGate({ children }) {
  const { status } = useAdmin();
  const location = useLocation();

  if (status === "loading") return <Boot />;
  if (status !== "authenticated") {
    return <Navigate to="/admin/signin" replace state={{ from: location.pathname }} />;
  }
  return children;
}
