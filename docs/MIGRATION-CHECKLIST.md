# Bean to Bloom — Migration & Rollout Checklist

## 0. Before anything
- [ ] Backup DB: `npx wrangler d1 export xbloom-db --remote --output=backup-pre-engine.sql`
- [ ] Tag current code: `git tag pre-recipe-engine && git push --tags`
- [ ] Add files to repo: `src/recipe-table.json`, `scripts/validate-recipe-table.mjs`, `CALIBRATION.md`, `CLASSIFICATION.md`, `REWRITE-SPEC.md`
- [ ] `package.json`: `"validate": "node scripts/validate-recipe-table.mjs src/recipe-table.json"`, and deploy script = `npm run validate && wrangler deploy`
- [ ] Confirm validator PASSES locally

## Phase 1 — Fingerprint cache
- [ ] Apply migration: `npx wrangler d1 execute xbloom-db --remote --file=migrations/010_recipe_engine.sql`
- [ ] Implement `fingerprint.js` + cache check in from-confirmation (profile constant = `neutral_classic` for now)
- [ ] Deploy → `/health` OK
- [ ] **Gate:** confirm same bean twice → second response `cached: true`, instant, identical recipe

## Phase 2 — Engine in shadow
- [ ] Implement `recipeEngine.js` + `classifier.js` (+ unit tests from spec §8)
- [ ] Set `RECIPE_SHADOW=1`, deploy
- [ ] Generate recipes for 4–6 real bags (mix of profiles) over 2–3 days
- [ ] **Gate:** shadow logs show valid table recipes, sensible profiles, zero validator failures. Review classifier outputs against the CLASSIFICATION.md test table.

## Phase 3 — Flip
- [ ] Frontend: profile chips, hot menu 210/225/240/255/270 (default 255), cached badge, 👍/👎
- [ ] Set `RECIPE_ENGINE=table`, remove shadow flag, deploy
- [ ] Smoke: one recipe per profile per mode end-to-end, incl. one Arabic-labeled bag and one product link
- [ ] Verify bridge: send one new-engine recipe to xBloom via Mac bridge — recipe appears correctly in the app
- [ ] Verify web recipe creation and Mac bridge xBloom link creation still work
- [ ] **Rollback if needed:** set `RECIPE_ENGINE=legacy`, redeploy (keep this path 1 week)
- [ ] After 1 stable week: delete legacy prompt, rejection rules, old fallback engine; remove the flag

## Launch weekend — Calibration
- [ ] Run the calibration plan in CALIBRATION.md (order: neutral → bright_clean → funky → dark)
- [ ] Freeze at final rulesVersion; note it in the repo README

## Ongoing
- [ ] Watch 👍/👎 per profile (admin summary in Phase 4); a dipping profile = one calibration loop + version bump
- [ ] Any table edit ever = via CALIBRATION.md rules only: validate → bump → commit → deploy
