import type { LlmClient } from "../llm/client.js";
import type { ChatLogService, GroupMessage } from "../chatLog/service.js";
import type { MemoryService } from "../memory/service.js";
import { log } from "../../utils/log.js";

const REACTION_EMOJIS = [
  "❤",
  "👍",
  "👎",
  "🔥",
  "🥰",
  "👏",
  "😁",
  "🤔",
  "🤯",
  "😱",
  "🤬",
  "😢",
  "🎉",
  "🤩",
  "🤮",
  "💩",
  "🙏",
  "👌",
  "🕊",
  "🤡",
  "🥱",
  "🥴",
  "😍",
  "🐳",
  "❤‍🔥",
  "🌚",
  "🌭",
  "💯",
  "🤣",
  "⚡",
  "🍌",
  "🏆",
  "💔",
  "🤨",
  "😐",
  "🍓",
  "🍾",
  "💋",
  "🖕",
  "😈",
  "😴",
  "😭",
  "🤓",
  "👻",
  "👨‍💻",
  "👀",
  "🎃",
  "🙈",
  "😇",
  "😨",
  "🤝",
  "✍",
  "🤗",
  "🫡",
  "🎅",
  "🎄",
  "☃",
  "💅",
  "🤪",
  "🗿",
  "🆒",
  "💘",
  "🙉",
  "🦄",
  "😘",
  "💊",
  "🙊",
  "😎",
  "👾",
  "🤷‍♂",
  "🤷",
  "🤷‍♀",
  "😡",
];

export interface ProactiveSettings {
  enabled: boolean;
  probability: number;
  warmup: number;
  minIntervalSec: number;
  contextSize: number;
}

export interface ProactiveDecision {
  react: boolean;
  /** Telegram message_id to react to. */
  targetMessageId?: number;
  kind: "emoji" | "none";
  emoji?: string;
  reason?: string;
}

export class ProactiveService {
  private lastReactionAt = new Map<string, number>();
  private inFlightScopes = new Set<string>();

  constructor(
    private readonly deps: {
      llm: LlmClient;
      chatLog: ChatLogService;
      memory: MemoryService;
    },
    private readonly settings: ProactiveSettings
  ) {}

  isEnabled(): boolean {
    return this.settings.enabled;
  }

  /**
   * Decide whether to react proactively to recent group activity.
   * `triggerMessageId` is the message that just arrived and triggered the
   * attempt — it is included in the candidate list but the model may pick
   * any earlier message instead.
   *
   * Returns null when the attempt is skipped (probability gate, warmup,
   * rate-limit) so the caller can avoid an LLM round-trip.
   */
  async maybeReact(
    chatId: number,
    triggerMessageId: number,
    chatTitle: string,
    modelId?: string,
    threadId?: number
  ): Promise<ProactiveDecision | null> {
    if (!this.settings.enabled) return null;
    if (Math.random() >= this.settings.probability) return null;

    const now = Date.now();
    const scopeKey = threadId == null ? String(chatId) : `${chatId}:${threadId}`;
    if (this.inFlightScopes.has(scopeKey)) return null;
    const last = this.lastReactionAt.get(scopeKey) ?? 0;
    if (now - last < this.settings.minIntervalSec * 1000) return null;

    const recent = this.deps.chatLog.recentGroupMessages(
      chatId,
      this.settings.contextSize,
      threadId
    );
    if (recent.length < this.settings.warmup) return null;

    this.inFlightScopes.add(scopeKey);
    let decision: ProactiveDecision | null;
    try {
      decision = await this.decideReaction(chatId, chatTitle, recent, modelId);
    } finally {
      this.inFlightScopes.delete(scopeKey);
    }
    if (!decision || !decision.react || decision.kind === "none" || !decision.emoji) return null;

    const targetId = decision.targetMessageId ?? triggerMessageId;
    const candidateIds = new Set(
      recent.flatMap((message) => (message.messageId == null ? [] : [message.messageId]))
    );
    if (!targetId || !candidateIds.has(targetId)) {
      log.warn({ chatId, targetId }, "Proactive reaction targeted an unknown message id");
      return null;
    }

    this.lastReactionAt.set(scopeKey, Date.now());
    decision.targetMessageId = targetId;
    return decision;
  }

  private async decideReaction(
    chatId: number,
    chatTitle: string,
    recent: GroupMessage[],
    modelId?: string
  ): Promise<ProactiveDecision | null> {
    const memoryQuery = recent
      .slice(-3)
      .map((message) => message.content)
      .join(" ")
      .slice(0, 500);
    const memories = this.deps.memory.context(chatId, memoryQuery, 12);
    const memoryLines = memories.length
      ? memories.map((m) => `- ${m.content}`).join("\n")
      : "(none)";

    const messageLines = recent
      .map((m, i) => {
        const id = m.messageId ?? "?";
        const reply = m.replyTo ? ` (replying to ${m.replyTo})` : "";
        const tag = m.type !== "text" ? `[${m.type}] ` : "";
        return `${i + 1}. id=${id} [${m.timestamp}] ${m.sender}${reply}: ${tag}${m.content.slice(0, 240)}`;
      })
      .join("\n");

    const instructions = `You are Skye, a calm, minimal AI assistant participating in the Telegram group "${chatTitle}".
You are passively reading the conversation. Right now you have a chance to react — unprompted — to one of the recent messages, as if you happened to notice something interesting, funny, important, or worth a quick word.

You are NOT required to react. Only react if something genuinely catches your eye. If nothing is worth it, skip.

If you react:
- Pick a target_message_id from the list below. It can be any message — the latest or an earlier one. Choose what feels natural.
- React with a single emoji. You MUST pick exactly one of these allowed Telegram reaction emojis (no others are accepted): ${REACTION_EMOJIS.join(" ")}.
- Use a reaction only for a quick acknowledgement, agreement, humor, or emotion. Never write a text reply.

Long-term memories about this chat:
${memoryLines}

Recent messages (the most recent is at the bottom):
${messageLines}

Respond ONLY with a single JSON object, nothing else. Shape:
{"react": true|false, "target_message_id": <number from the list above>, "kind": "emoji"|"none", "emoji": "<one allowed emoji>", "reason": "<one short sentence about why, for your own context>"}
If you choose not to react, return: {"react": false, "kind": "none"}`;

    try {
      const res = await this.deps.llm.ask(
        instructions,
        "Decide and respond with JSON only.",
        modelId
      );
      const text = res.output_text ?? "";
      const json = this.parseDecisionJson(text);
      if (!json) return null;
      return this.normalizeDecision(json);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log.warn({ err: msg, chatId }, "Proactive reaction LLM call failed");
      return null;
    }
  }

  private parseDecisionJson(raw: string): Record<string, unknown> | null {
    const trimmed = raw.trim();
    try {
      return JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      const start = trimmed.indexOf("{");
      const end = trimmed.lastIndexOf("}");
      if (start === -1 || end === -1 || end <= start) return null;
      try {
        return JSON.parse(trimmed.slice(start, end + 1)) as Record<string, unknown>;
      } catch {
        return null;
      }
    }
  }

  private normalizeDecision(json: Record<string, unknown>): ProactiveDecision {
    const react = json.react === true;
    const kindRaw = String(json.kind ?? "").toLowerCase();
    const kind: ProactiveDecision["kind"] = kindRaw === "emoji" ? "emoji" : "none";
    const targetMessageId =
      typeof json.target_message_id === "number"
        ? json.target_message_id
        : typeof json.target_message_id === "string"
          ? Number(json.target_message_id)
          : undefined;
    const emojiRaw = typeof json.emoji === "string" ? json.emoji : undefined;
    const emoji = emojiRaw && REACTION_EMOJIS.includes(emojiRaw) ? emojiRaw : undefined;
    const reason = typeof json.reason === "string" ? json.reason : undefined;

    return {
      react,
      targetMessageId: Number.isFinite(targetMessageId) ? targetMessageId : undefined,
      kind: react ? kind : "none",
      emoji,
      reason,
    };
  }
}

export { REACTION_EMOJIS };
