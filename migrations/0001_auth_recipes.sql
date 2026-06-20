-- Migration 0001: authentication, recipes, and bridge queue
--
-- Historical note: native xBloom Studio recipes created by users inside the xBloom
-- app and stored on their devices were NEVER stored by this web application. No
-- existing recipe data is affected by this migration. All tables are created fresh
-- with CREATE TABLE IF NOT EXISTS so the migration is idempotent.
--
-- Apply with:
--   wrangler d1 migrations apply xbloom-db --remote
--   wrangler d1 migrations apply xbloom-db --local  (dev)

CREATE TABLE IF NOT EXISTS users (
  id                  TEXT    NOT NULL PRIMARY KEY,
  username_display    TEXT    NOT NULL,
  username_normalized TEXT    NOT NULL UNIQUE,
  password_hash       TEXT    NOT NULL,
  role                TEXT    NOT NULL DEFAULT 'user'
                              CHECK (role IN ('admin', 'user')),
  enabled             INTEGER NOT NULL DEFAULT 1,
  is_primary          INTEGER NOT NULL DEFAULT 0,
  auth_version        INTEGER NOT NULL DEFAULT 0,
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash   TEXT    NOT NULL PRIMARY KEY,
  user_id      TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  auth_version INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL,
  created_at   INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS sessions_user_id   ON sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_expires_at ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS recipes (
  id          TEXT    NOT NULL PRIMARY KEY,
  owner_id    TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  full_name   TEXT    NOT NULL,
  bean_name   TEXT    NOT NULL,
  recipe_json TEXT    NOT NULL,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS recipes_owner_created ON recipes(owner_id, created_at DESC);

-- Rate-limit table: one row per login attempt, keyed by SHA-256 of username+IP hash.
-- Pruned inline during login and by the scheduled handler.
CREATE TABLE IF NOT EXISTS login_attempts (
  id           TEXT    NOT NULL PRIMARY KEY,
  key_hash     TEXT    NOT NULL,
  attempted_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS login_attempts_key ON login_attempts(key_hash, attempted_at);

-- Rate-limit table: one row per recipe generation attempt.
-- Pruned inline and by the scheduled handler.
CREATE TABLE IF NOT EXISTS recipe_attempts (
  id           TEXT    NOT NULL PRIMARY KEY,
  user_id      TEXT    NOT NULL,
  attempted_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS recipe_attempts_user ON recipe_attempts(user_id, attempted_at);

-- Bridge queue: one job per recipe (unique on recipe_id).
-- The Mac local-service polls /api/bridge/jobs/next to claim pending jobs and
-- save recipes into the xBloom Android app via Appium.
--
-- Root cause for the "Bridge not available" error on iPhone GitHub Pages:
-- The SPA calls http://127.0.0.1:3999 which resolves to the iPhone itself, not the
-- Mac running the bridge. Browser Private Network Access and mixed-context rules also
-- prevent direct cross-device loopback access. The cloud D1 bridge queue is the
-- permanent fix: the Mac service polls a public HTTPS endpoint instead.
CREATE TABLE IF NOT EXISTS bridge_jobs (
  id           TEXT    NOT NULL PRIMARY KEY,
  recipe_id    TEXT    NOT NULL UNIQUE REFERENCES recipes(id) ON DELETE CASCADE,
  owner_id     TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status       TEXT    NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending', 'claimed', 'completed', 'failed')),
  attempts     INTEGER NOT NULL DEFAULT 0,
  claimed_at   INTEGER,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  completed_at INTEGER,
  safe_error   TEXT
);

CREATE INDEX IF NOT EXISTS bridge_jobs_status    ON bridge_jobs(status, created_at);
CREATE INDEX IF NOT EXISTS bridge_jobs_owner_id  ON bridge_jobs(owner_id);
