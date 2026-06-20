import { describe, expect, it, vi } from "vitest";
import type { Driver } from "../src/driver.js";
import { clickCreate } from "../src/navigation.js";

interface MockElement {
  waitForExist: ReturnType<typeof vi.fn>;
  waitForDisplayed: ReturnType<typeof vi.fn>;
  click: ReturnType<typeof vi.fn>;
}

function element(): MockElement {
  return {
    waitForExist: vi.fn().mockResolvedValue(undefined),
    waitForDisplayed: vi.fn().mockResolvedValue(undefined),
    click: vi.fn().mockResolvedValue(undefined),
  };
}

function driverWithChooser(showChooser: boolean) {
  const create = element();
  const coffee = element();
  const save = element();
  if (!showChooser) coffee.waitForDisplayed.mockRejectedValue(new Error("not present"));

  const driver = {
    $: vi.fn().mockImplementation(async (selector: string) => {
      if (selector.includes("cv_create")) return create;
      if (selector.includes("tv_coffee_recipe")) return coffee;
      return save;
    }),
    pause: vi.fn().mockResolvedValue(undefined),
  };

  return { driver: driver as unknown as Driver, create, coffee, save };
}

describe("clickCreate", () => {
  it("selects Coffee Recipe when xBloom displays the recipe-type chooser", async () => {
    const { driver, create, coffee, save } = driverWithChooser(true);

    await clickCreate(driver, "job-1");

    expect(create.click).toHaveBeenCalledOnce();
    expect(coffee.click).toHaveBeenCalledOnce();
    expect(save.waitForExist).toHaveBeenCalledWith({ timeout: 10000 });
  });

  it("supports app states that open the coffee editor directly", async () => {
    const { driver, coffee, save } = driverWithChooser(false);

    await expect(clickCreate(driver, "job-2")).resolves.toBeUndefined();
    expect(coffee.click).not.toHaveBeenCalled();
    expect(save.waitForExist).toHaveBeenCalledWith({ timeout: 10000 });
  });
});
