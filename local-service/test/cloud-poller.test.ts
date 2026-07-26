import { afterEach, describe, expect, it, vi } from "vitest";
import { computePollDelayMs, requireShareLink, startCloudPoller } from "../src/cloud-poller.js";
import { ErrorCode, ServiceError } from "../src/errors.js";
import type { Config, Recipe } from "../src/types.js";

const config: Config = {
  port: 3999,
  appiumUrl: "http://127.0.0.1:4723",
  allowedOrigins: new Set(),
  allowedHosts: new Set(),
  expectedAppVersion: "2.2.2",
  expectedAppVersionCode: 2002033,
  skipVersionCheck: false,
  elementTimeoutMs: 10_000,
  sliderMaxRetries: 5,
  screenshotDir: "./runtime/screenshots",
  idempotencyTtlMs: 86_400_000,
  cloudWorkerUrl: "https://worker.example",
  bridgeToken: "test-token",
  bridgePollIntervalMs: 60_000,
};

const recipe: Recipe = {
  name: "HSA - Cold/48/decaf colombia",
  machine: "xBloom Studio",
  dripper: "Other",
  brewRatio: "1:9",
  totalVolumeMl: 180,
  doseG: 20,
  grindSize: 40,
  rpm: 80,
  pours: [
    {
      label: "Bloom",
      volumeMl: 40,
      tempC: 92,
      flowRateMlPerSec: 3,
      pauseSec: 35,
      pattern: "centered",
      agitationBefore: false,
      agitationAfter: false,
    },
    {
      label: "Pour 2",
      volumeMl: 140,
      tempC: 90,
      flowRateMlPerSec: 3.2,
      pauseSec: 2,
      pattern: "spiral",
      agitationBefore: false,
      agitationAfter: false,
    },
  ],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("cloud poll backoff", () => {
  it("uses the configured interval while healthy", () => {
    expect(computePollDelayMs(5000, 0)).toBe(5000);
  });

  it("backs off exponentially and caps prolonged outages at one minute", () => {
    expect(computePollDelayMs(5000, 1)).toBe(5000);
    expect(computePollDelayMs(5000, 2)).toBe(10_000);
    expect(computePollDelayMs(5000, 3)).toBe(20_000);
    expect(computePollDelayMs(5000, 20)).toBe(60_000);
  });

  it("prevents a broken configuration from creating a tight polling loop", () => {
    expect(computePollDelayMs(0, 1)).toBe(1000);
  });
});

describe("cloud completion", () => {
  it("refuses to report completion until xBloom returns a share link", () => {
    expect(() => requireShareLink(undefined)).toThrow(/did not return a share link/i);
  });

  it("returns a present share link", () => {
    const link = "https://share-h5.xbloom.com/?id=test";
    expect(requireShareLink(link)).toBe(link);
  });
});

describe("cloud poller connectivity safety", () => {
  it("does not claim a job while the emulator cannot reach xBloom", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const probeConnectivity = vi.fn().mockResolvedValue({
      ok: false,
      failedHost: "client-api.xbloom.com",
      reason: "dns_or_tcp_unreachable",
    });

    const stop = startCloudPoller(config, { probeConnectivity });
    await vi.waitFor(() => expect(probeConnectivity).toHaveBeenCalledOnce());
    stop();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("leaves a claimed lease uncompleted when connectivity is lost after Save", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ok: true,
          job: {
            id: "job-hsa",
            recipeId: "recipe-hsa",
            recipe,
            saveStarted: true,
            recipeSaved: true,
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const runAutomation = vi
      .fn()
      .mockRejectedValue(
        new ServiceError(ErrorCode.XBLOOM_NETWORK_UNAVAILABLE, "emulator network unavailable", 503),
      );

    const stop = startCloudPoller(config, {
      probeConnectivity: vi.fn().mockResolvedValue({ ok: true }),
      runAutomation,
    });
    await vi.waitFor(() => expect(runAutomation).toHaveBeenCalledOnce());
    await new Promise((resolve) => setTimeout(resolve, 0));
    stop();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/api/bridge/jobs/next");
  });
});
