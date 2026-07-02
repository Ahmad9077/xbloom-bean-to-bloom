# Bean to Bloom — Recipe Engine Rewrite Spec (v1.0)

**For:** Codex, implementing on the existing `xbloom-recipe-worker` codebase.
**Owner sign-off required before Phase 3 go-live.**

---

## 1. Goal

Replace probabilistic OpenAI recipe generation with a deterministic system:

```
photos/link → extraction (unchanged) → AI CLASSIFIES bean into 1 of 4 profiles
→ user confirms in popup (profile chip pre-selected)
→ Worker recipe engine LOOKS UP recipe from recipe-table.json
→ fingerprint cache: same bean+mode+size+profile+rulesVersion = same recipe, forever
```

The LLM never outputs a single recipe number. All numbers come from the versioned table.

## 2. Non-goals (do NOT touch)

- Authentication, sessions, roles, admin dashboard structure
- Mac bridge protocol, bridge job tables, bridge endpoints
- Recipe history UX, recipe naming format (`Username - HotOrCold/Rostery/BeanName`)
- Image handling policy (images still never persisted)
- WhatsApp/service routes (they route through the same new pipeline automatically)

## 3. New/changed modules (Worker)

### 3.1 `src/recipe-table.json`
The delivered table. Bundled at build time, imported as a module. Export `RULES_VERSION` from it. Never edited at runtime.

### 3.2 `src/classifier.js`
- `classifyBean(beanMeta, env)` → `{ profile, roastLevel, confidence, reasons, source: "openai"|"keyword" }`
- Primary: OpenAI structured-output call per `CLASSIFICATION.md` (temperature 0, pinned dated model snapshot, strict JSON schema).
- Fallback: keyword classifier (spec in `CLASSIFICATION.md`) when OpenAI errors/times out (timeout: 8s).
- `confidence < 0.6` → force `neutral_classic`, keep original suggestion in `reasons`.
- Prompt-injection guard preserved: bean metadata is data, never instructions.

### 3.3 `src/recipeEngine.js`
- `buildRecipe({ profile, brewMode, finalDrinkMl, beanMeta, username, roastery, beanName })` → recipe JSON.
- Pure function: table lookup + assembly. No network, no randomness.
- **Assembly contract:** for cell `recipes[profile][mode].sizes[finalMl]` with P pours, merge with `params`:
  - pour[i] = `{ label, volumeMl }` from cell + `tempC = tempsByPourCount[P][i]`, `pauseSec = pausesByPourCount[P][i]`, `pattern = patternsByPourCount[P][i]`, `agitateBefore/After` from the matching arrays, `flowRateMlPerSec = (i === 0 ? bloomFlow : mainFlow)`.
  - top-level: `doseG`, `brewRatio: "1:" + ratioN`, `totalVolumeMl = waterMl`, `grindSize`, `rpm` from params, `iceG` (cold only, display-only — never sent to xBloom app), `profile`, `rulesVersion`.
- **Bridge compatibility (hard requirement):** output must match the exact `recipe_json` shape currently stored/consumed by the frontend and Mac bridge. Diff a stored recipe row and match keys 1:1. Add `profile`, `rulesVersion`, `fingerprint` as new fields; never rename or drop existing keys.

### 3.4 `src/fingerprint.js`
- `fingerprint = sha256(normalize(roastery) + "|" + normalize(beanName) + "|" + brewMode + "|" + finalDrinkMl + "|" + profile + "|" + RULES_VERSION)`
- `normalize()`: trim, lowercase, collapse whitespace; Arabic: strip tatweel, unify alef forms (أإآ→ا), unify ة→ه optional — pick one and document in code.
- **Deliberately excludes** origin/process/notes: those vary per photo and are already captured via `profile`. Confirmed fields only → stable cache keys.
- Cache behavior: on confirm, look up `(owner_id, fingerprint)`. Hit → return existing recipe with `cached: true`. Miss → build, store, return. User changing the profile chip or a `rulesVersion` bump naturally produces a new fingerprint — no force-regenerate flag needed.

### 3.5 Deleted after Phase 3
- OpenAI recipe-generation prompt and its JSON parsing
- Bright/acidic backend rejection rules
- Old deterministic fallback recipe engine
- `bright_acidic_detection_terms` / `dark_roasty_detection_terms` as recipe logic (they move into the keyword fallback classifier config)

## 4. D1 migrations

```sql
-- migrations/010_recipe_engine.sql
ALTER TABLE recipes ADD COLUMN profile TEXT;
ALTER TABLE recipes ADD COLUMN rules_version TEXT;
ALTER TABLE recipes ADD COLUMN fingerprint TEXT;
ALTER TABLE recipes ADD COLUMN rating INTEGER;      -- 1 = up, -1 = down, NULL = unrated
ALTER TABLE recipes ADD COLUMN rated_at TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_recipes_owner_fp
  ON recipes(owner_id, fingerprint) WHERE fingerprint IS NOT NULL;

ALTER TABLE pending_recipe_confirmations ADD COLUMN suggested_profile TEXT;
ALTER TABLE pending_recipe_confirmations ADD COLUMN chosen_profile TEXT;
ALTER TABLE pending_recipe_confirmations ADD COLUMN classifier_confidence REAL;
```

Old rows have NULL fingerprint — untouched, still viewable in history.

## 5. API changes

| Endpoint | Change |
|---|---|
| `POST /api/recipes/from-images` | After extraction, run classifier. Response adds `suggestedProfile`, `classifierConfidence`, `profileOptions` (4 profiles with EN/AR labels + emoji from table). Store suggestion on the pending confirmation. |
| `POST /api/recipes/from-confirmation` | Accepts new field `profile` (one of the 4 ids; default = suggested). Check fingerprint cache first. Response adds `cached`, `profile`, `rulesVersion`. Existing confirmation-lock flow (pending→processing→completed) unchanged. |
| `POST /api/recipes/:id/rating` **(new)** | Body `{ value: 1 \| -1 \| 0 }` (0 clears). Owner-only. Updates `rating`, `rated_at`. |
| `GET /api/admin/ratings/summary` **(new, Phase 4)** | Per profile+mode: count, up, down, up-rate. Admin only. |

Hot size menu served to frontend changes to `[210, 225, 240, 255, 270]`, default **255**. Cold menu unchanged.

## 6. Frontend changes

1. **Confirmation popup:** add a 4-chip profile selector (pre-selected to `suggestedProfile`), labels from table (`labelAr` primary for RTL UI, `labelEn` secondary), emoji. One tap to override. If `classifierConfidence < 0.6`, show a small "تأكد من نوع البن" hint.
2. **Hot size selector:** new values, default 255. Show "≈250ml" nowhere — the number IS the drink size now.
3. **Recipe page:** show profile badge + rulesVersion small; cold recipes keep the existing ice instruction (`iceG` from table). Add 👍/👎 under the recipe ("كيف كان الكوب؟") → rating endpoint.
4. **Cached recipes:** when `cached: true`, show a subtle badge "وصفة محفوظة — نفس البن السابق" and open the stored recipe instantly.
5. Remove any remaining taste-style UI remnants.

## 7. Env flags

- `RECIPE_ENGINE = "table" | "legacy"` — rollback switch. Phase 2: legacy. Phase 3: table. Remove flag + legacy code after 1 stable week.
- `RECIPE_SHADOW = "1"` — Phase 2 only: after legacy generation, also run classifier+engine, `console.log` a JSON line `{ shadow: true, profile, cell, legacyDose, tableDose, ... }` (observability logs are already enabled). Never store shadow output.

## 8. Validation & tests

- `scripts/validate-recipe-table.mjs` (delivered, working) runs in CI and as a predeploy step: `npm run validate && wrangler deploy`. Deploy must abort on failure.
- Unit tests: assembly function (one cell per profile/mode, assert sums, temps, flows), fingerprint normalization (Arabic + English cases), cache hit/miss, classifier fallback trigger.
- Smoke: script iterates all 40 cells through `buildRecipe()` and re-asserts hard limits on the merged output.

## 9. Phases

**Phase 1 — Cache (½ day):** migrations, fingerprint module, cache check in from-confirmation (profile temporarily = "neutral_classic" constant so fingerprints are stable), `cached` badge. *Done when:* re-confirming the same bean returns `cached: true` instantly.

**Phase 2 — Engine in shadow (1 day):** table + validator wired into repo/CI, engine + classifier modules, `RECIPE_SHADOW=1` in production, new hot menu behind the flag. *Done when:* every real generation logs a valid shadow recipe for 2–3 days with zero validator failures.

**Phase 3 — Flip (½ day):** `RECIPE_ENGINE=table`, popup chips live, new hot menu live, rating buttons live. Legacy prompt path kept behind the flag for 1 week, then deleted along with rejection rules and old fallback engine. *Done when:* all new recipes carry `profile` + `rulesVersion` and no legacy code paths execute.

**Phase 4 — Feedback loop (later):** admin ratings summary; optional roast-level modifier (±1 grind within band) as a table-versioned change only.

## 10. Decisions already made (context for Codex)

1. Hot menu 210–270 replaces 200–300 (exact dose×ratio math is impossible at 200/250/275; 255 is the new default, closest to old 250).
2. Cold neutral 300ml = 176ml water + 124g ice (exact 16g×1:11). Bright/funky/dark keep 180/120.
3. `bright_funky` intentionally brews at 88–92°C — below the old "bright" minimums. The old rejection rules are retired; the table is the authority.
4. Dark hot 210/225 use 1:15 pairs (no gentler exact pair exists at those sizes); listed as calibration watch items in CALIBRATION.md.

## 11. Suggested kickoff message to Codex

> Read REWRITE-SPEC.md fully, then implement Phase 1 only. recipe-table.json and validate-recipe-table.mjs go into the repo as-is (scripts/ + src/). Add `npm run validate` and make deploy depend on it. Do not modify recipe-table.json values. Ask before any deviation from the spec.
