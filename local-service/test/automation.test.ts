import { describe, expect, it, vi } from "vitest";
import {
  normalizePauseSecForApp,
  normalizeRecipeNameForApp,
  verifyRecipeTotals,
} from "../src/automation.js";
import { ErrorCode } from "../src/errors.js";

function makeTotalsDriver(options: {
  current: string;
  target: string;
  machine: string;
  ratioBase: string;
  ratioHalf: string;
  displayed?: boolean[];
}) {
  let displayRead = 0;
  const action = vi.fn();
  const chain = {
    move: vi.fn(),
    down: vi.fn(),
    up: vi.fn(),
    perform: vi.fn().mockResolvedValue(undefined),
  } as {
    move: ReturnType<typeof vi.fn>;
    down: ReturnType<typeof vi.fn>;
    up: ReturnType<typeof vi.fn>;
    perform: ReturnType<typeof vi.fn>;
  };
  chain.move.mockReturnValue(chain);
  chain.down.mockReturnValue(chain);
  chain.up.mockReturnValue(chain);
  action.mockReturnValue(chain);

  const element = (text: string, isCurrent = false) => ({
    getText: vi.fn().mockResolvedValue(text),
    isExisting: vi.fn().mockResolvedValue(text !== ""),
    isDisplayed: vi.fn().mockImplementation(async () => {
      const values = options.displayed ?? [true];
      const value = values[displayRead] ?? values[values.length - 1] ?? true;
      if (isCurrent) displayRead += 1;
      return value;
    }),
    waitForDisplayed: vi.fn().mockResolvedValue(undefined),
  });

  const driver = {
    $: vi.fn().mockImplementation(async (selector: string) => {
      if (selector.includes("following-sibling")) {
        return element(options.target);
      }
      if (selector.includes("volumeCurrentTv")) return element(options.current, true);
      if (selector.includes("coffeeWaterdot5Tv")) return element(options.ratioHalf);
      if (selector.includes("coffeeWaterTv")) return element(options.ratioBase);
      if (selector.includes("volumeTv")) return element(options.machine);
      return element("");
    }),
    action,
    pause: vi.fn().mockResolvedValue(undefined),
  };
  return { driver, action };
}

describe("normalizePauseSecForApp", () => {
  it("maps legacy 0 and 1 second pauses to the live app minimum", () => {
    expect(normalizePauseSecForApp(0)).toBe(2);
    expect(normalizePauseSecForApp(1)).toBe(2);
  });

  it("preserves supported pause values", () => {
    expect(normalizePauseSecForApp(2)).toBe(2);
    expect(normalizePauseSecForApp(35)).toBe(35);
    expect(normalizePauseSecForApp(59)).toBe(59);
  });
});

describe("normalizeRecipeNameForApp", () => {
  it("preserves names that fit xBloom's limit", () => {
    expect(normalizeRecipeNameForApp("admin – OPT / Arabica")).toBe("admin – OPT / Arabica");
  });

  it("uses the same 30-character name that xBloom saves", () => {
    expect(normalizeRecipeNameForApp("admin – Qayel Ali / Tipica / Bourbon")).toBe(
      "admin – Qayel Ali / Tipica / B",
    );
  });

  it("does not split Unicode surrogate pairs", () => {
    const name = `${"a".repeat(29)}☕tail`;
    expect(Array.from(normalizeRecipeNameForApp(name))).toHaveLength(30);
    expect(normalizeRecipeNameForApp(name)).toBe(`${"a".repeat(29)}☕`);
  });
});

describe("verifyRecipeTotals", () => {
  it("accepts an exact ratio and matching current, target, and machine volumes", async () => {
    const { driver } = makeTotalsDriver({
      current: "176",
      target: "/176ml",
      machine: "176ml",
      ratioBase: "1:8",
      ratioHalf: "",
    });

    await expect(
      verifyRecipeTotals(
        driver as unknown as import("../src/driver.js").Driver,
        176,
        8,
        "job-exact",
      ),
    ).resolves.toBeUndefined();
  });

  it("rejects the production 176/187 ml and 1:8.5 mismatch before Save", async () => {
    const { driver } = makeTotalsDriver({
      current: "176",
      target: "/187ml",
      machine: "187ml",
      ratioBase: "1:8",
      ratioHalf: ".5",
    });

    await expect(
      verifyRecipeTotals(
        driver as unknown as import("../src/driver.js").Driver,
        176,
        8,
        "job-mismatch",
      ),
    ).rejects.toMatchObject({ code: ErrorCode.SLIDER_SET_FAILED });
  });

  it.each([
    ["current pour sum", { current: "175" }],
    ["xBloom target volume", { target: "/177ml" }],
    ["machine water", { machine: "177ml" }],
    ["displayed ratio", { ratioHalf: ".5" }],
  ])("rejects an independent %s mismatch", async (_label, override) => {
    const { driver } = makeTotalsDriver({
      current: "176",
      target: "/176ml",
      machine: "176ml",
      ratioBase: "1:8",
      ratioHalf: "",
      ...override,
    });

    await expect(
      verifyRecipeTotals(
        driver as unknown as import("../src/driver.js").Driver,
        176,
        8,
        "job-independent-mismatch",
      ),
    ).rejects.toMatchObject({ code: ErrorCode.SLIDER_SET_FAILED });
  });

  it("stops scrolling as soon as totals are visible", async () => {
    const { driver, action } = makeTotalsDriver({
      current: "176",
      target: "/176ml",
      machine: "176ml",
      ratioBase: "1:8",
      ratioHalf: "",
      displayed: [false, true],
    });

    await verifyRecipeTotals(
      driver as unknown as import("../src/driver.js").Driver,
      176,
      8,
      "job-scroll",
    );

    expect(action).toHaveBeenCalledOnce();
  });
});
