import type Database from "better-sqlite3";
import { z } from "zod";
import type { AgentProfile } from "./config.js";

export const PERSONAL_AGENT_PREFIX = "my_";
const DRAFT_TTL_MS = 60 * 60 * 1000;

const userAgentIdSchema = z
  .string()
  .min(1)
  .max(32)
  .regex(/^[a-z][a-z0-9_-]*$/, "Use lowercase letters, numbers, underscores, or hyphens")
  .refine((id) => !id.startsWith(PERSONAL_AGENT_PREFIX), 'Do not repeat the "my_" prefix');

const userAgentInputSchema = z.object({
  id: userAgentIdSchema,
  name: z.string().min(1).max(80),
  description: z.string().min(1).max(500),
  instructions: z.string().min(1).max(16_000),
});

export type UserAgentInput = z.infer<typeof userAgentInputSchema>;

export interface UserAgentRecord extends UserAgentInput {
  ownerUserId: number;
  createdAt: string;
  updatedAt: string;
}

export type UserAgentDraftStep = "name" | "description" | "instructions" | "confirm";

export interface UserAgentDraft {
  step: UserAgentDraftStep;
  name?: string;
  description?: string;
  instructions?: string;
  updatedAt: string;
}

interface UserAgentRow {
  ownerUserId: number;
  id: string;
  name: string;
  description: string;
  instructions: string;
  createdAt: string;
  updatedAt: string;
}

interface UserAgentDraftRow {
  step: UserAgentDraftStep;
  name: string | null;
  description: string | null;
  instructions: string | null;
  updatedAt: string;
}

function storedThreadId(threadId?: number): number {
  return threadId ?? 0;
}

function normalizeId(id: string): string {
  return id.startsWith(PERSONAL_AGENT_PREFIX) ? id.slice(PERSONAL_AGENT_PREFIX.length) : id;
}

export function personalProfileId(id: string): string {
  return `${PERSONAL_AGENT_PREFIX}${normalizeId(id)}`;
}

export function isPersonalProfileId(id: string): boolean {
  return id.startsWith(PERSONAL_AGENT_PREFIX);
}

export class UserAgentService {
  constructor(
    private readonly db: Database.Database,
    private readonly maxAgents: number
  ) {}

  list(ownerUserId: number): UserAgentRecord[] {
    return this.db
      .prepare<[number], UserAgentRow>(
        `SELECT owner_user_id AS ownerUserId, id, name, description, instructions,
                created_at AS createdAt, updated_at AS updatedAt
         FROM user_agents
         WHERE owner_user_id = ?
         ORDER BY created_at, id`
      )
      .all(ownerUserId);
  }

  profiles(ownerUserId: number): AgentProfile[] {
    return this.list(ownerUserId).map((agent) => ({
      id: personalProfileId(agent.id),
      name: agent.name,
      description: agent.description,
      instructions: agent.instructions,
      enabled: true,
    }));
  }

  get(ownerUserId: number, id: string): UserAgentRecord | undefined {
    return this.db
      .prepare<[number, string], UserAgentRow>(
        `SELECT owner_user_id AS ownerUserId, id, name, description, instructions,
                created_at AS createdAt, updated_at AS updatedAt
         FROM user_agents
         WHERE owner_user_id = ? AND id = ?`
      )
      .get(ownerUserId, normalizeId(id));
  }

  create(ownerUserId: number, input: UserAgentInput): UserAgentRecord {
    const parsed = userAgentInputSchema.parse({ ...input, id: normalizeId(input.id) });
    if (this.list(ownerUserId).length >= this.maxAgents) {
      throw new Error(`You can create at most ${this.maxAgents} personal agents.`);
    }
    if (this.get(ownerUserId, parsed.id)) {
      throw new Error(`Personal agent "${personalProfileId(parsed.id)}" already exists.`);
    }
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO user_agents
          (owner_user_id, id, name, description, instructions, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(ownerUserId, parsed.id, parsed.name, parsed.description, parsed.instructions, now, now);
    return this.get(ownerUserId, parsed.id)!;
  }

  update(ownerUserId: number, id: string, input: Omit<UserAgentInput, "id">): UserAgentRecord {
    const storedId = normalizeId(id);
    const parsed = userAgentInputSchema.omit({ id: true }).parse(input);
    const result = this.db
      .prepare(
        `UPDATE user_agents
         SET name = ?, description = ?, instructions = ?, updated_at = ?
         WHERE owner_user_id = ? AND id = ?`
      )
      .run(
        parsed.name,
        parsed.description,
        parsed.instructions,
        new Date().toISOString(),
        ownerUserId,
        storedId
      );
    if (result.changes === 0) {
      throw new Error(`Personal agent "${personalProfileId(storedId)}" does not exist.`);
    }
    return this.get(ownerUserId, storedId)!;
  }

  delete(ownerUserId: number, id: string): boolean {
    const storedId = normalizeId(id);
    return this.db.transaction(() => {
      this.db
        .prepare("DELETE FROM user_thread_agents WHERE owner_user_id = ? AND agent_id = ?")
        .run(ownerUserId, storedId);
      return (
        this.db
          .prepare("DELETE FROM user_agents WHERE owner_user_id = ? AND id = ?")
          .run(ownerUserId, storedId).changes > 0
      );
    })();
  }

  getSelection(ownerUserId: number, chatId: number, threadId?: number): string | undefined {
    const row = this.db
      .prepare<[number, number, number], { agentId: string }>(
        `SELECT selection.agent_id AS agentId
         FROM user_thread_agents AS selection
         INNER JOIN user_agents AS agent
           ON agent.owner_user_id = selection.owner_user_id
          AND agent.id = selection.agent_id
         WHERE selection.owner_user_id = ?
           AND selection.chat_id = ?
           AND selection.thread_id = ?`
      )
      .get(ownerUserId, chatId, storedThreadId(threadId));
    return row ? personalProfileId(row.agentId) : undefined;
  }

  setSelection(
    ownerUserId: number,
    chatId: number,
    threadId: number | undefined,
    id: string
  ): void {
    const storedId = normalizeId(id);
    if (!this.get(ownerUserId, storedId)) {
      throw new Error(`Personal agent "${personalProfileId(storedId)}" does not exist.`);
    }
    this.db
      .prepare(
        `INSERT INTO user_thread_agents
          (owner_user_id, chat_id, thread_id, agent_id, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(owner_user_id, chat_id, thread_id) DO UPDATE SET
           agent_id = excluded.agent_id,
           updated_at = excluded.updated_at`
      )
      .run(ownerUserId, chatId, storedThreadId(threadId), storedId, new Date().toISOString());
  }

  resetSelection(ownerUserId: number, chatId: number, threadId?: number): boolean {
    return (
      this.db
        .prepare(
          `DELETE FROM user_thread_agents
           WHERE owner_user_id = ? AND chat_id = ? AND thread_id = ?`
        )
        .run(ownerUserId, chatId, storedThreadId(threadId)).changes > 0
    );
  }

  startDraft(ownerUserId: number, chatId: number, threadId?: number): UserAgentDraft {
    return this.saveDraft(ownerUserId, chatId, threadId, { step: "name" });
  }

  getDraft(ownerUserId: number, chatId: number, threadId?: number): UserAgentDraft | undefined {
    const row = this.db
      .prepare<[number, number, number], UserAgentDraftRow>(
        `SELECT step, name, description, instructions, updated_at AS updatedAt
         FROM user_agent_drafts
         WHERE owner_user_id = ? AND chat_id = ? AND thread_id = ?`
      )
      .get(ownerUserId, chatId, storedThreadId(threadId));
    if (!row) return undefined;
    if (Date.now() - Date.parse(row.updatedAt) > DRAFT_TTL_MS) {
      this.cancelDraft(ownerUserId, chatId, threadId);
      return undefined;
    }
    return {
      step: row.step,
      ...(row.name ? { name: row.name } : {}),
      ...(row.description ? { description: row.description } : {}),
      ...(row.instructions ? { instructions: row.instructions } : {}),
      updatedAt: row.updatedAt,
    };
  }

  saveDraft(
    ownerUserId: number,
    chatId: number,
    threadId: number | undefined,
    draft: Omit<UserAgentDraft, "updatedAt">
  ): UserAgentDraft {
    const updatedAt = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO user_agent_drafts
          (owner_user_id, chat_id, thread_id, step, name, description, instructions, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(owner_user_id, chat_id, thread_id) DO UPDATE SET
           step = excluded.step,
           name = excluded.name,
           description = excluded.description,
           instructions = excluded.instructions,
           updated_at = excluded.updated_at`
      )
      .run(
        ownerUserId,
        chatId,
        storedThreadId(threadId),
        draft.step,
        draft.name ?? null,
        draft.description ?? null,
        draft.instructions ?? null,
        updatedAt
      );
    return { ...draft, updatedAt };
  }

  cancelDraft(ownerUserId: number, chatId: number, threadId?: number): boolean {
    return (
      this.db
        .prepare(
          `DELETE FROM user_agent_drafts
           WHERE owner_user_id = ? AND chat_id = ? AND thread_id = ?`
        )
        .run(ownerUserId, chatId, storedThreadId(threadId)).changes > 0
    );
  }
}
