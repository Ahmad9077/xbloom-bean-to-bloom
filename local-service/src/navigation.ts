import type { Driver } from "./driver.js";
import { ErrorCode, ServiceError } from "./errors.js";
import { log } from "./logger.js";

const APP_PACKAGE = "com.xbloom.tbdx";

async function throwIfLoginRequired(driver: Driver): Promise<void> {
  const loginMarkers = ["emailEt", "passwordEt"];
  for (const resourceId of loginMarkers) {
    try {
      const marker = await driver.$(
        `android=new UiSelector().resourceId("${APP_PACKAGE}:id/${resourceId}")`,
      );
      if (await marker.isDisplayed().catch(() => false)) {
        throw new ServiceError(ErrorCode.AUTH_REQUIRED, "xBloom login screen is displayed", 503);
      }
    } catch (error) {
      if (error instanceof ServiceError && error.code === ErrorCode.AUTH_REQUIRED) throw error;
      // Authentication detection is a fail-open probe. The main navigation
      // operation below remains responsible for reporting Appium/UI failures.
    }
  }
}

export async function navigateToRecipes(driver: Driver, jobId: string): Promise<void> {
  log.info("Resetting app to known state", { jobId, stage: "nav_known_state" });
  try {
    // Terminate then relaunch without clearing data (noReset preserves login)
    await driver.terminateApp(APP_PACKAGE);
    await driver.pause(800);
    await driver.activateApp(APP_PACKAGE);
    await driver.pause(500);
    await throwIfLoginRequired(driver);

    // Wait for main UI (bottom nav bar becomes visible)
    const tab = await driver.$(
      `android=new UiSelector().resourceId("${APP_PACKAGE}:id/recipeFragment")`,
    );
    await tab.waitForExist({ timeout: 20000 });
    await tab.click();
    await driver.pause(600);

    // Verify Recipes list is ready
    const createBtn = await driver.$(
      `android=new UiSelector().resourceId("${APP_PACKAGE}:id/cv_create")`,
    );
    await createBtn.waitForExist({ timeout: 10000 });
    await throwIfLoginRequired(driver);
    log.info("Known state achieved: Recipes tab with cv_create visible", { jobId });
  } catch (err) {
    if (err instanceof ServiceError && err.code === ErrorCode.AUTH_REQUIRED) throw err;
    // The login screen can arrive only after xBloom validates its server-side
    // session, so check again after a main-screen wait/click has failed.
    await throwIfLoginRequired(driver);
    throw new ServiceError(
      ErrorCode.NAVIGATION_ERROR,
      "Could not reach known state (Recipes tab)",
      500,
    );
  }
}

export async function clickCreate(driver: Driver, jobId: string): Promise<void> {
  log.info("Opening create recipe screen", { jobId, stage: "nav_create" });
  try {
    await throwIfLoginRequired(driver);
    const btn = await driver.$(
      `android=new UiSelector().resourceId("${APP_PACKAGE}:id/cv_create")`,
    );
    await btn.waitForExist({ timeout: 8000 });
    await btn.click();
    await driver.pause(800);

    // xBloom 2.2.2 may show a recipe-type chooser before the editor.
    // Select Coffee Recipe explicitly; Tea Recipe uses a different schema.
    const coffeeRecipe = await driver.$(
      `android=new UiSelector().resourceId("${APP_PACKAGE}:id/tv_coffee_recipe")`,
    );
    try {
      await coffeeRecipe.waitForDisplayed({ timeout: 2500 });
      await coffeeRecipe.click();
      await driver.pause(500);
      log.info("Coffee Recipe selected", { jobId, stage: "nav_recipe_type" });
    } catch {
      // Older app states open the coffee editor directly and have no chooser.
    }

    // Confirm create screen loaded — wait for saveTv
    const saveTv = await driver.$(
      `android=new UiSelector().resourceId("${APP_PACKAGE}:id/saveTv")`,
    );
    await saveTv.waitForExist({ timeout: 10000 });
  } catch (err) {
    await throwIfLoginRequired(driver);
    if (err instanceof ServiceError && err.code === ErrorCode.AUTH_REQUIRED) throw err;
    throw new ServiceError(ErrorCode.NAVIGATION_ERROR, "Could not open create screen", 500);
  }
}

export async function dryRunExit(driver: Driver, jobId: string): Promise<void> {
  log.info("Dry-run: backing out to Recipes", { jobId, stage: "dry_run_exit" });
  try {
    const back = await driver.$(`android=new UiSelector().resourceId("${APP_PACKAGE}:id/leftImg")`);
    await back.waitForExist({ timeout: 5000 });
    await back.click();
  } catch {
    await driver.pressKeyCode(4);
  }
  await driver.pause(600);

  // Handle a potential unsaved-changes discard prompt (never click save)
  try {
    const discardBtn = await driver.$(`android=new UiSelector().textContains("Discard")`);
    const exists = await discardBtn.isExisting();
    if (exists) {
      await discardBtn.click();
      await driver.pause(400);
    }
  } catch {
    // No discard prompt — continue
  }

  // Verify we are back on Recipes list
  const createBtn = await driver.$(
    `android=new UiSelector().resourceId("${APP_PACKAGE}:id/cv_create")`,
  );
  await createBtn.waitForExist({ timeout: 8000 });
  log.info("Dry-run: cv_create confirmed on Recipes", { jobId });
}

export async function goBack(driver: Driver, jobId: string): Promise<void> {
  log.info("Pressing back", { jobId, stage: "nav_back" });
  try {
    const back = await driver.$(`android=new UiSelector().resourceId("${APP_PACKAGE}:id/leftImg")`);
    await back.waitForExist({ timeout: 5000 });
    await back.click();
    await driver.pause(600);
  } catch {
    await driver.pressKeyCode(4);
    await driver.pause(600);
  }
}
