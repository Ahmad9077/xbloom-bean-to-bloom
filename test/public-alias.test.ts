import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import aliasWorker from "../src/public-alias.js";

describe("branded public Worker alias", () => {
  it("binds only to the existing application Worker", () => {
    const config = readFileSync("wrangler.public.toml", "utf8");
    expect(config).toContain('name = "brew"');
    expect(config).toContain('binding = "APP"');
    expect(config).toContain('service = "xbloom-recipe-worker"');
    expect(config).not.toContain("d1_databases");
    expect(config).not.toContain("OPENAI_API_KEY");
    expect(config).not.toContain("BRIDGE_TOKEN_HASH");
  });

  it("forwards the original request through the private service binding", async () => {
    const request = new Request("https://brew.bean-to-bloom.workers.dev/recipes/abc?x=1");
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
