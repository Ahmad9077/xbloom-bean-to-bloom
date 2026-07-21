import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
// @ts-expect-error root index.js is the deployed Worker bundle.
import productionWorker from "../index.js";
// @ts-expect-error the staging utility is intentionally a plain Node ESM script.
import { stageWebAssets } from "../scripts/stage-web-assets.mjs";

const assetsDist = "assets-dist";
const oldJavaScriptAsset = "index-Wp45wuaV.js";
const oldStylesheetAsset = "index-i6U5Dl9Q.css";

function withoutQuery(reference: string): string {
  return reference.split("?", 1)[0] ?? reference;
}

function scriptReferences(html: string): string[] {
  return [...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+\.js(?:\?[^"']*)?)["'][^>]*>/gi)].map(
    (match) => withoutQuery(match[1] ?? ""),
  );
}

function stylesheetReferences(html: string): string[] {
  return [...html.matchAll(/<link\b[^>]*>/gi)]
    .filter((match) => /\brel=["']stylesheet["']/i.test(match[0]))
    .map((match) => /\bhref=["']([^"']+\.css(?:\?[^"']*)?)["']/i.exec(match[0])?.[1] ?? "")
    .filter(Boolean)
    .map(withoutQuery);
}

describe("web asset staging utility", () => {
  const temporaryDirectories: string[] = [];

  afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("fails clearly when the web build output is missing", async () => {
    const root = mkdtempSync(join(tmpdir(), "bean-to-bloom-stage-missing-"));
    temporaryDirectories.push(root);

    await expect(
      stageWebAssets({
        webDist: join(root, "missing-web-dist"),
        assetsDist: join(root, "assets-dist"),
      }),
    ).rejects.toThrow("Web build output is missing");
  });

  it("replaces the shell, copies new files, and never deletes an older hashed bundle", async () => {
    const root = mkdtempSync(join(tmpdir(), "bean-to-bloom-stage-"));
    temporaryDirectories.push(root);
    const webDist = join(root, "web-dist");
    const assets = join(root, "assets-dist");

    mkdirSync(join(webDist, "assets"), { recursive: true });
    mkdirSync(join(assets, "assets"), { recursive: true });
    writeFileSync(join(webDist, "index.html"), "<html>new shell</html>");
    writeFileSync(join(webDist, "assets", "index-NewHash.js"), "console.log('new')");
    writeFileSync(join(webDist, "assets", "index-NewHash.css"), ":root{color:#241b16}");
    writeFileSync(join(webDist, "manifest.json"), '{"name":"Bean to Bloom"}');
    writeFileSync(join(assets, "index.html"), "<html>old shell</html>");
    writeFileSync(join(assets, "assets", oldJavaScriptAsset), "console.log('old')");
    writeFileSync(join(assets, "assets", oldStylesheetAsset), ":root{color:#000}");

    await stageWebAssets({ webDist, assetsDist: assets });
    await stageWebAssets({ webDist, assetsDist: assets });

    expect(readFileSync(join(assets, "index.html"), "utf8")).toBe("<html>new shell</html>");
    expect(readFileSync(join(assets, "assets", "index-NewHash.js"), "utf8")).toBe(
      "console.log('new')",
    );
    expect(readFileSync(join(assets, "manifest.json"), "utf8")).toBe('{"name":"Bean to Bloom"}');
    expect(readFileSync(join(assets, "assets", oldJavaScriptAsset), "utf8")).toBe(
      "console.log('old')",
    );
    expect(readFileSync(join(assets, "assets", oldStylesheetAsset), "utf8")).toBe(
      ":root{color:#000}",
    );
  });
});

describe("staged production web assets", () => {
  const html = readFileSync(join(assetsDist, "index.html"), "utf8");
  const scripts = scriptReferences(html);
  const stylesheets = stylesheetReferences(html);

  it("points the SPA shell at exactly one new content-hashed JavaScript and stylesheet", () => {
    expect(scripts).toHaveLength(1);
    expect(stylesheets).toHaveLength(1);

    expect(scripts[0]).toMatch(/^\/assets\/index-[A-Za-z0-9_-]+\.js$/);
    expect(stylesheets[0]).toMatch(/^\/assets\/index-[A-Za-z0-9_-]+\.css$/);
    expect(basename(scripts[0] ?? "")).not.toBe(oldJavaScriptAsset);
    expect(basename(stylesheets[0] ?? "")).not.toBe(oldStylesheetAsset);

    expect(existsSync(join(assetsDist, scripts[0] ?? ""))).toBe(true);
    expect(existsSync(join(assetsDist, stylesheets[0] ?? ""))).toBe(true);
  });

  it("preserves the previous immutable bundle for open clients and rollback", () => {
    expect(existsSync(join(assetsDist, "assets", oldJavaScriptAsset))).toBe(true);
    expect(existsSync(join(assetsDist, "assets", oldStylesheetAsset))).toBe(true);
  });

  it("ships the iPhone safe-area guard and reduced-motion-aware hero movement", () => {
    const stylesheet = readFileSync(join(assetsDist, stylesheets[0] ?? ""), "utf8");
    const script = readFileSync(join(assetsDist, scripts[0] ?? ""), "utf8");

    expect(html).toContain("viewport-fit=cover");
    expect(stylesheet).toContain("safe-area-inset-top");
    expect(stylesheet).toContain(".has-sticky-header");
    expect(stylesheet).toContain("linear-gradient(to bottom,var(--paper) 0 var(--safe-top)");
    expect(script).toContain("prefers-reduced-motion: reduce");
    expect(script).toContain("IntersectionObserver");
  });

  it("ships the compact mobile recipe-result hierarchy", () => {
    const stylesheet = readFileSync(join(assetsDist, stylesheets[0] ?? ""), "utf8");

    expect(stylesheet).toContain(".recipe-page{padding-bottom:96px}");
    expect(stylesheet).toContain(".metrics-grid{grid-template-columns:repeat(3,minmax(0,1fr))");
    expect(stylesheet).toContain(".metric,.metric:nth-child(3n){min-height:72px");
    expect(stylesheet).toContain(".pour-list dl{grid-column:2;grid-template-columns:repeat(4");
  });

  it("removes the two redundant visual labels without removing their controls", () => {
    const script = readFileSync(join(assetsDist, scripts[0] ?? ""), "utf8");

    expect(script).not.toContain("Total Drink ml");
    expect(script).not.toContain("Taste feedback");
    expect(script).toContain("Drink size");
    expect(script).toContain("How was the cup?");
  });

  it("serves the new JavaScript untouched because the legacy patch is path-scoped", async () => {
    const scriptPath = scripts[0] ?? "";
    const script = readFileSync(join(assetsDist, scriptPath), "utf8");
    const response = await productionWorker.fetch(
      new Request(`https://bean-to-bloom.test${scriptPath}`),
      {
        ASSETS: {
          fetch: async () =>
            new Response(script, {
              headers: { "Content-Type": "application/javascript; charset=UTF-8" },
            }),
        },
      },
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe(script);
    expect(response.headers.get("Content-Type")).toContain("application/javascript");
    expect(response.headers.get("Cache-Control")).not.toBe("no-store");

    const workerSource = readFileSync("index.js", "utf8");
    expect(workerSource.match(/url\.pathname === "\/assets\/index-Wp45wuaV\.js"/g)).toHaveLength(1);
    expect(workerSource).not.toContain('url.pathname.endsWith(".js")');
  });

  it("stages the PWA manifest, service worker, and typed SVG icon payloads exactly", () => {
    expect(html).toContain('<link rel="manifest" href="/manifest.json"');

    for (const file of ["manifest.json", "sw.js", "icon-192.svg", "icon-512.svg"]) {
      const staged = readFileSync(join(assetsDist, file), "utf8");
      const source = readFileSync(join("web", "public", file), "utf8");
      expect(staged).toBe(source);
    }

    const manifest = JSON.parse(readFileSync(join(assetsDist, "manifest.json"), "utf8")) as {
      name?: string;
      display?: string;
      icons?: Array<{ src?: string; type?: string }>;
    };
    expect(manifest.name).toBe("Bean to Bloom");
    expect(manifest.display).toBe("standalone");
    expect(manifest.icons).toHaveLength(2);
    expect(manifest.icons?.every((icon) => icon.type === "image/svg+xml")).toBe(true);

    const serviceWorker = readFileSync(join(assetsDist, "sw.js"), "utf8");
    expect(serviceWorker).toContain('self.addEventListener("install"');
    expect(serviceWorker).toContain('self.addEventListener("fetch"');
    expect(serviceWorker).toContain('request.mode === "navigate"');

    for (const icon of ["icon-192.svg", "icon-512.svg"]) {
      const svg = readFileSync(join(assetsDist, icon), "utf8");
      expect(svg).toMatch(/^<svg\b/);
      expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    }
  });
});
