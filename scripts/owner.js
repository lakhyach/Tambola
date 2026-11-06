#!/usr/bin/env node
/**
 * Owner bootstrap and recovery CLI.
 *
 * This is the ONLY way an owner account is created. There is no public
 * registration and no request-path route can mint one, so opening /admin never
 * makes anyone the owner.
 *
 *   npm run owner:create                    create a non-elevated owner account
 *   node scripts/owner.js super-admin:create create a platform Super Admin
 *   node scripts/owner.js super-admin:promote <username> explicitly elevate an account
 *   node scripts/owner.js super-admin:demote <username> revoke global authority
 *   npm run owner:list                      read-only list of owner usernames (no secrets)
 *   npm run owner:reset   -- <username>     rotate a password + revoke sessions
 *   npm run owner:mfa-reset -- <username>   destroy a lost second factor
 *   npm run owner:remove  -- <username>     delete an owner (and its sessions)
 *
 * Credentials are read from the environment (OWNER_USERNAME / OWNER_PASSWORD for
 * create, OWNER_USERNAME / OWNER_NEW_PASSWORD for reset) or, if absent, from a
 * hidden interactive prompt. Nothing is ever written to a log: the plaintext
 * password only exists in memory long enough to be hashed with scrypt, and the
 * digest stored is self-describing (see server/admin/password.js).
 *
 * The CLI deliberately does NOT take the running server's instance lease. The
 * read-only `list` command never runs migrations; create/reset/remove commands
 * migrate before changing owner rows. Prefer the hidden prompt over an
 * environment variable, so a password never lands in shell history.
 *
 * MFA recovery registers a short-lived authorization for a browser-generated
 * code. It does not alter the active factor; the owner must confirm a replacement
 * TOTP in the browser. The destructive mfa-reset command remains separate.
 */

import readline from "node:readline";
import { createPool, assertSchemaName } from "../server/db/pool.js";
import { migrate } from "../server/db/migrate.js";
import { createOwnerStore, normalizeUsername } from "../server/admin/owner-store.js";
import { createOwnerSessionStore } from "../server/admin/owner-sessions.js";
import { createMfaChallengeStore } from "../server/admin/mfa-challenges.js";
import { createAdminAudit, ADMIN_ACTIONS } from "../server/admin/audit.js";
import { hashPassword } from "../server/admin/password.js";
import { decryptSecret, parseMfaKey, MFA_KEY_ENV } from "../server/admin/mfa.js";
import { createMfaRecoveryStore } from "../server/admin/mfa-recovery.js";

const MIN_PASSWORD = 8;

function usage(code = 0) {
  const text = [
    "Owner bootstrap CLI",
    "",
    "  create                 create a non-elevated owner account",
    "  super-admin:create     create a separately authenticated platform Super Admin",
    "  super-admin:promote    promote an Owner after explicit typed confirmation",
    "  super-admin:demote     demote a Super Admin after explicit typed confirmation",
    "  list                   list owner usernames (never passwords)",
    "  reset   <username>     rotate a password and revoke its sessions",
    "  mfa-reset <username>   destroy a lost second factor and revoke its sessions",
    "  mfa-recovery-issue <username>  register a browser-generated, one-use replacement authorization",
    "  remove  <username>     delete an owner account and its sessions",
    "",
    "Environment:",
    "  DATABASE_URL           required (the control centre needs durable storage)",
    "  OWNER_USERNAME         optional, avoids the username prompt",
    "  OWNER_PASSWORD         optional for create",
    "  OWNER_NEW_PASSWORD     optional for reset",
    "  OWNER_MFA_KEY          required for mfa-reset (must match the running server)",
    "  SUPER_ADMIN_USERNAME / SUPER_ADMIN_PASSWORD  optional for super-admin:create",
    "  OWNER_CONFIRM=1        skip the interactive confirmation",
  ].join("\n");
  console.log(text);
  process.exitCode = code;
}

function ask(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

/** Hidden prompt: masks each character so a password never appears on screen. */
function askHidden(question) {
  if (!process.stdin.isTTY) return ask(question);
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const original = rl._writeToOutput.bind(rl);
    rl._writeToOutput = (string) => {
      if (string.includes(question)) original(string);
      else if (string === "\r\n" || string === "\n") return;
      else original("*");
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
  });
}

async function readPassword(label, envValue) {
  const password = envValue || (await askHidden(label));
  if (typeof password !== "string" || password.length < MIN_PASSWORD) {
    throw new Error(`password must be at least ${MIN_PASSWORD} characters`);
  }
  return password;
}

async function main() {
  const command = process.argv[2];
  const argUser = process.argv[3];
  if (!["create", "super-admin:create", "super-admin:promote", "super-admin:demote", "list", "reset", "mfa-reset", "mfa-recovery-issue", "remove"].includes(command)) return usage(command ? 1 : 0);

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("DATABASE_URL is not set. The owner control centre needs durable storage; set DATABASE_URL (see .env.example).");
    process.exitCode = 1;
    return;
  }
  if (command === "mfa-recovery-issue" && !process.stdin.isTTY) {
    console.error("MFA recovery authorization must be issued from an interactive terminal.");
    process.exitCode = 1;
    return;
  }

  const schema = process.env.DB_SCHEMA || "public";
  const db = createPool({ connectionString, schema });
  try {
    if (command === "list") {
      // Name the schema in the lookup. An unqualified to_regclass() resolves
      // through the pool's search_path ("<schema>,public"), so a pinned
      // non-public schema would claim to be initialized merely because
      // `public` has the tables - and then list owners out of a database this
      // command was never pointed at. `list` is the one read-only path that
      // promises to touch nothing, so it has to answer about the right schema.
      const initialized = await db.query("SELECT to_regclass($1) IS NOT NULL AS present", [
        `${assertSchemaName(schema)}.owner_accounts`,
      ]);
      if (!initialized.rows[0]?.present) {
        console.log("Owner schema is not initialized; no migrations were run.");
        return;
      }
      const store = createOwnerStore({ db });
      const owners = await store.list();
      if (!owners.length) {
        console.log("No owner account exists yet. Run: npm run owner:create");
        return;
      }
      console.log("Owner accounts:");
      for (const owner of owners) {
        const factor = owner.mfaEnrolled ? "mfa: on" : owner.mfaPending ? "mfa: pending (not required)" : "mfa: off";
        console.log(`  ${owner.username}  [${owner.role}] (created ${new Date(owner.createdAt).toISOString()}, last login ${owner.lastLoginAt ? new Date(owner.lastLoginAt).toISOString() : "never"}, ${factor})`);
      }
      return;
    }

    if (command === "mfa-recovery-issue") {
      const initialized = await db.query("SELECT to_regclass($1) IS NOT NULL AS present", [`${assertSchemaName(schema)}.owner_mfa_recovery_authorizations`]);
      if (!initialized.rows[0]?.present) {
        console.error("The MFA recovery schema is not installed. Apply the reviewed application migration before issuing recovery authorizations.");
        process.exitCode = 1;
        return;
      }
    } else {
      await migrate({ db });
    }
    const store = createOwnerStore({ db });
    const sessions = createOwnerSessionStore({ db });
    const challenges = createMfaChallengeStore({ db });
    const audit = createAdminAudit({ db });

    if (command === "mfa-recovery-issue") {
      const username = normalizeUsername(argUser || (await ask("Existing owner username: ")));
      const account = await store.getByUsername(username);
      if (!account || !account.totpConfirmedAt) {
        console.error("No active MFA-protected owner matches that username.");
        process.exitCode = 1;
        return;
      }
      let password = await askHidden("Current owner password: ");
      const verified = await store.verifyLogin({ username, password });
      password = "";
      if (!verified.ok) {
        console.error("Owner credentials were not accepted.");
        process.exitCode = 1;
        return;
      }
      let recoveryKey;
      try { recoveryKey = parseMfaKey(process.env[MFA_KEY_ENV]); }
      catch { console.error(`${MFA_KEY_ENV} is invalid; no authorization was issued.`); process.exitCode = 1; return; }
      if (!recoveryKey.configured) {
        console.error(`${MFA_KEY_ENV} is not configured; no authorization was issued.`);
        process.exitCode = 1;
        return;
      }
      let currentSecret = decryptSecret({ envelope: (await store.getForMfa({ ownerId: account.ownerId }))?.totpSecretEnc, ownerId: account.ownerId, key: recoveryKey.key });
      recoveryKey.key.fill(0);
      if (!currentSecret) {
        console.error(`${MFA_KEY_ENV} does not match the active owner factor; no authorization was issued.`);
        process.exitCode = 1;
        return;
      }
      currentSecret = "";
      let authorizationToken = await askHidden("Browser-generated one-time recovery authorization: ");
      if (!/^[0-9a-f]{64}$/.test(authorizationToken)) {
        authorizationToken = "";
        console.error("The recovery authorization must be 64 lowercase hexadecimal characters.");
        process.exitCode = 1;
        return;
      }
      const answer = await ask(`This authorizes replacement of the authenticator for '${account.username}' for 15 minutes. The current factor remains active until a new one is verified. Type 'authorize mfa recovery ${account.username}': `);
      if (answer !== `authorize mfa recovery ${account.username}`) {
        authorizationToken = "";
        console.log("aborted; no recovery authorization was issued");
        return;
      }
      const recovery = createMfaRecoveryStore({ db });
      const issued = await recovery.issueAuthorization({ ownerId: account.ownerId, username: account.username, authorizationToken });
      authorizationToken = "";
      console.log(`Recovery authorization registered until ${new Date(issued.expiresAt).toISOString()}.`);
      console.log("Return to the browser and submit the code already held there. This command did not display or store the code in plaintext.");
      return;
    }

    if (command === "create" || command === "super-admin:create") {
      const existing = await store.count();
      if (command === "create" && existing > 0) {
        console.error("An owner account already exists. Use 'reset <username>' to rotate its password, or 'remove <username>' first. There is deliberately no second-owner shortcut.");
        process.exitCode = 1;
        return;
      }
      const elevated = command === "super-admin:create";
      const username = normalizeUsername((elevated ? process.env.SUPER_ADMIN_USERNAME : process.env.OWNER_USERNAME) || argUser || (await ask(elevated ? "Super Admin username: " : "Owner username: ")));
      const password = await readPassword(elevated ? "Super Admin password: " : "Owner password: ", elevated ? process.env.SUPER_ADMIN_PASSWORD : process.env.OWNER_PASSWORD);
      const passwordHash = await hashPassword(password);
      const role = elevated ? "super_admin" : "owner";
      const created = await store.create({ username, passwordHash, role });
      console.log(`${elevated ? "Super Admin" : "Owner"} '${created.username}' created. Sign in at ${elevated ? "/super-admin/signin" : "/admin/signin"}.`);
      return;
    }

    if (command === "super-admin:promote") {
      const username = normalizeUsername(process.env.OWNER_USERNAME || argUser || (await ask("Owner username to promote: ")));
      const account = await store.getByUsername(username);
      if (!account) { console.error("No such owner account: " + username); process.exitCode = 1; return; }
      if (account.role === "super_admin") { console.log(`'${account.username}' is already a Super Admin.`); return; }
      const answer = await ask(`This grants global platform authority to '${account.username}' and revokes every current session. Type 'promote ${account.username} to super-admin' to confirm: `);
      if (answer !== `promote ${account.username} to super-admin`) { console.log("aborted - role is unchanged"); return; }
      const promoted = await store.setRole({ ownerId: account.ownerId, role: "super_admin", actor: `cli:${account.username}` });
      console.log(`'${promoted.username}' promoted to Super Admin. ${promoted.revoked} active session(s) revoked.`);
      return;
    }

    if (command === "super-admin:demote") {
      const username = normalizeUsername(process.env.OWNER_USERNAME || argUser || (await ask("Super Admin username to demote: ")));
      const account = await store.getByUsername(username);
      if (!account) { console.error("No such owner account: " + username); process.exitCode = 1; return; }
      if (account.role !== "super_admin") { console.log(`'${account.username}' is not a Super Admin; role is unchanged.`); return; }
      const answer = await ask(`This revokes global platform authority and every current session for '${account.username}'. Type 'demote ${account.username} from super-admin' to confirm: `);
      if (answer !== `demote ${account.username} from super-admin`) { console.log("aborted - role is unchanged"); return; }
      const demoted = await store.setRole({ ownerId: account.ownerId, role: "owner", actor: `cli:${account.username}` });
      if (!demoted.ok) {
        if (demoted.code === "LAST_SUPER_ADMIN") console.error("Cannot demote the last Super Admin; create another Super Admin first.");
        else console.error("Super Admin role could not be changed: " + demoted.code);
        process.exitCode = 1;
        return;
      }
      console.log(`'${demoted.username}' demoted to Owner. ${demoted.revoked} active session(s) revoked.`);
      return;
    }

    if (command === "reset") {
      const username = normalizeUsername(process.env.OWNER_USERNAME || argUser || (await ask("Owner username to reset: ")));
      const account = await store.getByUsername(username);
      if (!account) {
        console.error("No such owner account: " + username);
        process.exitCode = 1;
        return;
      }
      const password = await readPassword("New password: ", process.env.OWNER_NEW_PASSWORD);
      const passwordHash = await hashPassword(password);
      await store.setPassword({ ownerId: account.ownerId, passwordHash });
      const revoked = await sessions.revokeAllForOwner({ ownerId: account.ownerId, reason: "cli-reset" });
      console.log(`Password rotated for '${account.username}'. ${revoked.revoked} active session(s) revoked.`);
      return;
    }

    if (command === "mfa-reset") {
      const username = normalizeUsername(process.env.OWNER_USERNAME || argUser || (await ask("Owner username whose second factor is lost: ")));
      const account = await store.getByUsername(username);
      if (!account) {
        console.error("No such owner account: " + username);
        process.exitCode = 1;
        return;
      }
      if (!account.totpSecretEnc) {
        console.log(`'${account.username}' has no second factor to reset. Sign-in is password-only.`);
        return;
      }
      // Refuse rather than half-reset: without the configured key we cannot
      // prove which account the sealed secret belongs to, and clearing the
      // confirmation flag alone would leave an unusable factor behind.
      let key;
      try {
        key = parseMfaKey(process.env[MFA_KEY_ENV]);
      } catch (error) {
        console.error(error.message + ` (set ${MFA_KEY_ENV} to the same value the server uses)`);
        process.exitCode = 1;
        return;
      }
      if (!key.configured) {
        console.error(`${MFA_KEY_ENV} is not set. The running server cannot open this secret either, so reset it there first: the account is currently unable to sign in with MFA.`);
        process.exitCode = 1;
        return;
      }
      const state = account.totpConfirmedAt ? "active" : "pending";
      if (process.env.OWNER_CONFIRM !== "1") {
        const answer = await ask(`This destroys the ${state} second factor for '${account.username}' and signs every owner session out. Type 'reset ${account.username}' to confirm: `);
        if (answer !== `reset ${account.username}`) {
          console.log("aborted - the second factor is unchanged");
          return;
        }
      }
      const cleared = await store.clearMfa({ ownerId: account.ownerId });
      if (!cleared.ok) {
        console.error("Could not clear the second factor (" + cleared.code + ").");
        process.exitCode = 1;
        return;
      }
      const [revokedSessions, revokedChallenges] = await Promise.all([
        sessions.revokeAllForOwner({ ownerId: account.ownerId, reason: "mfa-recovery" }),
        challenges.revokeAllForOwner({ ownerId: account.ownerId }),
      ]);
      await audit
        .record({
          actor: `cli:${account.username}`,
          action: ADMIN_ACTIONS.MFA_RECOVERY_RESET,
          targetType: "owner",
          targetId: account.ownerId,
          metadata: { was: state, sessionsRevoked: revokedSessions.revoked, challengesRevoked: revokedChallenges.revoked },
        })
        .catch(() => {});
      console.log(`Second factor destroyed for '${account.username}' (was ${state}).`);
      console.log(`${revokedSessions.revoked} session(s) revoked, ${revokedChallenges.revoked} outstanding challenge(s) cancelled.`);
      console.log("Sign in with the password alone, then enroll a new device under Settings if OWNER_MFA_KEY is configured on the server.");
      return;
    }

    if (command === "remove") {
      const username = normalizeUsername(process.env.OWNER_USERNAME || argUser || (await ask("Owner username to remove: ")));
      const account = await store.getByUsername(username);
      if (!account) {
        console.error("No such owner account: " + username);
        process.exitCode = 1;
        return;
      }
      if (process.env.OWNER_CONFIRM !== "1") {
        const answer = await ask(`Type 'remove ${account.username}' to confirm: `);
        if (answer !== `remove ${account.username}`) {
          console.log("aborted - nothing was removed");
          return;
        }
      }
      const removed = await store.remove({ ownerId: account.ownerId, actor: `cli:${account.username}` });
      if (!removed.ok) {
        if (removed.code === "LAST_SUPER_ADMIN") console.error("Cannot remove the last Super Admin; create another Super Admin first.");
        else console.error("Owner account could not be removed: " + removed.code);
        process.exitCode = 1;
        return;
      }
      // The cascade in migration 003 already drops the owner's challenges and
      // sessions; this is belt-and-braces so a memory-backend or a pre-003
      // database cannot leave a live token behind either.
      await Promise.all([
        sessions.revokeAllForOwner({ ownerId: account.ownerId, reason: "owner-removed" }).catch(() => {}),
        challenges.revokeAllForOwner({ ownerId: account.ownerId }).catch(() => {}),
      ]);
      console.log(`Owner '${account.username}' removed, and all its sessions with it.`);
      return;
    }
  } finally {
    await db.end();
  }
}

main().catch((error) => {
  console.error("owner CLI failed: " + (error && error.message));
  process.exit(1);
});
