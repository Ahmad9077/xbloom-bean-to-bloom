import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const DEFAULT_XBLOOM_API_HOSTS = ["client-api.xbloom.com", "backend-api.xbloom.com"];

type ExecFileLike = (
  file: string,
  args: string[],
  options: { timeout: number },
) => Promise<unknown>;

function findAdb(): string | null {
  const roots = [
    process.env.ANDROID_SDK_ROOT ?? "",
    process.env.ANDROID_HOME ?? "",
    path.join(os.homedir(), "Library", "Android", "sdk"),
  ].filter(Boolean);

  for (const root of roots) {
    const candidate = path.join(root, "platform-tools", "adb");
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

export function configuredXbloomApiHosts(raw = process.env.XBLOOM_API_HOSTS): string[] {
  const hosts = (raw ?? DEFAULT_XBLOOM_API_HOSTS.join(","))
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter((host) => /^[a-z0-9.-]+$/.test(host));
  return hosts.length > 0 ? [...new Set(hosts)] : [...DEFAULT_XBLOOM_API_HOSTS];
}

export interface XbloomConnectivityResult {
  ok: boolean;
  failedHost?: string;
  reason?: "adb_missing" | "dns_or_tcp_unreachable";
}

/** Verify DNS and TCP reachability from inside the Android emulator, not from
 * the Mac. The emulator can retain IP connectivity while its virtual DNS
 * forwarder is stale, which prevents xBloom from creating official links. */
export async function probeXbloomApiConnectivity(
  hosts = configuredXbloomApiHosts(),
  run: ExecFileLike = execFileAsync,
  adbPath: string | null = findAdb(),
): Promise<XbloomConnectivityResult> {
  if (!adbPath) return { ok: false, reason: "adb_missing" };

  for (const host of hosts) {
    try {
      await run(
        adbPath,
        ["-s", "emulator-5554", "shell", "toybox", "nc", "-z", "-w", "4", host, "443"],
        { timeout: 7000 },
      );
    } catch {
      return { ok: false, failedHost: host, reason: "dns_or_tcp_unreachable" };
    }
  }
  return { ok: true };
}
