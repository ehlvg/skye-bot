/**
 * Thin fetch wrapper. Every panel API call carries the Telegram initData
 * header so the server validates the caller via HMAC.
 */
const initData = () => window.Telegram?.WebApp?.initData ?? "";

function headers(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "x-telegram-init-data": initData(),
  };
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { ...headers(), ...(init.headers || {}) },
  });
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) msg = body.error;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  if (res.status === 204) return null as T;
  return (await res.json()) as T;
}

export interface UserConfig {
  systemPrompt?: string;
  personality?: "skye" | "skye.exe" | "operator" | "muse";
}

export interface ChatConfig {
  voiceMode: boolean;
}

export interface McpServer {
  id: number;
  name: string;
  config: Record<string, unknown>;
  connected: boolean;
  toolCount: number;
}

export interface Memory {
  id: string;
  content: string;
  createdAt: string;
  chatId: number;
  category: "preference" | "fact" | "task" | "project";
  updatedAt?: string;
  expiresAt?: string | null;
  archivedAt?: string | null;
}

export interface MemoryExport {
  version: number;
  exportedAt: string;
  memories: Memory[];
}

export interface Stats {
  totalRequests: number;
  requestsToday: number;
  avgLatencyMs: number;
  errorRate: number;
}

export interface Monitoring {
  status: "ok";
  startedAt: string;
  uptimeSeconds: number;
  logs: { out: string[]; error: string[] };
}

export interface BillingAccount {
  modelId: string;
  subStatus: "none" | "active" | "cancelled";
  subExpiresAt: number;
  subPeriodStart: number;
  baseUsedTokens: number;
  baseQuotaTokens: number;
  packsTokens: number;
  totalUsedTokens: number;
  remaining: number;
  hasActiveSub: boolean;
}

export interface ModelEntry {
  id: string;
  name: string;
  multiplier: number;
}

export interface ModelsResponse {
  models: ModelEntry[];
  defaultModelId: string;
}

export interface TokenPack {
  id: string;
  name: string;
  stars: number;
  tokens: number;
}

export interface Plans {
  currency: string;
  title: string;
  description: string;
  subscriptionStars: number;
  subscriptionPeriodSeconds: number;
  baseQuotaTokens: number;
  packs: TokenPack[];
}

export interface BillingEvent {
  id: number;
  type: string;
  payload: unknown;
  amount: number | null;
  createdAt: string;
}

export const api = {
  getConfig: () => request<UserConfig>("/config"),
  updateConfig: (cfg: UserConfig) =>
    request<UserConfig>("/config", { method: "PUT", body: JSON.stringify(cfg) }),

  getChatConfig: () => request<ChatConfig>("/chat-config"),
  updateChatConfig: (cfg: ChatConfig) =>
    request<ChatConfig>("/chat-config", { method: "PUT", body: JSON.stringify(cfg) }),

  getMcpServers: () => request<McpServer[]>("/mcp"),
  addMcpServer: (name: string, config: Record<string, unknown>, inputs: Record<string, string>) =>
    request<McpServer>("/mcp", {
      method: "POST",
      body: JSON.stringify({ name, config, inputs }),
    }),
  updateMcpServer: (
    id: number,
    name: string,
    config: Record<string, unknown>,
    inputs: Record<string, string>,
  ) =>
    request<McpServer>(`/mcp/${id}`, {
      method: "PUT",
      body: JSON.stringify({ name, config, inputs }),
    }),
  deleteMcpServer: (id: number) => request<{ ok: true }>(`/mcp/${id}`, { method: "DELETE" }),

  getMemories: () => request<Memory[]>("/memories"),
  exportMemories: (chatId?: number) =>
    request<MemoryExport>(`/memories/export${chatId === undefined ? "" : `?chatId=${chatId}`}`),
  importMemories: (chatId: number, memories: unknown[]) =>
    request<{ ok: true; imported: number; merged: number }>("/memories/import", {
      method: "POST",
      body: JSON.stringify({ chatId, memories }),
    }),
  deleteMemory: (chatId: number, id: string) =>
    request<{ ok: true }>(`/memories/${chatId}/${encodeURIComponent(id)}`, { method: "DELETE" }),
  clearMemoriesForChat: (chatId: number) =>
    request<{ ok: true }>(`/memories/${chatId}`, { method: "DELETE" }),

  getStats: () => request<Stats>("/stats"),
  getMonitoring: () => request<Monitoring>("/monitoring"),

  getBillingAccount: () => request<BillingAccount>("/billing/account"),
  getModels: () => request<ModelsResponse>("/billing/models"),
  selectModel: (modelId: string) =>
    request<{ ok: true }>("/billing/model", { method: "PUT", body: JSON.stringify({ modelId }) }),
  getPlans: () => request<Plans>("/billing/plans"),
  createSubscriptionInvoice: () =>
    request<{ url: string }>("/billing/invoice/subscription", { method: "POST" }),
  createPackInvoice: (packId: string) =>
    request<{ url: string }>("/billing/invoice/pack", {
      method: "POST",
      body: JSON.stringify({ packId }),
    }),
  cancelSubscription: () => request<{ ok: true }>("/billing/cancel", { method: "POST" }),
  getBillingEvents: () => request<BillingEvent[]>("/billing/events"),
};
