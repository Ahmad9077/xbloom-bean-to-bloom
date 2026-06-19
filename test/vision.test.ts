import { describe, expect, it } from "vitest";
import type { Env } from "../src/types.js";
import { extractBeanMetadata, validateBeanMetadata } from "../src/vision.js";
import {
  LIGHT_BEAN,
  MOCK_ENV,
  makeJpegBytes,
  makeMockAI,
  makeMockAIArrayResponse,
  makeMockAIBadShape,
  makeMockAIBean,
  makeMockAICapturing,
  makeMockAIDirectObject,
  makeMockAIDirectObjectRaw,
  makeMockAINullResponse,
  makeMockAIReject,
  makeMockAIResponse,
  makePngBytes,
  makeWebpBytes,
} from "./fixtures.js";

const JPEG_BYTES = makeJpegBytes().buffer as ArrayBuffer;

function makeEnv(ai: { run: (model: string, inputs: unknown) => Promise<{ response?: unknown }> }) {
  return { ...MOCK_ENV, AI: ai } as unknown as Env;
}

// ---------------------------------------------------------------------------
// validateBeanMetadata
// ---------------------------------------------------------------------------

describe("validateBeanMetadata", () => {
  it("accepts a valid bean object", () => {
    expect(() => validateBeanMetadata(LIGHT_BEAN)).not.toThrow();
  });

  it("throws when roastLevel is not one of the three values", () => {
    expect(() => validateBeanMetadata({ ...LIGHT_BEAN, roastLevel: "blonde" })).toThrow(
      /roastLevel/,
    );
  });

  it("throws when flavors is not an array", () => {
    expect(() => validateBeanMetadata({ ...LIGHT_BEAN, flavors: "blueberry" })).toThrow(/flavors/);
  });

  it("throws when a required string field is missing", () => {
    const { origin: _removed, ...noOrigin } = LIGHT_BEAN;
    expect(() => validateBeanMetadata(noOrigin)).toThrow(/origin/);
  });

  it("throws when input is not an object", () => {
    expect(() => validateBeanMetadata("string")).toThrow(/object/);
    expect(() => validateBeanMetadata(null)).toThrow(/object/);
    expect(() => validateBeanMetadata(42)).toThrow(/object/);
  });

  it("accepts empty strings for optional-text fields", () => {
    const bean = { ...LIGHT_BEAN, variety: "", origin: "" };
    expect(() => validateBeanMetadata(bean)).not.toThrow();
  });

  it("accepts empty flavors array", () => {
    const bean = { ...LIGHT_BEAN, flavors: [] };
    expect(() => validateBeanMetadata(bean)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// extractBeanMetadata — CF Workers AI binding mock
// ---------------------------------------------------------------------------

describe("extractBeanMetadata", () => {
  it("returns parsed bean metadata on success (plain JSON string)", async () => {
    const result = await extractBeanMetadata(
      JPEG_BYTES,
      "image/jpeg",
      makeEnv(makeMockAIBean(LIGHT_BEAN)),
    );
    expect(result).toEqual(LIGHT_BEAN);
  });

  it("accepts a response wrapped in a Markdown JSON code fence", async () => {
    const fenced = `\`\`\`json\n${JSON.stringify(LIGHT_BEAN)}\n\`\`\``;
    const result = await extractBeanMetadata(JPEG_BYTES, "image/jpeg", makeEnv(makeMockAI(fenced)));
    expect(result).toEqual(LIGHT_BEAN);
  });

  it("accepts a code fence without language tag", async () => {
    const fenced = `\`\`\`\n${JSON.stringify(LIGHT_BEAN)}\n\`\`\``;
    const result = await extractBeanMetadata(JPEG_BYTES, "image/jpeg", makeEnv(makeMockAI(fenced)));
    expect(result).toEqual(LIGHT_BEAN);
  });

  it("throws UpstreamMalformedError when response is prose (not JSON)", async () => {
    const proseAI = makeMockAI(`Here is your metadata: ${JSON.stringify(LIGHT_BEAN)}`);
    await expect(
      extractBeanMetadata(JPEG_BYTES, "image/jpeg", makeEnv(proseAI)),
    ).rejects.toMatchObject({ code: "UPSTREAM_MALFORMED" });
  });

  it("throws UpstreamMalformedError when response has trailing prose after JSON", async () => {
    const trailingAI = makeMockAI(`${JSON.stringify(LIGHT_BEAN)} Hope that helps!`);
    await expect(
      extractBeanMetadata(JPEG_BYTES, "image/jpeg", makeEnv(trailingAI)),
    ).rejects.toMatchObject({ code: "UPSTREAM_MALFORMED" });
  });

  it("throws UpstreamMalformedError when response contains multiple JSON objects", async () => {
    const multiAI = makeMockAI(JSON.stringify(LIGHT_BEAN) + JSON.stringify(LIGHT_BEAN));
    await expect(
      extractBeanMetadata(JPEG_BYTES, "image/jpeg", makeEnv(multiAI)),
    ).rejects.toMatchObject({ code: "UPSTREAM_MALFORMED" });
  });

  it("throws UpstreamMalformedError when response is malformed JSON", async () => {
    const badJsonAI = makeMockAI("{not-valid-json{{");
    await expect(
      extractBeanMetadata(JPEG_BYTES, "image/jpeg", makeEnv(badJsonAI)),
    ).rejects.toMatchObject({ code: "UPSTREAM_MALFORMED" });
  });

  it("throws UpstreamMalformedError when response is empty", async () => {
    const emptyAI = makeMockAI("");
    await expect(
      extractBeanMetadata(JPEG_BYTES, "image/jpeg", makeEnv(emptyAI)),
    ).rejects.toMatchObject({ code: "UPSTREAM_MALFORMED" });
  });

  it("throws UpstreamMalformedError when response shape has no response field", async () => {
    await expect(
      extractBeanMetadata(JPEG_BYTES, "image/jpeg", makeEnv(makeMockAIBadShape())),
    ).rejects.toMatchObject({ code: "UPSTREAM_MALFORMED" });
  });

  it("throws UpstreamMalformedError when response JSON fails bean validation (wrong roastLevel)", async () => {
    const badBeanAI = makeMockAI(JSON.stringify({ ...LIGHT_BEAN, roastLevel: "burnt" }));
    await expect(
      extractBeanMetadata(JPEG_BYTES, "image/jpeg", makeEnv(badBeanAI)),
    ).rejects.toMatchObject({ code: "UPSTREAM_MALFORMED" });
  });

  it("throws InternalError when AI binding is absent", async () => {
    const envNoAI = { ALLOWED_ORIGINS: MOCK_ENV.ALLOWED_ORIGINS } as unknown as Env;
    await expect(extractBeanMetadata(JPEG_BYTES, "image/jpeg", envNoAI)).rejects.toMatchObject({
      code: "INTERNAL_ERROR",
    });
  });

  it("throws UpstreamError when binding rejects (quota/license/model error)", async () => {
    const rejectingAI = makeMockAIReject(new Error("Workers AI: quota exceeded"));
    await expect(
      extractBeanMetadata(JPEG_BYTES, "image/jpeg", makeEnv(rejectingAI)),
    ).rejects.toMatchObject({ code: "UPSTREAM_ERROR" });
  });

  it("does not include binding error text in thrown UpstreamError message", async () => {
    const SENTINEL = "BINDING_ERR_SENTINEL_abc123xyz";
    const rejectingAI = makeMockAIReject(new Error(SENTINEL));
    let thrownMessage = "";
    try {
      await extractBeanMetadata(JPEG_BYTES, "image/jpeg", makeEnv(rejectingAI));
    } catch (err) {
      thrownMessage = err instanceof Error ? err.message : String(err);
    }
    expect(thrownMessage).not.toContain(SENTINEL);
  });
});

// ---------------------------------------------------------------------------
// validateBeanMetadata — strict bounds and field constraints
// ---------------------------------------------------------------------------

describe("validateBeanMetadata — strict bounds", () => {
  it("throws when unknown fields are present", () => {
    expect(() => validateBeanMetadata({ ...LIGHT_BEAN, extraField: "foo" })).toThrow(
      /unknown field/,
    );
  });

  it("throws when description exceeds 200 characters", () => {
    expect(() => validateBeanMetadata({ ...LIGHT_BEAN, description: "x".repeat(201) })).toThrow(
      /description/,
    );
  });

  it("throws when coffeeType exceeds max length", () => {
    expect(() => validateBeanMetadata({ ...LIGHT_BEAN, coffeeType: "x".repeat(101) })).toThrow(
      /coffeeType/,
    );
  });

  it("throws when flavors array exceeds max count", () => {
    expect(() => validateBeanMetadata({ ...LIGHT_BEAN, flavors: Array(21).fill("note") })).toThrow(
      /flavors/,
    );
  });

  it("throws when a flavor item exceeds max length", () => {
    expect(() => validateBeanMetadata({ ...LIGHT_BEAN, flavors: ["x".repeat(51)] })).toThrow(
      /flavor/i,
    );
  });

  it("accepts description exactly at 200 characters", () => {
    expect(() =>
      validateBeanMetadata({ ...LIGHT_BEAN, description: "x".repeat(200) }),
    ).not.toThrow();
  });

  it("accepts exactly 20 flavors each exactly 50 characters", () => {
    expect(() =>
      validateBeanMetadata({ ...LIGHT_BEAN, flavors: Array(20).fill("x".repeat(50)) }),
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// extractBeanMetadata — regression tests for Workers AI response shapes
// ---------------------------------------------------------------------------

describe("extractBeanMetadata — Workers AI response shape regressions", () => {
  const JPEG_BUF = makeJpegBytes().buffer as ArrayBuffer;
  const PNG_BUF = makePngBytes().buffer as ArrayBuffer;
  const WEBP_BUF = makeWebpBytes().buffer as ArrayBuffer;

  function makeEnv(ai: {
    run: (model: string, inputs: unknown) => Promise<{ response?: unknown }>;
  }) {
    return { ...MOCK_ENV, AI: ai } as unknown as Env;
  }

  it("throws UpstreamMalformedError when response field is null (runtime type mismatch)", async () => {
    await expect(
      extractBeanMetadata(JPEG_BUF, "image/jpeg", makeEnv(makeMockAINullResponse())),
    ).rejects.toMatchObject({ code: "UPSTREAM_MALFORMED" });
  });

  it("accepts a valid pre-parsed object response", async () => {
    const result = await extractBeanMetadata(
      JPEG_BUF,
      "image/jpeg",
      makeEnv(makeMockAIResponse(LIGHT_BEAN)),
    );
    expect(result).toEqual(LIGHT_BEAN);
  });

  it("normalizes an overlong object-response description at a word boundary", async () => {
    const sourceDescription = "coffee description word ".repeat(24).trim();
    expect(sourceDescription.length).toBeGreaterThan(471);

    const result = await extractBeanMetadata(
      JPEG_BUF,
      "image/jpeg",
      makeEnv(makeMockAIResponse({ ...LIGHT_BEAN, description: sourceDescription })),
    );

    expect(result.description.length).toBeLessThanOrEqual(200);
    expect(sourceDescription.startsWith(result.description)).toBe(true);
    expect(sourceDescription[result.description.length]).toBe(" ");
  });

  it("rejects an array response", async () => {
    await expect(
      extractBeanMetadata(JPEG_BUF, "image/jpeg", makeEnv(makeMockAIResponse([LIGHT_BEAN]))),
    ).rejects.toMatchObject({ code: "UPSTREAM_MALFORMED" });
  });

  it("rejects an object response containing an unknown field", async () => {
    await expect(
      extractBeanMetadata(
        JPEG_BUF,
        "image/jpeg",
        makeEnv(makeMockAIResponse({ ...LIGHT_BEAN, unexpected: "value" })),
      ),
    ).rejects.toMatchObject({ code: "UPSTREAM_MALFORMED" });
  });

  it("image is embedded in user message content as image_url — no top-level image field", async () => {
    const { ai, lastInputs } = makeMockAICapturing(LIGHT_BEAN);
    await extractBeanMetadata(JPEG_BUF, "image/jpeg", makeEnv(ai));

    const inputs = lastInputs() as {
      messages: Array<{ role: string; content: unknown }>;
      image?: unknown;
    };
    // Must NOT send image as a top-level field
    expect(inputs.image).toBeUndefined();

    // User message content must be an array with an image_url entry
    const userContent = inputs.messages[1]?.content;
    expect(Array.isArray(userContent)).toBe(true);
    const parts = userContent as Array<{ type?: string; image_url?: { url?: string } }>;
    const imgPart = parts.find((p) => p.type === "image_url");
    expect(imgPart?.image_url?.url).toMatch(/^data:image\/jpeg;base64,/);
  });

  it("data URL mime type matches the detected image type — JPEG", async () => {
    const { ai, lastInputs } = makeMockAICapturing(LIGHT_BEAN);
    await extractBeanMetadata(JPEG_BUF, "image/jpeg", makeEnv(ai));
    const parts = (lastInputs() as { messages: Array<{ content: unknown }> }).messages[1]
      ?.content as Array<{
      type: string;
      image_url?: { url: string };
    }>;
    expect(parts.find((p) => p.type === "image_url")?.image_url?.url).toMatch(
      /^data:image\/jpeg;base64,/,
    );
  });

  it("data URL mime type matches the detected image type — PNG", async () => {
    const { ai, lastInputs } = makeMockAICapturing(LIGHT_BEAN);
    await extractBeanMetadata(PNG_BUF, "image/png", makeEnv(ai));
    const parts = (lastInputs() as { messages: Array<{ content: unknown }> }).messages[1]
      ?.content as Array<{
      type: string;
      image_url?: { url: string };
    }>;
    expect(parts.find((p) => p.type === "image_url")?.image_url?.url).toMatch(
      /^data:image\/png;base64,/,
    );
  });

  it("data URL mime type matches the detected image type — WebP", async () => {
    const { ai, lastInputs } = makeMockAICapturing(LIGHT_BEAN);
    await extractBeanMetadata(WEBP_BUF, "image/webp", makeEnv(ai));
    const parts = (lastInputs() as { messages: Array<{ content: unknown }> }).messages[1]
      ?.content as Array<{
      type: string;
      image_url?: { url: string };
    }>;
    expect(parts.find((p) => p.type === "image_url")?.image_url?.url).toMatch(
      /^data:image\/webp;base64,/,
    );
  });

  it("system message is a plain string (not an array)", async () => {
    const { ai, lastInputs } = makeMockAICapturing(LIGHT_BEAN);
    await extractBeanMetadata(JPEG_BUF, "image/jpeg", makeEnv(ai));
    const messages = (lastInputs() as { messages: Array<{ role: string; content: unknown }> })
      .messages;
    expect(messages[0]?.role).toBe("system");
    expect(typeof messages[0]?.content).toBe("string");
  });

  it("succeeds for all three supported image types end-to-end", async () => {
    for (const [bytes, mime] of [
      [JPEG_BUF, "image/jpeg"],
      [PNG_BUF, "image/png"],
      [WEBP_BUF, "image/webp"],
    ] as const) {
      const result = await extractBeanMetadata(bytes, mime, makeEnv(makeMockAIBean(LIGHT_BEAN)));
      expect(result).toEqual(LIGHT_BEAN);
    }
  });
});
