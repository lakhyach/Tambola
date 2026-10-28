#!/usr/bin/env node
/**
 * Owner bootstrap and recovery CLI.
 *
 * This is the ONLY way an owner account is created. There is no public
 * registration and no request-path route can mint one, so opening /admin never
 * makes anyone the owner.
 *
 *   npm run owner:create                    create the single owner account
 *   npm run owner:list                      list owner usernames (no secrets)
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
 * The CLI deliberately does NOT take the running server's instance lease: it
 * only runs migrations and writes owner rows, both of which are safe while the
 * game server is up. Prefer the hidden prompt over an environment variable, so a
 * password never lands in shell history.
 *
 * MFA recovery is the one command here that weakens an account on purpose. It is
 * the documented answer to "I lost the authenticator", and the barrier it leans
 * on is host access to DATABASE_URL - not a secret the dashboard can leak. It
 * destroys the sealed secret, clears the confirmation, revokes every live session
 * and every outstanding challenge, and writes an audit row. It never prints or
 * returns a secret, and it refuses to run if OWNER_MFA_KEY is unreadable, because
 * a half-completed reset would leave an account that cannot sign in at all.
 */

import readline from "node:readline";
import { createPool } from "../server/db/pool.js";
import { migrate } from "../server/db/migrate.js";
import { createOwnerStore, normalizeUsername } from "../server/admin/owner-store.js";
import { createOwnerSessionStore } from "../server/admin/owner-sessions.js";
import { createMfaChallengeStore } from "../server/admin/mfa-challenges.js";
import { createAdminAudit, ADMIN_ACTIONS } from "../server/admin/audit.js";
import { hashPassword } from "../server/admin/password.js";
import { parseMfaKey, MFA_KEY_ENV } from "../server/admin/mfa.js";

const MIN_PASSWORD = 8;

function usage(code = 0) {
  const text = [
    "Owner bootstrap CLI",
    "",
    "  create                 create the single owner account",
    "  list                   list owner usernames (never passwords)",
    "  reset   <username>     rotate a password and revoke its sessions",
    "  mfa-reset <username>   destroy a lost second factor and revoke its sessions",
    "  remove  <username>     delete an owner account and its sessions",
    "",
    "Environment:",
    "  DATABASE_URL           required (the control centre needs durable storage)",
    "  OWNER_USERNAME         optional, avoids the username prompt",
    "  OWNER_PASSWORD         optional for create",
    "  OWNER_NEW_PASSWORD     optional for reset",
    "  OWNER_MFA_KEY          required for mfa-reset (must match the running server)",
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
  if (!["create", "list", "reset", "mfa-reset", "remove"].includes(command)) return usage(command ? 1 : 0);

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("DATABASE_URL is not set. The owner control centre needs durable storage; set DATABASE_URL (see .env.example).");
    process.exitCode = 1;
    return;
  }

  const db = createPool({ connectionString, schema: process.env.DB_SCHEMA || "public" });
  try {
    await migrate({ db });
    const store = createOwnerStore({ db });
    const sessions = createOwnerSessionStore({ db });
    const challenges = createMfaChallengeStore({ db });
    const audit = createAdminAudit({ db });

    if (command === "list") {
      const owners = await store.list();
      if (!owners.length) {
        console.log("No owner account exists yet. Run: npm run owner:create");
        return;
      }
      console.log("Owner accounts:");
      for (const owner of owners) {
        const factor = owner.mfaEnrolled ? "mfa: on" : owner.mfaPending ? "mfa: pending (not required)" : "mfa: off";
        console.log(`  ${owner.username}  (created ${new Date(owner.createdAt).toISOString()}, last login ${owner.lastLoginAt ? new Date(owner.lastLoginAt).toISOString() : "never"}, ${factor})`);
      }
      return;
    }

    if (command === "create") {
      const existing = await store.count();
      if (existing > 0) {
        console.error("An owner account already exists. Use 'reset <username>' to rotate its password, or 'remove <username>' first. There is deliberately no second-owner shortcut.");
        process.exitCode = 1;
        return;
      }
      const username = normalizeUsername(process.env.OWNER_USERNAME || argUser || (await ask("Owner username: ")));
      const password = await readPassword("Owner password: ", process.env.OWNER_PASSWORD);
      const passwordHash = await hashPassword(password);
      const created = await store.create({ username, passwordHash });
      console.log(`Owner '${created.username}' created. Sign in at /admin/signin.`);
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
      await store.remove({ ownerId: account.ownerId });
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
