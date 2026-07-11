import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
// @ts-expect-error root index.js is the deployed Worker bundle.
import productionWorker from "../index.js";

const assetPath = "assets-dist/assets/index-Wp45wuaV.js";
const assetUrl = "https://bean-to-bloom.test/assets/index-Wp45wuaV.js";

function makeEnv(script: string) {
  return {
    ASSETS: {
      fetch: async () =>
        new Response(script, {
          headers: { "Content-Type": "application/javascript; charset=UTF-8" },
        }),
    },
  };
}

describe("deployed production frontend strength patch", () => {
  it("patches the real asset exactly once and leaves valid JavaScript", async () => {
    const source = readFileSync(assetPath, "utf8");
    const response = await productionWorker.fetch(new Request(assetUrl), makeEnv(source));

    expect(response.status).toBe(200);
    const patched = await response.text();
    expect(patched.match(/\[\["strong","Strong"\],\["soft","Soft"\]\]/g)).toHaveLength(1);
    expect(patched.match(/role:"radio","aria-checked":Sp/g)).toHaveLength(1);
    expect(patched).toContain(
      "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-terracotta",
    );
    expect(patched.match(/wm\(le,a,X,jk\)/g)).toHaveLength(1);
    expect(patched.match(/d\.append\("strength",t\)/g)).toHaveLength(1);
    expect(patched.match(/o\.strength==="strong"\?\[210,224,238,252,266\]:uh/g)).toHaveLength(1);
    expect(patched.match(/o\.strength==="strong"\?252:255/g)).toHaveLength(1);
    expect(patched.match(/children:o\.strength==="strong"\?"Strong":"Soft"/g)).toHaveLength(2);
    expect(() => new Function(patched)).not.toThrow();
  });

  it("fails closed when a changed asset no longer accepts the required patch", async () => {
    const response = await productionWorker.fetch(
      new Request(assetUrl),
      makeEnv("console.log('unexpected replacement asset')"),
    );

    expect(response.status).toBe(500);
    const body = (await response.json()) as { error?: { code?: string; message?: string } };
    expect(body.error?.code).toBe("INTERNAL_ERROR");
    expect(body.error?.message).toBe("Internal error");
  });
});
