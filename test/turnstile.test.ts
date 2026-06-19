import { describe, expect, it, vi } from "vitest";
import { verifyTurnstile } from "../src/turnstile.js";

const SECRET = "test-secret-key";

describe("verifyTurnstile", () => {
  it("resolves when Turnstile API returns success: true", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ success: true, "error-codes": [] }), { status: 200 }),
      );
    await expect(verifyTurnstile("valid-token", SECRET, mockFetch)).resolves.toBeUndefined();
  });

  it("throws TurnstileError when Turnstile API returns success: false", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ success: false, "error-codes": ["invalid-input-response"] }),
          { status: 200 },
        ),
      );
    await expect(verifyTurnstile("bad-token", SECRET, mockFetch)).rejects.toMatchObject({
      code: "TURNSTILE_FAILED",
    });
  });

  it("throws ClientError when token is null", async () => {
    const mockFetch = vi.fn();
    await expect(verifyTurnstile(null, SECRET, mockFetch)).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("throws ClientError when token is empty string", async () => {
    const mockFetch = vi.fn();
    await expect(verifyTurnstile("", SECRET, mockFetch)).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });

  it("throws ClientError when token is whitespace only", async () => {
    const mockFetch = vi.fn();
    await expect(verifyTurnstile("   ", SECRET, mockFetch)).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });

  it("throws UpstreamError when Turnstile API returns non-OK status", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue(new Response("Service Unavailable", { status: 503 }));
    await expect(verifyTurnstile("token", SECRET, mockFetch)).rejects.toMatchObject({
      code: "UPSTREAM_ERROR",
    });
  });

  it("throws UpstreamError when fetch rejects (network error)", async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    await expect(verifyTurnstile("token", SECRET, mockFetch)).rejects.toMatchObject({
      code: "UPSTREAM_ERROR",
    });
  });

  it("does not include the secret key in the error message", async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error("network error"));
    try {
      await verifyTurnstile("token", SECRET, mockFetch);
    } catch (err) {
      expect((err as Error).message).not.toContain(SECRET);
    }
  });

  it("does not include error-codes in the TurnstileError message", async () => {
    const SENTINEL = "ts-error-sentinel-xyz123";
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: false, "error-codes": [SENTINEL] }), {
        status: 200,
      }),
    );
    try {
      await verifyTurnstile("token", SECRET, mockFetch);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect((err as Error).message).not.toContain(SENTINEL);
    }
  });

  it("does not include network error message in the UpstreamError message", async () => {
    const SENTINEL = "ts-net-sentinel-abc456";
    const mockFetch = vi.fn().mockRejectedValue(new Error(SENTINEL));
    try {
      await verifyTurnstile("token", SECRET, mockFetch);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect((err as Error).message).not.toContain(SENTINEL);
    }
  });
});
