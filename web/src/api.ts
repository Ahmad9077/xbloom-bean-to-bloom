import type {
  AdminUser,
  AuthUser,
  BrewMode,
  BrewStrength,
  BridgeJob,
  Recipe,
  RecipeListItem,
} from "./types.js";

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, code: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }
}

async function req(path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(path, { credentials: "include", ...init });
  const data: unknown = await res.json();
  if (!res.ok) {
    const err = (data as { error?: { code?: string; message?: string } }).error;
    const apiError = new ApiError(
      err?.message ?? `HTTP ${res.status}`,
      err?.code ?? "UNKNOWN",
      res.status,
    );
    if (res.status === 401 && path !== "/api/auth/login" && path !== "/api/auth/me") {
      window.dispatchEvent(new Event("xbloom:unauthorized"));
    }
    throw apiError;
  }
  return data;
}

async function jsonReq(path: string, method: string, body: unknown): Promise<unknown> {
  return req(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// Auth
export async function apiLogin(username: string, password: string): Promise<AuthUser> {
  const data = await jsonReq("/api/auth/login", "POST", { username, password });
  return (data as { user: AuthUser }).user;
}

export async function apiLogout(): Promise<void> {
  await jsonReq("/api/auth/logout", "POST", {});
}

export async function apiMe(): Promise<AuthUser | null> {
  try {
    const data = await req("/api/auth/me");
    return (data as { user: AuthUser }).user;
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return null;
    throw err;
  }
}

// Recipes
export async function apiCreateRecipe(
  images: File[],
  brewMode: BrewMode,
  strength: BrewStrength,
): Promise<{ id: string; link: string; recipe: Recipe }> {
  const fd = new FormData();
  for (const img of images) fd.append("images", img);
  fd.append("brewMode", brewMode);
  fd.append("strength", strength);

  const data = await req("/api/recipes/from-images", { method: "POST", body: fd });
  return data as { id: string; link: string; recipe: Recipe };
}

export async function apiGetRecipe(id: string): Promise<Recipe> {
  const data = await req(`/api/recipes/${encodeURIComponent(id)}`);
  return (data as { recipe: Recipe }).recipe;
}

export async function apiGetRecipes(): Promise<RecipeListItem[]> {
  const data = await req("/api/recipes");
  return (data as { recipes: RecipeListItem[] }).recipes;
}

// Bridge jobs
export async function apiCreateBridgeJob(recipeId: string, retry = false): Promise<BridgeJob> {
  const data = await req(`/api/recipes/${encodeURIComponent(recipeId)}/bridge-jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ retry }),
  });
  return (data as { job: BridgeJob }).job;
}

export async function apiGetBridgeJob(recipeId: string): Promise<BridgeJob | null> {
  try {
    const data = await req(`/api/recipes/${encodeURIComponent(recipeId)}/bridge-jobs`);
    return (data as { job: BridgeJob }).job;
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

// Admin
export async function apiGetUsers(): Promise<AdminUser[]> {
  const data = await req("/api/admin/users");
  return (data as { users: AdminUser[] }).users;
}

export async function apiCreateUser(
  username: string,
  password: string,
  role: "admin" | "user",
): Promise<AdminUser> {
  const data = await jsonReq("/api/admin/users", "POST", { username, password, role });
  return (data as { user: AdminUser }).user;
}

export async function apiUpdateUser(
  id: string,
  patch: { password?: string; enabled?: boolean; role?: "admin" | "user" },
): Promise<void> {
  await jsonReq(`/api/admin/users/${id}`, "PATCH", patch);
}

export async function apiDeleteUser(id: string): Promise<void> {
  await req(`/api/admin/users/${id}`, { method: "DELETE" });
}

// Image compression: resize to max 1600px long edge, output JPEG ~0.82 quality.
// Falls back to original file on any canvas/decode error.
export async function compressImage(file: File): Promise<File> {
  const lowerName = file.name.toLowerCase();
  if (
    file.type === "image/heic" ||
    file.type === "image/heif" ||
    lowerName.endsWith(".heic") ||
    lowerName.endsWith(".heif")
  ) {
    throw new Error("HEIC format is not supported. Please convert to JPEG, PNG, or WebP first.");
  }

  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    return file;
  }

  return new Promise<File>((resolve) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const MAX = 1600;
      let { width, height } = img;
      if (Math.max(width, height) > MAX) {
        if (width >= height) {
          height = Math.round((height * MAX) / width);
          width = MAX;
        } else {
          width = Math.round((width * MAX) / height);
          height = MAX;
        }
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve(file);
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            resolve(file);
            return;
          }
          const outName = `${file.name.replace(/\.[^.]+$/, "")}.jpg`;
          resolve(new File([blob], outName, { type: "image/jpeg" }));
        },
        "image/jpeg",
        0.82,
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(file);
    };

    img.src = objectUrl;
  });
}
