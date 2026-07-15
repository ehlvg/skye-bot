import { describe, expect, test } from "vitest";
import { buildTelegramCommands, formatToolBlock, uniqByCommand } from "../commands.js";
import type { TelegramDeps } from "../types.js";

describe("buildTelegramCommands", () => {
  test("preserves the complete built-in command set and registration order", () => {
    const commands = buildTelegramCommands({
      deps: {} as TelegramDeps,
      chatEpochs: new Map(),
      activeTurns: new Map(),
      imageControls: new Map(),
      builtinTools: [],
      storeConversation: () => {},
    });

    expect(commands.map((command) => command.name)).toEqual([
      "stop",
      "start",
      "help",
      "reset",
      "image",
      "config",
      "status",
      "tools",
      "catchup",
      "reminders",
    ]);
  });
});

describe("uniqByCommand", () => {
  test("keeps the first command with a duplicate Telegram name", () => {
    const commands = [
      { command: "help", source: "feature" },
      { command: "help", source: "built-in" },
      { command: "status", source: "built-in" },
    ];

    expect(commands.filter(uniqByCommand)).toEqual([commands[0], commands[2]]);
  });
});

describe("formatToolBlock", () => {
  test("renders source, description, and JSON schema", () => {
    const block = formatToolBlock(
      "search",
      "Search documentation",
      { type: "object", properties: { query: { type: "string" } } },
      "mcp:docs"
    );

    expect(block).toContain("**search** `mcp:docs`");
    expect(block).toContain("Search documentation");
    expect(block).toContain('"query"');
  });

  test("uses a readable placeholder for an empty description", () => {
    expect(formatToolBlock("noop", "", {})).toContain("_No description_");
  });
});
