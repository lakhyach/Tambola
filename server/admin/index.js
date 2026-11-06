/**
 * The admin layer assembly.
 *
 * One factory that builds the owner authentication stack, the read queries and
 * the router, choosing durable or in-memory backends to match the server's
 * persistence mode. Keeping the choice here means createApp (server/index.js)
 * only has to say "durable or not" and hand over the database handle.
 *
 * Phase 6 adds three pieces, all optional at construction time so tests can
 * inject cheap substitutes:
 *
 *   throttle    shared attempt counters (PostgreSQL when durable, memory
 *               otherwise) used by sign-in, the second factor and the
 *               authenticated mutation routes
 *   mfa         the TOTP key policy: { key, configured } read from
 *               OWNER_MFA_KEY. A malformed key throws here, at boot, instead of
 *               silently downgrading the second factor.
 *   challenges  the short-lived pre-authentication tokens a password produces
 *               before the TOTP step is satisfied
 *
 * No secrets are read from a request here, and none are logged. The owner
 * store's hashes come only from the bootstrap CLI or an authenticated password
 * change; this module never mints an owner on its own.
 */

import { createAdminRouter } from "./routes.js";
import { createOwnerStore, createMemoryOwnerStore } from "./owner-store.js";
import { createOwnerSessionStore, createMemoryOwnerSessions } from "./owner-sessions.js";
import { createAdminAudit, createMemoryAdminAudit } from "./audit.js";
import { createAdminQueries } from "./queries.js";
import { createThrottleSet } from "./rate-limit.js";
import { createMfaChallengeStore, createMemoryMfaChallengeStore } from "./mfa-challenges.js";
import { createMfaRecoveryStore } from "./mfa-recovery.js";
import { mfaKeyFromEnv } from "./mfa.js";
import { createThemeService } from "../themes/service.js";
import { createPosterService } from "../posters/service.js";
import { createPlatformBrandingService } from "../branding/platform.js";

export function createAdmin({
  db = null,
  durable = false,
  registry,
  controller,
  config = {},
  log = () => {},
  production = false,
  publicOrigin = process.env.PUBLIC_ORIGIN || null,
  // injectable for tests
  ownerStore = null,
  ownerSessions = null,
  audit = null,
  queries = null,
  rateLimiter = null,
  throttle = null,
  challenges = null,
  mfaRecovery = null,
  mfaKey = undefined,
  mfaIssuer = process.env.MFA_ISSUER || "Ninety Club",
  challengeTtlMs = undefined,
  healthProbe = null,
} = {}) {
  const hasDatabase = Boolean(durable && db);
  const themeService = hasDatabase ? createThemeService({ db }) : null;
  const posterService = hasDatabase ? createPosterService({ db }) : null;
  const platformBrandingService = createPlatformBrandingService({ db: hasDatabase ? db : null });
  const store = ownerStore || (hasDatabase ? createOwnerStore({ db, log }) : createMemoryOwnerStore({ log }));
  const sessions = ownerSessions || (hasDatabase ? createOwnerSessionStore({ db, log }) : createMemoryOwnerSessions({ log }));
  const auditLog = audit || (hasDatabase ? createAdminAudit({ db, log }) : createMemoryAdminAudit({ log }));
  // Read queries need a database; without one the routes serve live state.
  const readQueries = queries || (hasDatabase ? createAdminQueries({ db }) : null);

  // An explicitly injected limiter (the Phase 5 tests do this) wins for the
  // password step; every other budget is still built so the routes never have
  // to branch on backend.
  const throttleSet = throttle || createThrottleSet({ db: hasDatabase ? db : null, log });
  if (rateLimiter) throttleSet.signin = rateLimiter;

  const challengeStore =
    challenges || (hasDatabase ? createMfaChallengeStore({ db, ttlMs: challengeTtlMs }) : createMemoryMfaChallengeStore({ ttlMs: challengeTtlMs }));
  const recoveryStore = mfaRecovery || (hasDatabase ? createMfaRecoveryStore({ db }) : null);

  // Throws MFA_KEY_INVALID when OWNER_MFA_KEY is present but malformed: a typo
  // must stop the server, not quietly disable the second factor.
  const mfa = mfaKey === undefined ? mfaKeyFromEnv() : mfaKey;

  const router = createAdminRouter({
    db: hasDatabase ? db : null,
    ownerStore: store,
    ownerSessions: sessions,
    audit: auditLog,
    queries: readQueries,
    registry,
    controller,
    config,
    publicOrigin: publicOrigin || null,
    throttle: throttleSet,
    challenges: challengeStore,
    mfaRecovery: recoveryStore,
    mfa: { configured: Boolean(mfa && mfa.configured), key: (mfa && mfa.key) || null, issuer: mfaIssuer },
    production,
    themeService,
    posterService,
    platformBrandingService,
    healthProbe,
    log,
  });

  return {
    router,
    ownerStore: store,
    ownerSessions: sessions,
    audit: auditLog,
    queries: readQueries,
    throttle: throttleSet,
    challenges: challengeStore,
    mfaRecovery: recoveryStore,
    mfa: { configured: Boolean(mfa && mfa.configured), issuer: mfaIssuer },
    durable: Boolean(readQueries),
    themeService,
    posterService,
    platformBrandingService,
  };
}
