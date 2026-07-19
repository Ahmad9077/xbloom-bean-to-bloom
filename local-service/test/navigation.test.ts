import { describe, expect, it, vi } from "vitest";
import type { Driver } from "../src/driver.js";
import { ErrorCode, ServiceError } from "../src/errors.js";
import { clickCreate, navigateToRecipes } from "../src/navigation.js";

interface MockElement {
  waitForExist: ReturnType<typeof vi.fn>;
  waitForDisplayed: ReturnType<typeof vi.fn>;
  isDisplayed: ReturnType<typeof vi.fn>;
  click: ReturnType<typeof vi.fn>;
}

function element(): MockElement {
  return {
    waitForExist: vi.fn().mockResolvedValue(undefined),
    waitForDisplayed: vi.fn().mockResolvedValue(undefined),
    isDisplayed: vi.fn().mockResolvedValue(false),
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

  it("fails with AUTH_REQUIRED when the login screen is displayed", async () => {
    const { driver } = driverWithChooser(true);
    const login = element();
    login.isDisplayed.mockResolvedValue(true);
    vi.mocked(driver.$).mockImplementation(async (selector: string) => {
      if (selector.includes("emailEt")) return login as never;
      return element() as never;
    });

    await expect(clickCreate(driver, "job-login")).rejects.toMatchObject({
      code: ErrorCode.AUTH_REQUIRED,
    });
  });
});

describe("navigateToRecipes", () => {
  it("rejects a logged-out emulator before touching the Recipes controls", async () => {
    const login = element();
    login.isDisplayed.mockResolvedValue(true);
    const recipesTab = element();
    const driver = {
      terminateApp: vi.fn().mockResolvedValue(undefined),
      pause: vi.fn().mockResolvedValue(undefined),
      activateApp: vi.fn().mockResolvedValue(undefined),
      $: vi.fn().mockImplementation(async (selector: string) => {
        if (selector.includes("emailEt")) return login;
        if (selector.includes("recipeFragment")) return recipesTab;
        return element();
      }),
    } as unknown as Driver;

    await expect(navigateToRecipes(driver, "job-login")).rejects.toSatisfy(
      (error: unknown) => error instanceof ServiceError && error.code === ErrorCode.AUTH_REQUIRED,
    );
    expect(recipesTab.click).not.toHaveBeenCalled();
  });

  it("detects a login screen that appears after the main-screen wait fails", async () => {
    const login = element();
    login.isDisplayed.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const recipesTab = element();
    recipesTab.waitForExist.mockRejectedValue(new Error("main screen did not load"));
    const driver = {
      terminateApp: vi.fn().mockResolvedValue(undefined),
      pause: vi.fn().mockResolvedValue(undefined),
      activateApp: vi.fn().mockResolvedValue(undefined),
      $: vi.fn().mockImplementation(async (selector: string) => {
        if (selector.includes("emailEt")) return login;
        if (selector.includes("recipeFragment")) return recipesTab;
        return element();
      }),
    } as unknown as Driver;

    await expect(navigateToRecipes(driver, "job-delayed-login")).rejects.toMatchObject({
      code: ErrorCode.AUTH_REQUIRED,
    });
  });

  it("keeps an ordinary main-screen failure classified as NAVIGATION_ERROR", async () => {
    const recipesTab = element();
    recipesTab.waitForExist.mockRejectedValue(new Error("webdriver timeout"));
    const driver = {
      terminateApp: vi.fn().mockResolvedValue(undefined),
      pause: vi.fn().mockResolvedValue(undefined),
      activateApp: vi.fn().mockResolvedValue(undefined),
      $: vi.fn().mockImplementation(async (selector: string) => {
        if (selector.includes("recipeFragment")) return recipesTab;
        return element();
      }),
    } as unknown as Driver;

    await expect(navigateToRecipes(driver, "job-navigation")).rejects.toMatchObject({
      code: ErrorCode.NAVIGATION_ERROR,
    });
  });
});
