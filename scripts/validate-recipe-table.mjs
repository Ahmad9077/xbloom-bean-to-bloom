#!/usr/bin/env node
/**
 * validate-recipe-table.mjs — Bean to Bloom recipe table validator.
 *
 * Run:  node scripts/validate-recipe-table.mjs [path/to/recipe-table.json]
 * Exit code 0 = PASS, 1 = FAIL (with reasons).
 *
 * Codex: wire this into CI / predeploy. `wrangler deploy` must never run
 * if this script fails. Also run it after every calibration edit.
 */
import fs from "node:fs";
import { createHash } from "node:crypto";

const DEFAULT_TABLE_PATH = new URL("../src/recipe-table.json", import.meta.url);
const FLOWS = [3.0, 3.1, 3.2, 3.3, 3.4, 3.5];
const RPMS = [60, 70, 80, 90, 100, 110, 120];
const PATTERNS = ["centered", "spiral", "circular"];
const LABELS = ["Bloom", "Pour 2", "Pour 3", "Pour 4"];
const PROFILES = ["bright_clean", "bright_funky", "neutral_classic", "dark_roasty"];
const MODES = ["hot", "cold"];
const STRENGTHS = ["strong", "soft"];
const APPROVED_V1_3_STRUCTURE_SHA256 =
  "6bb7bf035b64763c52b0a3f19c0d4e975c952991703c1a96e590b9a0dfaf8686";

const file = process.argv[2] || DEFAULT_TABLE_PATH;
const t = JSON.parse(fs.readFileSync(file, "utf8"));
const errors = [];
const err = (m) => errors.push(m);

if (!/^\d+\.\d+\.\d+$/.test(t.rulesVersion || "")) err("rulesVersion must be semver x.y.z");

const hotSizes = t.menus?.hot?.finalDrinkMl || [];
const coldSizes = t.menus?.cold?.finalDrinkMl || [];
if (!hotSizes.includes(t.menus?.hot?.default)) err("hot default size not in hot menu");
if (!coldSizes.includes(t.menus?.cold?.default)) err("cold default size not in cold menu");
const [pctMin, pctMax] = t.menus?.cold?.waterPercentBand || [55, 65];

// Validate strength-specific menus for hot mode
const hotStrongSizes = t.menus?.hot?.finalDrinkMlByStrength?.strong || [];
const hotSoftSizes = t.menus?.hot?.finalDrinkMlByStrength?.soft || [];
const coldStrongSizes = t.menus?.cold?.finalDrinkMlByStrength?.strong || [];
const coldSoftSizes = t.menus?.cold?.finalDrinkMlByStrength?.soft || [];
if (hotStrongSizes.length !== 5) err("hot.finalDrinkMlByStrength.strong must have 5 sizes");
if (hotSoftSizes.length !== 5) err("hot.finalDrinkMlByStrength.soft must have 5 sizes");
if (!hotStrongSizes.every(s => typeof s === "number")) err("hot strong sizes must all be numbers");
if (!hotSoftSizes.every(s => typeof s === "number")) err("hot soft sizes must all be numbers");
if (JSON.stringify(hotStrongSizes) !== JSON.stringify([210, 224, 238, 252, 266]))
  err("hot strong sizes must match the owner-approved v1.3 menu");
if (JSON.stringify(hotSoftSizes) !== JSON.stringify([210, 225, 240, 255, 270]))
  err("hot soft sizes must match the owner-approved v1.3 menu");
if (JSON.stringify(coldStrongSizes) !== JSON.stringify([240, 270, 300, 330, 360]))
  err("cold strong sizes must match the owner-approved v1.3 menu");
if (JSON.stringify(coldSoftSizes) !== JSON.stringify([240, 270, 300, 330, 360]))
  err("cold soft sizes must match the owner-approved v1.3 menu");
if (t.menus?.hot?.defaultByStrength?.strong !== 252) err("hot strong default must be 252");
if (t.menus?.hot?.defaultByStrength?.soft !== 255) err("hot soft default must be 255");
if (t.menus?.cold?.defaultByStrength?.strong !== 300) err("cold strong default must be 300");
if (t.menus?.cold?.defaultByStrength?.soft !== 300) err("cold soft default must be 300");

let cells = 0;
for (const p of PROFILES) {
  const prof = t.recipes?.[p];
  if (!prof) { err(`missing profile ${p}`); continue; }
  for (const mode of MODES) {
    const m = prof[mode];
    if (!m) { err(`missing ${p}.${mode}`); continue; }
    const P = m.params || {};

    if (!RPMS.includes(P.rpm)) err(`${p}.${mode}: rpm ${P.rpm} not in allowed set`);
    for (const f of [P.bloomFlow, P.mainFlow])
      if (!FLOWS.includes(f)) err(`${p}.${mode}: flow ${f} not in allowed set`);
    if (!(Number.isInteger(P.grindSize) && P.grindSize >= 1 && P.grindSize <= 80))
      err(`${p}.${mode}: grindSize out of machine range 1-80`);
    if (P.grindSize < P.grindBand?.[0] || P.grindSize > P.grindBand?.[1])
      err(`${p}.${mode}: grindSize ${P.grindSize} outside calibration band ${P.grindBand}`);

    if (!m.sizesByStrength) { err(`${p}.${mode}: missing sizesByStrength`); continue; }

    for (const strength of STRENGTHS) {
      if (!m.sizesByStrength[strength]) { err(`${p}.${mode}: missing sizesByStrength.${strength}`); continue; }

      // Determine expected sizes for this mode+strength
      const expectedSizes = mode === "hot"
        ? (t.menus?.hot?.finalDrinkMlByStrength?.[strength] || hotSizes)
        : coldSizes;

      for (const size of expectedSizes) {
        cells++;
        const c = m.sizesByStrength[strength]?.[String(size)];
        const tag = `${p}.${mode}.${strength}.${size}`;
        if (!c) { err(`${tag}: cell missing`); continue; }
        const { doseG, ratioN, waterMl, iceG, pours } = c;

        if (!Number.isInteger(doseG) || doseG < 5 || doseG > 25) err(`${tag}: doseG ${doseG} invalid (int 5-25)`);
        if (!Number.isInteger(ratioN) || ratioN < 5 || ratioN > 25) err(`${tag}: ratioN ${ratioN} invalid (int 5-25)`);
        if (doseG * ratioN !== waterMl) err(`${tag}: waterMl ${waterMl} != doseG*ratioN ${doseG * ratioN}`);

        // Hot-specific checks
        if (mode === "hot") {
          if (waterMl !== size) err(`${tag}: hot waterMl ${waterMl} != final drink ${size}`);
          if (iceG) err(`${tag}: hot recipe must not have ice`);
          // ratioN constraint: Soft ≤ 15, Strong = 14
          if (strength === "soft" && ratioN > 15) err(`${tag}: Hot Soft ratioN ${ratioN} must be <= 15`);
          if (strength === "strong" && ratioN !== 14) err(`${tag}: Hot Strong ratioN ${ratioN} must be exactly 14`);
        }

        // Cold-specific checks
        if (mode === "cold") {
          if (waterMl + (iceG || 0) !== size) err(`${tag}: waterMl+iceG ${waterMl + (iceG || 0)} != final drink ${size}`);
          const pct = (waterMl / size) * 100;
          if (pct < pctMin || pct > pctMax) err(`${tag}: water ${pct.toFixed(1)}% outside ${pctMin}-${pctMax}%`);
          if (!Number.isInteger(iceG) || iceG < 96 || iceG > 144)
            err(`${tag}: iceG ${iceG} outside approved 96-144g window`);
        }

        const n = pours?.length || 0;
        if (n < 2 || n > 4) err(`${tag}: pour count ${n} outside 2-4`);
        const expected = waterMl < 170 ? 3 : 4;
        if (n !== expected) err(`${tag}: pour count ${n} != rule (${expected} for water ${waterMl})`);

        const temps = P.tempsByPourCount?.[String(n)];
        const pauses = P.pausesByPourCount?.[String(n)];
        const pats = P.patternsByPourCount?.[String(n)];
        const aa = P.agitateAfterByPourCount?.[String(n)];
        const ab = P.agitateBeforeByPourCount?.[String(n)];
        for (const [name, arr] of [["temps", temps], ["pauses", pauses], ["patterns", pats], ["agitateAfter", aa], ["agitateBefore", ab]])
          if (!arr || arr.length !== n) err(`${tag}: params.${name} missing or length != ${n}`);

        let sum = 0;
        (pours || []).forEach((pr, i) => {
          if (pr.label !== LABELS[i]) err(`${tag}: pour ${i} label "${pr.label}" != "${LABELS[i]}"`);
          if (!Number.isInteger(pr.volumeMl) || pr.volumeMl < 1 || pr.volumeMl > 240)
            err(`${tag}: pour ${i} volume ${pr.volumeMl} outside 1-240`);
          sum += pr.volumeMl || 0;
        });
        if (sum !== waterMl) err(`${tag}: pours sum ${sum} != waterMl ${waterMl}`);

        (temps || []).forEach((tc, i) => {
          if (tc < 40 || tc > 95) err(`${tag}: temp ${tc} outside machine 40-95`);
          if (i > 0 && tc > temps[i - 1]) err(`${tag}: temps must be non-increasing`);
          if (tc < P.tempRange?.[0] || tc > P.tempRange?.[1])
            err(`${tag}: temp ${tc} outside profile band ${P.tempRange}`);
        });
        (pauses || []).forEach((s) => { if (s < 2 || s > 59) err(`${tag}: pause ${s} outside 2-59`); });
        (pats || []).forEach((x) => { if (!PATTERNS.includes(x)) err(`${tag}: pattern "${x}" invalid`); });

        const bloomX = (pours?.[0]?.volumeMl || 0) / doseG;
        if (bloomX < 1.8 || bloomX > 3.0)
          err(`${tag}: bloom ${pours?.[0]?.volumeMl}ml is ${bloomX.toFixed(2)}x dose (allowed 1.8-3.0x)`);
      }

      // Cold strength concentration check: strong should be tighter ratio than soft
      if (mode === "cold" && strength === "strong") {
        const softSizes = m.sizesByStrength["soft"];
        for (const size of coldSizes) {
          const strong = m.sizesByStrength["strong"]?.[String(size)];
          const soft = softSizes?.[String(size)];
          if (strong && soft && strong.ratioN > soft.ratioN) {
            err(`${p}.cold.${size}: strong ratioN ${strong.ratioN} must be <= soft ratioN ${soft.ratioN}`);
          }
        }
      }
    }
  }
}

if (cells !== 80) err(`expected 80 cells (4 profiles x 2 modes x 5 sizes x 2 strengths), found ${cells}`);

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

const approvedStructure = {
  menus: {
    hot: {
      finalDrinkMlByStrength: t.menus?.hot?.finalDrinkMlByStrength,
      defaultByStrength: t.menus?.hot?.defaultByStrength,
    },
    cold: {
      finalDrinkMlByStrength: t.menus?.cold?.finalDrinkMlByStrength,
      defaultByStrength: t.menus?.cold?.defaultByStrength,
    },
  },
  recipes: Object.fromEntries(
    PROFILES.map((profile) => [
      profile,
      Object.fromEntries(
        MODES.map((mode) => [mode, t.recipes?.[profile]?.[mode]?.sizesByStrength]),
      ),
    ]),
  ),
};
const structureHash = createHash("sha256").update(canonicalJson(approvedStructure)).digest("hex");
if (t.rulesVersion === "1.3.0" && structureHash !== APPROVED_V1_3_STRUCTURE_SHA256) {
  err("v1.3.0 strength cells changed without updating the owner-approved structural checksum");
}

if (errors.length) {
  console.error(`FAIL — ${errors.length} problem(s):`);
  errors.forEach((e) => console.error("  - " + e));
  process.exit(1);
}
console.log(`PASS — ${cells}/80 cells valid against xBloom Studio hard limits (rulesVersion ${t.rulesVersion})`);
