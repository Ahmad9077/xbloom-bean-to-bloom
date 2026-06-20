# xBloom Recipe Worker

Cloudflare Worker that converts coffee-bean bag photos into validated xBloom Studio brewing recipes. Authenticated; stores recipes in D1; ships a cloud bridge queue for the Mac local service.

---

## Architecture

```
Browser (SPA) → Cloudflare Worker (same-origin via Static Assets)
                     │
                     ├─ D1 database (users, sessions, recipes, bridge_jobs)
                     ├─ Workers AI (photo extraction, request scope only)
                     └─ OpenAI Responses API (text-only recipe recommendation)

Mac local-service ← polls /api/bridge/jobs/next (bearer token)
                  → POST /api/bridge/jobs/:id/complete
```

### Key modules

| Path | Role |
|---|---|
| `src/index.ts` | Router, SPA protection, scheduled handler |
| `src/db.ts` | All D1 query helpers |
| `src/auth/password.ts` | PBKDF2-HMAC-SHA256 hashing |
| `src/auth/session.ts` | Cookie generation/parsing |
| `src/auth/middleware.ts` | `requireAuth`, `requireAdmin`, `enforceSameOrigin` |
| `src/auth/bridge-token.ts` | Bridge bearer-token validation |
| `src/routes/auth.ts` | Login, logout, me |
| `src/routes/recipes.ts` | Recipe generation + history |
| `src/routes/admin.ts` | User management |
| `src/routes/bridge.ts` | Bridge queue endpoints |
| `src/openai.ts` | GPT-5.4 text-only structured recipe recommendation |
| `src/vision.ts` | Workers AI multi-image extraction and strict metadata validation |
| `src/recipe.ts` | xBloom Studio recipe validation and legacy deterministic fallback helpers |
| `src/sanitize.ts` | Username and model-string sanitization |

---

## Security overview

### Authentication
- Username login only. Passwords hashed with PBKDF2-HMAC-SHA256 (100,000 iterations, Cloudflare Workers' supported maximum, 16-byte random salt, 32-byte key). Encoded: `pbkdf2$sha256$100000$<base64url-salt>$<base64url-hash>`. Hash format stores the iteration count for future migration.
- Session: 32-byte random token, SHA-256 stored in D1. Cookie `__Host-xbloom_session` (Secure, HttpOnly, SameSite=Lax, Path=/, Max-Age 604800).
- Constant-time password comparison; dummy hash execution for unknown usernames to resist timing-based enumeration. Generic "Invalid username or password" error regardless of failure reason.
- Session invalidated on password change, role change, or enabled toggle via `auth_version` increment.

### Rate limiting
- Login: max 5 failures per username+IP-hash in 15 minutes → 429.
- Recipe generation: max 10 per user per hour → 429.

### Input validation
- Username: NFKC normalize, trim, 3–32 chars, `[\p{L}\p{N}._-]` only, no control/HTML delimiters.
- Password: minimum 4 characters with no character-composition restrictions.
- Image magic bytes validated (JPEG/PNG/WebP), max 10 MB per file, 20 MB combined, 1–4 files.
- AI-sourced strings sanitized (control chars and `< > & " '` stripped, length capped, NFKC).

### Same-origin enforcement
Mutation API routes check the `Origin` header when present and reject cross-origin requests. Non-browser requests (no `Origin` header, e.g. bridge service) are allowed through.

### CSP / security headers
All responses carry `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`. API responses use `default-src 'none'`. SPA asset responses use a SPA-appropriate CSP.

### Error logging
Logs contain only fixed-category error codes and request IDs. User data, recipe JSON, image bytes/base64, credentials, and session tokens are never logged.

### Image privacy
Image bytes exist only in memory during the request scope; they are analyzed by the Cloudflare Workers AI binding and then discarded. OpenAI receives sanitized extracted text only, never image bytes. Nothing image-related is written to D1, logs, or application storage. No temp files are created (and therefore no local cleanup is needed).

### Cold serving rule
Cold recipes target a 300 ml finished drink (accepted range 270–300 ml), using 100–120 g of ice placed in the serving glass or carafe and 150–200 ml of machine water. The Worker validates these limits before storing a recommendation.

---

## Database migration

> Historical note: native xBloom Studio recipes created inside the xBloom app and stored on device were **never** stored by this application. All tables are created fresh with `CREATE TABLE IF NOT EXISTS`; no existing data is affected.

```bash
# Create the database (once per account):
wrangler d1 create xbloom-db

# Update wrangler.toml with the returned database_id, then:
npm run migrate:remote   # production
npm run migrate:local    # local dev
```

---

## Bootstrap: create first admin

```bash
node scripts/create-admin.mjs --username=admin --remote
# Prompts for password (read from stdin, never process args or env)

# Force-reset primary admin password:
node scripts/create-admin.mjs --username=admin --force-reset-primary --remote
```

The script reads the password from stdin with no echo. It uses the same PBKDF2 parameters as the runtime. The plaintext password is never placed in command-line arguments, environment variables, source code, or logs. On this Mac, the deployed primary account is `admin`; its generated bootstrap password is stored in macOS Keychain under service `xBloom Bean to Bloom Admin`, account `admin`.

---

## Private recipe links

Recipes are identified by UUID (not sequential IDs) generated server-side. The link `/recipes/<uuid>` is only accessible by the recipe owner; any other authenticated user requesting the same path receives an indistinguishable 404. There are no public recipe endpoints.

---

## Bridge queue: root cause and fix

### Why "Bridge not available" appeared on iPhone

The old SPA called `http://127.0.0.1:3999`. On an iPhone, that loopback address resolves to the **iPhone itself**, not the Mac running the bridge service. The Mac service listens on `127.0.0.1:3999` (loopback-only), so it is physically unreachable from another device via that address. Browser Private Network Access (PNA) and mixed-context rules (HTTPS page → HTTP endpoint) also block the call.

### Permanent fix: cloud D1 bridge queue

The browser posts a bridge job to `/api/recipes/:id/bridge-jobs`. The Mac local service polls the cloud endpoint `/api/bridge/jobs/next` (public HTTPS, bearer-token authenticated) and completes jobs via `/api/bridge/jobs/:id/complete`. No device-local networking is required.

### Mac service setup

```bash
# Generate a random bearer token (Mac) without writing it to the repo:
BRIDGE_TOKEN="$(openssl rand -hex 32)"
security add-generic-password -U -a bridge -s "xBloom Bean to Bloom Bridge Token" -w "$BRIDGE_TOKEN"

# Compute its SHA-256:
printf %s "$BRIDGE_TOKEN" | shasum -a 256 | awk '{print $1}'

# Store the hash in the Worker:
wrangler secret put BRIDGE_TOKEN_HASH   # paste the SHA-256 hex

# Clear the shell variable after configuring the Worker secret:
unset BRIDGE_TOKEN

# The Mac service reads the plaintext token from Keychain and passes it as:
#   Authorization: Bearer <BRIDGE_TOKEN>
```

---

## Setup and deployment

```bash
npm install
npm run check          # typecheck + lint + test
npm run audit:high     # security audit
npm run dev            # local Worker dev (port 8787)
npm run deploy         # build SPA + deploy Worker
```

### Secrets (set via Wrangler, never in source)

| Secret | Purpose |
|---|---|
| `OPENAI_API_KEY` | Server-side OpenAI API access for text-only recipe recommendation |
| `TURNSTILE_SECRET_KEY` | Cloudflare Turnstile CAPTCHA (optional) |
| `BRIDGE_TOKEN_HASH` | SHA-256 hex of Mac bridge bearer token |

## AI recommendation flow

Cloudflare Workers AI analyzes the uploaded bag photos and merges their visible bean metadata. The
Worker sanitizes that extracted text, then sends only the text metadata to GPT-5.4 for a bean-specific
xBloom Studio recommendation using strict structured output and `store: false`. Images are never
sent to OpenAI. The Worker derives the username from the authenticated session, overwrites trusted
identity fields, validates every xBloom Studio field, and only then stores the recipe. OpenAI failures
and spending-limit errors are reported safely; the app does not silently substitute a generic recipe.

After Appium saves the recipe, it asks the official xBloom app to create a share link. Only HTTPS
links on `share-h5.xbloom.com` are accepted and returned to the recipe owner.

## Production deployment on this Mac

- Worker and SPA: `https://xbloom-recipe-worker.wld-cba.workers.dev`
- D1 database: `xbloom-db`; migrations run with `npm run migrate:remote`
- Durable bridge runtime: `~/.codex/xbloom-bridge/app`
- LaunchAgent: `~/Library/LaunchAgents/com.xbloom.bean-to-bloom-bridge.plist`
- LaunchAgent label: `com.xbloom.bean-to-bloom-bridge`

The bridge runtime is intentionally copied outside Documents because macOS privacy controls prevented a background LaunchAgent from reading the project directory. It is launched at login and kept alive. The Android app must remain logged in to the same xBloom account used on the iPhone.

## Data lifecycle and deletion policy

- Recipes and sessions persist in D1 across browser closes, Worker deployments, and Mac restarts.
- Deleting a user permanently cascades to that user's recipes, sessions, recipe-attempt records, and bridge jobs. The Admin Dashboard displays this consequence before confirmation.
- Existing pre-migration native xBloom app recipes were not part of this site's storage and are unchanged.
- Uploaded images are never stored: Workers receive multipart bytes in memory, validate and analyze them, then the request scope is discarded on both success and failure.

---

## API reference

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/auth/login` | — | Login, sets session cookie |
| POST | `/api/auth/logout` | session | Invalidate session |
| GET | `/api/auth/me` | session | Current user |
| POST | `/api/recipes/from-images` | session | Generate recipe from 1–4 bag photos |
| GET | `/api/recipes` | session | Recipe history (owner only, desc) |
| GET | `/api/recipes/:id` | session (owner) | Single recipe |
| POST | `/api/recipes/:id/bridge-jobs` | session (owner) | Queue recipe for Mac bridge |
| GET | `/api/recipes/:id/bridge-jobs` | session (owner) | Bridge job status |
| GET | `/api/admin/users` | admin | List users with recipe counts |
| POST | `/api/admin/users` | admin | Create user |
| PATCH | `/api/admin/users/:id` | admin | Reset password / toggle enabled / change role |
| DELETE | `/api/admin/users/:id` | admin | Delete user (cascades recipes/sessions) |
| GET | `/api/bridge/jobs/next` | bridge bearer | Claim next pending job |
| POST | `/api/bridge/jobs/:id/complete` | bridge bearer | Mark job completed or failed |
| GET | `/health` | — | Health check |
| POST | `/v1/recipes/from-image` | — | **Deprecated** → 401 with migration guidance |
