import { describe, expect, it } from "vitest";
import { MAX_IMAGE_BYTES, detectImageType } from "../src/image.js";
import { makeJpegBytes, makePngBytes, makeWebpBytes } from "./fixtures.js";

describe("detectImageType", () => {
  it("detects JPEG by magic bytes", () => {
    expect(detectImageType(makeJpegBytes().buffer as ArrayBuffer)).toBe("image/jpeg");
  });

  it("detects PNG by magic bytes", () => {
    expect(detectImageType(makePngBytes().buffer as ArrayBuffer)).toBe("image/png");
  });

  it("detects WebP by magic bytes", () => {
    expect(detectImageType(makeWebpBytes().buffer as ArrayBuffer)).toBe("image/webp");
  });

  it("returns null for unrecognised bytes", () => {
    const buf = new Uint8Array([
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    ]);
    expect(detectImageType(buf.buffer as ArrayBuffer)).toBeNull();
  });

  it("returns null for buffer shorter than 12 bytes", () => {
    const buf = new Uint8Array([0xff, 0xd8, 0xff]);
    // Only 3 bytes — shorter than minimum check length
    const short = new Uint8Array([0xff, 0xd8]);
    expect(detectImageType(short.buffer as ArrayBuffer)).toBeNull();
  });
});

describe("extractImage", () => {
  it("rejects oversized files", async () => {
    const { extractImage } = await import("../src/image.js");
    // Build a FormData with an oversized 'image' field
    const oversized = new Uint8Array(MAX_IMAGE_BYTES + 1);
    // Give it a valid JPEG magic header
    oversized[0] = 0xff;
    oversized[1] = 0xd8;
    oversized[2] = 0xff;
    const fd = new FormData();
    fd.append("image", new File([oversized], "big.jpg", { type: "image/jpeg" }));
    const req = new Request("http://localhost", { method: "POST", body: fd });
    await expect(extractImage(req)).rejects.toMatchObject({ code: "PAYLOAD_TOO_LARGE" });
  });

  it("rejects missing image field", async () => {
    const { extractImage } = await import("../src/image.js");
    const fd = new FormData();
    const req = new Request("http://localhost", { method: "POST", body: fd });
    await expect(extractImage(req)).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects unsupported format", async () => {
    const { extractImage } = await import("../src/image.js");
    const buf = new Uint8Array(32).fill(0x00);
    const fd = new FormData();
    fd.append("image", new File([buf], "file.bmp", { type: "image/bmp" }));
    const req = new Request("http://localhost", { method: "POST", body: fd });
    await expect(extractImage(req)).rejects.toMatchObject({ code: "UNSUPPORTED_MEDIA_TYPE" });
  });

  it("rejects empty file", async () => {
    const { extractImage } = await import("../src/image.js");
    const fd = new FormData();
    fd.append("image", new File([], "empty.jpg", { type: "image/jpeg" }));
    const req = new Request("http://localhost", { method: "POST", body: fd });
    await expect(extractImage(req)).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("accepts a valid JPEG", async () => {
    const { extractImage } = await import("../src/image.js");
    const bytes = makeJpegBytes();
    const fd = new FormData();
    fd.append("image", new File([bytes], "photo.jpg", { type: "image/jpeg" }));
    const req = new Request("http://localhost", { method: "POST", body: fd });
    const result = await extractImage(req);
    expect(result.mimeType).toBe("image/jpeg");
  });

  it("accepts a PNG uploaded with wrong Content-Type header (trusts magic bytes)", async () => {
    const { extractImage } = await import("../src/image.js");
    const bytes = makePngBytes();
    const fd = new FormData();
    // Supply wrong MIME type — validation should rely on magic bytes, not this
    fd.append("image", new File([bytes], "photo.dat", { type: "application/octet-stream" }));
    const req = new Request("http://localhost", { method: "POST", body: fd });
    const result = await extractImage(req);
    expect(result.mimeType).toBe("image/png");
  });
});
