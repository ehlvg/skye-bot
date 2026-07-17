import { randomBytes } from "crypto";

export const TOOL_CONFIRMATION_TTL_MS = 5 * 60 * 1_000;
export const TOOL_CONFIRMATION_CALLBACK_PATTERN = /^tool_confirm:(allow|deny):(tc_[0-9a-f]{24})$/;

const SENSITIVE_KEY = /(authorization|cookie|credential|password|secret|token|api[_-]?key)/i;

export interface PendingToolConfirmation {
  id: string;
  chatId: number;
  threadId?: number;
  userId: number;
  toolName: string;
  args: Record<string, unknown>;
  isMcp: boolean;
  expiresAt: number;
  execute: () => Promise<string>;
}

export type ConsumeConfirmationResult =
  | { status: "ok"; confirmation: PendingToolConfirmation }
  | { status: "forbidden" }
  | { status: "not_found" };

/** Short-lived, fail-closed storage for tool approvals. Entries never survive a restart. */
export class ToolConfirmationStore {
  private readonly pending = new Map<string, PendingToolConfirmation>();

  constructor(private readonly ttlMs = TOOL_CONFIRMATION_TTL_MS) {}

  create(
    input: Omit<PendingToolConfirmation, "id" | "expiresAt">,
    now = Date.now()
  ): PendingToolConfirmation {
    this.prune(now);
    const confirmation: PendingToolConfirmation = {
      ...input,
      id: `tc_${randomBytes(12).toString("hex")}`,
      expiresAt: now + this.ttlMs,
    };
    this.pending.set(confirmation.id, confirmation);
    return confirmation;
  }

  consume(
    id: string,
    chatId: number,
    userId: number | undefined,
    threadId?: number,
    now = Date.now()
  ): ConsumeConfirmationResult {
    const confirmation = this.pending.get(id);
    if (!confirmation || confirmation.expiresAt <= now) {
      this.pending.delete(id);
      return { status: "not_found" };
    }
    if (
      confirmation.chatId !== chatId ||
      confirmation.userId !== userId ||
      confirmation.threadId !== threadId
    ) {
      return { status: "forbidden" };
    }
    this.pending.delete(id);
    return { status: "ok", confirmation };
  }

  private prune(now: number): void {
    for (const [id, confirmation] of this.pending) {
      if (confirmation.expiresAt <= now) this.pending.delete(id);
    }
  }
}

function previewValue(key: string, value: unknown): string {
  if (SENSITIVE_KEY.test(key)) return "[hidden]";
  let serialized: string;
  try {
    const json =
      typeof value === "string"
        ? value
        : JSON.stringify(value, (nestedKey, nestedValue) =>
            SENSITIVE_KEY.test(nestedKey) ? "[hidden]" : nestedValue
          );
    serialized = json ?? String(value);
  } catch {
    serialized = String(value);
  }
  return serialized.length > 180 ? `${serialized.slice(0, 180)}…` : serialized;
}

export function formatToolConfirmation(
  toolName: string,
  args: Record<string, unknown>,
  isMcp: boolean
): string {
  const details = Object.entries(args)
    .slice(0, 8)
    .map(([key, value]) => `• ${key}: ${previewValue(key, value)}`)
    .join("\n");
  return [
    "This action needs your confirmation.",
    "",
    `Tool: ${toolName}`,
    `Source: ${isMcp ? "MCP server" : "sandbox"}`,
    ...(details ? ["", details] : []),
    "",
    "The request expires in 5 minutes and is cancelled if the bot restarts.",
  ].join("\n");
}
