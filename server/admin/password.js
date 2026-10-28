/**
 * Owner password hashing.
 *
 * A single, deliberately narrow job: turn a password into a self-describing
 * digest and back again. Nothing here reads a database or a request; it is the
 * lowest layer of owner authentication and is unit-testable on its own.
 *
 * Why scrypt and not bcrypt/argon2: scrypt ships inside node:crypto, so the
 * owner can be authenticated without adding a native dependency to a project
 * that has carefully kept its server dependency list small. The parameters are
 * recorded inside the digest string, so a future move to stronger parameters
 * (or a different algorithm) is a re-hash on next login, not a schema change.
 *
 * Digest format: scrypt$N$r$p$<saltHex>$<hashHex>
 *   N = cost (2^14), r = block size, p = parallelism, salt = 16 random bytes,
 *   hash = 32 bytes. Comparison is constant-time.
 *
 * The plaintext password never leaves the function that verifies it: it is not
 * returned, stored, or logged anywhere in this module or its callers.
 */

import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt);

const ALGORITHM = "scrypt";
const PARAMS = Object.freeze({ N: 16384, r: 8, p: 1, keylen: 32, saltBytes: 16 });

/** Hash a password into the self-describing stored form. */
export async function hashPassword(password) {
  const text = String(password ?? "");
  if (text.length < 8) throw new Error("password too short (minimum 8 characters)");
  if (text.length > 200) throw new Error("password too long (maximum 200 characters)");
  const salt = randomBytes(PARAMS.saltBytes);
  const derived = await scryptAsync(text, salt, PARAMS.keylen, {
    N: PARAMS.N,
    r: PARAMS.r,
    p: PARAMS.p,
    maxmem: 128 * PARAMS.N * PARAMS.r * 2,
  });
  return [ALGORITHM, PARAMS.N, PARAMS.r, PARAMS.p, salt.toString("hex"), derived.toString("hex")].join("$");
}

/** Parse a stored digest; returns null if it is malformed or an unknown scheme. */
function parse(digest) {
  if (typeof digest !== "string") return null;
  const parts = digest.split("$");
  if (parts.length !== 6 || parts[0] !== ALGORITHM) return null;
  const [algo, n, r, p, saltHex, hashHex] = parts;
  const N = Number(n);
  const cost = Number(r);
  const parallelism = Number(p);
  if (!Number.isInteger(N) || !Number.isInteger(cost) || !Number.isInteger(parallelism)) return null;
  if (!/^[0-9a-f]+$/i.test(saltHex) || !/^[0-9a-f]+$/i.test(hashHex)) return null;
  return { algo, N, r: cost, p: parallelism, salt: Buffer.from(saltHex, "hex"), hash: Buffer.from(hashHex, "hex") };
}

/**
 * Constant-time verification. Returns false (never throws) for anything that is
 * not a match, including a malformed stored value, so a caller cannot tell a
 * wrong password from a corrupt record through timing or an exception.
 */
export async function verifyPassword(password, digest) {
  const record = parse(digest);
  if (!record) return false;
  const text = String(password ?? "");
  if (!text.length || text.length > 200) return false;
  try {
    const derived = await scryptAsync(text, record.salt, record.hash.length, {
      N: record.N,
      r: record.r,
      p: record.p,
      maxmem: 128 * record.N * record.r * 2,
    });
    return derived.length === record.hash.length && timingSafeEqual(derived, record.hash);
  } catch {
    return false;
  }
}

/** True when a stored digest was made with weaker params than we now use. */
export function needsRehash(digest) {
  const record = parse(digest);
  if (!record) return true;
  return record.N !== PARAMS.N || record.r !== PARAMS.r || record.p !== PARAMS.p || record.hash.length !== PARAMS.keylen;
}

export const PASSWORD_ALGO = ALGORITHM;
