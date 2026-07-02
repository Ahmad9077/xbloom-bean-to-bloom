// Phase 1 recipe-cache fingerprinting.
// Keep this deliberately narrow: confirmed roastery/bean + brew mode + target
// drink size + selected profile + recipe rules version. Origin/process/notes
// are intentionally excluded because they can vary across photos for the same
// bag.

export const RULES_VERSION = "1.0.1";
export const DEFAULT_RECIPE_PROFILE = "neutral_classic";

export function normalizeFingerprintPart(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/\u0640/g, "") // Arabic tatweel/kashida.
    .replace(/[أإآ]/g, "ا") // Arabic alef variants.
    .replace(/ة/g, "ه") // Stable Arabic ta marbuta matching.
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

export async function recipeFingerprint({
  roastery,
  beanName,
  brewMode,
  finalDrinkMl,
  profile = DEFAULT_RECIPE_PROFILE,
  rulesVersion = RULES_VERSION,
}) {
  const source = [
    normalizeFingerprintPart(roastery),
    normalizeFingerprintPart(beanName),
    brewMode,
    String(finalDrinkMl),
    profile,
    rulesVersion,
  ].join("|");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(source));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
