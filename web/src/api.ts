import type { BrewMode, BridgeResponse, Recipe, WorkerResponse } from "./types.js";

const WORKER_URL =
  (import.meta.env.VITE_WORKER_URL as string | undefined) ??
  "https://xbloom-recipe-worker.wld-cba.workers.dev";

const LOCAL_SERVICE_URL =
  (import.meta.env.VITE_LOCAL_SERVICE_URL as string | undefined) ?? "http://127.0.0.1:3999";

export async function analyzeImage(image: File, brewMode: BrewMode): Promise<WorkerResponse> {
  const fd = new FormData();
  fd.append("image", image);
  fd.append("brewMode", brewMode);

  const res = await fetch(`${WORKER_URL}/v1/recipes/from-image`, {
    method: "POST",
    body: fd,
  });

  if (!res.ok && res.status === 0) {
    throw new Error("Network error — check your connection.");
  }

  return res.json() as Promise<WorkerResponse>;
}

export async function checkBridge(): Promise<boolean> {
  try {
    const res = await fetch(`${LOCAL_SERVICE_URL}/health`, {
      signal: AbortSignal.timeout(3000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function saveRecipe(recipe: Recipe, idempotencyKey: string): Promise<BridgeResponse> {
  const res = await fetch(`${LOCAL_SERVICE_URL}/v1/recipes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ recipe, confirmSave: true, idempotencyKey }),
    signal: AbortSignal.timeout(120_000),
  });

  return res.json() as Promise<BridgeResponse>;
}
