import { describe, expect, test } from "vitest";
import {
  buildFinalReply,
  formatToolCalls,
  stabilizeStreamingMarkdown,
  type ToolCallRecord,
} from "../helpers.js";

const calls: ToolCallRecord[] = [
  { name: "save_memory", args: { content: "likes coffee" }, isMcp: false },
  { name: "search", args: { query: "telegram rich messages" }, isMcp: true },
];

describe("formatToolCalls", () => {
  test("formats built-in and MCP calls", () => {
    expect(formatToolCalls(calls)).toContain("save_memory");
    expect(formatToolCalls(calls)).toContain("search");
  });
});

describe("buildFinalReply", () => {
  test("keeps plain replies unchanged", () => {
    expect(buildFinalReply([], "# Heading\n\n$x$")).toBe("# Heading\n\n$x$");
  });

  test("prepends tool call summary as markdown quote", () => {
    const reply = buildFinalReply(calls, "Done.");
    expect(reply).toContain("> 🧠 save_memory");
    expect(reply).toContain("> 🔌 search");
    expect(reply).toContain("\n\nDone.");
  });
});

describe("stabilizeStreamingMarkdown", () => {
  test("closes an open code fence", () => {
    expect(stabilizeStreamingMarkdown("```math\nx = 1")).toBe("```math\nx = 1\n```");
  });

  test("closes an open block formula", () => {
    expect(stabilizeStreamingMarkdown("$$\nx^2")).toBe("$$\nx^2\n$$");
  });

  test("closes an open inline formula", () => {
    expect(stabilizeStreamingMarkdown("answer is $x")).toBe("answer is $x$");
  });

  test("leaves stable markdown unchanged", () => {
    const markdown = "| A | B |\n|---|---|\n| $x$ | `code` |";
    expect(stabilizeStreamingMarkdown(markdown)).toBe(markdown);
  });
});
