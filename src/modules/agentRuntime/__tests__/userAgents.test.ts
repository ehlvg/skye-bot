import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "../../../core/db.js";
import { agentIdFromName, UserAgentService } from "../userAgents.js";

const OWNER_A = 91_001;
const OWNER_B = 91_002;
const CHAT = -91_100;

beforeEach(() => {
  getDb()
    .prepare("DELETE FROM user_thread_agents WHERE owner_user_id IN (?, ?)")
    .run(OWNER_A, OWNER_B);
  getDb()
    .prepare("DELETE FROM user_agent_drafts WHERE owner_user_id IN (?, ?)")
    .run(OWNER_A, OWNER_B);
  getDb().prepare("DELETE FROM user_agents WHERE owner_user_id IN (?, ?)").run(OWNER_A, OWNER_B);
});

describe("UserAgentService", () => {
  it("isolates private agents with the same id between owners", () => {
    const service = new UserAgentService(getDb(), 10);
    service.create(OWNER_A, {
      id: "writer",
      name: "Writer A",
      description: "Writes for A",
      instructions: "Use A's preferred style.",
      modelId: "openai/gpt-5",
    });
    service.create(OWNER_B, {
      id: "writer",
      name: "Writer B",
      description: "Writes for B",
      instructions: "Use B's preferred style.",
    });

    expect(service.profiles(OWNER_A)).toEqual([
      expect.objectContaining({
        id: "my_writer",
        name: "Writer A",
        enabled: true,
        model_id: "openai/gpt-5",
      }),
    ]);
    expect(service.profiles(OWNER_B)).toEqual([
      expect.objectContaining({ id: "my_writer", name: "Writer B", enabled: true }),
    ]);
  });

  it("stores selection separately for each owner and topic", () => {
    const service = new UserAgentService(getDb(), 10);
    for (const ownerUserId of [OWNER_A, OWNER_B]) {
      service.create(ownerUserId, {
        id: "writer",
        name: `Writer ${ownerUserId}`,
        description: "Writes",
        instructions: "Write.",
      });
    }

    service.setSelection(OWNER_A, CHAT, 10, "my_writer");
    service.setSelection(OWNER_B, CHAT, 20, "writer");

    expect(service.getSelection(OWNER_A, CHAT, 10)).toBe("my_writer");
    expect(service.getSelection(OWNER_A, CHAT, 20)).toBeUndefined();
    expect(service.getSelection(OWNER_B, CHAT, 20)).toBe("my_writer");
  });

  it("updates agents and removes their active selections on deletion", () => {
    const service = new UserAgentService(getDb(), 10);
    service.create(OWNER_A, {
      id: "writer",
      name: "Writer",
      description: "Writes",
      instructions: "First version.",
    });
    service.setSelection(OWNER_A, CHAT, undefined, "my_writer");

    expect(
      service.update(OWNER_A, "my_writer", {
        name: "Editor",
        description: "Edits",
        instructions: "Second version.",
      })
    ).toMatchObject({ name: "Editor", instructions: "Second version." });
    expect(service.delete(OWNER_A, "my_writer")).toBe(true);
    expect(service.getSelection(OWNER_A, CHAT)).toBeUndefined();
    expect(service.delete(OWNER_A, "writer")).toBe(false);
  });

  it("enforces the per-user limit and validates ids", () => {
    const service = new UserAgentService(getDb(), 1);
    service.create(OWNER_A, {
      id: "first",
      name: "First",
      description: "First agent",
      instructions: "Be first.",
    });

    expect(() =>
      service.create(OWNER_A, {
        id: "second",
        name: "Second",
        description: "Second agent",
        instructions: "Be second.",
      })
    ).toThrow(/at most 1/);
    expect(() =>
      new UserAgentService(getDb(), 10).create(OWNER_B, {
        id: "Not Valid",
        name: "Invalid",
        description: "Invalid",
        instructions: "Invalid.",
      })
    ).toThrow();
  });

  it("persists an isolated multi-step creation draft", () => {
    const service = new UserAgentService(getDb(), 10);
    service.startDraft(OWNER_A, CHAT, 10);
    service.saveDraft(OWNER_A, CHAT, 10, {
      step: "confirm",
      name: "Research Assistant",
      description: "Finds reliable sources",
      instructions: "Research carefully.",
      modelId: "anthropic/claude-sonnet-4",
    });

    const reloaded = new UserAgentService(getDb(), 10);
    expect(reloaded.getDraft(OWNER_A, CHAT, 10)).toMatchObject({
      step: "confirm",
      name: "Research Assistant",
      modelId: "anthropic/claude-sonnet-4",
    });
    expect(reloaded.getDraft(OWNER_B, CHAT, 10)).toBeUndefined();
    expect(reloaded.getDraft(OWNER_A, CHAT, 20)).toBeUndefined();
    expect(reloaded.cancelDraft(OWNER_A, CHAT, 10)).toBe(true);
    expect(reloaded.getDraft(OWNER_A, CHAT, 10)).toBeUndefined();
  });

  it("generates readable ids from English and Russian names", () => {
    expect(agentIdFromName("Research Assistant")).toBe("research_assistant");
    expect(agentIdFromName("Исследователь данных")).toBe("issledovatel_dannyh");
    expect(agentIdFromName("123 Numbers")).toBe("agent_123_numbers");
  });
});
