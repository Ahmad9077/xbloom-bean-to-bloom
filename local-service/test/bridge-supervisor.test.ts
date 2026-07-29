import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const supervisorPath = fileURLToPath(new URL("../lib/bridge-supervisor.sh", import.meta.url));

type RunResult = { status: number; stdout: string; stderr: string };

// spawnSync always captures both streams regardless of exit code.
function bash(script: string, env: Record<string, string> = {}): RunResult {
  const r = spawnSync("bash", ["-c", script], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  return { status: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

// Source the supervisor lib then run an expression.
function sup(expr: string, env: Record<string, string> = {}): RunResult {
  return bash(`source "${supervisorPath}"; ${expr}`, env);
}

// Create a temp dir with fake binaries (mode 0o755).
function makeFakeBin(dir: string, scripts: Record<string, string>): void {
  mkdirSync(dir, { recursive: true });
  for (const [name, body] of Object.entries(scripts)) {
    writeFileSync(join(dir, name), `#!/usr/bin/env bash\n${body}\n`, { mode: 0o755 });
  }
}

// ─── compute_boot_backoff_sec ─────────────────────────────────────────────────

describe("compute_boot_backoff_sec", () => {
  it("returns 0 for 0 failures", () => {
    expect(sup("compute_boot_backoff_sec 0").stdout.trim()).toBe("0");
  });

  it("returns 30s for 1 failure", () => {
    expect(sup("compute_boot_backoff_sec 1").stdout.trim()).toBe("30");
  });

  it("backs off exponentially: 1→30 2→60 3→120 4→240", () => {
    const delays = [1, 2, 3, 4].map((n) =>
      Number(sup(`compute_boot_backoff_sec ${n}`).stdout.trim()),
    );
    expect(delays).toEqual([30, 60, 120, 240]);
  });

  it("caps at 300s for 5+ failures", () => {
    expect(Number(sup("compute_boot_backoff_sec 5").stdout.trim())).toBe(300);
    expect(Number(sup("compute_boot_backoff_sec 10").stdout.trim())).toBe(300);
    expect(Number(sup("compute_boot_backoff_sec 60").stdout.trim())).toBe(300);
    expect(Number(sup("compute_boot_backoff_sec 64").stdout.trim())).toBe(300);
  });
});

// ─── read / write / reset boot failures ──────────────────────────────────────

describe("boot-failure persistence", () => {
  let dir: string;

  beforeEach(() => {
    dir = join(tmpdir(), `xbloom-sup-test-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("reads 0 when no file exists", () => {
    expect(sup("read_boot_failures", { XBLOOM_RUNTIME_DIR: dir }).stdout.trim()).toBe("0");
  });

  it("writes and reads back a count", () => {
    expect(
      sup("write_boot_failures 3; read_boot_failures", { XBLOOM_RUNTIME_DIR: dir }).stdout.trim(),
    ).toBe("3");
  });

  it("reset removes the counter and next read returns 0", () => {
    expect(
      sup("write_boot_failures 7; reset_boot_failures; read_boot_failures", {
        XBLOOM_RUNTIME_DIR: dir,
      }).stdout.trim(),
    ).toBe("0");
  });

  it("ignores corrupted file content and returns 0", () => {
    writeFileSync(join(dir, "boot-failures"), "notanumber\n");
    expect(sup("read_boot_failures", { XBLOOM_RUNTIME_DIR: dir }).stdout.trim()).toBe("0");
  });

  it("write_boot_failures creates file with mode 600", () => {
    sup("write_boot_failures 1", { XBLOOM_RUNTIME_DIR: dir });
    const perms = bash(`stat -f '%Lp' "${dir}/boot-failures"`).stdout.trim();
    expect(perms).toBe("600");
  });
});

// ─── adb_boot_completed (stubbed adb) ────────────────────────────────────────

describe("adb_boot_completed", () => {
  let binDir: string;

  beforeEach(() => {
    binDir = join(tmpdir(), `fake-bin-${Date.now()}`);
  });

  afterEach(() => {
    rmSync(binDir, { recursive: true, force: true });
  });

  it("returns true when adb reports sys.boot_completed=1", () => {
    makeFakeBin(binDir, { adb: "echo 1" });
    const r = sup("adb_boot_completed && echo yes || echo no", {
      PATH: `${binDir}:${process.env.PATH}`,
    });
    expect(r.stdout.trim()).toBe("yes");
  });

  it("returns false when adb reports sys.boot_completed=0", () => {
    makeFakeBin(binDir, { adb: "echo 0" });
    const r = sup("adb_boot_completed && echo yes || echo no", {
      PATH: `${binDir}:${process.env.PATH}`,
    });
    expect(r.stdout.trim()).toBe("no");
  });

  it("returns false when adb returns empty output", () => {
    makeFakeBin(binDir, { adb: "echo ''" });
    const r = sup("adb_boot_completed && echo yes || echo no", {
      PATH: `${binDir}:${process.env.PATH}`,
    });
    expect(r.stdout.trim()).toBe("no");
  });

  it("returns false and does not hang when adb blocks beyond timeout", () => {
    makeFakeBin(binDir, { adb: "sleep 30" });
    const start = Date.now();
    const r = sup("ADB_PROBE_TIMEOUT_SEC=1; adb_boot_completed && echo yes || echo no", {
      PATH: `${binDir}:${process.env.PATH}`,
    });
    const elapsed = Date.now() - start;
    expect(r.stdout.trim()).toBe("no");
    // Should complete well within 5s even with Python overhead
    expect(elapsed).toBeLessThan(5000);
  }, 10_000);
});

// ─── adb_get_state_ok (stubbed adb) ──────────────────────────────────────────

describe("adb_get_state_ok", () => {
  let binDir: string;

  beforeEach(() => {
    binDir = join(tmpdir(), `fake-bin-${Date.now()}`);
  });

  afterEach(() => {
    rmSync(binDir, { recursive: true, force: true });
  });

  it("returns true when the serial is listed as device", () => {
    makeFakeBin(binDir, {
      adb: "printf 'List of devices attached\\nemulator-5554 device product:sdk\\n'",
    });
    const r = sup("adb_get_state_ok && echo yes || echo no", {
      PATH: `${binDir}:${process.env.PATH}`,
    });
    expect(r.stdout.trim()).toBe("yes");
  });

  it("returns false and unknown when adb exits non-zero", () => {
    makeFakeBin(binDir, { adb: "exit 1" });
    const r = sup("adb_get_state_ok && echo yes || echo no", {
      PATH: `${binDir}:${process.env.PATH}`,
    });
    expect(r.stdout.trim()).toBe("no");
    expect(sup("adb_serial_state", { PATH: `${binDir}:${process.env.PATH}` }).stdout.trim()).toBe(
      "unknown",
    );
  });

  it("reports absent only after a successful listing without the serial", () => {
    makeFakeBin(binDir, { adb: "printf 'List of devices attached\\n\\n'" });
    expect(sup("adb_serial_state", { PATH: `${binDir}:${process.env.PATH}` }).stdout.trim()).toBe(
      "absent",
    );
  });

  it("reports an offline serial as present, not absent", () => {
    makeFakeBin(binDir, { adb: "printf 'List of devices attached\\nemulator-5554 offline\\n'" });
    expect(sup("adb_serial_state", { PATH: `${binDir}:${process.env.PATH}` }).stdout.trim()).toBe(
      "present",
    );
  });

  it("returns false and does not hang when adb blocks beyond timeout", () => {
    makeFakeBin(binDir, { adb: "sleep 30" });
    const start = Date.now();
    const r = sup("ADB_PROBE_TIMEOUT_SEC=1; adb_get_state_ok && echo yes || echo no", {
      PATH: `${binDir}:${process.env.PATH}`,
    });
    const elapsed = Date.now() - start;
    expect(r.stdout.trim()).toBe("no");
    expect(elapsed).toBeLessThan(5000);
  }, 10_000);
});

// ─── stop_emulator_and_wait (stubbed adb) ────────────────────────────────────

describe("stop_emulator_and_wait", () => {
  let binDir: string;

  beforeEach(() => {
    binDir = join(tmpdir(), `fake-bin-${Date.now()}`);
  });

  afterEach(() => {
    rmSync(binDir, { recursive: true, force: true });
  });

  it("returns immediately after a successful adb listing confirms absence", () => {
    makeFakeBin(binDir, {
      adb: `case "$*" in
        *"emu kill"*) exit 0 ;;
        *"devices -l"*) printf 'List of devices attached\\n\\n'; exit 0 ;;
        *) exit 1 ;;
      esac`,
    });
    const r = sup("stop_emulator_and_wait 10 emulator-5554 ''", {
      PATH: `${binDir}:${process.env.PATH}`,
    });
    expect(r.status).toBe(0);
    expect(r.stderr).toMatch(/gone from ADB/i);
  });

  it("times out gracefully when emulator never disappears", () => {
    makeFakeBin(binDir, {
      adb: `case "$*" in
        *"emu kill"*) exit 0 ;;
        *"devices -l"*) printf 'List of devices attached\\nemulator-5554 offline\\n'; exit 0 ;;
        *) exit 0 ;;
      esac`,
    });
    const start = Date.now();
    const r = sup("XBLOOM_STOP_CONFIRM_TIMEOUT_SEC=2; stop_emulator_and_wait 3 emulator-5554 ''", {
      PATH: `${binDir}:${process.env.PATH}`,
    });
    const elapsed = Date.now() - start;
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/did not fully stop/i);
    // Must have waited at least one sleep cycle (2s) before the 3s deadline
    expect(elapsed).toBeGreaterThan(1500);
  }, 10_000);

  it("does not mistake an adb probe timeout for a stopped emulator", () => {
    makeFakeBin(binDir, { adb: "sleep 30" });
    const start = Date.now();
    const r = sup(
      "ADB_PROBE_TIMEOUT_SEC=1; XBLOOM_STOP_CONFIRM_TIMEOUT_SEC=2; stop_emulator_and_wait 2 emulator-5554 ''",
      { PATH: `${binDir}:${process.env.PATH}` },
    );
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/did not fully stop/i);
    expect(Date.now() - start).toBeLessThan(20_000);
  }, 25_000);

  it("kills a supplied emulator PID before waiting", () => {
    makeFakeBin(binDir, {
      adb: `case "$*" in
        *"emu kill"*) exit 0 ;;
        *"devices -l"*) printf 'List of devices attached\\n\\n'; exit 0 ;;
        *) exit 1 ;;
      esac`,
    });
    const r = bash(
      `
      source "${supervisorPath}"
      (sleep 60) &
      epid=$!
      stop_emulator_and_wait 5 emulator-5554 "$epid" 2>&1
      if kill -0 "$epid" 2>/dev/null; then echo "still_running"; else echo "killed"; fi
      `,
      { PATH: `${binDir}:${process.env.PATH}` },
    );
    expect(r.stdout).toContain("killed");
  });
});

// ─── Boot timeout integration ─────────────────────────────────────────────────

describe("boot timeout integration", () => {
  it("backoff values are non-decreasing and bounded", () => {
    const delays = [1, 2, 3, 4, 5, 10].map((n) =>
      Number(sup(`compute_boot_backoff_sec ${n}`).stdout.trim()),
    );
    for (let i = 1; i < delays.length; i++) {
      expect(delays[i]).toBeGreaterThanOrEqual(delays[i - 1] as number);
    }
    for (const d of delays) {
      expect(d).toBeGreaterThan(0);
      expect(d).toBeLessThanOrEqual(300);
    }
  });

  it("boot failure increments persist across reads (simulate launchd restart)", () => {
    const dir = join(tmpdir(), `boot-persist-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    try {
      sup("write_boot_failures 1", { XBLOOM_RUNTIME_DIR: dir });
      const n = sup("read_boot_failures", { XBLOOM_RUNTIME_DIR: dir }).stdout.trim();
      expect(n).toBe("1");
      const backoff = Number(
        sup(`compute_boot_backoff_sec ${n}`, { XBLOOM_RUNTIME_DIR: dir }).stdout.trim(),
      );
      expect(backoff).toBe(30);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reset_boot_failures stops backoff growth after a healthy startup", () => {
    const dir = join(tmpdir(), `boot-reset-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    try {
      sup("write_boot_failures 4", { XBLOOM_RUNTIME_DIR: dir });
      let n = Number(sup("read_boot_failures", { XBLOOM_RUNTIME_DIR: dir }).stdout.trim());
      expect(n).toBe(4);
      // Healthy boot resets
      sup("reset_boot_failures", { XBLOOM_RUNTIME_DIR: dir });
      n = Number(sup("read_boot_failures", { XBLOOM_RUNTIME_DIR: dir }).stdout.trim());
      expect(n).toBe(0);
      expect(Number(sup("compute_boot_backoff_sec 0").stdout.trim())).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
