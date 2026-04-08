// Must be set before any module that calls getDb() is executed
process.env.DB_PATH = ":memory:";

import { test, expect, describe, beforeEach } from "bun:test";
import {
  addMemory,
  getMemories,
  deleteMemory,
  clearMemories,
  executeMemoryTool,
} from "../memory.js";

const CHAT = 42;

beforeEach(async () => {
  await clearMemories(CHAT);
});

describe("addMemory / getMemories", () => {
  test("addMemory returns an entry with mem_ prefix ID", async () => {
    const entry = await addMemory(CHAT, "user likes tea");
    expect(entry.id).toMatch(/^mem_/);
    expect(entry.content).toBe("user likes tea");
    expect(entry.createdAt).toBeTruthy();
  });

  test("getMemories returns all added memories in order", async () => {
    await addMemory(CHAT, "fact one");
    await addMemory(CHAT, "fact two");
    const mems = getMemories(CHAT);
    expect(mems).toHaveLength(2);
    expect(mems[0].content).toBe("fact one");
    expect(mems[1].content).toBe("fact two");
  });

  test("getMemories returns empty array for unknown chatId", () => {
    expect(getMemories(9999)).toHaveLength(0);
  });

  test("memories are isolated per chatId", async () => {
    await addMemory(CHAT, "chat 42 memory");
    await addMemory(100, "chat 100 memory");
    expect(getMemories(CHAT)).toHaveLength(1);
    expect(getMemories(100)).toHaveLength(1);
    await clearMemories(100);
  });
});

describe("deleteMemory", () => {
  test("deletes an existing memory and returns true", async () => {
    const entry = await addMemory(CHAT, "to delete");
    expect(await deleteMemory(CHAT, entry.id)).toBe(true);
    expect(getMemories(CHAT)).toHaveLength(0);
  });

  test("returns false for a non-existent ID", async () => {
    expect(await deleteMemory(CHAT, "mem_fake")).toBe(false);
  });

  test("only deletes the matching entry", async () => {
    const a = await addMemory(CHAT, "keep me");
    const b = await addMemory(CHAT, "delete me");
    await deleteMemory(CHAT, b.id);
    const remaining = getMemories(CHAT);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe(a.id);
  });
});

describe("clearMemories", () => {
  test("removes all memories for a chat", async () => {
    await addMemory(CHAT, "m1");
    await addMemory(CHAT, "m2");
    await clearMemories(CHAT);
    expect(getMemories(CHAT)).toHaveLength(0);
  });
});

describe("executeMemoryTool", () => {
  test("save_memory saves and returns confirmation", async () => {
    const result = await executeMemoryTool(CHAT, {
      function: { name: "save_memory", arguments: JSON.stringify({ content: "loves jazz" }) },
    });
    expect(result).toMatch(/^Memory saved with ID mem_/);
    expect(getMemories(CHAT)).toHaveLength(1);
  });

  test("delete_memory removes the entry and returns confirmation", async () => {
    const entry = await addMemory(CHAT, "temporary");
    const result = await executeMemoryTool(CHAT, {
      function: { name: "delete_memory", arguments: JSON.stringify({ memory_id: entry.id }) },
    });
    expect(result).toBe(`Memory ${entry.id} deleted.`);
    expect(getMemories(CHAT)).toHaveLength(0);
  });

  test("delete_memory returns not-found message for missing ID", async () => {
    const result = await executeMemoryTool(CHAT, {
      function: { name: "delete_memory", arguments: JSON.stringify({ memory_id: "mem_ghost" }) },
    });
    expect(result).toBe("Memory mem_ghost not found.");
  });

  test("unknown tool returns error message", async () => {
    const result = await executeMemoryTool(CHAT, {
      function: { name: "fly_spaceship", arguments: "{}" },
    });
    expect(result).toBe("Unknown tool: fly_spaceship");
  });
});
