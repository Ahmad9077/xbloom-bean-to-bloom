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

const FLOWS = [3.0, 3.1, 3.2, 3.3, 3.4, 3.5];
const RPMS = [60, 70, 80, 90, 100, 110, 120];
const PATTERNS = ["centered", "spiral", "circular"];
const LABELS = ["Bloom", "Pour 2", "Pour 3", "Pour 4"];
const PROFILES = ["bright_clean", "bright_funky", "neutral_classic", "dark_roasty"];
const MODES = ["hot", "cold"];

const file = process.argv[2] || "recipe-table.json";
const t = JSON.parse(fs.readFileSync(file, "utf8"));
const errors = [];
const err = (m) => errors.push(m);

if (!/^\d+\.\d+\.\d+$/.test(t.rulesVersion || "")) err("rulesVersion must be semver x.y.z");

const hotSizes = t.menus?.hot?.finalDrinkMl || [];
const coldSizes = t.menus?.cold?.finalDrinkMl || [];
if (!hotSizes.includes(t.menus?.hot?.default)) err("hot default size not in hot menu");
if (!coldSizes.includes(t.menus?.cold?.default)) err("cold default size not in cold menu");
const [pctMin, pctMax] = t.menus?.cold?.waterPercentBand || [55, 65];

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

    const sizes = mode === "hot" ? hotSizes : coldSizes;
    for (const size of sizes) {
      cells++;
      const c = m.sizes?.[String(size)];
      const tag = `${p}.${mode}.${size}`;
      if (!c) { err(`${tag}: cell missing`); continue; }
      const { doseG, ratioN, waterMl, iceG, pours } = c;

      if (!Number.isInteger(doseG) || doseG < 5 || doseG > 18) err(`${tag}: doseG ${doseG} invalid (int 5-18)`);
      if (!Number.isInteger(ratioN) || ratioN < 5 || ratioN > 25) err(`${tag}: ratioN ${ratioN} invalid (int 5-25)`);
      if (doseG * ratioN !== waterMl) err(`${tag}: waterMl ${waterMl} != doseG*ratioN ${doseG * ratioN}`);

      if (mode === "hot") {
        if (waterMl !== size) err(`${tag}: hot waterMl ${waterMl} != final drink ${size}`);
        if (iceG) err(`${tag}: hot recipe must not have ice`);
      } else {
        if (waterMl + (iceG || 0) !== size) err(`${tag}: waterMl+iceG ${waterMl + (iceG || 0)} != final drink ${size}`);
        const pct = (waterMl / size) * 100;
        if (pct < pctMin || pct > pctMax) err(`${tag}: water ${pct.toFixed(1)}% outside ${pctMin}-${pctMax}%`);
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
  }
}

if (cells !== 40) err(`expected 40 cells (4 profiles x 2 modes x 5 sizes), found ${cells}`);

if (errors.length) {
  console.error(`FAIL — ${errors.length} problem(s):`);
  errors.forEach((e) => console.error("  - " + e));
  process.exit(1);
}
console.log(`PASS — ${cells}/40 cells valid against xBloom Studio hard limits (rulesVersion ${t.rulesVersion})`);
