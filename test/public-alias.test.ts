import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import aliasWorker from "../src/public-alias.js";

describe("branded public proxy", () => {
  it("configures the Pages project with only an internal app service binding", () => {
    const config = readFileSync("public-url/wrangler.toml", "utf8");
    const pageWorker = readFileSync("public-url/dist/_worker.js", "utf8");

    expect(config).toContain('name = "beantobloom"');
    expect(config).toContain('binding = "APP"');
    expect(config).toContain('service = "xbloom-recipe-worker"');
    expect(config).not.toContain("d1_databases");
    expect(config).not.toContain("OPENAI_API_KEY");
    expect(config).not.toContain("BRIDGE_TOKEN_HASH");
    expect(pageWorker).toContain("return env.APP.fetch(request)");
  });

  it("forwards the original request through the private service binding", async () => {
    const request = new Request("https://beantobloom.pages.dev/recipes/abc?x=1");
    const fetch = vi.fn(async (forwarded: Request) =>
      Response.json({ url: forwarded.url, cookie: forwarded.headers.get("Cookie") }),
    );

    const response = await aliasWorker.fetch(request, {
      APP: { fetch } as unknown as Fetcher,
    });

    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith(request);
    await expect(response.json()).resolves.toEqual({
      url: request.url,
      cookie: null,
    });
  });
});
