import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
// @ts-expect-error root index.js is the deployed Worker bundle.
import productionWorker from "../index.js";
import { generateSessionToken, hashSessionToken, sessionExpiresAt } from "../src/auth/session.js";
import { createSession, createUser } from "../src/db.js";
import { type TestDb, makeTestDb } from "./db-mock.js";
import { makeJpegBytes, makeMockAI } from "./fixtures.js";

const origin = "http://localhost";
const visionBean = {
  storeName: "OPT",
  beanName: "Yemenia",
  coffeeType: "Arabica",
  variety: "Yemenia",
  origin: "Yemen",
  processingMethod: "natural",
  roastLevel: "light",
  flavors: ["strawberry", "floral"],
  description: "Floral Yemen coffee with strawberry notes",
  visibleText: "OPT Yemenia Arabica Yemen natural light strawberry floral Yemen coffee",
};

let db: TestDb;
let cookie: string;

async function installProductionRecipeSchema() {
  await db.exec(`
    ALTER TABLE recipes ADD COLUMN store_name TEXT NOT NULL DEFAULT '';
    ALTER TABLE recipes ADD COLUMN source TEXT NOT NULL DEFAULT 'web';
    ALTER TABLE recipes ADD COLUMN source_confirmation_id TEXT;
    ALTER TABLE recipes ADD COLUMN profile TEXT;
    ALTER TABLE recipes ADD COLUMN rules_version TEXT;
    ALTER TABLE recipes ADD COLUMN fingerprint TEXT;
    ALTER TABLE recipes ADD COLUMN rating INTEGER;
    ALTER TABLE recipes ADD COLUMN rated_at TEXT;
    CREATE UNIQUE INDEX idx_recipes_owner_fp
      ON recipes(owner_id, fingerprint) WHERE fingerprint IS NOT NULL;
    CREATE TABLE pending_recipe_confirmations (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      bean_json TEXT NOT NULL,
      brew_mode TEXT NOT NULL CHECK (brew_mode IN ('cold', 'hot')),
      status TEXT NOT NULL DEFAULT 'pending',
      expires_at INTEGER NOT NULL,
      suggested_profile TEXT,
      chosen_profile TEXT,
      classifier_confidence REAL,
      processing_started_at INTEGER,
      result_recipe_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
  await db.exec(readFileSync("migrations/014_recipe_strength.sql", "utf8"));
}

function makeEnv() {
  return {
    DB: db,
    AI: makeMockAI(JSON.stringify(visionBean)),
    ALLOWED_ORIGINS: origin,
    RECIPE_ENGINE: "table",
    RECIPE_SHADOW: "0",
  };
}

function scanRequest(strength: "strong" | "soft") {
  const formData = new FormData();
  formData.append("images", new File([makeJpegBytes()], "bag.jpg", { type: "image/jpeg" }));
  formData.append("brewMode", "cold");
  formData.append("strength", strength);
  return new Request(`${origin}/api/recipes/from-images`, {
    method: "POST",
    headers: { Cookie: cookie, Origin: origin },
    body: formData,
  });
}

function confirmRequest(confirmationId: string, extra: Record<string, unknown> = {}) {
  return new Request(`${origin}/api/recipes/from-confirmation`, {
    method: "POST",
    headers: { Cookie: cookie, Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({
      confirmationId,
      storeName: "OPT",
      beanName: "Yemenia",
      roastLevel: "light",
      finalDrinkMl: 300,
      ...extra,
    }),
  });
}

beforeEach(async () => {
  db = makeTestDb();
  await installProductionRecipeSchema();
  const userId = crypto.randomUUID();
  await createUser(db, {
    id: userId,
    usernameDisplay: "tester",
    usernameNormalized: "tester",
    passwordHash: "unused-in-session-test",
    role: "user",
    isPrimary: false,
  });
  const token = generateSessionToken();
  await createSession(db, {
    tokenHash: await hashSessionToken(token),
    userId,
    authVersion: 0,
    expiresAt: sessionExpiresAt(),
  });
  cookie = `__Host-xbloom_session=${token}`;
});

afterEach(() => db.close());

describe("deployed pending-confirmation strength flow", () => {
  it("persists strength, rejects confirmation override, and isolates Strong/Soft fingerprints", async () => {
    const strongScan = await productionWorker.fetch(scanRequest("strong"), makeEnv());
    expect(strongScan.status).toBe(202);
    const strongPending = (await strongScan.json()) as {
      confirmationId: string;
      strength: string;
    };
    expect(strongPending.strength).toBe("strong");
    const storedPending = await db
      .prepare("SELECT strength FROM pending_recipe_confirmations WHERE id = ?")
      .bind(strongPending.confirmationId)
      .first<{ strength: string }>();
    expect(storedPending?.strength).toBe("strong");

    const override = await productionWorker.fetch(
      confirmRequest(strongPending.confirmationId, { strength: "soft" }),
      makeEnv(),
    );
    expect(override.status).toBe(400);

    const strongConfirm = await productionWorker.fetch(
      confirmRequest(strongPending.confirmationId),
      makeEnv(),
    );
    expect(strongConfirm.status).toBe(201);
    const strongBody = (await strongConfirm.json()) as {
      recipe: { strength: string; fingerprint: string; doseG: number; brewRatio: string };
    };
    expect(strongBody.recipe).toMatchObject({
      strength: "strong",
      doseG: 22,
      brewRatio: "1:8",
    });

    const softScan = await productionWorker.fetch(scanRequest("soft"), makeEnv());
    expect(softScan.status).toBe(202);
    const softPending = (await softScan.json()) as { confirmationId: string; strength: string };
    const softConfirm = await productionWorker.fetch(
      confirmRequest(softPending.confirmationId),
      makeEnv(),
    );
    expect(softConfirm.status).toBe(201);
    const softBody = (await softConfirm.json()) as {
      recipe: { strength: string; fingerprint: string; doseG: number; brewRatio: string };
    };
    expect(softBody.recipe).toMatchObject({
      strength: "soft",
      doseG: 18,
      brewRatio: "1:10",
    });
    expect(softBody.recipe.fingerprint).not.toBe(strongBody.recipe.fingerprint);
  });
});
