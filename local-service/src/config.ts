import type { Config } from "./types.js";

function env(key: string, fallback?: string): string {
  const val = process.env[key] ?? fallback;
  if (val === undefined) throw new Error(`Missing required env var: ${key}`);
  return val;
}

function envBool(key: string, fallback: boolean): boolean {
  const val = process.env[key];
  if (val === undefined) return fallback;
  return val.toLowerCase() === "true";
}

function envInt(key: string, fallback: number): number {
  const val = process.env[key];
  if (val === undefined) return fallback;
  const n = Number.parseInt(val, 10);
  if (Number.isNaN(n)) throw new Error(`Env var ${key} must be an integer`);
  return n;
}

export function loadConfig(): Config {
  const originsRaw = env("ALLOWED_ORIGINS", "");
  const hostsRaw = env("ALLOWED_HOSTS", "localhost:3999,127.0.0.1:3999");

  return {
    port: envInt("PORT", 3999),
    appiumUrl: env("APPIUM_URL", "http://127.0.0.1:4723"),
    allowedOrigins: new Set(
      originsRaw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    ),
    allowedHosts: new Set(
      hostsRaw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    ),
    expectedAppVersion: env("EXPECTED_APP_VERSION", "2.2.2"),
    skipVersionCheck: envBool("SKIP_VERSION_CHECK", false),
    elementTimeoutMs: envInt("ELEMENT_TIMEOUT_MS", 10000),
    sliderMaxRetries: envInt("SLIDER_MAX_RETRIES", 5),
    screenshotDir: env("SCREENSHOT_DIR", "./runtime/screenshots"),
    idempotencyTtlMs: envInt("IDEMPOTENCY_TTL_MS", 86400000),
  };
}
