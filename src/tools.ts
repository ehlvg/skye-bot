import { getMemories, addMemory, deleteMemory } from "./memory.js";
import { generateImage, type ApiCredentials } from "./openai.js";
import { exaSearch } from "./exa.js";
import { getRecentMessages } from "./chatLog.js";
import { addReminder } from "./reminders.js";
import { EXA_API_KEY } from "./config.js";

export interface ToolResult {
  text: string;
  imageBuffer?: Buffer;
}

export interface ToolContext {
  chatId: number;
  threadId?: number;
  creds?: ApiCredentials;
  lastImageDataUrl?: string;
}

// ─── Tool definitions ────────────────────────────────────────────────────────

const recallMemoriesTool = {
  type: "function" as const,
  function: {
    name: "recall_memories",
    description:
      "Retrieve all saved memories for this chat. Call this when context about the user or previous conversations might be relevant.",
    parameters: { type: "object", properties: {}, required: [] },
  },
};

const saveMemoryTool = {
  type: "function" as const,
  function: {
    name: "save_memory",
    description:
      "Save an important fact to long-term memory. Use for names, preferences, project details, or anything the user asks you to remember.",
    parameters: {
      type: "object",
      properties: {
        content: {
          type: "string",
          description: "The fact to remember, written as a clear statement.",
        },
      },
      required: ["content"],
    },
  },
};

const deleteMemoryTool = {
  type: "function" as const,
  function: {
    name: "delete_memory",
    description: "Delete a specific memory by its ID. Use when the user asks you to forget something.",
    parameters: {
      type: "object",
      properties: {
        memory_id: {
          type: "string",
          description: "The memory ID to delete (e.g. mem_abc123).",
        },
      },
      required: ["memory_id"],
    },
  },
};

const generateImageTool = {
  type: "function" as const,
  function: {
    name: "generate_image",
    description:
      "Generate an image from a text description. Use when the user asks for an image, illustration, or any visual — or when an image would genuinely enrich the response.",
    parameters: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description: "Detailed description of the image to generate.",
        },
      },
      required: ["prompt"],
    },
  },
};

const editImageTool = {
  type: "function" as const,
  function: {
    name: "edit_image",
    description:
      "Edit or transform the last image the user sent, based on a text instruction.",
    parameters: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description: "Instructions for how to edit the image.",
        },
      },
      required: ["prompt"],
    },
  },
};

const webSearchTool = {
  type: "function" as const,
  function: {
    name: "web_search",
    description:
      "Search the web for current information. Use when asked about recent events, things you're unsure about, or anything that benefits from fresh data.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query." },
        num_results: {
          type: "number",
          description: "Number of results to return (default 5, max 10).",
        },
      },
      required: ["query"],
    },
  },
};

const getChatContextTool = {
  type: "function" as const,
  function: {
    name: "get_chat_context",
    description:
      "Get recent messages from this group chat. Use when you need context about what was discussed.",
    parameters: {
      type: "object",
      properties: {
        n: {
          type: "number",
          description: "Number of recent messages to retrieve (default 20, max 50).",
        },
      },
      required: [],
    },
  },
};

const setReminderTool = {
  type: "function" as const,
  function: {
    name: "set_reminder",
    description: "Set a reminder that will be sent to the user at a specific time.",
    parameters: {
      type: "object",
      properties: {
        text: { type: "string", description: "The reminder message to send." },
        trigger_at: {
          type: "string",
          description:
            "ISO 8601 datetime when to send the reminder, including timezone offset (e.g. 2026-03-29T18:00:00+03:00).",
        },
      },
      required: ["text", "trigger_at"],
    },
  },
};

// ─── Tool registry ────────────────────────────────────────────────────────────

/** Build the tool list for a given context. */
export function buildTools(isGroup: boolean): any[] {
  const tools: any[] = [
    recallMemoriesTool,
    saveMemoryTool,
    deleteMemoryTool,
    generateImageTool,
    editImageTool,
    setReminderTool,
  ];

  if (EXA_API_KEY) tools.push(webSearchTool);
  if (isGroup) tools.push(getChatContextTool);

  return tools;
}

// ─── Tool notifications ───────────────────────────────────────────────────────

/** Returns a short human-readable status string for significant tool calls. Undefined = silent. */
export function toolNotification(name: string, args: any): string | undefined {
  switch (name) {
    case "web_search":
      return `searching: "${args.query}"`;
    case "generate_image":
      return `generating image`;
    case "edit_image":
      return `editing image`;
    case "set_reminder":
      return `setting reminder for ${args.trigger_at}`;
    default:
      return undefined; // memory tools and get_chat_context are silent
  }
}

// ─── Tool executor ────────────────────────────────────────────────────────────

export async function executeTool(
  name: string,
  args: any,
  ctx: ToolContext
): Promise<ToolResult> {
  switch (name) {
    case "recall_memories": {
      const mems = getMemories(ctx.chatId);
      if (!mems.length) return { text: "No saved memories for this chat." };
      return { text: mems.map((m) => `[${m.id}] ${m.content}`).join("\n") };
    }

    case "save_memory": {
      const entry = await addMemory(ctx.chatId, args.content);
      return { text: `Memory saved (${entry.id}).` };
    }

    case "delete_memory": {
      const ok = await deleteMemory(ctx.chatId, args.memory_id);
      return { text: ok ? `Deleted ${args.memory_id}.` : `Not found: ${args.memory_id}.` };
    }

    case "generate_image": {
      const buf = await generateImage(args.prompt, undefined, ctx.creds);
      return {
        text: buf ? "Image generated." : "No image was returned by the model.",
        imageBuffer: buf ?? undefined,
      };
    }

    case "edit_image": {
      if (!ctx.lastImageDataUrl) return { text: "No recent image to edit." };
      const buf = await generateImage(args.prompt, ctx.lastImageDataUrl, ctx.creds);
      return {
        text: buf ? "Image edited." : "No image was returned by the model.",
        imageBuffer: buf ?? undefined,
      };
    }

    case "web_search": {
      const n = Math.min(args.num_results ?? 5, 10);
      const results = await exaSearch(args.query, n);
      if (!results.length) return { text: "No results found." };
      const text = results
        .map((r, i) => `${i + 1}. ${r.title}\n${r.url}\n${r.text}`)
        .join("\n\n");
      return { text };
    }

    case "get_chat_context": {
      const n = Math.min(args.n ?? 20, 50);
      const text = getRecentMessages(ctx.chatId, n);
      return { text: text || "No recent messages logged." };
    }

    case "set_reminder": {
      await addReminder(ctx.chatId, ctx.threadId, args.text, args.trigger_at);
      return { text: `Reminder set for ${args.trigger_at}.` };
    }

    default:
      return { text: `Unknown tool: ${name}` };
  }
}
