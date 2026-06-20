/**
 * Sanitize an untrusted string that may come from the AI model or user input.
 *
 * - NFKC normalize (collapses lookalike Unicode, folds compatibility forms)
 * - Remove ASCII control characters (0x00–0x1F, 0x7F)
 * - Remove HTML delimiter characters: < > & " '
 * - Trim leading/trailing whitespace
 * - Truncate to maxLen (hard cut; no word boundary needed for storage caps)
 *
 * Preserves Unicode letters, Arabic, accented characters, spaces, digits and
 * meaningful punctuation (., -, _, (, ), @, etc.).
 */
export function sanitizeModelString(raw: string, maxLen: number): string {
  const normalized = raw.normalize("NFKC");
  // biome-ignore lint/suspicious/noControlCharactersInRegex: intentionally targeting control chars
  const cleaned = normalized.replace(/[\x00-\x1F\x7F<>&"']/g, "");
  const trimmed = cleaned.trim();
  return trimmed.length > maxLen ? trimmed.slice(0, maxLen).trim() : trimmed;
}

/**
 * Validate a username submitted by a user (not AI-sourced).
 * NFKC, trim, 3–32 chars, only letters/digits/. _ -.
 * No control chars or HTML delimiter chars.
 * Returns normalized display form (with original casing) and case-folded normalized form.
 * Throws a descriptive string message on validation failure.
 */
export function parseUsername(raw: string): { display: string; normalized: string } {
  const display = raw.normalize("NFKC").trim();
  if (display.length < 3) throw new Error("Username must be at least 3 characters");
  if (display.length > 32) throw new Error("Username must be at most 32 characters");
  // Only allow letters (any script), digits, and . _ -
  // Reject control chars and HTML delimiters explicitly
  // biome-ignore lint/suspicious/noControlCharactersInRegex: intentionally rejecting control chars
  if (/[\x00-\x1F\x7F<>&"']/.test(display)) {
    throw new Error("Username contains invalid characters");
  }
  if (!/^[\p{L}\p{N}._-]+$/u.test(display)) {
    throw new Error("Username may only contain letters, digits, and . _ -");
  }
  const normalized = display.toLowerCase();
  return { display, normalized };
}

/**
 * Validate a password submitted by a user.
 * Minimum 4 characters. All character types are accepted.
 */
export function validatePassword(pw: string): void {
  if (pw.length < 4) throw new Error("Password must be at least 4 characters");
}
