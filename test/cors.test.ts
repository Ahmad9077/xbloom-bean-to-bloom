import { describe, expect, it } from "vitest";
import { buildCorsHeaders, handlePreflight, parseAllowedOrigins } from "../src/cors.js";

describe("parseAllowedOrigins", () => {
  it("returns empty set for undefined", () => {
    expect(parseAllowedOrigins(undefined).size).toBe(0);
  });

  it("returns empty set for empty string", () => {
    expect(parseAllowedOrigins("").size).toBe(0);
  });

  it("parses a single origin", () => {
    const s = parseAllowedOrigins("https://example.com");
    expect(s.has("https://example.com")).toBe(true);
    expect(s.size).toBe(1);
  });

  it("parses multiple comma-separated origins", () => {
    const s = parseAllowedOrigins("https://a.com, https://b.com ,https://c.com");
    expect(s.has("https://a.com")).toBe(true);
    expect(s.has("https://b.com")).toBe(true);
    expect(s.has("https://c.com")).toBe(true);
    expect(s.size).toBe(3);
  });

  it("filters out blank entries", () => {
    const s = parseAllowedOrigins(",,,https://a.com,,,");
    expect(s.size).toBe(1);
  });
});

describe("buildCorsHeaders", () => {
  const allowed = parseAllowedOrigins("https://allowed.com,http://localhost:3000");

  it("returns CORS headers for an allowed origin", () => {
    const h = buildCorsHeaders("https://allowed.com", allowed);
    expect(h.get("Access-Control-Allow-Origin")).toBe("https://allowed.com");
    expect(h.get("Vary")).toBe("Origin");
  });

  it("does not reflect a disallowed origin", () => {
    const h = buildCorsHeaders("https://evil.com", allowed);
    expect(h.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("returns empty headers when origin is null", () => {
    const h = buildCorsHeaders(null, allowed);
    expect(h.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("does not reflect arbitrary origins when allow list is empty", () => {
    const empty = parseAllowedOrigins(undefined);
    const h = buildCorsHeaders("https://any.com", empty);
    expect(h.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("includes localhost in the allowed list from wrangler default", () => {
    const h = buildCorsHeaders("http://localhost:3000", allowed);
    expect(h.get("Access-Control-Allow-Origin")).toBe("http://localhost:3000");
  });
});

describe("handlePreflight", () => {
  const allowed = parseAllowedOrigins("https://allowed.com");

  it("returns 204 for allowed origin", () => {
    const res = handlePreflight("https://allowed.com", allowed);
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://allowed.com");
  });

  it("returns 204 without CORS headers for disallowed origin", () => {
    const res = handlePreflight("https://bad.com", allowed);
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
});
