import { enforceSameOrigin, requireAdmin } from "../auth/middleware.js";
import { hashPassword } from "../auth/password.js";
import {
  createUser,
  deleteUser,
  deleteUserSessions,
  findUserById,
  listUsersWithRecipeCounts,
  updateUserFields,
} from "../db.js";
import { ClientError, ConflictError, ForbiddenError, NotFoundError } from "../errors.js";
import { parseUsername, validatePassword } from "../sanitize.js";
import type { Env } from "../types.js";

// ---------------------------------------------------------------------------
// GET /api/admin/users
// ---------------------------------------------------------------------------

export async function handleListUsers(
  request: Request,
  env: Env,
  requestId: string,
): Promise<Response> {
  enforceSameOrigin(request);
  await requireAdmin(request, env);
  const rows = await listUsersWithRecipeCounts(env.DB);

  const users = rows.map((r) => ({
    id: r.id,
    username: r.username_display,
    role: r.role,
    enabled: r.enabled === 1,
    isPrimary: r.is_primary === 1,
    recipeCount: r.recipe_count,
    createdAt: r.created_at,
  }));

  return new Response(JSON.stringify({ ok: true, requestId, users }), {
    status: 200,
    headers: { "Content-Type": "application/json;charset=UTF-8" },
  });
}

// ---------------------------------------------------------------------------
// POST /api/admin/users  { username, password, role? }
// ---------------------------------------------------------------------------

export async function handleCreateUser(
  request: Request,
  env: Env,
  requestId: string,
): Promise<Response> {
  enforceSameOrigin(request);
  await requireAdmin(request, env);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new ClientError("Expected JSON body");
  }
  const obj = asObject(body);

  const rawUsername = stringField(obj, "username");
  const rawPassword = stringField(obj, "password");
  const rawRole = typeof obj.role === "string" ? obj.role : "user";
  if (rawRole !== "admin" && rawRole !== "user")
    throw new ClientError("role must be admin or user");

  let display: string;
  let normalized: string;
  try {
    ({ display, normalized } = parseUsername(rawUsername));
  } catch (e) {
    throw new ClientError(e instanceof Error ? e.message : "Invalid username");
  }

  try {
    validatePassword(rawPassword);
  } catch (e) {
    throw new ClientError(e instanceof Error ? e.message : "Invalid password");
  }

  // Check for duplicate
  const { findUserByNormalized } = await import("../db.js");
  const existing = await findUserByNormalized(env.DB, normalized);
  if (existing) throw new ConflictError("Username already taken");

  const id = crypto.randomUUID();
  const passwordHash = await hashPassword(rawPassword);

  await createUser(env.DB, {
    id,
    usernameDisplay: display,
    usernameNormalized: normalized,
    passwordHash,
    role: rawRole,
    isPrimary: false,
  });

  return new Response(
    JSON.stringify({ ok: true, requestId, user: { id, username: display, role: rawRole } }),
    { status: 201, headers: { "Content-Type": "application/json;charset=UTF-8" } },
  );
}

// ---------------------------------------------------------------------------
// PATCH /api/admin/users/:id
// Body can contain: { password?, enabled?, role? }
// ---------------------------------------------------------------------------

export async function handlePatchUser(
  request: Request,
  env: Env,
  requestId: string,
  targetId: string,
): Promise<Response> {
  enforceSameOrigin(request);
  await requireAdmin(request, env);

  const target = await findUserById(env.DB, targetId);
  if (!target) throw new NotFoundError("User not found");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new ClientError("Expected JSON body");
  }
  const obj = asObject(body);

  const allowedKeys = new Set(["password", "enabled", "role"]);
  const keys = Object.keys(obj);
  if (keys.length === 0) throw new ClientError("At least one user field is required");
  const unknownKey = keys.find((key) => !allowedKeys.has(key));
  if (unknownKey) throw new ClientError(`Unknown user field: ${unknownKey}`);

  // Primary admin self-protection
  if (target.is_primary === 1) {
    if ("enabled" in obj && obj.enabled === false) {
      throw new ForbiddenError("The primary administrator cannot be disabled");
    }
    if ("role" in obj && obj.role !== "admin") {
      throw new ForbiddenError("The primary administrator role cannot be changed");
    }
  }

  let password: string | undefined;
  let enabled: boolean | undefined;
  let role: "admin" | "user" | undefined;

  if ("password" in obj) {
    const pw = stringField(obj, "password");
    try {
      validatePassword(pw);
    } catch (e) {
      throw new ClientError(e instanceof Error ? e.message : "Invalid password");
    }
    password = pw;
  }

  if ("enabled" in obj) {
    if (typeof obj.enabled !== "boolean") throw new ClientError("enabled must be boolean");
    enabled = obj.enabled;
  }

  if ("role" in obj) {
    if (obj.role !== "admin" && obj.role !== "user") {
      throw new ClientError("role must be admin or user");
    }
    role = obj.role;
  }

  const passwordHash = password === undefined ? undefined : await hashPassword(password);
  const fields: Parameters<typeof updateUserFields>[2] = {};
  if (passwordHash !== undefined) fields.passwordHash = passwordHash;
  if (enabled !== undefined) fields.enabled = enabled;
  if (role !== undefined) fields.role = role;
  await updateUserFields(env.DB, targetId, fields);
  await deleteUserSessions(env.DB, targetId);

  return new Response(JSON.stringify({ ok: true, requestId }), {
    status: 200,
    headers: { "Content-Type": "application/json;charset=UTF-8" },
  });
}

// ---------------------------------------------------------------------------
// DELETE /api/admin/users/:id
// ---------------------------------------------------------------------------

export async function handleDeleteUser(
  request: Request,
  env: Env,
  requestId: string,
  targetId: string,
): Promise<Response> {
  enforceSameOrigin(request);
  await requireAdmin(request, env);

  const target = await findUserById(env.DB, targetId);
  if (!target) throw new NotFoundError("User not found");

  if (target.is_primary === 1) {
    throw new ForbiddenError("The primary administrator cannot be deleted");
  }

  await deleteUser(env.DB, targetId);

  return new Response(JSON.stringify({ ok: true, requestId }), {
    status: 200,
    headers: { "Content-Type": "application/json;charset=UTF-8" },
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function asObject(v: unknown): Record<string, unknown> {
  if (typeof v !== "object" || v === null || Array.isArray(v)) {
    throw new ClientError("Request body must be a JSON object");
  }
  return v as Record<string, unknown>;
}

function stringField(obj: Record<string, unknown>, key: string): string {
  const val = obj[key];
  if (typeof val !== "string" || val.length === 0) {
    throw new ClientError(`"${key}" is required and must be a non-empty string`);
  }
  return val;
}
