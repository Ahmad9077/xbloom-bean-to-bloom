#!/usr/bin/env node
/**
 * Create (or force-reset) the primary admin account in a D1 database.
 *
 * Usage:
 *   # Create primary admin in remote D1:
 *   node scripts/create-admin.mjs --username=admin [--remote]
 *
 *   # Create primary admin in local D1 dev database:
 *   node scripts/create-admin.mjs --username=admin --local
 *
 *   # Reset the primary admin password (requires --force-reset-primary):
 *   node scripts/create-admin.mjs --username=admin --force-reset-primary [--remote|--local]
 *
 * Password is read from stdin interactively (never from command-line args or env vars).
 * The plaintext password is never written to logs, process arguments, or source.
 *
 * Requirements: Node.js 18+, wrangler CLI on PATH.
 */

import { createInterface } from "node:readline";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomBytes } from "node:crypto";
import { subtle } from "node:crypto";

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);

function getArg(name) {
  const prefix = `--${name}=`;
  const full = `--${name}`;
  for (const a of args) {
    if (a.startsWith(prefix)) return a.slice(prefix.length);
    if (a === full) return true;
  }
  return undefined;
}

const username = getArg("username");
const isRemote = getArg("remote") === true;
const forceReset = getArg("force-reset-primary") === true;

if (!username || typeof username !== "string") {
  console.error("Usage: node scripts/create-admin.mjs --username=<name> [--remote|--local] [--force-reset-primary]");
  process.exit(1);
}

// Default to local if neither flag given (safer)
const target = isRemote ? "--remote" : "--local";

// ---------------------------------------------------------------------------
// Username validation (same rules as src/sanitize.ts)
// ---------------------------------------------------------------------------

function validateUsername(raw) {
  const display = raw.normalize("NFKC").trim();
  if (display.length < 3 || display.length > 32) {
    throw new Error("Username must be 3–32 characters");
  }
  if (!/^[\p{L}\p{N}._-]+$/u.test(display)) {
    throw new Error("Username may only contain letters, digits, and . _ -");
  }
  return { display, normalized: display.toLowerCase() };
}

// ---------------------------------------------------------------------------
// Password hashing (matches src/auth/password.ts)
// ---------------------------------------------------------------------------

// Cloudflare Workers WebCrypto rejects PBKDF2 counts above 100,000.
const ITERATIONS = 100_000;

async function hashPassword(password) {
  const salt = randomBytes(16);
  const keyMaterial = await subtle.importKey(
    "raw",
    Buffer.from(password, "utf8"),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: ITERATIONS },
    keyMaterial,
    256,
  );
  const saltB64 = salt.toString("base64url");
  const hashB64 = Buffer.from(bits).toString("base64url");
  return `pbkdf2$sha256$${ITERATIONS}$${saltB64}$${hashB64}`;
}

// ---------------------------------------------------------------------------
// Stdin password prompt (no echo)
// ---------------------------------------------------------------------------

async function promptPassword(prompt) {
  const rl = createInterface({ input: process.stdin, output: process.stderr });

  // Disable echo
  if (process.stdin.isTTY) {
    process.stderr.write(prompt);
    process.stdin.setRawMode(true);
    process.stdin.resume();
  } else {
    process.stderr.write(prompt);
  }

  return new Promise((resolve, reject) => {
    let password = "";

    if (process.stdin.isTTY) {
      process.stdin.on("data", (ch) => {
        const c = ch.toString();
        if (c === "\n" || c === "\r" || c === "") {
          if (c === "") {
            process.stdin.setRawMode(false);
            rl.close();
            reject(new Error("Aborted"));
            return;
          }
          process.stderr.write("\n");
          process.stdin.setRawMode(false);
          rl.close();
          resolve(password);
        } else if (c === "" || c === "\b") {
          password = password.slice(0, -1);
        } else {
          password += c;
        }
      });
    } else {
      rl.once("line", (line) => {
        rl.close();
        resolve(line);
      });
      rl.once("close", () => {
        if (!password) reject(new Error("No input"));
      });
    }
  });
}

// ---------------------------------------------------------------------------
// D1 query via wrangler CLI
// ---------------------------------------------------------------------------

async function d1Query(sql) {
  // Values are validated/generated above. execFile passes arguments without a shell.
  const { stdout, stderr } = await execFileAsync(
    "npx",
    ["wrangler", "d1", "execute", "xbloom-db", target, "--command", sql],
    { timeout: 30_000 },
  );
  return { stdout, stderr };
}

async function d1QueryJson(sql) {
  const { stdout } = await execFileAsync(
    "npx",
    ["wrangler", "d1", "execute", "xbloom-db", target, "--json", "--command", sql],
    { timeout: 30_000 },
  );
  try {
    const parsed = JSON.parse(stdout.trim());
    return Array.isArray(parsed) ? parsed[0]?.results ?? [] : [];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  let usernameData;
  try {
    usernameData = validateUsername(username);
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }

  const { display: usernameDisplay, normalized: usernameNormalized } = usernameData;

  // Check if user already exists
  const existing = await d1QueryJson(
    `SELECT id, is_primary FROM users WHERE username_normalized = '${usernameNormalized}'`,
  );
  const existingUser = existing[0];

  if (existingUser && !forceReset) {
    console.error(
      `Error: User '${usernameDisplay}' already exists. Use --force-reset-primary to reset the primary admin password.`,
    );
    process.exit(1);
  }

  if (existingUser && forceReset && !existingUser.is_primary) {
    console.error(
      "Error: --force-reset-primary can only reset the primary admin account.",
    );
    process.exit(1);
  }

  // Prompt for password
  let password;
  try {
    password = await promptPassword("Enter admin password: ");
  } catch {
    console.error("Aborted.");
    process.exit(1);
  }

  if (!password || password.length < 4) {
    console.error("Error: Password must be at least 4 characters.");
    process.exit(1);
  }

  // Confirm
  let confirm;
  try {
    confirm = await promptPassword("Confirm password: ");
  } catch {
    console.error("Aborted.");
    process.exit(1);
  }

  if (password !== confirm) {
    console.error("Error: Passwords do not match.");
    process.exit(1);
  }

  const passwordHash = await hashPassword(password);
  // Clear password from memory (best-effort)
  password = null;
  confirm = null;

  const now = Date.now();

  if (existingUser && forceReset) {
    // Reset existing primary admin's password and increment auth_version
    const sql = `UPDATE users SET password_hash = '${passwordHash}', auth_version = auth_version + 1, updated_at = ${now} WHERE id = '${existingUser.id}'`;
    await d1Query(sql);
    // Delete all existing sessions for this user
    await d1Query(`DELETE FROM sessions WHERE user_id = '${existingUser.id}'`);
    console.log(`Primary admin '${usernameDisplay}' password reset successfully.`);
    console.log("All existing sessions for this account have been invalidated.");
  } else {
    // Create new primary admin
    const id = randomBytes(16).toString("hex").replace(
      /(.{8})(.{4})(.{4})(.{4})(.{12})/,
      "$1-$2-$3-$4-$5",
    );
    const sql = `INSERT INTO users (id, username_display, username_normalized, password_hash, role, enabled, is_primary, auth_version, created_at, updated_at) VALUES ('${id}', '${usernameDisplay}', '${usernameNormalized}', '${passwordHash}', 'admin', 1, 1, 0, ${now}, ${now})`;
    await d1Query(sql);
    console.log(`Primary admin '${usernameDisplay}' created successfully (id: ${id}).`);
    console.log(`Run migrations first if you have not: npm run migrate:${isRemote ? "remote" : "local"}`);
  }
}

main().catch((err) => {
  console.error("Unexpected error:", err.message ?? err);
  process.exit(1);
});
