import { ClientError, PayloadTooLargeError, UnsupportedMediaError } from "./errors.js";

/** Maximum image size accepted by this Worker (not an xBloom limit). */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB

export type DetectedMimeType = "image/jpeg" | "image/png" | "image/webp";

/**
 * Detect image format from the first bytes of the buffer.
 * Returns null for unrecognised content signatures.
 */
export function detectImageType(buffer: ArrayBuffer): DetectedMimeType | null {
  if (buffer.byteLength < 12) return null;
  const v = new Uint8Array(buffer);

  // JPEG: FF D8 FF
  if (v[0] === 0xff && v[1] === 0xd8 && v[2] === 0xff) {
    return "image/jpeg";
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    v[0] === 0x89 &&
    v[1] === 0x50 &&
    v[2] === 0x4e &&
    v[3] === 0x47 &&
    v[4] === 0x0d &&
    v[5] === 0x0a &&
    v[6] === 0x1a &&
    v[7] === 0x0a
  ) {
    return "image/png";
  }

  // WebP: RIFF????WEBP
  if (
    v[0] === 0x52 &&
    v[1] === 0x49 &&
    v[2] === 0x46 &&
    v[3] === 0x46 &&
    v[8] === 0x57 &&
    v[9] === 0x45 &&
    v[10] === 0x42 &&
    v[11] === 0x50
  ) {
    return "image/webp";
  }

  return null;
}

/**
 * Extract and validate the image field from an already-parsed FormData object.
 * Use this when the caller has already called request.formData() to avoid
 * consuming the body twice.
 */
export async function extractImageFromFormData(
  formData: FormData,
): Promise<{ bytes: ArrayBuffer; mimeType: DetectedMimeType }> {
  const field: unknown = formData.get("image");
  if (field === null || field === undefined) {
    throw new ClientError('Missing required form field "image"');
  }
  if (!(field instanceof File)) {
    throw new ClientError('"image" field must be a file, not a text value');
  }

  const bytes = await field.arrayBuffer();

  if (bytes.byteLength === 0) {
    throw new ClientError("Uploaded image is empty");
  }
  if (bytes.byteLength > MAX_IMAGE_BYTES) {
    throw new PayloadTooLargeError(
      `Image exceeds the ${MAX_IMAGE_BYTES / 1024 / 1024} MB Worker limit`,
    );
  }

  const mimeType = detectImageType(bytes);
  if (mimeType === null) {
    throw new UnsupportedMediaError(
      "Image format not recognised from content signature. Supported: JPEG, PNG, WebP",
    );
  }

  return { bytes, mimeType };
}

/**
 * Extract and validate the uploaded image from a multipart/form-data request.
 * Throws typed errors on any failure; never throws generic Error directly.
 */
export async function extractImage(
  request: Request,
): Promise<{ bytes: ArrayBuffer; mimeType: DetectedMimeType }> {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    throw new ClientError("Could not parse multipart/form-data body");
  }

  return extractImageFromFormData(formData);
}

/**
 * Encode a binary ArrayBuffer to a base64 data-URL string.
 */
export function toDataUrl(bytes: ArrayBuffer, mimeType: string): string {
  const u8 = new Uint8Array(bytes);
  let binary = "";
  for (let i = 0; i < u8.length; i++) {
    binary += String.fromCharCode(u8[i] as number);
  }
  return `data:${mimeType};base64,${btoa(binary)}`;
}
