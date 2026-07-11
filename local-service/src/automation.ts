import fs from "node:fs";
import path from "node:path";
import type { Driver } from "./driver.js";
import { ErrorCode, ServiceError } from "./errors.js";
import { log } from "./logger.js";
import { clickCreate, dryRunExit, navigateToRecipes } from "./navigation.js";
import {
  readSliderRatio,
  setSlider,
  setSliderDose,
  setSliderGrind,
  setSliderRatio,
  setSliderRpm,
} from "./slider.js";
import type { Bypass, Pour, Recipe } from "./types.js";

const PKG = "com.xbloom.tbdx";
const APP_PAUSE_MIN_SEC = 2;
const APP_RECIPE_NAME_MAX_CHARS = 30;

// Global selector (recipe-level controls that appear exactly once)
const sel = (resourceId: string) =>
  `android=new UiSelector().resourceId("${PKG}:id/${resourceId}")`;

function uiSelectorString(value: string): string {
  return JSON.stringify(value);
}

// Wraps a string as an XPath literal, handling both quote characters via concat().
function xpathLiteral(value: string): string {
  if (!value.includes("'")) return `'${value}'`;
  if (!value.includes('"')) return `"${value}"`;
  const parts = value.split("'");
  return `concat(${parts.map((p) => `'${p}'`).join(`, "'", `)})`;
}

// Scoped XPath: find resourceId within the same RecyclerView pour item as nameTv[text=label].
// XML hierarchy: LinearLayout > swipeMenuLayout > … > nameTv (label text)
//                LinearLayout > contentLl > volumeSb, temperatureSb, flowRateSb, …
// contentLl is a FOLLOWING SIBLING of swipeMenuLayout under the same LinearLayout root.
// UiSelector.fromParent() only reaches siblings within the immediate parent, so it cannot
// bridge swipeMenuLayout → contentLl. Instead we walk up via ancestor:: to the LinearLayout
// that owns both swipeMenuLayout and contentLl, then descend to the target resourceId.
function pourSel(label: string, resourceId: string): string {
  const lit = xpathLiteral(label);
  return (
    `//*[@resource-id='${PKG}:id/nameTv' and @text=${lit}]` +
    `/ancestor::*[.//*[@resource-id='${PKG}:id/contentLl']][1]` +
    `//*[@resource-id='${PKG}:id/${resourceId}']`
  );
}

// ─── Dripper ──────────────────────────────────────────────────────────────────

const DRIPPER_SEL: Record<Recipe["dripper"], string> = {
  xPod: sel("xpodLl"),
  Omni: sel("xdripperLl"),
  Other: sel("otherLl"),
};

async function selectDripper(
  driver: Driver,
  dripper: Recipe["dripper"],
  jobId: string,
): Promise<void> {
  log.info("Selecting dripper", { jobId, stage: "dripper", dripper });
  const el = await driver.$(DRIPPER_SEL[dripper]);
  await el.waitForExist({ timeout: 8000 });
  const selected = await el.getAttribute("selected");
  if (selected !== "true") {
    await el.click();
    await driver.pause(300);
  }
}

// ─── Pour list ────────────────────────────────────────────────────────────────

async function addPour(driver: Driver, jobId: string, idx: number): Promise<void> {
  log.info("Adding pour", { jobId, stage: "pour_add", idx });
  const addTv = await driver.$(sel("addTv"));
  await addTv.waitForDisplayed({ timeout: 8000 });
  await addTv.click();
  await driver.pause(500);
}

async function expandPourByLabel(driver: Driver, label: string, jobId: string): Promise<void> {
  log.info("Expanding pour", { jobId, stage: "pour_expand", label });
  // Newly added rows initially sit behind the fixed Save control. Move the RecyclerView
  // upward so the label receives the tap instead of the overlay.
  const pourList = await driver.$(sel("pourRcv"));
  await pourList.waitForExist({ timeout: 8000 });
  await driver
    .action("pointer", { id: "pour-scroll", parameters: { pointerType: "touch" } })
    .move({ x: 540, y: 2100, origin: "viewport" })
    .down({ button: 0 })
    .move({ x: 540, y: 900, duration: 500, origin: "viewport" })
    .up({ button: 0 })
    .perform();
  await driver.pause(300);

  // Tap the visible label coordinates. Its large parent row overlaps the fixed Save control
  // near the bottom of this screen, so clicking the parent's centre is intercepted.
  const labelElement = await driver.$(
    `android=new UiSelector().resourceId("${PKG}:id/nameTv").text(${uiSelectorString(label)})`,
  );
  await labelElement.waitForExist({ timeout: 8000 });
  await labelElement.click();
  await driver.pause(400);

  // Confirm this exact row's editor expanded. Avoid a second blind click, which would collapse it.
  const contentLlSel = pourSel(label, "contentLl");
  const contentLl = await driver.$(contentLlSel);
  await contentLl.waitForDisplayed({ timeout: 6000 });
}

async function setPourValues(
  driver: Driver,
  pour: Pour,
  totalVolumeMl: number,
  maxRetries: number,
  jobId: string,
  idx: number,
): Promise<void> {
  const st = `pour${idx}`;
  const label = pour.label;
  log.info("Setting pour values", { jobId, stage: st });

  // All slider selectors scoped to this pour's list item via fromParent
  await setSlider(
    driver,
    pourSel(label, "volumeSb"),
    pourSel(label, "volumeTv"),
    pour.volumeMl,
    0,
    250,
    Number.parseInt,
    maxRetries,
    jobId,
    `${st}_vol`,
  );
  await setSlider(
    driver,
    pourSel(label, "temperatureSb"),
    pourSel(label, "temperatureTv"),
    pour.tempC,
    40,
    95,
    Number.parseInt,
    maxRetries,
    jobId,
    `${st}_temp`,
  );
  await setSlider(
    driver,
    pourSel(label, "flowRateSb"),
    pourSel(label, "flowRateTv"),
    pour.flowRateMlPerSec,
    3.0,
    3.5,
    Number.parseFloat,
    maxRetries,
    jobId,
    `${st}_flow`,
  );
  await setSlider(
    driver,
    pourSel(label, "pausingSb"),
    pourSel(label, "pausingTv"),
    normalizePauseSecForApp(pour.pauseSec),
    APP_PAUSE_MIN_SEC,
    59,
    Number.parseInt,
    maxRetries,
    jobId,
    `${st}_pause`,
  );
  await selectPattern(driver, pour.pattern, label, jobId, st);
  await setAgitation(
    driver,
    "vibrationBeforeRl",
    "vibrationBeforeTv",
    label,
    pour.agitationBefore,
    jobId,
    `${st}_agB`,
  );
  await setAgitation(
    driver,
    "vibrationAfterRl",
    "vibrationAfterTv",
    label,
    pour.agitationAfter,
    jobId,
    `${st}_agA`,
  );

  log.info("Pour values set", { jobId, stage: `${st}_done` });
}

/** xBloom Studio 2.2.2 cannot position its pause slider below 2 seconds.
 * Preserve delivery of older saved recipes that allowed 0 or 1 second. */
export function normalizePauseSecForApp(pauseSec: number): number {
  return Math.max(APP_PAUSE_MIN_SEC, pauseSec);
}

/** xBloom Studio 2.2.2 silently truncates saved recipe names to 30 Unicode
 * characters. Use the same value for saving and subsequent search/recovery. */
export function normalizeRecipeNameForApp(recipeName: string): string {
  return Array.from(recipeName).slice(0, APP_RECIPE_NAME_MAX_CHARS).join("");
}

async function selectPattern(
  driver: Driver,
  pattern: Pour["pattern"],
  label: string,
  jobId: string,
  stage: string,
): Promise<void> {
  const map: Record<Pour["pattern"], string> = {
    centered: pourSel(label, "centerLl"),
    spiral: pourSel(label, "spiralLl"),
    circular: pourSel(label, "circularLl"),
  };
  const el = await driver.$(map[pattern]);
  await el.waitForExist({ timeout: 5000 });
  const already = await el.getAttribute("selected");
  if (already !== "true") {
    await el.click();
    await driver.pause(200);
  }
  log.debug("Pattern selected", { jobId, stage, pattern });
}

async function setAgitation(
  driver: Driver,
  containerResId: string,
  tvResId: string,
  label: string,
  wantOn: boolean,
  jobId: string,
  stage: string,
): Promise<void> {
  const tvEl = await driver.$(pourSel(label, tvResId));
  await tvEl.waitForExist({ timeout: 5000 });
  const text = (await tvEl.getText()).trim().toUpperCase();
  const isOn = text === "ON";
  if (isOn !== wantOn) {
    const container = await driver.$(pourSel(label, containerResId));
    await container.click();
    await driver.pause(200);
  }
  log.debug("Agitation set", { jobId, stage, wantOn });
}

// ─── Bypass ───────────────────────────────────────────────────────────────────

async function addAndSetBypass(
  driver: Driver,
  bypass: Bypass,
  maxRetries: number,
  jobId: string,
): Promise<void> {
  log.info("Adding bypass", { jobId, stage: "bypass" });
  const addBypassTv = await driver.$(sel("addBypassTv"));
  await addBypassTv.waitForDisplayed({ timeout: 8000 });
  await addBypassTv.click();
  await driver.pause(500);

  await expandPourByLabel(driver, "Bypass", jobId);

  // Sliders scoped to the Bypass list item — distinct from any pour's volumeSb/temperatureSb
  await setSlider(
    driver,
    pourSel("Bypass", "volumeSb"),
    pourSel("Bypass", "volumeTv"),
    bypass.volumeMl,
    5,
    100,
    Number.parseInt,
    maxRetries,
    jobId,
    "bypass_volume",
  );
  await setSlider(
    driver,
    pourSel("Bypass", "temperatureSb"),
    pourSel("Bypass", "temperatureTv"),
    bypass.tempC,
    40,
    95,
    Number.parseInt,
    maxRetries,
    jobId,
    "bypass_temp",
  );
  log.info("Bypass set", { jobId, stage: "bypass_done" });
}

// ─── Verify pour total ────────────────────────────────────────────────────────

function parseMl(text: string): number {
  return Number.parseInt(text.replace(/\D/g, ""), 10);
}

export async function verifyRecipeTotals(
  driver: Driver,
  expectedTotal: number,
  expectedRatio: number,
  jobId: string,
): Promise<void> {
  const currentVolumeEl = await driver.$(sel("volumeCurrentTv"));
  const machineVolumeEl = await driver.$(sel("volumeTv"));
  const ratioBaseEl = await driver.$(sel("coffeeWaterTv"));

  // Return the nested editor to its top, but stop as soon as both the totals
  // and recipe header are visible. A second blind gesture at the top lands on
  // the ratio SeekBar.
  for (let i = 0; i < 3; i++) {
    const [currentVisible, machineVisible, ratioVisible] = await Promise.all([
      currentVolumeEl.isDisplayed().catch(() => false),
      machineVolumeEl.isDisplayed().catch(() => false),
      ratioBaseEl.isDisplayed().catch(() => false),
    ]);
    if (currentVisible && machineVisible && ratioVisible) break;
    await driver
      .action("pointer", { id: "total-scroll", parameters: { pointerType: "touch" } })
      // Stay in the left margin so the gesture cannot alter any SeekBar.
      .move({ x: 20, y: 900, origin: "viewport" })
      .down({ button: 0 })
      .move({ x: 20, y: 2100, duration: 500, origin: "viewport" })
      .up({ button: 0 })
      .perform();
    await driver.pause(250);
  }

  try {
    await Promise.all([
      currentVolumeEl.waitForDisplayed({ timeout: 5000 }),
      machineVolumeEl.waitForDisplayed({ timeout: 5000 }),
      ratioBaseEl.waitForDisplayed({ timeout: 5000 }),
    ]);
  } catch {
    throw new ServiceError(
      ErrorCode.SLIDER_SET_FAILED,
      "Final recipe header and totals could not be displayed for verification",
      500,
    );
  }
  const targetVolumeEl = await driver.$(
    `//*[@resource-id='${PKG}:id/volumeCurrentTv']/following-sibling::*[@resource-id='${PKG}:id/volumeSumTv'][1]`,
  );
  const [currentVolume, targetVolume, machineVolume, actualRatio] = await Promise.all([
    currentVolumeEl.getText().then(parseMl),
    targetVolumeEl.getText().then(parseMl),
    machineVolumeEl.getText().then(parseMl),
    readSliderRatio(driver),
  ]);

  if (
    currentVolume !== expectedTotal ||
    targetVolume !== expectedTotal ||
    machineVolume !== expectedTotal ||
    actualRatio !== expectedRatio
  ) {
    throw new ServiceError(
      ErrorCode.SLIDER_SET_FAILED,
      `Final recipe mismatch: pours=${currentVolume}, target=${targetVolume}, machine=${machineVolume}, ratio=${actualRatio}; expected volume=${expectedTotal}, ratio=${expectedRatio}`,
      500,
    );
  }
  log.info("Recipe totals verified", {
    jobId,
    stage: "verify_total",
    currentVolume,
    targetVolume,
    machineVolume,
    actualRatio,
  });
}

// ─── Save ─────────────────────────────────────────────────────────────────────

async function findCreatedRecipeRow(driver: Driver, recipeName: string, jobId: string) {
  const searchButton = await driver.$(sel("btn_search"));
  await searchButton.waitForDisplayed({ timeout: 8000 });
  await searchButton.click();

  const searchInput = await driver.$(sel("etSearch"));
  await searchInput.waitForDisplayed({ timeout: 8000 });
  await searchInput.clearValue();
  await searchInput.setValue(recipeName);
  await driver.hideKeyboard().catch(() => {});

  const searchAction = await driver.$(sel("btnSearchAction"));
  await searchAction.waitForDisplayed({ timeout: 5000 });
  await searchAction.click();
  await driver.pause(1000);

  const recipeNameLiteral = xpathLiteral(recipeName);
  const recipeRow = await driver.$(
    `//*[@resource-id='${PKG}:id/tv_recipe_name' and @text=${recipeNameLiteral}]/ancestor::*[@clickable='true'][1]`,
  );
  try {
    await recipeRow.waitForDisplayed({ timeout: 15000 });
  } catch {
    throw new ServiceError(
      ErrorCode.SHARE_LINK_FAILED,
      "The saved recipe could not be found in xBloom. Please try again.",
      503,
    );
  }
  await driver.hideKeyboard().catch(() => {});
  log.info("Saved recipe found with xBloom search", { jobId, stage: "share_recipe_found" });
  return recipeRow;
}

async function openCreatedRecipe(driver: Driver, recipeName: string, jobId: string): Promise<void> {
  // Every share attempt starts from a clean, known screen. xBloom retains its
  // full-screen Search activity between Appium sessions, where bottom-nav
  // controls exist behind the overlay but cannot actually navigate.
  await navigateToRecipes(driver, jobId);

  const myTab = await driver.$(sel("cv_my"));
  if (await myTab.isExisting()) {
    await myTab.click();
    await driver.pause(1500);
  }

  // The xBloom app currently defaults My Recipes to its "xBloom" catalogue.
  // User-created recipes are only actionable from the "Created" tab.
  const createdTab = await driver.$("~Created");
  await createdTab.waitForExist({ timeout: 8000 });
  await createdTab.click();
  await driver.pause(1200);

  // RecyclerView only exposes visible rows and retains its previous scroll position.
  // Use xBloom's own search so lookup is independent of list position and list size.
  const recipeRow = await findCreatedRecipeRow(driver, recipeName, jobId);
  await recipeRow.click();

  const shareButton = await driver.$(sel("shareIv"));
  try {
    await shareButton.waitForDisplayed({ timeout: 10000 });
  } catch {
    throw new ServiceError(
      ErrorCode.SHARE_LINK_FAILED,
      "The saved recipe could not be opened for sharing. Please try again.",
      503,
    );
  }
  log.info("Saved recipe opened from Created recipes", { jobId, stage: "share_recipe_open" });
}

async function createShareLinkFromOpenRecipe(driver: Driver, jobId: string): Promise<string> {
  const shareButton = await driver.$(sel("shareIv"));
  try {
    await shareButton.waitForDisplayed({ timeout: 10000 });
    await shareButton.click();
    const shareGrid = await driver.$(sel("shareRcv"));
    await shareGrid.waitForDisplayed({ timeout: 8000 });
    await driver.setClipboard(Buffer.from("").toString("base64"), "plaintext").catch(() => {});
    const linkItem = await driver.$(
      `android=new UiSelector().resourceId("${PKG}:id/nameTv").text("Link")`,
    );
    await linkItem.waitForDisplayed({ timeout: 8000 });
    await linkItem.click();
    await driver.pause(1000);
  } catch {
    throw new ServiceError(
      ErrorCode.SHARE_LINK_FAILED,
      "xBloom could not open its link-sharing action. Please try again.",
      503,
    );
  }

  let encodedClipboard: string;
  try {
    encodedClipboard = await driver.getClipboard("plaintext");
  } catch {
    throw new ServiceError(
      ErrorCode.SHARE_LINK_FAILED,
      "xBloom created the share action but its link could not be read. Please try again.",
      503,
    );
  }
  const clipboard = Buffer.from(encodedClipboard, "base64").toString("utf8");
  const match = /https:\/\/share-h5\.xbloom\.com\/\?id=[^\s]+/.exec(clipboard);
  if (!match) {
    throw new ServiceError(
      ErrorCode.SHARE_LINK_FAILED,
      "xBloom did not create a share link. Please try again.",
      503,
    );
  }
  const shareUrl = new URL(match[0]);
  if (shareUrl.protocol !== "https:" || shareUrl.hostname !== "share-h5.xbloom.com") {
    throw new ServiceError(
      ErrorCode.SHARE_LINK_FAILED,
      "xBloom returned an invalid share link",
      500,
    );
  }
  log.info("xBloom share link created", { jobId, stage: "share_link_done" });
  return shareUrl.toString();
}

async function createShareLink(driver: Driver, recipeName: string, jobId: string): Promise<string> {
  await openCreatedRecipe(driver, recipeName, jobId);
  return createShareLinkFromOpenRecipe(driver, jobId);
}

async function saveRecipe(
  driver: Driver,
  recipeName: string,
  jobId: string,
  onBeforeSave?: () => Promise<void>,
  onRecipeSaved?: () => Promise<void>,
): Promise<string> {
  log.info("Clicking Save", { jobId, stage: "save_click" });

  const saveTv = await driver.$(sel("saveTv"));
  await saveTv.waitForDisplayed({ timeout: 8000 });
  await saveTv.click();
  await driver.pause(800);

  // Wait for name-entry screen
  const titleTv = await driver.$(
    `android=new UiSelector().resourceId("${PKG}:id/titleTv").text("Save recipe")`,
  );
  try {
    await titleTv.waitForExist({ timeout: 10000 });
  } catch {
    throw new ServiceError(
      ErrorCode.SAVE_FAILED,
      "xBloom did not open the recipe naming screen after Save",
      503,
    );
  }
  log.info("Name screen visible", { jobId, stage: "save_name" });

  const textEt = await driver.$(sel("textEt"));
  await textEt.waitForDisplayed({ timeout: 5000 });
  await textEt.clearValue();
  await textEt.setValue(recipeName);
  await driver.hideKeyboard().catch(() => {});
  await driver.pause(300);

  const saveIv = await driver.$(sel("saveIv"));
  await saveIv.waitForDisplayed({ timeout: 5000 });
  // Persist this checkpoint before the irreversible app action. If the outcome is
  // ever uncertain, automatic retries will not risk creating a duplicate.
  await onBeforeSave?.();
  await saveIv.click();

  // Cloud sync can leave the name screen visible for several seconds. Rapid reverse polling
  // overloaded UiAutomator2 in the live app, so allow the transition to settle first.
  await driver.pause(12000);

  // Confirm the recipe exists in the user's Created collection before marking
  // the cloud checkpoint complete.
  const tab = await driver.$(`android=new UiSelector().resourceId("${PKG}:id/recipeFragment")`);
  await tab.waitForExist({ timeout: 15000 });
  await tab.click();
  await driver.pause(600);
  const myTab = await driver.$(sel("cv_my"));
  if (await myTab.isExisting()) await myTab.click();
  const createdTab = await driver.$("~Created");
  await createdTab.waitForExist({ timeout: 8000 });
  await createdTab.click();
  await driver.pause(1200);
  const recipeRow = await findCreatedRecipeRow(driver, recipeName, jobId);
  log.info("Recipe saved and confirmed in My Recipes", { jobId, stage: "save_done" });
  await onRecipeSaved?.();
  // We are already looking at the exact saved search result. Open that row
  // directly instead of trying to navigate through controls behind Search.
  await recipeRow.click();
  log.info("Saved recipe opened from search result", { jobId, stage: "share_recipe_open" });
  return createShareLinkFromOpenRecipe(driver, jobId);
}

// ─── Screenshot ───────────────────────────────────────────────────────────────

export async function captureFailureScreenshot(
  driver: Driver,
  screenshotDir: string,
  jobId: string,
): Promise<void> {
  try {
    fs.mkdirSync(screenshotDir, { recursive: true });
    const filePath = path.join(screenshotDir, `failure_${jobId}_${Date.now()}.png`);
    await driver.saveScreenshot(filePath);
    log.info("Failure screenshot saved", { jobId, stage: "screenshot" });
    // File path intentionally omitted from log to avoid leaking directory structure
  } catch {
    log.warn("Screenshot capture failed", { jobId, stage: "screenshot_warn" });
  }
}

// ─── Orchestrator ─────────────────────────────────────────────────────────────

export interface AutomationOptions {
  dryRun: boolean;
  confirmSave: boolean;
  maxRetries: number;
  screenshotDir: string;
  resumeSavedRecipe: boolean;
  onBeforeSave?: (() => Promise<void>) | undefined;
  onRecipeSaved?: (() => Promise<void>) | undefined;
}

export async function createRecipe(
  driver: Driver,
  recipe: Recipe,
  opts: AutomationOptions,
  jobId: string,
): Promise<{ shareLink?: string }> {
  const appRecipeName = normalizeRecipeNameForApp(recipe.name);
  if (opts.resumeSavedRecipe) {
    log.info("Resuming at xBloom share-link creation", { jobId, stage: "share_resume" });
    return { shareLink: await createShareLink(driver, appRecipeName, jobId) };
  }
  await navigateToRecipes(driver, jobId);
  await clickCreate(driver, jobId);

  await selectDripper(driver, recipe.dripper, jobId);

  if (recipe.dripper !== "xPod") {
    await setSliderDose(driver, recipe.doseG, opts.maxRetries, jobId, recipe.dripper);
  }

  const ratioN = Number.parseInt(recipe.brewRatio.split(":")[1] ?? "15", 10);
  await setSliderRatio(driver, ratioN, opts.maxRetries, jobId);
  await setSliderGrind(driver, recipe.grindSize, opts.maxRetries, jobId);
  await setSliderRpm(driver, recipe.rpm, opts.maxRetries, jobId);

  for (let i = 0; i < recipe.pours.length; i++) {
    const pour = recipe.pours[i];
    if (!pour) continue;
    await addPour(driver, jobId, i);
    await expandPourByLabel(driver, pour.label, jobId);
    await setPourValues(driver, pour, recipe.totalVolumeMl, opts.maxRetries, jobId, i);
  }

  if (recipe.bypass) {
    await addAndSetBypass(driver, recipe.bypass, opts.maxRetries, jobId);
  }

  await verifyRecipeTotals(driver, recipe.totalVolumeMl, ratioN, jobId);

  if (opts.dryRun) {
    log.info("Dry-run complete — backing out", { jobId, stage: "dry_run_exit" });
    await dryRunExit(driver, jobId);
    return {};
  }

  if (opts.confirmSave) {
    return {
      shareLink: await saveRecipe(
        driver,
        appRecipeName,
        jobId,
        opts.onBeforeSave,
        opts.onRecipeSaved,
      ),
    };
  }
  return {};
}
