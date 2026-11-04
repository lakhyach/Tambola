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
import RoleUnavailable from "./RoleUnavailable.jsx";

export default function AdminGate({ children }) {
  const { status, owner, mfa } = useAdmin();
  const location = useLocation();

  if (status === "loading") return <Boot />;
  if (status !== "authenticated") {
    const base = location.pathname.startsWith("/super-admin") ? "/super-admin" : "/admin";
    return <Navigate to={`${base}/signin`} replace state={{ from: location.pathname }} />;
  }
  const superAdmin = owner?.role === "super_admin";
  const superAdminPath = location.pathname.startsWith("/super-admin");
  if (superAdminPath && !superAdmin) return <RoleUnavailable role="super_admin_required" />;
  if (superAdmin && mfa?.required && mfa?.state !== "enrolled" && location.pathname !== "/super-admin/settings") {
    return <Navigate to="/super-admin/settings" replace />;
  }
  if (!superAdminPath && superAdmin) {
    const suffix = location.pathname.replace(/^\/admin/, "");
    return <Navigate to={`/super-admin${suffix}`} replace />;
  }
  if (!superAdmin && location.pathname !== "/admin/settings") return <Navigate to="/admin/settings" replace />;
  return children;
}
