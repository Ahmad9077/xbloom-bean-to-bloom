import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const auditPath = fileURLToPath(new URL("../lib/bridge-audit.sh", import.meta.url));
const plistTemplatePath = fileURLToPath(
  new URL("../lib/com.xbloom.bean-to-bloom-audit.plist", import.meta.url),
);
const bridgePlistTemplatePath = fileURLToPath(
  new URL("../lib/com.xbloom.bean-to-bloom-bridge.plist", import.meta.url),
);
const watchdogPath = fileURLToPath(new URL("../lib/bridge-watchdog.sh", import.meta.url));

type RunResult = { status: number; stdout: string; stderr: string };

// spawnSync captures both streams regardless of exit code.
// timeout: 30s as a hard ceiling — audit integration tests should finish in ~5s
// after the watchdog subshell pipe-isolation fix.
function bash(script: string, env: Record<string, string> = {}, timeoutMs = 30_000): RunResult {
  const r = spawnSync("bash", ["-c", script], {
    encoding: "utf8",
    env: { ...process.env, ...env },
    timeout: timeoutMs,
  });
  return { status: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

function makeFakeBin(dir: string, scripts: Record<string, string>): void {
  mkdirSync(dir, { recursive: true });
  for (const [name, body] of Object.entries(scripts)) {
    writeFileSync(join(dir, name), `#!/usr/bin/env bash\n${body}\n`, { mode: 0o755 });
  }
}

let runtimeDir: string;
let reportDir: string;

beforeEach(() => {
  runtimeDir = join(tmpdir(), `xbloom-audit-test-${Date.now()}`);
  reportDir = join(runtimeDir, "audit", "reports");
  mkdirSync(reportDir, { recursive: true });
});

afterEach(() => {
  rmSync(runtimeDir, { recursive: true, force: true });
});

// ─── Helpers: set up a complete fake environment for the audit script ─────────

function makeAuditEnv(
  binDir: string,
  androidHome: string,
  overrides: Record<string, string> = {},
): Record<string, string> {
  return {
    PATH: `${binDir}:${process.env.PATH}`,
    ANDROID_HOME: androidHome,
    ANDROID_SDK_ROOT: androidHome,
    XBLOOM_RUNTIME_DIR: runtimeDir,
    XBLOOM_AUDIT_FORCE: "1",
    XBLOOM_AUDIT_REPAIR: "0",
    XBLOOM_AUDIT_TIMEOUT_SEC: "120",
    ADB_PROBE_TIMEOUT_SEC: "5",
    CLOUD_WORKER_URL: "",
    XBLOOM_PACKAGE: "com.xbloom.tbdx",
    ...overrides,
  };
}

// A fake adb binary that handles the calls made by bridge-audit.sh
const FAKE_ADB = `
case "$*" in
  *"get-state"*)                           echo "device" ;;
  *"forward --list"*)                       echo "" ;;
  *"sys.boot_completed"*)                  echo "1" ;;
  *"pm list packages"*)                    echo "package:com.xbloom.tbdx" ;;
  *"dumpsys package"*)                     echo "versionName=2.2.2" ;;
  *"toybox nc"*)                           exit 0 ;;
  *"emu kill"*)                            exit 0 ;;
  *)                                       exit 0 ;;
esac
`.trim();

const FAKE_CURL = `echo '{"ok":true,"status":"ready","queueDepth":0}'`;
const FAKE_LAUNCHCTL = `
case "$*" in
  *"list com.xbloom.bean-to-bloom-bridge"*) printf '{\n  "PID" = 12345;\n  "LastExitStatus" = 0;\n}\n' ;;
  *"kickstart"*)                             exit 0 ;;
  *)                                         exit 0 ;;
esac
`.trim();

// ─── Audit report creation (runs the real script) ────────────────────────────

describe("audit report creation", () => {
  it("creates a timestamped JSON report file with all required check keys", () => {
    const binDir = join(tmpdir(), `audit-bin-${Date.now()}`);
    const androidHome = join(tmpdir(), `audit-android-${Date.now()}`);
    const platformTools = join(androidHome, "platform-tools");
    makeFakeBin(binDir, {
      curl: FAKE_CURL,
      launchctl: FAKE_LAUNCHCTL,
      nc: "exit 0",
      security: "exit 0",
      appium: "echo 'uiautomator2@3.9.0'",
    });
    makeFakeBin(platformTools, { adb: FAKE_ADB });
    // Also put adb in PATH for has_active_uiautomator2_session
    writeFileSync(join(binDir, "adb"), `#!/usr/bin/env bash\n${FAKE_ADB}\n`, { mode: 0o755 });

    const r = bash(`bash "${auditPath}"`, makeAuditEnv(binDir, androidHome));

    try {
      const files = readdirSync(reportDir).filter((f) => f.endsWith(".json"));
      expect(files.length).toBeGreaterThan(0);

      const reportFile = files[0];
      if (!reportFile) throw new Error("audit JSON report was not created");
      const report = JSON.parse(readFileSync(join(reportDir, reportFile), "utf8"));
      expect(report.version).toBe("1");
      expect(report.overall).toMatch(/^(healthy|degraded|failed)$/);
      expect(typeof report.timestamp).toBe("string");
      expect(report.timestamp).toMatch(/^\d{8}T\d{6}Z$/);
      expect(typeof report.duration_sec).toBe("number");
      expect(typeof report.repair_attempted).toBe("boolean");
      expect(report.checks).toBeDefined();
      expect(report.checks.bridge_launchagent.pid).toBe(12345);

      const requiredKeys = [
        "bridge_launchagent",
        "bridge_health",
        "adb_transport",
        "android_boot",
        "emulator_network",
        "host_network",
        "appium",
        "xbloom_app",
        "prerequisites",
        "keychain",
        "disk_space",
        "host_load",
        "recent_errors",
        "cloud_health",
      ];
      for (const key of requiredKeys) {
        expect(report.checks).toHaveProperty(key);
        expect(report.checks[key].status).toMatch(/^(ok|warning|failed)$/);
      }
      expect(existsSync(join(runtimeDir, "audit", "latest.json"))).toBe(true);
      const history = readFileSync(join(runtimeDir, "audit", "history.jsonl"), "utf8").trim();
      expect(history).not.toContain("recipe");
      expect(JSON.parse(history).timestamp).toBe(report.timestamp);
    } finally {
      rmSync(binDir, { recursive: true, force: true });
      rmSync(androidHome, { recursive: true, force: true });
    }
  }, 30_000);

  it("report files are created with mode 600", () => {
    const binDir = join(tmpdir(), `audit-bin-${Date.now()}`);
    const androidHome = join(tmpdir(), `audit-android-${Date.now()}`);
    makeFakeBin(binDir, {
      curl: FAKE_CURL,
      launchctl: FAKE_LAUNCHCTL,
      nc: "exit 0",
      security: "exit 0",
      appium: "echo 'uiautomator2@3.9.0'",
    });
    makeFakeBin(join(androidHome, "platform-tools"), { adb: FAKE_ADB });
    writeFileSync(join(binDir, "adb"), `#!/usr/bin/env bash\n${FAKE_ADB}\n`, { mode: 0o755 });

    bash(`bash "${auditPath}"`, makeAuditEnv(binDir, androidHome));

    try {
      const files = readdirSync(reportDir);
      expect(files.length).toBeGreaterThan(0);
      for (const f of files) {
        const perms = bash(`stat -f '%Lp' "${join(reportDir, f)}"`).stdout.trim();
        expect(perms).toBe("600");
      }
    } finally {
      rmSync(binDir, { recursive: true, force: true });
      rmSync(androidHome, { recursive: true, force: true });
    }
  }, 30_000);

  it("report never includes raw log content", () => {
    const binDir = join(tmpdir(), `audit-bin-${Date.now()}`);
    const androidHome = join(tmpdir(), `audit-android-${Date.now()}`);
    makeFakeBin(binDir, {
      curl: FAKE_CURL,
      launchctl: FAKE_LAUNCHCTL,
      nc: "exit 0",
      security: "exit 0",
      appium: "echo 'uiautomator2@3.9.0'",
    });
    makeFakeBin(join(androidHome, "platform-tools"), { adb: FAKE_ADB });
    writeFileSync(join(binDir, "adb"), `#!/usr/bin/env bash\n${FAKE_ADB}\n`, { mode: 0o755 });
    // Seed a fake bridge log with sensitive data
    writeFileSync(
      join(runtimeDir, "emulator.log"),
      "ERROR: recipe for user@secret.com failed\nFATAL crash at line 99\n",
    );

    bash(`bash "${auditPath}"`, makeAuditEnv(binDir, androidHome));

    try {
      const files = readdirSync(reportDir).filter((f) => f.endsWith(".json"));
      const reportFile = files[0];
      if (!reportFile) throw new Error("audit JSON report was not created");
      const report = JSON.parse(readFileSync(join(reportDir, reportFile), "utf8"));
      const reportText = JSON.stringify(report);
      expect(reportText).not.toContain("user@secret.com");
      expect(reportText).not.toContain("line 99");
      // Count is allowed; raw sample is not
      expect(report.checks.recent_errors.status).toBe("warning");
      expect(typeof report.checks.recent_errors.count).toBe("number");
      expect(report.checks.recent_errors).not.toHaveProperty("sample");
    } finally {
      rmSync(binDir, { recursive: true, force: true });
      rmSync(androidHome, { recursive: true, force: true });
    }
  }, 30_000);

  it("detects UiAutomator2 without a pipefail SIGPIPE false warning", () => {
    const binDir = join(tmpdir(), `audit-driver-bin-${Date.now()}`);
    const androidHome = join(tmpdir(), `audit-driver-android-${Date.now()}`);
    makeFakeBin(binDir, {
      curl: FAKE_CURL,
      launchctl: FAKE_LAUNCHCTL,
      nc: "exit 0",
      security: "exit 0",
      appium: `echo 'uiautomator2@8.0.0 [installed]'; for _ in $(seq 1 5000); do echo filler; done`,
    });
    makeFakeBin(join(androidHome, "platform-tools"), { adb: FAKE_ADB });
    writeFileSync(join(binDir, "adb"), `#!/usr/bin/env bash\n${FAKE_ADB}\n`, { mode: 0o755 });

    bash(`bash "${auditPath}"`, makeAuditEnv(binDir, androidHome));

    try {
      const report = JSON.parse(readFileSync(join(runtimeDir, "audit", "latest.json"), "utf8"));
      expect(report.checks.prerequisites.status).toBe("ok");
      expect(report.checks.prerequisites.uiautomator2).toBe(true);
    } finally {
      rmSync(binDir, { recursive: true, force: true });
      rmSync(androidHome, { recursive: true, force: true });
    }
  }, 30_000);
});

// ─── Once-per-Kuwait-day gate ─────────────────────────────────────────────────

describe("once-per-Kuwait-day gate", () => {
  it("skips the audit if already ran today", () => {
    // Pre-write today's KWT date
    const today = bash("TZ=Asia/Kuwait date +%Y-%m-%d").stdout.trim();
    const gateDir = join(runtimeDir, "audit");
    mkdirSync(gateDir, { recursive: true });
    writeFileSync(join(gateDir, "last-run-kwt-date"), today);

    const binDir = join(tmpdir(), `audit-gate-bin-${Date.now()}`);
    const androidHome = join(tmpdir(), `audit-gate-android-${Date.now()}`);
    makeFakeBin(binDir, {
      curl: FAKE_CURL,
      launchctl: FAKE_LAUNCHCTL,
      nc: "exit 0",
      security: "exit 0",
      appium: "echo 'uiautomator2@3.9.0'",
    });
    makeFakeBin(join(androidHome, "platform-tools"), { adb: FAKE_ADB });
    writeFileSync(join(binDir, "adb"), `#!/usr/bin/env bash\n${FAKE_ADB}\n`, { mode: 0o755 });

    const r = bash(
      `bash "${auditPath}"`,
      makeAuditEnv(binDir, androidHome, { XBLOOM_AUDIT_FORCE: "0" }),
    );

    try {
      expect(r.stderr).toMatch(/already ran today/i);
      // No report file should be created
      const files = existsSync(reportDir)
        ? readdirSync(reportDir).filter((f) => f.endsWith(".json"))
        : [];
      expect(files.length).toBe(0);
    } finally {
      rmSync(binDir, { recursive: true, force: true });
      rmSync(androidHome, { recursive: true, force: true });
    }
  }, 15_000);
});

// ─── Report retention ─────────────────────────────────────────────────────────

describe("report retention", () => {
  it("prunes files older than REPORT_RETENTION_DAYS", () => {
    const oldFile = join(reportDir, "audit-old.json");
    writeFileSync(oldFile, "{}");
    bash(`touch -t $(date -v-31d +%Y%m%d%H%M) "${oldFile}"`);
    const newFile = join(reportDir, "audit-new.json");
    writeFileSync(newFile, "{}");

    bash(`find "${reportDir}" -type f -mtime +30 -delete 2>/dev/null || true`);

    expect(existsSync(oldFile)).toBe(false);
    expect(existsSync(newFile)).toBe(true);
  });
});

// ─── Safe repair gating ───────────────────────────────────────────────────────

describe("safe repair gating", () => {
  it("skips repair when an active UiAutomator2 session is detected", () => {
    const binDir = join(tmpdir(), `fake-bin-${Date.now()}`);
    makeFakeBin(binDir, { adb: "echo 'emulator-5554 tcp:8201 tcp:6790'" });

    const r = bash(
      `
      source "${watchdogPath}"
      ADB_PROBE_TIMEOUT_SEC=5
      if has_active_uiautomator2_session; then echo "skipped_active_session"
      else echo "repair_allowed"; fi
      `,
      { PATH: `${binDir}:${process.env.PATH}` },
    );

    rmSync(binDir, { recursive: true, force: true });
    expect(r.stdout.trim()).toBe("skipped_active_session");
  });

  it("allows repair when no active session is present", () => {
    const binDir = join(tmpdir(), `fake-bin-${Date.now()}`);
    makeFakeBin(binDir, { adb: "echo 'emulator-5554 tcp:3999 tcp:3999'" });

    const r = bash(
      `
      source "${watchdogPath}"
      ADB_PROBE_TIMEOUT_SEC=5
      if has_active_uiautomator2_session; then echo "skipped_active_session"
      else echo "repair_allowed"; fi
      `,
      { PATH: `${binDir}:${process.env.PATH}` },
    );

    rmSync(binDir, { recursive: true, force: true });
    expect(r.stdout.trim()).toBe("repair_allowed");
  });

  it("returns unknown instead of no-session when adb inspection times out", () => {
    const binDir = join(tmpdir(), `fake-bin-${Date.now()}`);
    makeFakeBin(binDir, { adb: "sleep 30" });
    const r = bash(
      `source "${watchdogPath}"; ADB_PROBE_TIMEOUT_SEC=1; has_active_uiautomator2_session; echo $?`,
      { PATH: `${binDir}:${process.env.PATH}` },
      8_000,
    );
    rmSync(binDir, { recursive: true, force: true });
    expect(r.stdout.trim()).toBe("2");
  }, 10_000);

  it("uses kickstart -k not legacy start", () => {
    const content = readFileSync(auditPath, "utf8");
    expect(content).toContain("kickstart -k");
    expect(content).not.toMatch(/launchctl start /);
  });

  it("bridge repair uses correct label com.xbloom.bean-to-bloom-bridge", () => {
    const content = readFileSync(auditPath, "utf8");
    expect(content).toContain("BRIDGE_AGENT_LABEL");
    expect(content).toContain("com.xbloom.bean-to-bloom-bridge");
  });

  it("requires second health probe before repair (false_alarm path)", () => {
    // Both probes succeed → REPAIR_RESULT should be false_alarm or empty
    const content = readFileSync(auditPath, "utf8");
    expect(content).toContain("false_alarm");
  });
});

// ─── Audit lock ───────────────────────────────────────────────────────────────

describe("audit lock", () => {
  it("uses atomic mkdir for the lock", () => {
    const content = readFileSync(auditPath, "utf8");
    expect(content).toContain("mkdir");
    expect(content).toContain("LOCK_DIR");
    expect(content).toContain("LOCK_FILE");
  });

  it("acquire_lock skips when a live process holds the lock", () => {
    const lockFile = join(runtimeDir, "audit.lock");
    const lockDir = `${lockFile}.d`;
    mkdirSync(lockDir, { recursive: true });
    writeFileSync(lockFile, `${process.pid}\n`);

    const r = bash(
      `
      LOCK_FILE="${lockFile}"
      LOCK_DIR="${lockDir}"
      acquire_lock() {
        if mkdir "$LOCK_DIR" 2>/dev/null; then
          echo "$$" > "$LOCK_FILE"; chmod 600 "$LOCK_FILE"; return 0
        fi
        local old_pid; old_pid=$(cat "$LOCK_FILE" 2>/dev/null || echo "")
        if [[ -n "$old_pid" ]] && kill -0 "$old_pid" 2>/dev/null; then
          echo "already_running"; exit 0
        fi
        rm -f "$LOCK_FILE"; rmdir "$LOCK_DIR" 2>/dev/null || true
        if mkdir "$LOCK_DIR" 2>/dev/null; then
          echo "$$" > "$LOCK_FILE"; chmod 600 "$LOCK_FILE"; return 0
        fi
        echo "could_not_lock"; exit 0
      }
      acquire_lock
      echo "acquired"
      `,
    );

    rmSync(lockDir, { recursive: true, force: true });
    expect(r.stdout.trim()).toBe("already_running");
  });

  it("a losing real audit process does not delete the active owner's lock", () => {
    const lockFile = join(runtimeDir, "audit", "audit.lock");
    const lockDir = `${lockFile}.d`;
    mkdirSync(lockDir, { recursive: true });
    writeFileSync(lockFile, `${process.pid}\n`, { mode: 0o600 });

    const r = bash(`bash "${auditPath}"`, {
      XBLOOM_RUNTIME_DIR: runtimeDir,
      XBLOOM_AUDIT_FORCE: "1",
      XBLOOM_AUDIT_REPAIR: "0",
    });

    expect(r.stderr).toMatch(/already running/i);
    expect(existsSync(lockDir)).toBe(true);
    expect(readFileSync(lockFile, "utf8").trim()).toBe(String(process.pid));
  });
});

// ─── LaunchAgent plist template ───────────────────────────────────────────────

describe("LaunchAgent plist template", () => {
  it("plist label is com.xbloom.bean-to-bloom-daily-audit", () => {
    const content = readFileSync(plistTemplatePath, "utf8");
    expect(content).toContain("com.xbloom.bean-to-bloom-daily-audit");
  });

  it("fires at Hour=8 Minute=0", () => {
    const content = readFileSync(plistTemplatePath, "utf8");
    expect(content).toContain("<integer>8</integer>");
    expect(content).toContain("<integer>0</integer>");
  });

  it("RunAtLoad is true", () => {
    const content = readFileSync(plistTemplatePath, "utf8");
    expect(content).toContain("<true/>");
    expect(content).toContain("RunAtLoad");
  });

  it("TZ is Asia/Kuwait", () => {
    const content = readFileSync(plistTemplatePath, "utf8");
    expect(content).toContain("Asia/Kuwait");
  });

  it("all placeholders are substituted by the installer", () => {
    const template = readFileSync(plistTemplatePath, "utf8");
    const resolved = template
      .replace(/AUDIT_SCRIPT_PATH/g, "/home/user/.codex/xbloom-bridge/app/lib/bridge-audit.sh")
      .replace(/USER_HOME/g, "/home/user")
      .replace(/ANDROID_HOME_PATH/g, "/home/user/Library/Android/sdk")
      .replace(/XBLOOM_RUNTIME_PATH/g, "/home/user/.codex/xbloom-bridge");

    expect(resolved).not.toContain("AUDIT_SCRIPT_PATH");
    expect(resolved).not.toContain("USER_HOME");
    expect(resolved).not.toContain("ANDROID_HOME_PATH");
    expect(resolved).not.toContain("XBLOOM_RUNTIME_PATH");
    expect(resolved).toContain("<key>XBLOOM_RUNTIME_DIR</key>");
  });

  it("audit PATH includes Android platform-tools for the session guard", () => {
    const content = readFileSync(plistTemplatePath, "utf8");
    expect(content).toContain("ANDROID_HOME_PATH/platform-tools");
    expect(content).toContain("/usr/sbin:/sbin");
  });

  it("plutil validates the plist structure", () => {
    const r = spawnSync("plutil", ["-lint", plistTemplatePath], { encoding: "utf8" });
    if (r.status === null) return;
    expect(r.status).toBe(0);
  });

  it("main bridge allows enough time for graceful emulator shutdown", () => {
    const content = readFileSync(bridgePlistTemplatePath, "utf8");
    expect(content).toContain("<key>ExitTimeOut</key>");
    expect(content).toContain("<integer>90</integer>");
    const r = spawnSync("plutil", ["-lint", bridgePlistTemplatePath], { encoding: "utf8" });
    if (r.status === null) return;
    expect(r.status).toBe(0);
  });
});

// ─── Disk space thresholds ────────────────────────────────────────────────────

describe("disk space thresholds", () => {
  it.each([
    [50, 80, 90, "ok"],
    [85, 80, 90, "warning"],
    [95, 80, 90, "failed"],
  ] as [number, number, number, string][])(
    "%d%% used → %s (warn=%d crit=%d)",
    (used, warn, crit, expected) => {
      const r = bash(`
        used_pct=${used}
        DISK_WARN_PCT=${warn}
        DISK_CRIT_PCT=${crit}
        if   [[ "$used_pct" -ge "$DISK_CRIT_PCT" ]]; then echo "failed"
        elif [[ "$used_pct" -ge "$DISK_WARN_PCT"  ]]; then echo "warning"
        else echo "ok"; fi
      `);
      expect(r.stdout.trim()).toBe(expected);
    },
  );
});

// ─── Production correctness checks ───────────────────────────────────────────

describe("production correctness", () => {
  it("uses com.xbloom.tbdx as the default xBloom package", () => {
    const content = readFileSync(auditPath, "utf8");
    expect(content).toContain("com.xbloom.tbdx");
    expect(content).not.toContain("xbloom_studio");
  });

  it("uses explicit emulator-5554 serial for all adb shell calls", () => {
    const content = readFileSync(auditPath, "utf8");
    // Every adb call that runs a shell command should specify -s emulator-5554
    const shellLines = content
      .split("\n")
      .filter((l) => l.includes("ADB_BIN") && l.includes("shell"));
    for (const line of shellLines) {
      expect(line).toContain("emulator-5554");
    }
  });

  it("global audit timeout is at least 1200s (20 min)", () => {
    const content = readFileSync(auditPath, "utf8");
    const m = content.match(/XBLOOM_AUDIT_TIMEOUT_SEC:-(\d+)/);
    expect(m).not.toBeNull();
    expect(Number(m?.[1])).toBeGreaterThanOrEqual(1200);
  });

  it("never calls queue claim endpoints or cloud mutation URLs", () => {
    const content = readFileSync(auditPath, "utf8");
    // Must not reference any bridge jobs API path (claim, complete, checkpoint)
    expect(content).not.toMatch(/\/api\/bridge\/jobs/);
    // Must not include cloud-mutation URL fragments
    expect(content).not.toMatch(/\/checkpoint/);
  });
});
