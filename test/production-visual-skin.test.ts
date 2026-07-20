import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const skinName = "bean-to-bloom-production-skin-42400f45464d.css";
const sourcePath = `web/public/${skinName}`;
const deployedPath = `assets-dist/assets/${skinName}`;

function fileHash(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

describe("production visual skin isolation", () => {
  it("links the same content-hashed skin from source and deployed HTML", () => {
    const webHtml = readFileSync("web/index.html", "utf8");
    const deployedHtml = readFileSync("assets-dist/index.html", "utf8");

    expect(existsSync(sourcePath)).toBe(true);
    expect(existsSync(deployedPath)).toBe(true);
    expect(webHtml).toContain(`href="/${skinName}"`);
    expect(deployedHtml).toContain(`href="/assets/${skinName}"`);

    const sourceCss = readFileSync(sourcePath, "utf8");
    const deployedCss = readFileSync(deployedPath, "utf8");
    const contentHash = createHash("sha256").update(sourceCss).digest("hex");

    expect(deployedCss).toBe(sourceCss);
    expect(skinName).toContain(contentHash.slice(0, 12));
    expect(deployedHtml.indexOf(`/assets/${skinName}`)).toBeGreaterThan(
      deployedHtml.indexOf("/assets/index-i6U5Dl9Q.css"),
    );
  });

  it("keeps production scripts and the service worker byte-identical", () => {
    const webHtml = readFileSync("web/index.html", "utf8");
    const deployedHtml = readFileSync("assets-dist/index.html", "utf8");

    expect(webHtml).toContain('<script type="module" src="/src/main.tsx"></script>');
    expect(deployedHtml).toContain(
      '<script type="module" crossorigin src="/assets/index-Wp45wuaV.js?v=default-only-20260701"></script>',
    );
    expect(fileHash("index.js")).toBe(
      "dd91cedefaed3cc1b698dbac3897fa9dca8d249a2e74bc90ddc7d4a142c705fd",
    );
    expect(fileHash("assets-dist/assets/index-Wp45wuaV.js")).toBe(
      "bb3bc738c734b173b60d4e4802629fdbe41dbafd76ba862713e5336cd93ac2af",
    );
    expect(fileHash("web/public/sw.js")).toBe(
      "e8635faa6bf90b5748159c26f2858320853943b883e7944753a244eeb0ec472a",
    );
  });

  it("contains only production-facing CSS with responsive accessibility guards", () => {
    const publicSurface = [
      readFileSync("web/index.html", "utf8"),
      readFileSync("assets-dist/index.html", "utf8"),
      readFileSync(sourcePath, "utf8"),
      readFileSync(deployedPath, "utf8"),
    ].join("\n");

    expect(publicSurface).not.toMatch(
      /\b(?:design preview|review screen|for review|demo notice|review switcher)\b/i,
    );
    expect(publicSurface).toContain(":has(");
    expect(publicSurface).toContain(":focus-visible");
    expect(publicSurface).toContain("@media (prefers-reduced-motion: reduce)");
    expect(publicSurface).toContain("overflow-x: hidden");
  });

  it("keeps mobile recipe cards and tablet admin actions reachable", () => {
    const css = readFileSync(deployedPath, "utf8");

    expect(css).toContain(
      'section[aria-label="Users"] > div {\n  overflow-x: auto;\n  overflow-y: hidden;',
    );
    expect(css).toMatch(
      /@media \(max-width: 1100px\)[\s\S]*main:has\(#bean-heading\) section:has\(#bridge-heading\),[\s\S]*grid-column: 1;/,
    );
    expect(css).toContain("overflow-wrap: anywhere;");
    expect(css).toContain('nav[aria-label="Main navigation"]\n  > div\n  > div\n  a[href="/"],');
    expect(css).toContain("grid-template-columns: 46px minmax(0, 1fr);");
    expect(css).toContain('ol[aria-label="Pour timeline"] > li > div:first-child {');
    expect(css).toContain("--bloom-sage: #536d5e;");
    expect(css).toContain("grid-template-columns: repeat(4, minmax(0, 1fr));");
  });
});
