-- Migration 011: sticky bean profile cache.
--
-- Profiles are keyed by normalized confirmed roastery + bean name. The cache is
-- intentionally independent of user id so rescans of the same bean keep the
-- same brewing profile and cannot flip between OpenAI and keyword classifier
-- outputs.

CREATE TABLE IF NOT EXISTS bean_profile_cache (
  normalized_key TEXT PRIMARY KEY,
  store_name     TEXT NOT NULL,
  bean_name      TEXT NOT NULL,
  profile        TEXT NOT NULL CHECK (profile IN ('bright_clean', 'bright_funky', 'neutral_classic', 'dark_roasty')),
  roast_level    TEXT,
  confidence     REAL,
  source         TEXT NOT NULL,
  reasons_json   TEXT NOT NULL DEFAULT '[]',
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_bean_profile_cache_names
  ON bean_profile_cache(store_name, bean_name);
