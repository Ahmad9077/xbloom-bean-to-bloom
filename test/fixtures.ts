/**
 * Synthetic image bytes with valid content signatures.
 * These are not real decodable images — just enough bytes to pass magic-byte detection.
 */

export function makeJpegBytes(extraBytes = 64): Uint8Array {
  const buf = new Uint8Array(3 + extraBytes);
  buf[0] = 0xff;
  buf[1] = 0xd8;
  buf[2] = 0xff;
  return buf;
}

export function makePngBytes(extraBytes = 64): Uint8Array {
  const buf = new Uint8Array(8 + extraBytes);
  buf[0] = 0x89;
  buf[1] = 0x50; // P
  buf[2] = 0x4e; // N
  buf[3] = 0x47; // G
  buf[4] = 0x0d;
  buf[5] = 0x0a;
  buf[6] = 0x1a;
  buf[7] = 0x0a;
  return buf;
}

export function makeWebpBytes(extraBytes = 64): Uint8Array {
  const buf = new Uint8Array(12 + extraBytes);
  // RIFF
  buf[0] = 0x52;
  buf[1] = 0x49;
  buf[2] = 0x46;
  buf[3] = 0x46;
  // 4-byte size (fake)
  buf[4] = 0x00;
  buf[5] = 0x00;
  buf[6] = 0x00;
  buf[7] = 0x00;
  // WEBP
  buf[8] = 0x57;
  buf[9] = 0x45;
  buf[10] = 0x42;
  buf[11] = 0x50;
  return buf;
}

import type { BeanMetadata } from "../src/types.js";

export const LIGHT_BEAN: BeanMetadata = {
  coffeeType: "Single Origin",
  variety: "Heirloom",
  origin: "Ethiopia",
  processingMethod: "Washed",
  roastLevel: "light",
  flavors: ["blueberry", "jasmine", "lemon"],
  description: "Bright, floral Ethiopian Yirgacheffe",
};

export const MEDIUM_BEAN: BeanMetadata = {
  coffeeType: "Blend",
  variety: "Typica",
  origin: "Guatemala",
  processingMethod: "Honey",
  roastLevel: "medium",
  flavors: ["chocolate", "caramel"],
  description: "Balanced Guatemalan honey process",
};

export const DARK_BEAN: BeanMetadata = {
  coffeeType: "Espresso",
  variety: "Robusta",
  origin: "Brazil",
  processingMethod: "Natural",
  roastLevel: "dark",
  flavors: ["dark chocolate", "tobacco"],
  description: "Bold Brazilian natural dark roast",
};

// ---------------------------------------------------------------------------
// Mock Cloudflare Workers AI binding
// ---------------------------------------------------------------------------

type MockAIRun = (model: string, inputs: unknown) => Promise<{ response?: unknown }>;

export interface MockAI {
  run: MockAIRun;
}

/** Mock AI that returns a plain JSON string response. */
export function makeMockAI(responseText: string): MockAI {
  return {
    run: (_model: string, _inputs: unknown) => Promise.resolve({ response: responseText }),
  };
}

/** Mock AI that returns any runtime response value. */
export function makeMockAIResponse(response: unknown): MockAI {
  return {
    run: (_model: string, _inputs: unknown) => Promise.resolve({ response }),
  };
}

/** Mock AI that returns a valid bean as JSON. */
export function makeMockAIBean(bean: BeanMetadata): MockAI {
  return makeMockAI(JSON.stringify(bean));
}

/** Mock AI that rejects (simulates quota/license/model errors). */
export function makeMockAIReject(err: Error): MockAI {
  return {
    run: (_model: string, _inputs: unknown) => Promise.reject(err),
  };
}

/** Mock AI that returns an object without a response field. */
export function makeMockAIBadShape(): MockAI {
  return {
    run: (_model: string, _inputs: unknown) => Promise.resolve({}),
  };
}

/** Mock AI that returns an object where response is null (runtime mismatch). */
export function makeMockAINullResponse(): MockAI {
  return {
    run: (_model: string, _inputs: unknown) => Promise.resolve({ response: null }),
  };
}

/** Mock AI that returns the bean as a pre-parsed object (Workers AI runtime form). */
export function makeMockAIDirectObject(bean: BeanMetadata): MockAI {
  return {
    run: (_model: string, _inputs: unknown) => Promise.resolve({ response: { ...bean } }),
  };
}

/** Mock AI that returns an arbitrary raw object as response (for negative-path testing). */
export function makeMockAIDirectObjectRaw(obj: Record<string, unknown>): MockAI {
  return {
    run: (_model: string, _inputs: unknown) => Promise.resolve({ response: obj }),
  };
}

/** Mock AI where the response field is an array (must be rejected). */
export function makeMockAIArrayResponse(): MockAI {
  return {
    run: (_model: string, _inputs: unknown) => Promise.resolve({ response: [] }),
  };
}

/** Mock AI that captures the inputs of each call and returns a valid bean. */
export function makeMockAICapturing(bean: BeanMetadata): {
  ai: MockAI;
  lastInputs: () => unknown;
} {
  let captured: unknown;
  return {
    ai: {
      run: (_model: string, inputs: unknown) => {
        captured = inputs;
        return Promise.resolve({ response: JSON.stringify(bean) });
      },
    },
    lastInputs: () => captured,
  };
}

export const MOCK_ENV = {
  AI: makeMockAIBean(LIGHT_BEAN),
  ALLOWED_ORIGINS: "http://localhost:3000,http://localhost:8787",
};

export function makeFormDataRequest(
  imageBytes: Uint8Array,
  filename = "test.jpg",
  mimeType = "image/jpeg",
  origin = "http://localhost:3000",
  extra?: Record<string, string>,
  brewMode?: "cold" | "hot",
): Request {
  const fd = new FormData();
  fd.append("image", new File([imageBytes], filename, { type: mimeType }));
  if (brewMode !== undefined) {
    fd.append("brewMode", brewMode);
  }
  if (extra) {
    for (const [k, v] of Object.entries(extra)) {
      fd.append(k, v);
    }
  }
  return new Request("http://localhost/v1/recipes/from-image", {
    method: "POST",
    body: fd,
    headers: { Origin: origin },
  });
}
