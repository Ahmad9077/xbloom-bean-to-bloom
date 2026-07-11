-- Migration 014: recipe strength (strong/soft) on every new recipe.
--
-- pending_recipe_confirmations gains a nullable strength column.
-- New application flow requires it; old pending rows (if any) are backward-compatible.
--
-- bean_recipe_revisions is rebuilt to include strength in the composite primary key
-- so strong and soft recipes never share revision history.
-- Old rows are preserved as 'strong' for migration continuity; the new engine rules
-- version change (1.2.0 → 1.3.0) prevents their fingerprints from being reused.

ALTER TABLE pending_recipe_confirmations
  ADD COLUMN strength TEXT
  CHECK (strength IS NULL OR strength IN ('strong', 'soft'));

-- Rebuild bean_recipe_revisions with strength in the primary key.
ALTER TABLE bean_recipe_revisions RENAME TO bean_recipe_revisions_v013;

CREATE TABLE IF NOT EXISTS bean_recipe_revisions (
  owner_id        TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  normalized_key  TEXT    NOT NULL,
  brew_mode       TEXT    NOT NULL CHECK (brew_mode IN ('cold', 'hot')),
  profile         TEXT    NOT NULL,
  final_drink_ml  INTEGER NOT NULL,
  engine_version  TEXT    NOT NULL,
  strength        TEXT    NOT NULL DEFAULT 'strong' CHECK (strength IN ('strong', 'soft')),
  revision        INTEGER NOT NULL DEFAULT 0,
  updated_at      INTEGER NOT NULL,
  PRIMARY KEY (
    owner_id,
    normalized_key,
    brew_mode,
    profile,
    final_drink_ml,
    engine_version,
    strength
  )
);

INSERT INTO bean_recipe_revisions
  (owner_id, normalized_key, brew_mode, profile, final_drink_ml, engine_version, strength, revision, updated_at)
  SELECT owner_id, normalized_key, brew_mode, profile, final_drink_ml, engine_version,
         'strong' AS strength, revision, updated_at
  FROM bean_recipe_revisions_v013;

DROP TABLE bean_recipe_revisions_v013;
