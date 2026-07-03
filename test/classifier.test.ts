import { describe, expect, it } from "vitest";
// @ts-expect-error classifier is a runtime ESM JS module.
import { classifyBean } from "../src/classifier.js";

describe("classifyBean", () => {
  it("uses keyword fallback and neutral profile when OpenAI is unavailable", async () => {
    const result = await classifyBean(
      {
        storeName: "Unknown",
        beanName: "Bag",
        origin: "",
        processingMethod: "",
        roastLevel: "medium",
        flavors: [],
        description: "",
      },
      {},
    );

    expect(result).toMatchObject({
      profile: "neutral_classic",
      roastLevel: "unknown",
      confidence: 0.5,
      source: "keyword",
    });
    expect(result.reasons.length).toBeGreaterThan(0);
  });

  it("keeps natural Brazil chocolate/nut beans neutral in keyword fallback", async () => {
    const result = await classifyBean(
      {
        storeName: "Roaster",
        beanName: "Brazil",
        origin: "Brazil",
        processingMethod: "Natural",
        roastLevel: "medium",
        flavors: ["chocolate", "hazelnut", "caramel"],
        description: "Chocolate, hazelnut, caramel",
      },
      {},
    );

    expect(result.profile).toBe("neutral_classic");
    expect(result.source).toBe("keyword");
  });

  it("classifies Arabic natural fruit-forward metadata as funky in keyword fallback", async () => {
    const result = await classifyBean(
      {
        storeName: "محامص",
        beanName: "اليمن",
        origin: "اليمن",
        processingMethod: "طبيعي",
        roastLevel: "medium",
        flavors: ["توت", "فواكه مجففة"],
        description: "اليمن، طبيعي، توت وفواكه مجففة",
      },
      {},
    );

    expect(result).toMatchObject({
      profile: "bright_funky",
      source: "keyword",
      confidence: 0.5,
    });
  });

  it("treats unknown roast level as low-confidence neutral", async () => {
    const result = await classifyBean(
      {
        storeName: "Roaster",
        beanName: "Anaerobic Berry",
        origin: "Ethiopia",
        processingMethod: "Anaerobic natural",
        roastLevel: "unknown",
        flavors: ["strawberry", "floral", "winey"],
        description: "Anaerobic natural process, strawberry, floral, winey",
      },
      {},
    );

    expect(result).toMatchObject({
      profile: "neutral_classic",
      roastLevel: "unknown",
      source: "keyword",
    });
    expect(result.confidence).toBeLessThan(0.6);
  });
});
