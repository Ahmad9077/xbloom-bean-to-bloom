import table from "./recipe-table.json" with { type: "json" };

export const RULES_VERSION = table.rulesVersion;
export const PROFILE_IDS = Object.freeze(Object.keys(table.recipes));

function assertProfile(profile) {
  if (!Object.hasOwn(table.recipes, profile)) {
    throw new Error(`Unknown recipe profile: ${String(profile)}`);
  }
}

function assertBrewMode(brewMode) {
  if (brewMode !== "hot" && brewMode !== "cold") {
    throw new Error(`Unknown brew mode: ${String(brewMode)}`);
  }
}

export function buildRecipe({
  profile,
  brewMode,
  finalDrinkMl,
  beanMeta,
  username,
  roastery,
  beanName,
  fingerprint,
}) {
  assertProfile(profile);
  assertBrewMode(brewMode);

  const modeTable = table.recipes[profile][brewMode];
  const cell = modeTable.sizes[String(finalDrinkMl)];
  if (!cell) {
    throw new Error(`No recipe-table cell for ${profile}.${brewMode}.${finalDrinkMl}`);
  }

  const pourCount = cell.pours.length;
  const params = modeTable.params;
  const temps = params.tempsByPourCount[String(pourCount)];
  const pauses = params.pausesByPourCount[String(pourCount)];
  const patterns = params.patternsByPourCount[String(pourCount)];
  const agitateBefore = params.agitateBeforeByPourCount[String(pourCount)];
  const agitateAfter = params.agitateAfterByPourCount[String(pourCount)];
  if (!temps || !pauses || !patterns || !agitateBefore || !agitateAfter) {
    throw new Error(`Missing pour parameter arrays for ${profile}.${brewMode}.${pourCount}`);
  }

  const recipeName = `${username} - ${brewMode === "hot" ? "Hot" : "Cold"}/${roastery}/${beanName}`;
  const pours = cell.pours.map((pour, index) => ({
    label: pour.label,
    volumeMl: pour.volumeMl,
    tempC: temps[index],
    flowRateMlPerSec: index === 0 ? params.bloomFlow : params.mainFlow,
    pauseSec: pauses[index],
    pattern: patterns[index],
    agitationBefore: agitateBefore[index],
    agitationAfter: agitateAfter[index],
  }));

  const recipe = {
    name: recipeName,
    machine: "xBloom Studio",
    dripper: "Omni",
    brewMode,
    brewRatio: `1:${cell.ratioN}`,
    totalVolumeMl: cell.waterMl,
    doseG: cell.doseG,
    grindSize: params.grindSize,
    rpm: params.rpm,
    pours,
    bean: beanMeta,
    profile,
    rulesVersion: table.rulesVersion,
    ...(fingerprint ? { fingerprint } : {}),
  };

  if (brewMode === "cold") {
    const iceG = cell.iceG;
    recipe.icedServing = {
      iceG,
      totalBeverageMl: cell.waterMl + iceG,
      instruction: `Put exactly ${iceG} g of ice in the serving glass or carafe before brewing. xBloom brews ${cell.waterMl} ml of hot coffee over it, making about ${cell.waterMl + iceG} ml total.`,
    };
  }

  return recipe;
}

export function getRecipeCell({ profile, brewMode, finalDrinkMl }) {
  assertProfile(profile);
  assertBrewMode(brewMode);
  return table.recipes[profile][brewMode].sizes[String(finalDrinkMl)] ?? null;
}

export function selectTableFinalDrinkMl(brewMode, requestedFinalDrinkMl) {
  assertBrewMode(brewMode);
  const menu = table.menus[brewMode].finalDrinkMl;
  if (menu.includes(requestedFinalDrinkMl)) return requestedFinalDrinkMl;
  return menu.reduce((best, candidate) => {
    const bestDelta = Math.abs(best - requestedFinalDrinkMl);
    const candidateDelta = Math.abs(candidate - requestedFinalDrinkMl);
    if (candidateDelta < bestDelta) return candidate;
    if (candidateDelta === bestDelta && candidate > best) return candidate;
    return best;
  }, menu[0]);
}
