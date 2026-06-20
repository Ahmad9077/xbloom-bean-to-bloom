import { describe, expect, it } from "vitest";
import { parseUsername, sanitizeModelString, validatePassword } from "../src/sanitize.js";

describe("sanitizeModelString", () => {
  it("returns plain ASCII unchanged", () => {
    expect(sanitizeModelString("Ethiopia Natural", 100)).toBe("Ethiopia Natural");
  });

  it("removes HTML delimiter characters", () => {
    expect(sanitizeModelString('<script>alert("xss")</script>', 100)).toBe(
      "scriptalert(xss)/script",
    );
    expect(sanitizeModelString("a < b & c > d", 50)).toBe("a  b  c  d");
  });

  it("removes single and double quotes", () => {
    expect(sanitizeModelString("O'Reilly & Associates", 100)).toBe("OReilly  Associates");
    expect(sanitizeModelString('"quoted"', 100)).toBe("quoted");
  });

  it("preserves Unicode letters and accented characters", () => {
    expect(sanitizeModelString("Café Arabica", 100)).toBe("Café Arabica");
    expect(sanitizeModelString("コーヒー", 100)).toBe("コーヒー");
    expect(sanitizeModelString("قهوة عربية", 100)).toBe("قهوة عربية");
  });

  it("preserves meaningful punctuation", () => {
    expect(sanitizeModelString("Yirgacheffe – Washed (2024)", 100)).toBe(
      "Yirgacheffe – Washed (2024)",
    );
  });

  it("removes ASCII control characters", () => {
    expect(sanitizeModelString("hello\x00world", 100)).toBe("helloworld");
    expect(sanitizeModelString("tab\there", 100)).toBe("tabhere");
    expect(sanitizeModelString("newline\nhere", 100)).toBe("newlinehere");
  });

  it("removes DEL (0x7F)", () => {
    expect(sanitizeModelString("del\x7Fchar", 100)).toBe("delchar");
  });

  it("NFKC normalizes compatibility characters", () => {
    // Fullwidth letters → ASCII
    expect(sanitizeModelString("ＡＢＣ", 100)).toBe("ABC");
    // Ligature fi → fi
    expect(sanitizeModelString("ﬁne", 100)).toBe("fine");
  });

  it("trims leading and trailing whitespace", () => {
    expect(sanitizeModelString("  hello  ", 100)).toBe("hello");
  });

  it("truncates to maxLen", () => {
    expect(sanitizeModelString("hello world", 5)).toBe("hello");
  });

  it("returns empty string for all-delimiter input", () => {
    expect(sanitizeModelString("<>&\"'\x00", 100)).toBe("");
  });
});

describe("parseUsername", () => {
  it("accepts a simple ASCII username", () => {
    const { display, normalized } = parseUsername("alice");
    expect(display).toBe("alice");
    expect(normalized).toBe("alice");
  });

  it("accepts mixed-case and normalizes to lowercase for normalized", () => {
    const { display, normalized } = parseUsername("Alice");
    expect(display).toBe("Alice");
    expect(normalized).toBe("alice");
  });

  it("accepts . _ - special chars", () => {
    expect(() => parseUsername("user.name_one-two")).not.toThrow();
  });

  it("rejects username shorter than 3 chars", () => {
    expect(() => parseUsername("ab")).toThrow(/3/);
  });

  it("rejects username longer than 32 chars", () => {
    expect(() => parseUsername("a".repeat(33))).toThrow(/32/);
  });

  it("rejects username with spaces", () => {
    expect(() => parseUsername("user name")).toThrow();
  });

  it("rejects username with HTML delimiter < >", () => {
    expect(() => parseUsername("user<name>")).toThrow();
  });

  it("rejects username with control characters", () => {
    expect(() => parseUsername("user\x00name")).toThrow();
  });

  it("NFKC normalizes before length check", () => {
    // Fullwidth ASCII letters → ASCII (3 → 3 chars, valid)
    expect(() => parseUsername("ＡＢＣ")).not.toThrow();
  });
});

describe("validatePassword", () => {
  it("accepts any four-character password", () => {
    expect(() => validatePassword("abcd")).not.toThrow();
    expect(() => validatePassword("    ")).not.toThrow();
    expect(() => validatePassword("!@#$")).not.toThrow();
  });

  it("rejects password shorter than four characters", () => {
    expect(() => validatePassword("abc")).toThrow(/4/);
  });

  it("does not impose a maximum length", () => {
    expect(() => validatePassword("a".repeat(1024))).not.toThrow();
  });
});
