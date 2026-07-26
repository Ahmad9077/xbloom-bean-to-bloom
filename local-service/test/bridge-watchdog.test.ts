import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const helperPath = fileURLToPath(new URL("../lib/bridge-watchdog.sh", import.meta.url));

function hasActiveSession(forwards: string): boolean {
  const result = spawnSync(
    "bash",
    ["-c", 'source "$1"; has_active_uiautomator2_session "$2"', "bash", helperPath, forwards],
    { encoding: "utf8" },
  );
  return result.status === 0;
}

describe("bridge watchdog Appium-session detection", () => {
  it("protects a UiAutomator2 session using alternate system port 8201", () => {
    expect(hasActiveSession("emulator-5554 tcp:8201 tcp:6790")).toBe(true);
  });

  it("ignores unrelated forwards and other emulators", () => {
    const forwards = [
      "emulator-5554 tcp:8201 tcp:7812",
      "emulator-5556 tcp:8202 tcp:6790",
      "emulator-5554 tcp:3999 tcp:3999",
    ].join("\n");
    expect(hasActiveSession(forwards)).toBe(false);
  });
});
