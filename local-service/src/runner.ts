import { captureFailureScreenshot, createRecipe } from "./automation.js";
import { closeDriver, createDriver } from "./driver.js";
import type { Config, Recipe } from "./types.js";

export async function runRecipeAutomation(
  config: Config,
  recipe: Recipe,
  jobId: string,
  options: { dryRun: boolean; confirmSave: boolean },
): Promise<void> {
  let driver: Awaited<ReturnType<typeof createDriver>> | undefined;
  try {
    driver = await createDriver({
      appiumUrl: config.appiumUrl,
      elementTimeoutMs: config.elementTimeoutMs,
      skipVersionCheck: config.skipVersionCheck,
      expectedAppVersion: config.expectedAppVersion,
      jobId,
    });

    await createRecipe(
      driver,
      recipe,
      {
        dryRun: options.dryRun,
        confirmSave: options.confirmSave,
        maxRetries: config.sliderMaxRetries,
        screenshotDir: config.screenshotDir,
      },
      jobId,
    );
  } catch (error) {
    if (driver) await captureFailureScreenshot(driver, config.screenshotDir, jobId);
    throw error;
  } finally {
    if (driver) await closeDriver(driver, jobId);
  }
}
