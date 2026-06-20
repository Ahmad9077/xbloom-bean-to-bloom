/**
 * D1 query helpers.
 *
 * All functions accept a D1Database, run specific queries, and return typed results.
 * Image bytes, passwords, and session tokens are NEVER stored or logged here.
 */

// ---------------------------------------------------------------------------
// Row shapes (DB-level snake_case)
// ---------------------------------------------------------------------------

export interface UserRow {
  id: string;
  username_display: string;
  username_normalized: string;
  password_hash: string;
  role: "admin" | "user";
  enabled: number;
  is_primary: number;
  auth_version: number;
  created_at: number;
  updated_at: number;
}

export interface SessionRow {
  token_hash: string;
  user_id: string;
  auth_version: number;
  expires_at: number;
  created_at: number;
  last_seen_at: number;
}

export interface RecipeRow {
  id: string;
  owner_id: string;
  full_name: string;
  bean_name: string;
  recipe_json: string;
  created_at: number;
  updated_at: number;
}

export interface BridgeJobRow {
  id: string;
  recipe_id: string;
  owner_id: string;
  status: "pending" | "claimed" | "completed" | "failed";
  attempts: number;
  claimed_at: number | null;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
  safe_error: string | null;
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

export async function findUserById(db: D1Database, id: string): Promise<UserRow | null> {
  return db.prepare("SELECT * FROM users WHERE id = ?").bind(id).first<UserRow>();
}

export async function findUserByNormalized(
  db: D1Database,
  normalized: string,
): Promise<UserRow | null> {
  return db
    .prepare("SELECT * FROM users WHERE username_normalized = ?")
    .bind(normalized)
    .first<UserRow>();
}

export async function createUser(
  db: D1Database,
  data: {
    id: string;
    usernameDisplay: string;
    usernameNormalized: string;
    passwordHash: string;
    role: "admin" | "user";
    isPrimary: boolean;
  },
): Promise<void> {
  const now = Date.now();
  await db
    .prepare(
      `INSERT INTO users
         (id, username_display, username_normalized, password_hash, role, enabled, is_primary, auth_version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, 0, ?, ?)`,
    )
    .bind(
      data.id,
      data.usernameDisplay,
      data.usernameNormalized,
      data.passwordHash,
      data.role,
      data.isPrimary ? 1 : 0,
      now,
      now,
    )
    .run();
}

export async function updateUserPassword(
  db: D1Database,
  id: string,
  passwordHash: string,
): Promise<void> {
  const now = Date.now();
  await db
    .prepare(
      "UPDATE users SET password_hash = ?, auth_version = auth_version + 1, updated_at = ? WHERE id = ?",
    )
    .bind(passwordHash, now, id)
    .run();
}

export async function updateUserEnabled(
  db: D1Database,
  id: string,
  enabled: boolean,
): Promise<void> {
  const now = Date.now();
  await db
    .prepare(
      "UPDATE users SET enabled = ?, auth_version = auth_version + 1, updated_at = ? WHERE id = ?",
    )
    .bind(enabled ? 1 : 0, now, id)
    .run();
}

export async function updateUserRole(
  db: D1Database,
  id: string,
  role: "admin" | "user",
): Promise<void> {
  const now = Date.now();
  await db
    .prepare(
      "UPDATE users SET role = ?, auth_version = auth_version + 1, updated_at = ? WHERE id = ?",
    )
    .bind(role, now, id)
    .run();
}

export async function updateUserFields(
  db: D1Database,
  id: string,
  fields: {
    passwordHash?: string;
    enabled?: boolean;
    role?: "admin" | "user";
  },
): Promise<void> {
  const assignments: string[] = [];
  const values: unknown[] = [];

  if (fields.passwordHash !== undefined) {
    assignments.push("password_hash = ?");
    values.push(fields.passwordHash);
  }
  if (fields.enabled !== undefined) {
    assignments.push("enabled = ?");
    values.push(fields.enabled ? 1 : 0);
  }
  if (fields.role !== undefined) {
    assignments.push("role = ?");
    values.push(fields.role);
  }
  if (assignments.length === 0) return;

  assignments.push("auth_version = auth_version + 1", "updated_at = ?");
  values.push(Date.now(), id);
  await db
    .prepare(`UPDATE users SET ${assignments.join(", ")} WHERE id = ?`)
    .bind(...values)
    .run();
}

export async function deleteUser(db: D1Database, id: string): Promise<void> {
  await db.prepare("DELETE FROM users WHERE id = ?").bind(id).run();
}

export async function listUsersWithRecipeCounts(
  db: D1Database,
): Promise<Array<UserRow & { recipe_count: number }>> {
  const result = await db
    .prepare(
      `SELECT u.*, COUNT(r.id) AS recipe_count
       FROM users u
       LEFT JOIN recipes r ON r.owner_id = u.id
       GROUP BY u.id
       ORDER BY u.created_at ASC`,
    )
    .all<UserRow & { recipe_count: number }>();
  return result.results;
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export async function findSession(db: D1Database, tokenHash: string): Promise<SessionRow | null> {
  return db
    .prepare("SELECT * FROM sessions WHERE token_hash = ?")
    .bind(tokenHash)
    .first<SessionRow>();
}

export async function createSession(
  db: D1Database,
  data: {
    tokenHash: string;
    userId: string;
    authVersion: number;
    expiresAt: number;
  },
): Promise<void> {
  const now = Date.now();
  await db
    .prepare(
      `INSERT INTO sessions (token_hash, user_id, auth_version, expires_at, created_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(data.tokenHash, data.userId, data.authVersion, data.expiresAt, now, now)
    .run();
}

export async function deleteSession(db: D1Database, tokenHash: string): Promise<void> {
  await db.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(tokenHash).run();
}

export async function deleteUserSessions(db: D1Database, userId: string): Promise<void> {
  await db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(userId).run();
}

export async function deleteExpiredSessions(db: D1Database): Promise<void> {
  await db.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(Date.now()).run();
}

// ---------------------------------------------------------------------------
// Login rate limiting
// ---------------------------------------------------------------------------

const LOGIN_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const LOGIN_MAX_ATTEMPTS = 5;

export async function countRecentLoginAttempts(db: D1Database, keyHash: string): Promise<number> {
  const since = Date.now() - LOGIN_WINDOW_MS;
  const row = await db
    .prepare("SELECT COUNT(*) AS cnt FROM login_attempts WHERE key_hash = ? AND attempted_at >= ?")
    .bind(keyHash, since)
    .first<{ cnt: number }>();
  return row?.cnt ?? 0;
}

export async function recordLoginAttempt(db: D1Database, keyHash: string): Promise<void> {
  await db
    .prepare("INSERT INTO login_attempts (id, key_hash, attempted_at) VALUES (?, ?, ?)")
    .bind(crypto.randomUUID(), keyHash, Date.now())
    .run();
}

export async function clearLoginAttempts(db: D1Database, keyHash: string): Promise<void> {
  await db.prepare("DELETE FROM login_attempts WHERE key_hash = ?").bind(keyHash).run();
}

export async function pruneLoginAttempts(db: D1Database): Promise<void> {
  const cutoff = Date.now() - LOGIN_WINDOW_MS;
  await db.prepare("DELETE FROM login_attempts WHERE attempted_at < ?").bind(cutoff).run();
}

export { LOGIN_MAX_ATTEMPTS, LOGIN_WINDOW_MS };

// ---------------------------------------------------------------------------
// Recipe generation rate limiting
// ---------------------------------------------------------------------------

const RECIPE_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const RECIPE_MAX_ATTEMPTS = 10;

export async function countRecentRecipeAttempts(db: D1Database, userId: string): Promise<number> {
  const since = Date.now() - RECIPE_WINDOW_MS;
  const row = await db
    .prepare("SELECT COUNT(*) AS cnt FROM recipe_attempts WHERE user_id = ? AND attempted_at >= ?")
    .bind(userId, since)
    .first<{ cnt: number }>();
  return row?.cnt ?? 0;
}

export async function recordRecipeAttempt(db: D1Database, userId: string): Promise<void> {
  await db
    .prepare("INSERT INTO recipe_attempts (id, user_id, attempted_at) VALUES (?, ?, ?)")
    .bind(crypto.randomUUID(), userId, Date.now())
    .run();
}

export async function pruneRecipeAttempts(db: D1Database): Promise<void> {
  const cutoff = Date.now() - RECIPE_WINDOW_MS;
  await db.prepare("DELETE FROM recipe_attempts WHERE attempted_at < ?").bind(cutoff).run();
}

export { RECIPE_MAX_ATTEMPTS, RECIPE_WINDOW_MS };

// ---------------------------------------------------------------------------
// Recipes
// ---------------------------------------------------------------------------

export async function storeRecipe(
  db: D1Database,
  data: {
    id: string;
    ownerId: string;
    fullName: string;
    beanName: string;
    recipeJson: string;
  },
): Promise<void> {
  const now = Date.now();
  await db
    .prepare(
      `INSERT INTO recipes (id, owner_id, full_name, bean_name, recipe_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(data.id, data.ownerId, data.fullName, data.beanName, data.recipeJson, now, now)
    .run();
}

export async function findRecipeById(db: D1Database, id: string): Promise<RecipeRow | null> {
  return db.prepare("SELECT * FROM recipes WHERE id = ?").bind(id).first<RecipeRow>();
}

export async function listRecipesByOwner(db: D1Database, ownerId: string): Promise<RecipeRow[]> {
  const result = await db
    .prepare("SELECT * FROM recipes WHERE owner_id = ? ORDER BY created_at DESC")
    .bind(ownerId)
    .all<RecipeRow>();
  return result.results;
}

// ---------------------------------------------------------------------------
// Bridge jobs
// ---------------------------------------------------------------------------

export async function createBridgeJobIfAbsent(
  db: D1Database,
  data: { id: string; recipeId: string; ownerId: string },
): Promise<BridgeJobRow> {
  const existing = await db
    .prepare("SELECT * FROM bridge_jobs WHERE recipe_id = ?")
    .bind(data.recipeId)
    .first<BridgeJobRow>();
  if (existing?.status === "failed") {
    await db
      .prepare(
        `UPDATE bridge_jobs
         SET status = 'pending', attempts = 0, claimed_at = NULL,
             completed_at = NULL, safe_error = NULL, updated_at = ?
         WHERE id = ? AND status = 'failed'`,
      )
      .bind(Date.now(), existing.id)
      .run();
    const retried = await getBridgeJobByRecipe(db, data.recipeId);
    if (!retried) throw new Error("Bridge job retry failed");
    return retried;
  }
  if (existing) return existing;

  const now = Date.now();
  await db
    .prepare(
      `INSERT INTO bridge_jobs
         (id, recipe_id, owner_id, status, attempts, created_at, updated_at)
       VALUES (?, ?, ?, 'pending', 0, ?, ?)
       ON CONFLICT(recipe_id) DO NOTHING`,
    )
    .bind(data.id, data.recipeId, data.ownerId, now, now)
    .run();

  const created = await db
    .prepare("SELECT * FROM bridge_jobs WHERE recipe_id = ?")
    .bind(data.recipeId)
    .first<BridgeJobRow>();
  if (!created) throw new Error("Bridge job insert failed");
  return created;
}

export async function getBridgeJobByRecipe(
  db: D1Database,
  recipeId: string,
): Promise<BridgeJobRow | null> {
  return db
    .prepare("SELECT * FROM bridge_jobs WHERE recipe_id = ?")
    .bind(recipeId)
    .first<BridgeJobRow>();
}

const BRIDGE_STALE_MS = 10 * 60 * 1000; // 10 minutes
export const BRIDGE_MAX_ATTEMPTS = 3;

export async function claimNextBridgeJob(db: D1Database): Promise<BridgeJobRow | null> {
  const staleThreshold = Date.now() - BRIDGE_STALE_MS;

  // Return stale claimed jobs to pending first
  await db
    .prepare(
      `UPDATE bridge_jobs
       SET status = 'pending', claimed_at = NULL, updated_at = ?
       WHERE status = 'claimed' AND claimed_at < ?`,
    )
    .bind(Date.now(), staleThreshold)
    .run();

  // A stale claim has consumed an attempt. Do not leave exhausted jobs pending forever.
  await db
    .prepare(
      `UPDATE bridge_jobs
       SET status = 'failed', completed_at = ?, updated_at = ?, safe_error = ?
       WHERE status = 'pending' AND attempts >= ?`,
    )
    .bind(
      Date.now(),
      Date.now(),
      "The Mac bridge could not complete this recipe after several attempts.",
      BRIDGE_MAX_ATTEMPTS,
    )
    .run();

  // Atomically claim the oldest pending job that still has attempts left
  const now = Date.now();
  const claimed = await db
    .prepare(
      `UPDATE bridge_jobs
       SET status = 'claimed', attempts = attempts + 1, claimed_at = ?, updated_at = ?
       WHERE id = (
         SELECT id FROM bridge_jobs
         WHERE status = 'pending' AND attempts < ?
         ORDER BY created_at ASC
         LIMIT 1
       )
       RETURNING *`,
    )
    .bind(now, now, BRIDGE_MAX_ATTEMPTS)
    .first<BridgeJobRow>();

  return claimed ?? null;
}

export async function completeBridgeJob(
  db: D1Database,
  id: string,
  status: "completed" | "failed",
  safeError: string | null,
): Promise<void> {
  const now = Date.now();
  await db
    .prepare(
      `UPDATE bridge_jobs
       SET status = ?, completed_at = ?, updated_at = ?, safe_error = ?
       WHERE id = ? AND status = 'claimed'`,
    )
    .bind(status, now, now, safeError, id)
    .run();
}

export async function getBridgeJobById(db: D1Database, id: string): Promise<BridgeJobRow | null> {
  return db.prepare("SELECT * FROM bridge_jobs WHERE id = ?").bind(id).first<BridgeJobRow>();
}

export async function pruneOldBridgeJobs(db: D1Database): Promise<void> {
  // Keep completed/failed jobs for 7 days
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  await db
    .prepare("DELETE FROM bridge_jobs WHERE status IN ('completed', 'failed') AND completed_at < ?")
    .bind(cutoff)
    .run();
}
