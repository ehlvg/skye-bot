const tg = window.Telegram.WebApp;

const initData = tg.initData;

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "X-Telegram-Init-Data": initData,
      ...options?.headers,
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(body || `HTTP ${res.status}`);
  }
  return res.json();
}

export interface UserConfig {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  maxTokens?: number;
  systemPrompt?: string;
}

export interface McpServer {
  id: number;
  name: string;
  config: {
    type?: "stdio" | "http";
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    url?: string;
    headers?: Record<string, string>;
  };
  inputs: { id: string; description?: string; password?: boolean }[];
  toolCount?: number;
  connected: boolean;
}

export interface MemoryEntry {
  id: string;
  content: string;
  createdAt: string;
}

export interface UsageStats {
  totalRequests: number;
  avgLatencyMs: number;
  errorRate: number;
  requestsToday: number;
}

export interface ChatConfig {
  fastMode: boolean;
  voiceMode: boolean;
}

export const api = {
  getConfig: () => request<UserConfig>("/config"),
  updateConfig: (config: UserConfig) =>
    request<UserConfig>("/config", { method: "PUT", body: JSON.stringify(config) }),

  getMcpServers: () => request<McpServer[]>("/mcp"),
  addMcpServer: (name: string, config: McpServer["config"], inputs?: Record<string, string>) =>
    request<McpServer>("/mcp", {
      method: "POST",
      body: JSON.stringify({ name, config, inputs }),
    }),
  updateMcpServer: (
    id: number,
    name: string,
    config: McpServer["config"],
    inputs?: Record<string, string>
  ) =>
    request<McpServer>(`/mcp/${id}`, {
      method: "PUT",
      body: JSON.stringify({ name, config, inputs }),
    }),
  deleteMcpServer: (id: number) => request<void>(`/mcp/${id}`, { method: "DELETE" }),

  getMemories: (chatId?: number) =>
    request<MemoryEntry[]>(`/memories${chatId ? `?chatId=${chatId}` : ""}`),
  deleteMemory: (chatId: number, id: string) =>
    request<void>(`/memories/${chatId}/${id}`, { method: "DELETE" }),
  clearMemories: (chatId: number) =>
    request<void>(`/memories/${chatId}`, { method: "DELETE" }),

  getUsageStats: () => request<UsageStats>("/stats"),
  getChatConfig: () => request<ChatConfig>("/chat-config"),
  updateChatConfig: (config: Partial<ChatConfig>) =>
    request<ChatConfig>("/chat-config", { method: "PUT", body: JSON.stringify(config) }),
};
