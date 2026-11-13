import { hash, verify } from "@node-rs/argon2";
import { randomToken } from "../utils/crypto.js";

/** Hashes with Argon2id (library default: m=19456 KiB, t=2, p=1 — the OWASP baseline). */
export function hashPassword(password: string): Promise<string> {
  return hash(password);
}

let dummyHash: Promise<string> | undefined;

/**
 * Verifies a password. When the account does not exist (`passwordHash` undefined) a dummy
 * hash is still verified, so response time does not reveal whether the account exists.
 */
export async function verifyPassword(passwordHash: string | undefined, password: string): Promise<boolean> {
  if (passwordHash === undefined) {
    dummyHash ??= hash(randomToken());
    await verify(await dummyHash, password).catch(() => false);
    return false;
  }
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}
