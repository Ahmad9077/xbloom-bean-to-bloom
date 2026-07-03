-- Migration 013: hybrid engine feedback and per-bean retune revisions.
--
-- Ratings now capture one low-rating complaint, and retunes advance a
-- per-bean revision so a targeted fix does not overwrite the cached baseline.

ALTER TABLE recipes ADD COLUMN rating_complaint TEXT
  CHECK (
    rating_complaint IS NULL OR
    rating_complaint IN ('sour', 'bitter', 'weak', 'harsh')
  );

ALTER TABLE recipes ADD COLUMN retune_revision INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS bean_recipe_revisions (
  owner_id        TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  normalized_key  TEXT    NOT NULL,
  brew_mode       TEXT    NOT NULL CHECK (brew_mode IN ('cold', 'hot')),
  profile         TEXT    NOT NULL,
  final_drink_ml  INTEGER NOT NULL,
  engine_version  TEXT    NOT NULL,
  revision        INTEGER NOT NULL DEFAULT 0,
  updated_at      INTEGER NOT NULL,
  PRIMARY KEY (
    owner_id,
    normalized_key,
    brew_mode,
    profile,
    final_drink_ml,
    engine_version
  )
);
