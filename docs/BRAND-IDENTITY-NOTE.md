# Platform and instance identity

**Ninety Club** is the provisional working identity; **Roundhouse 90** and **Rally Ninety** remain alternatives pending owner approval. The original ticket-inspired mark, horizontal lockup, app icon, favicon and social-sharing art are project assets in `client/public/brand/`.

The platform owner can manage the shared identity at `/admin/branding` (also reachable at `/super-admin/branding`). Name, tagline, browser/share description, local asset references, accent palette, optional policy/support URLs and footer notice are validated and stored in `platform_settings.branding`. Changes write an append-only owner audit event and are returned through the public `/api/public/branding` endpoint. The client applies name, metadata, icon, footer links and fallback accent colors at runtime. If no database setting exists, the configured `VITE_APP_*` values remain the deployment fallback.

Each game instance keeps its own validated logo, icon, tagline and palette, separate from the platform brand. An active approved theme or an instance's selected theme retains control of its theme tokens; platform accents are the fallback when no theme is active. Regular and Bumper retain their distinct default identity assets. A platform brand edit therefore does not merge tenant identities or rewrite historical poster snapshots.

The authenticated owner save, durable setting/audit row, public response, browser metadata/icon, navigation/reload behavior and 390 px landing layout were verified in an isolated PostgreSQL schema on 1 November 2026. See `TEST-REPORT.md` for exact results and remaining visual/accessibility work.

## Runtime platform brand management (1 November 2026)

Platform-wide identity now has an owner-managed durable record in `platform_settings.branding` and a sanitized public read endpoint. The `/admin/branding` editor selects original local assets, validates text and HTTPS links, checks accent contrast, and writes an append-only audit event. Public header, landing identity, browser metadata, favicon, footer links and fallback palette update at runtime; build-time `VITE_*` values remain the deployment fallback when no saved setting exists. Active published themes and instance-specific theme selections retain their palette precedence. Per-instance branding remains separately stored and isolated.
