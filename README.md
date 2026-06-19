# xBloom Recipe Worker

Cloudflare Worker that converts a coffee-bean bag photo into a validated xBloom Studio recipe.

## Architecture

1. The client uploads a JPEG, PNG, or WebP image as multipart form data.
2. The Worker calls the **Cloudflare Workers AI binding** server-side using model
   `@cf/meta/llama-3.2-11b-vision-instruct` and extracts only bean metadata. Text
   printed in the image is treated as untrusted data, not instructions. The model is
   never told recipe numbers.
3. A deterministic TypeScript engine—not the AI—selects brewing parameters, clamps
   and quantises them to verified app limits, and validates the finished recipe.

No OpenAI API key or any external provider key is required. Vision inference runs
entirely within the Cloudflare Workers AI binding.

This project targets **xBloom Studio only**. The native integration mapping is
`adaptedModel=2` / `J20`. Bean metadata is retained by this service but is not stored
in a native xBloom recipe.

There is no public xBloom authoring API. This Worker does not call xBloom endpoints or
claim to add recipes directly to an account.

## API

- `GET /health`
- `POST /v1/recipes/from-image`

Upload requests use `multipart/form-data` with an `image` file. When Turnstile is
enabled, also include `cf-turnstile-response` as a form field.

Successful recipe responses contain `ok`, `requestId`, and `recipe`. Errors contain
`ok`, `requestId`, and an `error` object with stable `code` and safe `message` fields.
The health response contains `ok`, `requestId`, and `status`.

Example:

```sh
curl -X POST https://example-worker.workers.dev/v1/recipes/from-image \
  -F "image=@/path/to/coffee-bag.jpg"
```

## Public recipe schema

```json
{
  "name": "string",
  "machine": "xBloom Studio",
  "dripper": "Omni | xPod | Other",
  "brewRatio": "1:N",
  "totalVolumeMl": 160,
  "doseG": 16,
  "grindSize": 23,
  "rpm": 90,
  "pours": [
    {
      "label": "Bloom",
      "volumeMl": 55,
      "tempC": 93,
      "flowRateMlPerSec": 3.0,
      "pauseSec": 40,
      "pattern": "centered | spiral | circular",
      "agitationBefore": false,
      "agitationAfter": false
    }
  ],
  "bypass": {
    "volumeMl": 20,
    "tempC": 90
  },
  "bean": {
    "coffeeType": "string",
    "variety": "string",
    "origin": "string",
    "processingMethod": "string",
    "roastLevel": "light | medium | dark",
    "flavors": ["string"],
    "description": "string"
  }
}
```

`bypass` is optional.

## Verified native constraints

| Field | Constraint |
|---|---|
| Dose | Integer, 5–18 g |
| Ratio | `1:5`–`1:25`; `totalVolumeMl = doseG × N` |
| Grind size | Integer, 1–80 |
| RPM | 60–120, step 10 |
| Generated pour volume | Positive integer, at most 240 ml |
| Temperature | Integer, 40–95 °C |
| Flow rate | 3.0–3.5 ml/s, step 0.1 |
| Pause | Integer, 0–59 seconds; this is a pause, not pour duration |
| Pattern | `centered`, `spiral`, or `circular` |
| Agitation | Boolean before/after controls |
| Optional bypass | 5–100 ml; 40–95 °C |

Pour volumes plus optional bypass volume must equal `totalVolumeMl` exactly. The app
also exposes RT/BP temperature sentinels, but this engine emits numeric temperatures
only.

Service-only safety limits—not xBloom native limits—are: recipe names at most 200
characters; primary bean text fields at most 100 characters; descriptions at most 200;
at most 20 flavors; and each flavor at most 50 characters.

## Setup and verification

Prerequisites: Node.js, npm, a Cloudflare account, and Wrangler authentication.

```sh
npm install
npm run check
npm run dev
```

Tests require no network access or API key. They inject a narrow mock AI binding and
use synthetic signature-valid image bytes.

## Cloudflare Workers AI — free allocation

This Worker uses the Cloudflare Workers AI binding bound as `AI` (declared in
`wrangler.toml` under `[ai]`). The binding is available at no charge on the
**Workers Free plan** with an allocation of **10,000 neurons per day**. Requests that
exceed the daily allocation fail until the allocation resets; they do not bill
automatically.

**Keep the Cloudflare Workers Free plan** if zero-cost operation is required. Upgrading
to Workers Paid removes the daily allocation cap and will incur charges per request
beyond the included quota.

## Meta license acceptance (required before first use)

The model `@cf/meta/llama-3.2-11b-vision-instruct` is subject to Meta's license and
Acceptable Use Policy. You must accept the license once per Cloudflare account before
the model will serve requests.

Accept the license through the **Cloudflare dashboard** or **AI Playground** — do not
pass account tokens or credentials in shell commands or files. No shell command or
environment variable is needed in this project; the accepted license is stored at the
account level by Cloudflare.

Until the license is accepted, Workers AI requests for this model will fail with a
license or permission error.

## Configuration

Configuration variable in `wrangler.toml`:

- `ALLOWED_ORIGINS`: comma-separated exact origins. Cross-origin access is denied by
  default unless the request origin is listed.

Optional secret (Turnstile CAPTCHA verification):

```sh
npx wrangler secret put TURNSTILE_SECRET_KEY
```

Never pass secret values as shell arguments; use the interactive `wrangler secret put`
prompt.

The Workers AI binding does not require a secret. It is declared as:

```toml
[ai]
binding = "AI"
```

## Deploy

```sh
npm run deploy
```

Deployment requires Wrangler authentication and that the Meta license has been
accepted at the account level (see above). The Worker will fail requests until the
license is accepted.

Real-photo smoke testing remains pending: Cloudflare login, Meta license acceptance,
deployment to a live Worker URL, and a physical coffee-bag photo are all required.
Synthetic tests establish request handling, validation, security behaviour, and
deterministic recipe generation.

## Limits

- The 10 MB upload maximum is a Worker service limit, not an xBloom limit.
- Phase 3 provides no persistence or account automation. Those are separate phases.
