-- Migration 010: recipe engine metadata and fingerprint cache.
--
-- Old rows keep NULL fingerprint/profile/rules_version and remain viewable.

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
