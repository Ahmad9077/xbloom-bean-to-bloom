import { describe, expect, it, vi } from "vitest";
import { configuredXbloomApiHosts, probeXbloomApiConnectivity } from "../src/connectivity.js";

describe("xBloom emulator connectivity", () => {
  it("normalizes and de-duplicates configured hosts", () => {
    expect(
      configuredXbloomApiHosts(" CLIENT-API.XBLOOM.COM,client-api.xbloom.com,bad host "),
    ).toEqual(["client-api.xbloom.com"]);
  });

  it("checks every required host from inside the emulator", async () => {
    const run = vi.fn().mockResolvedValue({});
    await expect(
      probeXbloomApiConnectivity(
        ["client-api.xbloom.com", "backend-api.xbloom.com"],
        run,
        "/sdk/platform-tools/adb",
      ),
    ).resolves.toEqual({ ok: true });
    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[0]?.[1]).toContain("client-api.xbloom.com");
    expect(run.mock.calls[1]?.[1]).toContain("backend-api.xbloom.com");
  });

  it("fails before a job can be claimed when emulator DNS is broken", async () => {
    const run = vi.fn().mockRejectedValue(new Error("nc: bad address"));
    await expect(
      probeXbloomApiConnectivity(["client-api.xbloom.com"], run, "/sdk/platform-tools/adb"),
    ).resolves.toEqual({
      ok: false,
      failedHost: "client-api.xbloom.com",
      reason: "dns_or_tcp_unreachable",
    });
  });
});
