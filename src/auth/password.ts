/**
 * Password hashing and verification using WebCrypto PBKDF2-HMAC-SHA256.
 *
 * Encoded format: pbkdf2$sha256$<iterations>$<base64url-salt>$<base64url-hash>
 * - 100 000 iterations (Cloudflare Workers WebCrypto maximum), 16-byte random
 *   salt, 32-byte derived key. Login throttling and strong-password validation
 *   provide additional online-attack protection.
 * - Iteration count is stored in the encoded string so future migrations can
 *   re-hash on login with a higher count.
 *
 * Passwords and hashes are NEVER logged.
 */

const ITERATIONS = 100_000;
const SALT_BYTES = 16;
const KEY_BYTES = 32;
const HASH_ALG = "SHA-256";
// biome-ignore lint/suspicious/noExplicitAny: KeyUsage is a DOM type not in ES2022 lib
const KEY_USAGES: any[] = ["deriveBits"];

function toBase64url(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i] as number);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64url(s: string): Uint8Array {
  const padded = s
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(s.length / 4) * 4, "=");
  const bin = atob(padded);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a[i] as number) ^ (b[i] as number);
  return diff === 0;
}

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    KEY_USAGES,
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: HASH_ALG, salt, iterations },
    keyMaterial,
    KEY_BYTES * 8,
  );
  return new Uint8Array(bits);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await derive(password, salt, ITERATIONS);
  return `pbkdf2$sha256$${ITERATIONS}$${toBase64url(salt)}$${toBase64url(hash)}`;
}

/**
 * Verify a password against a stored encoded hash.
 * Always takes the full PBKDF2 time (uses stored iteration count) for constant-time behaviour.
 * Returns false for any malformed encoded string rather than throwing.
 */
export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const parts = encoded.split("$");
  if (parts.length !== 5) return false;
  if (parts[0] !== "pbkdf2" || parts[1] !== "sha256") return false;
  const iterations = Number(parts[2]);
  if (!Number.isInteger(iterations) || iterations < 1) return false;
  const saltStr = parts[3];
  const hashStr = parts[4];
  if (!saltStr || !hashStr) return false;

  let salt: Uint8Array;
  let expectedHash: Uint8Array;
  try {
    salt = fromBase64url(saltStr);
    expectedHash = fromBase64url(hashStr);
  } catch {
    return false;
  }

  const derived = await derive(password, salt, iterations);
  return constantTimeEqual(derived, expectedHash);
}

/**
 * Run a dummy verification (full cost) against a static placeholder hash.
 * Call this when a username is not found to prevent timing-based enumeration.
 */
export async function dummyVerify(): Promise<void> {
  // Fixed salt/hash with the production iteration count. The result is discarded;
  // matching the real cost prevents username-existence timing leaks.
  const placeholder =
    "pbkdf2$sha256$100000$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
  await verifyPassword("__dummy__", placeholder);
}
