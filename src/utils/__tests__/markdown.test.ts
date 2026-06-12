import { test, expect, describe } from "vitest";
import { cleanMd } from "../markdown.js";

describe("cleanMd", () => {
  test("keeps rich markdown emphasis", () => {
    expect(cleanMd("hello *world*")).toBe("hello *world*");
  });

  test("keeps underscores", () => {
    expect(cleanMd("_italic_")).toBe("_italic_");
  });

  test("keeps strikethrough", () => {
    expect(cleanMd("~~strikethrough~~")).toBe("~~strikethrough~~");
  });

  test("keeps code spans", () => {
    expect(cleanMd("`code`")).toBe("`code`");
  });

  test("keeps rich blocks", () => {
    const markdown = "# Heading\n\n| A | B |\n|---|---|\n| $x$ | ==marked== |";
    expect(cleanMd(markdown)).toBe(markdown);
  });

  test("unescapes punctuation after backslash", () => {
    expect(cleanMd("hello\\. world")).toBe("hello. world");
    expect(cleanMd("item\\!")).toBe("item!");
  });

  test("leaves plain text untouched", () => {
    expect(cleanMd("just a normal sentence")).toBe("just a normal sentence");
  });

  test("handles empty string", () => {
    expect(cleanMd("")).toBe("");
  });
});
