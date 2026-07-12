import { test, expect, describe, beforeEach } from "vitest";
import {
  addMemory,
  getMemories,
  deleteMemory,
  clearMemories,
  executeMemoryTool,
  searchMemories,
  importMemories,
  exportMemories,
} from "../modules/memory/service.js";
import { getDb } from "../core/db.js";

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
      name: "save_memory",
      arguments: JSON.stringify({ content: "loves jazz" }),
    });
    expect(result).toMatch(/^Memory saved with ID mem_/);
    expect(getMemories(CHAT)).toHaveLength(1);
  });

  test("delete_memory removes the entry and returns confirmation", async () => {
    const entry = await addMemory(CHAT, "temporary");
    const result = await executeMemoryTool(CHAT, {
      name: "delete_memory",
      arguments: JSON.stringify({ memory_id: entry.id }),
    });
    expect(result).toBe(`Memory ${entry.id} deleted.`);
    expect(getMemories(CHAT)).toHaveLength(0);
  });

  test("delete_memory returns not-found message for missing ID", async () => {
    const result = await executeMemoryTool(CHAT, {
      name: "delete_memory",
      arguments: JSON.stringify({ memory_id: "mem_ghost" }),
    });
    expect(result).toBe("Memory mem_ghost not found.");
  });

  test("unknown tool returns error message", async () => {
    const result = await executeMemoryTool(CHAT, {
      name: "fly_spaceship",
      arguments: "{}",
    });
    expect(result).toBe("Unknown tool: fly_spaceship");
  });
});

describe("memory management", () => {
  test("stores categories and applies category expiry defaults", async () => {
    const task = await addMemory(CHAT, "Finish the release checklist", "task");
    const preference = await addMemory(CHAT, "User prefers concise answers", "preference");
    expect(task.category).toBe("task");
    expect(task.expiresAt).toBeTruthy();
    expect(preference.category).toBe("preference");
    expect(preference.expiresAt).toBeNull();
  });

  test("merges highly similar memories instead of creating duplicates", async () => {
    const first = await addMemory(CHAT, "User likes black coffee", "preference");
    const second = await addMemory(CHAT, "User likes black coffee", "preference");
    expect(second.id).toBe(first.id);
    expect(second.merged).toBe(true);
    expect(getMemories(CHAT)).toHaveLength(1);
  });

  test("preserves the existing expiration when a merge omits expiresAt", async () => {
    const expiry = "2030-01-01T00:00:00.000Z";
    const first = await addMemory(CHAT, "The release deadline is January 1", "fact", expiry);
    const second = await addMemory(CHAT, "The release deadline is January 1", "fact");
    expect(second.id).toBe(first.id);
    expect(second.expiresAt).toBe(expiry);
    expect(getMemories(CHAT)[0].expiresAt).toBe(expiry);
  });

  test("search returns relevant active memories and records usage", async () => {
    await addMemory(CHAT, "The project uses TypeScript", "project");
    await addMemory(CHAT, "User likes tea", "preference");
    const results = searchMemories(CHAT, "project TypeScript");
    expect(results).toHaveLength(1);
    expect(results[0].content).toContain("TypeScript");
    expect(results[0].lastUsedAt).toBeTruthy();
  });

  test("search_memory without a category searches across all categories", async () => {
    await addMemory(CHAT, "The launch project is called Aurora", "project");
    const result = await executeMemoryTool(CHAT, {
      name: "search_memory",
      arguments: JSON.stringify({ query: "Aurora launch" }),
    });
    expect(result).toContain("Aurora");
  });

  test("rejects invalid custom expiration dates", async () => {
    await expect(addMemory(CHAT, "Invalid expiry", "fact", "not-a-date")).rejects.toThrow(
      "valid date"
    );
  });

  test("archives expired memories automatically", async () => {
    const entry = await addMemory(CHAT, "Old task", "task");
    getDb()
      .prepare("UPDATE memories SET expires_at = ? WHERE id = ?")
      .run("2000-01-01T00:00:00.000Z", entry.id);
    expect(getMemories(CHAT)).toHaveLength(0);
    const archived = getDb()
      .prepare<
        { id: string },
        { archivedAt: string | null }
      >("SELECT archived_at AS archivedAt FROM memories WHERE id = @id")
      .get({ id: entry.id });
    expect(archived?.archivedAt).toBeTruthy();
  });

  test("imports through the same validation and exports a portable record set", async () => {
    const result = await importMemories(CHAT, [{ content: "Imported fact", category: "fact" }]);
    expect(result.imported).toBe(1);
    const exported = exportMemories(CHAT);
    expect(exported.some((entry) => entry.content === "Imported fact")).toBe(true);
  });

  test("rolls back the entire import when a later record is invalid", async () => {
    await expect(
      importMemories(CHAT, [
        { content: "This record must not remain", category: "fact" },
        { content: "Invalid expiry", category: "fact", expiresAt: "not-a-date" },
      ])
    ).rejects.toThrow("valid date");
    expect(getMemories(CHAT)).toHaveLength(0);
  });
});
