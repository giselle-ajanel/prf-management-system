import "server-only";
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

// Password verification for the development and demo credential path.
//
// Production identity comes from the SSO reverse proxy (see lib/auth.ts): the login form is refused there
// unless PRF_ALLOW_PASSWORD_LOGIN is explicitly set, so this file is not the organisation's credential
// store and is not trying to be one. What it does have to get right is the part that is genuinely
// dangerous to hand-roll — a memory-hard KDF with a per-user salt, and a comparison that does not leak the
// answer through its timing.
//
// scrypt comes from node:crypto rather than a dependency: it is the strongest KDF available without adding
// a native module to a project that currently has four runtime dependencies.

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

/** Stored form: "scrypt:<salt hex>:<derived key hex>". */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const derived = await scrypt(password, salt, KEY_LENGTH);
  return `scrypt:${salt.toString("hex")}:${derived.toString("hex")}`;
}

/**
 * Constant-time verification.
 *
 * A malformed or missing stored hash still performs a derivation before returning false, so "no such user"
 * and "wrong password" take the same time and the login endpoint cannot be used to enumerate accounts.
 */
export async function verifyPassword(password: string, stored: string | undefined): Promise<boolean> {
  const parts = (stored || "").split(":");
  const usable = parts.length === 3 && parts[0] === "scrypt" && /^[0-9a-f]+$/.test(parts[1] || "");
  const salt = usable ? Buffer.from(parts[1], "hex") : randomBytes(SALT_LENGTH);
  const expected = usable ? Buffer.from(parts[2], "hex") : randomBytes(KEY_LENGTH);
  const derived = await scrypt(password, salt, expected.length || KEY_LENGTH);
  if (!usable || derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}
