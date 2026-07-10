import { captureFailureScreenshot, createRecipe } from "./automation.js";
import { closeDriver, createDriver } from "./driver.js";
import type { Config, Recipe } from "./types.js";

export async function runRecipeAutomation(
  config: Config,
  recipe: Recipe,
  jobId: string,
  options: {
    dryRun: boolean;
    confirmSave: boolean;
    resumeSavedRecipe?: boolean;
    onBeforeSave?: () => Promise<void>;
    onRecipeSaved?: () => Promise<void>;
  },
): Promise<{ shareLink?: string }> {
  let driver: Awaited<ReturnType<typeof createDriver>> | undefined;
  try {
    driver = await createDriver({
      appiumUrl: config.appiumUrl,
      elementTimeoutMs: config.elementTimeoutMs,
      skipVersionCheck: config.skipVersionCheck,
      expectedAppVersion: config.expectedAppVersion,
      expectedAppVersionCode: config.expectedAppVersionCode,
      jobId,
    });

    return await createRecipe(
      driver,
      recipe,
      {
        dryRun: options.dryRun,
        confirmSave: options.confirmSave,
        maxRetries: config.sliderMaxRetries,
        screenshotDir: config.screenshotDir,
        resumeSavedRecipe: options.resumeSavedRecipe ?? false,
        onBeforeSave: options.onBeforeSave,
        onRecipeSaved: options.onRecipeSaved,
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
