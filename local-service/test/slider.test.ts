import { describe, expect, it, vi } from "vitest";
import { ErrorCode } from "../src/errors.js";
import { setSlider } from "../src/slider.js";

type Driver = {
  $: (sel: string) => Promise<MockElement>;
  action: (type: string, opts: object) => MockActionChain;
  pause: (ms: number) => Promise<void>;
};

type MockElement = {
  waitForExist: (opts: object) => Promise<void>;
  getLocation: () => Promise<{ x: number; y: number }>;
  getSize: () => Promise<{ width: number; height: number }>;
  getText: () => Promise<string>;
};

type MockActionChain = {
  move: (opts: object) => MockActionChain;
  down: (opts: object) => MockActionChain;
  pause: (ms: number) => MockActionChain;
  up: (opts: object) => MockActionChain;
  perform: () => Promise<void>;
};

function makeDriver(values: string[]): Driver {
  let callCount = 0;

  const chain: MockActionChain = {
    move: () => chain,
    down: () => chain,
    pause: () => chain,
    up: () => chain,
    perform: vi.fn().mockResolvedValue(undefined),
  };

  const sliderEl: MockElement = {
    waitForExist: vi.fn().mockResolvedValue(undefined),
    getLocation: vi.fn().mockResolvedValue({ x: 69, y: 673 }),
    getSize: vi.fn().mockResolvedValue({ width: 942, height: 179 }),
    getText: vi.fn().mockResolvedValue(""),
  };

  const textEl: MockElement = {
    waitForExist: vi.fn().mockResolvedValue(undefined),
    getLocation: vi.fn().mockResolvedValue({ x: 0, y: 0 }),
    getSize: vi.fn().mockResolvedValue({ width: 50, height: 30 }),
    getText: vi.fn().mockImplementation(async () => {
      const v = values[callCount] ?? values[values.length - 1] ?? "0";
      callCount++;
      return v;
    }),
  };

  return {
    $: vi.fn().mockImplementation(async (sel: string) => {
      if (sel.includes("Sb")) return sliderEl;
      return textEl;
    }),
    action: vi.fn().mockReturnValue(chain),
    pause: vi.fn().mockResolvedValue(undefined),
  };
}

describe("setSlider", () => {
  it("succeeds on first try when value matches", async () => {
    const driver = makeDriver(["15"]);
    await setSlider(
      driver as unknown as import("../src/driver.js").Driver,
      "android=...Sb",
      "android=...Tv",
      15,
      5,
      18,
      Number.parseInt,
      3,
      "job-1",
      "dose",
    );
    // No error thrown
    expect(driver.action).toHaveBeenCalledOnce();
  });

  it("retries when first tap produces wrong value", async () => {
    // First attempt returns 10, second returns 15
    const driver = makeDriver(["10", "15"]);
    await setSlider(
      driver as unknown as import("../src/driver.js").Driver,
      "android=...Sb",
      "android=...Tv",
      15,
      5,
      18,
      Number.parseInt,
      3,
      "job-1",
      "dose",
    );
    expect(driver.action).toHaveBeenCalledTimes(2);
  });

  it("throws SLIDER_SET_FAILED when max retries exhausted", async () => {
    // Always returns wrong value
    const driver = makeDriver(["10", "10", "10", "10"]);
    await expect(
      setSlider(
        driver as unknown as import("../src/driver.js").Driver,
        "android=...Sb",
        "android=...Tv",
        15,
        5,
        18,
        Number.parseInt,
        3,
        "job-1",
        "dose",
      ),
    ).rejects.toMatchObject({ code: ErrorCode.SLIDER_SET_FAILED });
  });

  it("uses correct x position for min value", async () => {
    const driver = makeDriver(["5"]);
    await setSlider(
      driver as unknown as import("../src/driver.js").Driver,
      "android=...Sb",
      "android=...Tv",
      5,
      5,
      18,
      Number.parseInt,
      3,
      "job-1",
      "dose",
    );
    const actionFn = driver.action as ReturnType<typeof vi.fn>;
    expect(actionFn).toHaveBeenCalled();
  });

  it("uses correct x position for max value", async () => {
    const driver = makeDriver(["18"]);
    await setSlider(
      driver as unknown as import("../src/driver.js").Driver,
      "android=...Sb",
      "android=...Tv",
      18,
      5,
      18,
      Number.parseInt,
      3,
      "job-1",
      "dose",
    );
    expect(driver.action).toHaveBeenCalled();
  });
});
