# CALIBRATION.md — Taste Fix Playbook (v1.0)

**Codex: this file is your only authority for taste-related edits to `recipe-table.json`. Follow it exactly. Never improvise a fix.**

## Golden rules

1. **One variable per fix.** Never change two things at once.
2. **A fix applies to the whole profile+mode** (its `params` block), so it improves all 5 sizes consistently — never edit a single size cell for taste.
3. **Calibration edits touch ONLY the `params` block:** `grindSize`, temps inside `tempsByPourCount`, `mainFlow`, `rpm`, pauses. Structural fields are **forbidden** without explicit owner approval in the same message: `doseG`, `ratioN`, `waterMl`, `iceG`, pour volumes, pour counts, menus, `bloomFlow`.
4. **Stay inside the bands** in the table: `grindSize` within `grindBand`; every temp within `tempRange` and 40–95; `mainFlow` ∈ {3.0…3.5}; `rpm` ∈ {60…120 by 10}; pauses 2–59. Temps must stay non-increasing across pours (shift the whole curve, keep the shape).
5. **After every edit:** run `node scripts/validate-recipe-table.mjs` (must PASS), bump `rulesVersion` patch (1.0.x → 1.0.x+1), commit with message `calibrate(<profile>.<mode>): <symptom> → <change>`, deploy, and reply to the owner with the exact diff.
6. Version bump means new fingerprints → next brews of the same beans get the fixed recipe automatically. Old stored recipes are history, untouched.

## Symptom → fix table

| Owner says the cup is… | Meaning | Fix (in order; use the first that's still in-band) |
|---|---|---|
| sour / sharp / حامض | under-extracted | grindSize −2 (finer) → else all temps +1 |
| sour AND thin/watery | strongly under-extracted | grindSize −2 AND nothing else; re-taste before more |
| bitter / harsh / dry finish / مر | over-extracted | all temps −2 → else grindSize +2 (coarser) |
| balanced but watery/thin | body too low | grindSize −1 → else bloom pause +5s (max 45) |
| no sweetness / hollow | development too short | bloom pause +5–10s → else mainFlow one step down |
| astringent, drying finish | too much agitation | mainFlow one step down → else rpm one step down |
| flat / muted (fresh beans) | too gentle | all temps +1 → else rpm one step up |
| fermented harshness / وكأنه متخمر زيادة (bright_funky only) | ferment amplified | all temps −1 to −2 ONLY. Never grind finer for this symptom. |

If a symptom repeats after two fixes on the same profile+mode → stop, report to owner, request a tasting session instead of a third blind edit.

## How the owner reports (examples Codex must handle)

> "Recipe **admin - Cold/Umq/YemenHaraz** tastes sharp"

Codex: look up that recipe row in D1 → read its `profile` (bright_funky) and mode (cold) → apply the sour fix to `recipes.bright_funky.cold.params` → validate → bump → deploy → reply:
`bright_funky.cold: grindSize 42 → 40 (sour fix). rulesVersion 1.0.1. Validator PASS.`

> "كل وصفات الدارك الحارة مرّة" → dark_roasty.hot, bitter fix: temps [88,87,86,86] → [86,85,84,84].

## Owner's side (the tasting itself)

- One variable per brew; judge on 4 axes: acidity, sweetness, body, finish.
- Confirm a symptom on a **second bean of the same profile** before reporting — one weird bag shouldn't move the whole profile.
- Fresh beans (7–30 days off roast), same water every time.

## Launch calibration weekend (one-time)

Per profile: brew the table recipe → apply at most 2 fixes via Codex → confirm on a second bean → lock. Order: neutral_classic → bright_clean → bright_funky → dark_roasty. Target: rulesVersion ~1.0.4–1.0.8 by Sunday night, then freeze.

## Watch items from v1.0 authoring

- `dark_roasty.hot` at 210/225 runs 1:15 (strongest exact pair available) — if those sizes taste heavy, the temp −2 fix is the right lever.
- `neutral_classic.hot` 270 runs 18g@1:15 (strong side) — same lever if needed.

## Watch items from v1.2.0 cold body fix (Other dripper, doses to 25g)

- All cold cells were rebuilt for fuller body: bright profiles brew 1:9 (60% water, uniform 1:15 overall drink); neutral ~1:16 overall; dark ~1:17 overall. The old 18g dose cap is gone — the dripper is now "Other", app-verified up to 25g.
- Doses above 18g (bright 300/330/360, neutral 330/360, dark 360) are new territory: if a cup tastes muddy/over-heavy, the first lever is temps −1, NOT a dose cut (dose/ratio remain structural and owner-approved).
- 360ml cells at neutral (1:10) and dark (1:11) run slightly more machine water (~64%) to keep ice ≤144g — expect them marginally less ice-cold; serve in a chilled glass if needed.
- If a cold cup is now too intense, the symptom fix table applies unchanged (it never touches dose/ratio).
