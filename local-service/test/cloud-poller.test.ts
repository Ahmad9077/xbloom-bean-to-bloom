import { describe, expect, it } from "vitest";
import { computePollDelayMs, requireShareLink } from "../src/cloud-poller.js";

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
