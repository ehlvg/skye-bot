import { test, expect, describe } from "bun:test";
import { cleanMd } from "../markdown.js";

describe("cleanMd", () => {
  test("strips asterisks", () => {
    expect(cleanMd("hello *world*")).toBe("hello world");
  });

  test("strips underscores", () => {
    expect(cleanMd("_italic_")).toBe("italic");
  });

  test("strips tildes", () => {
    expect(cleanMd("~~strikethrough~~")).toBe("strikethrough");
  });

  test("strips backticks", () => {
    expect(cleanMd("`code`")).toBe("code");
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
