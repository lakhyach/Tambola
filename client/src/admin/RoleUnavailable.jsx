/* eslint-disable react/prop-types */
import "./admin.css";

/** Explain the missing role/grant while the server continues to enforce access. */
export default function RoleUnavailable({ role = "owner" }) {
  const title = role === "owner" ? "Owner account has no instance assignment" : "Super Admin access is unavailable";
  const description = role === "owner"
    ? "This account can manage its own credentials, but no instance-scoped Admin grant is configured."
    : role === "super_admin_required"
      ? "This signed-in account does not have the Super Admin role required for global platform operations."
      : "This workspace has no separately provisioned Super Admin identity or authorization policy.";
  return (
    <div className="adm-signin">
      <main className="adm-signin__panel oh-panel" aria-labelledby="role-unavailable-title">
        <span className="oh-eyebrow adm-signin__eyebrow">Ninety Club</span>
        <h1 className="adm-signin__title" id="role-unavailable-title">{title}</h1>
        <p className="adm-signin__lede">{description}</p>
        <p className="adm-signin__note">Ask an authorized platform operator to configure the role before using this area.</p>
      </main>
    </div>
  );
}
