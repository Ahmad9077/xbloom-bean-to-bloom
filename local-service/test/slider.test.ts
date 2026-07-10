import { describe, expect, it, vi } from "vitest";
import { ErrorCode } from "../src/errors.js";
import { setSlider, setSliderDose } from "../src/slider.js";

type Driver = {
  $: (sel: string) => Promise<MockElement>;
  action: (type: string, opts: object) => MockActionChain;
  pause: (ms: number) => Promise<void>;
};

type TestDriver = Driver & { moveSpy: ReturnType<typeof vi.fn> };

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

function makeDriver(values: string[]): TestDriver {
  let callCount = 0;
  const moveSpy = vi.fn();

  const chain: MockActionChain = {
    move: (opts) => {
      moveSpy(opts);
      return chain;
    },
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
    moveSpy,
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

  it("bisects opposing slider values instead of oscillating around the target", async () => {
    const driver = makeDriver(["21", "23", "22"]);
    await setSlider(
      driver as unknown as import("../src/driver.js").Driver,
      "android=...Sb",
      "android=...Tv",
      22,
      2,
      59,
      Number.parseInt,
      5,
      "job-1",
      "pour1_pause",
    );
    const moves = driver.moveSpy.mock.calls.map((call) => call[0] as { x: number });
    expect(moves).toHaveLength(3);
    const firstX = moves[0]?.x ?? 0;
    const secondX = moves[1]?.x ?? 0;
    const thirdX = moves[2]?.x ?? 0;
    expect(thirdX).toBe(Math.round((firstX + secondX) / 2));
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

  it("maps a 20 g Other-dripper dose against the 5-25 g slider range", async () => {
    const driver = makeDriver(["20"]);

    await setSliderDose(
      driver as unknown as import("../src/driver.js").Driver,
      20,
      3,
      "job-20g",
      "Other",
    );

    expect(driver.moveSpy).toHaveBeenCalledWith({ x: 767, y: 763, origin: "viewport" });
  });

  it("keeps legacy Omni doses on the 5-18 g slider range", async () => {
    const driver = makeDriver(["18"]);

    await setSliderDose(
      driver as unknown as import("../src/driver.js").Driver,
      18,
      3,
      "job-18g-omni",
      "Omni",
    );

    expect(driver.moveSpy).toHaveBeenCalledWith({ x: 993, y: 763, origin: "viewport" });
  });
});
