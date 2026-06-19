# xBloom Local Appium Service

Local HTTP service that drives the xBloom Android app via Appium to create and save recipes.
Binds to `127.0.0.1` only. Never expose to a network interface.

## Supported app version

xBloom Studio **2.2.2** (`EXPECTED_APP_VERSION=2.2.2`). Other versions may work with
`SKIP_VERSION_CHECK=true` during development, but are untested.

## Prerequisites

- Node.js >= 20
- Appium 3 running locally (`appium`)
- Android SDK platform-tools on the PATH of the **Appium process** (not just the shell)

The Appium server process must be launched with `ANDROID_HOME` (or the legacy
`ANDROID_SDK_ROOT`) set so that `adb` and the UiAutomator2 driver can locate platform-tools:

```sh
export ANDROID_HOME=/path/to/android-sdk
export ANDROID_SDK_ROOT=$ANDROID_HOME   # legacy alias, set both for compatibility
appium
```

The xBloom Studio app must already be installed and logged in on the connected device or
emulator before starting any job.

## Setup

```sh
cp .env.example .env
# Edit .env — see comments inside. Do NOT put credentials or tokens in .env.
npm install
```

## Development

```sh
npm run dev        # run without compiling (uses tsx)
npm run check      # format + typecheck + lint + test + build
```

## Running in production

```sh
npm run build
npm start
```

The service listens on `http://127.0.0.1:3999` by default (`PORT` env var).

## Security

- Bound to `127.0.0.1` only — do not reverse-proxy this onto a public interface.
- `ALLOWED_HOSTS` and `ALLOWED_ORIGINS` in `.env` restrict which callers are accepted.
- No credentials or secrets belong in `.env` or any file committed to version control.
  The service inherits the device session from the already-running Appium server; no
  passwords are passed through this service.

## Workflow: always dryRun first

Always run with `dryRun: true` and verify the dry-run log before committing a real save.
`dryRun` and `confirmSave` are mutually exclusive; exactly one must be `true` per request.

```jsonc
// Step 1 — verify recipe layout without saving
{ "recipe": { ... }, "dryRun": true }

// Step 2 — only after confirming Step 1 succeeded
{ "recipe": { ... }, "confirmSave": true, "idempotencyKey": "unique-per-recipe-attempt" }
```

Use an `idempotencyKey` on `confirmSave` requests to prevent duplicate saves if the caller
retries a timed-out request.

## Failure screenshots

On Appium errors the service captures a screenshot to `SCREENSHOT_DIR`
(default `./runtime/screenshots/`). The directory is gitignored. File paths are not
logged to avoid leaking directory structure in log output.
