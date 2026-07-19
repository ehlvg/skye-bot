import { describe, expect, test } from "vitest";
import {
  buildFinalReply,
  draftStatusForMessageType,
  draftStatusForToolCalls,
  formatToolCalls,
  parseTextEncodedToolCall,
  renderDraftStatus,
  stabilizeStreamingMarkdown,
  type ToolCallRecord,
} from "../helpers.js";

const calls: ToolCallRecord[] = [
  { name: "save_memory", args: { content: "likes coffee" }, isConnector: false },
  { name: "search", args: { query: "telegram rich messages" }, isConnector: true },
];

describe("formatToolCalls", () => {
  test("formats built-in and connector calls", () => {
    expect(formatToolCalls(calls)).toContain("save_memory");
    expect(formatToolCalls(calls)).toContain("search");
  });
});

describe("buildFinalReply", () => {
  test("keeps plain replies unchanged", () => {
    expect(buildFinalReply([], "# Heading\n\n$x$")).toBe("# Heading\n\n$x$");
  });

  test("keeps final replies clean when tools were used", () => {
    const reply = buildFinalReply(calls, "Done.");
    expect(reply).toBe("Done.");
  });
});

describe("parseTextEncodedToolCall", () => {
  const tools = new Set(["search_memory"]);

  test("recovers a legacy action envelope with JSON arguments", () => {
    expect(
      parseTextEncodedToolCall(
        '{"action":"search_memory","action_input":"{\\"query\\":\\"salad price\\"}"}',
        tools
      )
    ).toEqual({ name: "search_memory", arguments: '{"query":"salad price"}' });
  });

  test("recovers the single-quoted arguments produced by some models", () => {
    expect(
      parseTextEncodedToolCall(
        '{"action":"search_memory","action_input":"{\'query\': \'salad price\'}"}',
        tools
      )
    ).toEqual({ name: "search_memory", arguments: '{"query":"salad price"}' });
  });

  test("does not treat unknown actions or ordinary JSON as tool calls", () => {
    expect(
      parseTextEncodedToolCall('{"action":"delete_everything","action_input":"{}"}', tools)
    ).toBeUndefined();
    expect(parseTextEncodedToolCall('{"answer":"search_memory"}', tools)).toBeUndefined();
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

describe("draft statuses", () => {
  test("uses the requested AI action emoji ids", () => {
    expect(renderDraftStatus({ kind: "thinking", text: "Thinking…" }, true)).toContain(
      'emoji-id="5535034915403333642"'
    );
    expect(renderDraftStatus({ kind: "images", text: "Looking at images…" }, false)).toContain(
      'emoji-id="5537651753077440526"'
    );
    expect(renderDraftStatus({ kind: "voice", text: "Listening…" }, false)).toContain(
      'emoji-id="5537354996607090745"'
    );
    expect(renderDraftStatus({ kind: "documents", text: "Studying…" }, false)).toContain(
      'emoji-id="5535039193190760468"'
    );
    expect(renderDraftStatus({ kind: "code", text: "Working…" }, false)).toContain(
      'emoji-id="5535251334510411788"'
    );
    expect(renderDraftStatus({ kind: "web", text: "Searching…" }, false)).toContain(
      'emoji-id="5535365052359507996"'
    );
  });

  test("selects statuses from message and tool types", () => {
    expect(draftStatusForMessageType("document").kind).toBe("documents");
    expect(draftStatusForMessageType("photo").kind).toBe("images");
    expect(
      draftStatusForToolCalls([{ name: "sandbox_run_command", args: {}, isConnector: false }]).kind
    ).toBe("code");
    expect(
      draftStatusForToolCalls([{ name: "web_search", args: {}, isConnector: false }]).kind
    ).toBe("web");
  });

  test("renders exactly one thinking block", () => {
    const rendered = renderDraftStatus({ kind: "thinking", text: "Thinking…" }, true);
    expect(rendered.match(/<tg-thinking>/g)).toHaveLength(1);
    expect(rendered).toContain("Thinking…");
  });
});
