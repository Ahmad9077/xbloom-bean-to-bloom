import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const APPROVED_V1_3_STRUCTURE_SHA256 =
  "6bb7bf035b64763c52b0a3f19c0d4e975c952991703c1a96e590b9a0dfaf8686";

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

describe("owner-approved recipe strength structure", () => {
  it("pins all 80 v1.3 menu cells, menus, and defaults", () => {
    const table = JSON.parse(readFileSync("src/recipe-table.json", "utf8")) as {
      rulesVersion: string;
      menus: Record<string, Record<string, unknown>>;
      recipes: Record<string, Record<string, { sizesByStrength: unknown }>>;
    };
    const profiles = ["bright_clean", "bright_funky", "neutral_classic", "dark_roasty"];
    const modes = ["hot", "cold"];
    const structure = {
      menus: {
        hot: {
          finalDrinkMlByStrength: table.menus.hot?.finalDrinkMlByStrength,
          defaultByStrength: table.menus.hot?.defaultByStrength,
        },
        cold: {
          finalDrinkMlByStrength: table.menus.cold?.finalDrinkMlByStrength,
          defaultByStrength: table.menus.cold?.defaultByStrength,
        },
      },
      recipes: Object.fromEntries(
        profiles.map((profile) => [
          profile,
          Object.fromEntries(
            modes.map((mode) => [mode, table.recipes[profile]?.[mode]?.sizesByStrength]),
          ),
        ]),
      ),
    };

    expect(table.rulesVersion).toBe("1.3.0");
    expect(createHash("sha256").update(canonicalJson(structure)).digest("hex")).toBe(
      APPROVED_V1_3_STRUCTURE_SHA256,
    );
  });
});
