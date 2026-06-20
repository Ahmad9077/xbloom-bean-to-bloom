import { afterEach, describe, expect, it, vi } from "vitest";
import { recommendRecipe } from "../src/openai.js";
import type { Env } from "../src/types.js";
import { LIGHT_BEAN } from "./fixtures.js";

const ENV = { OPENAI_API_KEY: "test-openai-secret" } as Env;

const RESULT = {
  brewRatio: "1:10",
  totalVolumeMl: 160,
  doseG: 16,
  grindSize: 23,
  rpm: 90,
  pours: [
    {
      label: "Bloom",
      volumeMl: 55,
      tempC: 93,
      flowRateMlPerSec: 3,
      pauseSec: 40,
      pattern: "centered",
      agitationBefore: false,
      agitationAfter: false,
    },
    {
      label: "Pour 2",
      volumeMl: 105,
      tempC: 92,
      flowRateMlPerSec: 3,
      pauseSec: 5,
      pattern: "spiral",
      agitationBefore: false,
      agitationAfter: false,
    },
  ],
  icedServing: null,
};

function openAIResponse(value: unknown = RESULT): Response {
  return new Response(
    JSON.stringify({
      output: [
        { type: "message", content: [{ type: "output_text", text: JSON.stringify(value) }] },
      ],
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("recommendRecipe", () => {
  it("sends extracted bean text only to GPT-5.4 with structured output and storage disabled", async () => {
    const fetchMock = vi.fn().mockResolvedValue(openAIResponse());
    vi.stubGlobal("fetch", fetchMock);

    const result = await recommendRecipe(LIGHT_BEAN, "hot", ENV);

    expect(result).toEqual(RESULT);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/responses");
    expect(init.headers).toMatchObject({
      Authorization: "Bearer test-openai-secret",
      "Content-Type": "application/json",
    });
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({
      model: "gpt-5.4",
      store: false,
      reasoning: { effort: "medium" },
      max_output_tokens: 2000,
      text: { format: { type: "json_schema", name: "xbloom_recipe", strict: true } },
    });
    const content = body.input[0].content as Array<Record<string, unknown>>;
    expect(content).toHaveLength(1);
    expect(content.some((part) => part.type === "input_image")).toBe(false);
    expect(JSON.stringify(body)).not.toContain("data:image");
    expect(content[0]?.text).toContain("hot serving");
    expect(content[0]?.text).toContain('"beanName":"Yirgacheffe"');
  });

  it("fails safely when the Worker secret is missing", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(recommendRecipe(LIGHT_BEAN, "cold", {} as Env)).rejects.toMatchObject({
      code: "INTERNAL_ERROR",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("instructs cold recommendations to target 300 ml with more ice", async () => {
    const fetchMock = vi.fn().mockResolvedValue(openAIResponse());
    vi.stubGlobal("fetch", fetchMock);

    await recommendRecipe(LIGHT_BEAN, "cold", ENV);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    const prompt = body.input[0].content[0].text as string;
    expect(prompt).toContain("target exactly 300 ml");
    expect(prompt).toContain("100..120 g ice");
    expect(prompt).toContain("150..200 ml machine water");
  });

  it("maps spending and rate limits without exposing provider details", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("provider-secret-detail", { status: 429 })),
    );
    await expect(recommendRecipe(LIGHT_BEAN, "cold", ENV)).rejects.toMatchObject({
      code: "UPSTREAM_ERROR",
      message: "OpenAI rate or spending limit reached",
    });
  });

  it("does not expose an upstream authentication response", async () => {
    const sentinel = "sensitive-provider-response";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(sentinel, { status: 401 })));
    try {
      await recommendRecipe(LIGHT_BEAN, "cold", ENV);
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toMatchObject({ code: "UPSTREAM_ERROR" });
      expect((error as Error).message).not.toContain(sentinel);
    }
  });

  it("rejects malformed JSON and missing output text", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ output: [{ content: [{ type: "output_text", text: "{" }] }] }),
        ),
      )
      .mockResolvedValueOnce(openAIResponse())
      .mockResolvedValueOnce(new Response(JSON.stringify({ output: [] })));
    vi.stubGlobal("fetch", fetchMock);

    await expect(recommendRecipe(LIGHT_BEAN, "cold", ENV)).rejects.toMatchObject({
      code: "UPSTREAM_MALFORMED",
    });
    await expect(recommendRecipe(LIGHT_BEAN, "hot", ENV)).resolves.toEqual(RESULT);
    await expect(recommendRecipe(LIGHT_BEAN, "cold", ENV)).rejects.toMatchObject({
      code: "UPSTREAM_MALFORMED",
    });
  });

  it("maps network failures to a safe upstream error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network-secret-detail")));
    await expect(recommendRecipe(LIGHT_BEAN, "cold", ENV)).rejects.toMatchObject({
      code: "UPSTREAM_ERROR",
      message: "OpenAI request failed",
    });
  });
});
