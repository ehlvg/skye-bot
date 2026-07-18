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
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 30_000);
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      ...init,
      signal: init.signal ?? controller.signal,
      headers: { ...headers(), ...(init.headers || {}) },
    });
  } finally {
    window.clearTimeout(timeout);
  }
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

export interface CustomConnector {
  id: number;
  name: string;
  config: Record<string, unknown>;
  connected: boolean;
  toolCount: number;
}

export interface ManagedConnector {
  slug: string;
  name: string;
  logo?: string;
  connected: boolean;
  status?: string;
}

export interface ConnectorsResponse {
  managed: {
    enabled: boolean;
    connectors: ManagedConnector[];
  };
  custom: CustomConnector[];
  customEnabled: boolean;
  maxCustom: number;
  managedUnavailable?: boolean;
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

export interface AuditEvent {
  ts: string;
  kind: "request" | "activity" | "billing";
  id: number;
  userId: number;
  chatId: number | null;
  action: string;
  model: string | null;
  status: string | null;
  latencyMs: number | null;
  inputText: string | null;
  outputText: string | null;
  toolCalls: unknown;
  details: unknown;
  error: string | null;
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
  enabled: boolean;
  currency: string;
  title: string;
  description: string;
  subscriptionStars: number;
  subscriptionPeriodSeconds: number;
  baseQuotaTokens: number;
  packs: TokenPack[];
}

export type AccessMode = "private" | "allowlist" | "subscription" | "open";

export interface AboutInfo {
  name: string;
  version: string;
  commit: string | null;
  sourceUrl: string;
  securityUrl: string;
  license: string;
  maintainer: {
    name: string;
    alias: string;
    telegram: string;
    email: string;
  };
  accessMode: AccessMode;
  billingEnabled: boolean;
  isAdmin: boolean;
  isOwner: boolean;
}

export interface AdminPrincipal {
  userId: number;
  role: "owner" | "admin";
  source: "config" | "database";
  removable: boolean;
  addedBy: number | null;
  createdAt: string | null;
}

export interface AdminPrincipalsResponse {
  ownerUserId: number | null;
  canManage: boolean;
  admins: AdminPrincipal[];
}

export interface BillingEvent {
  id: number;
  type: string;
  payload: unknown;
  amount: number | null;
  createdAt: string;
}

export const api = {
  getAbout: () => request<AboutInfo>("/about"),
  getAdminPrincipals: () => request<AdminPrincipalsResponse>("/admin/principals"),
  addAdminPrincipal: (userId: number) =>
    request<{ admins: AdminPrincipal[] }>("/admin/principals", {
      method: "POST",
      body: JSON.stringify({ userId }),
    }),
  removeAdminPrincipal: (userId: number) =>
    request<{ admins: AdminPrincipal[] }>(`/admin/principals/${userId}`, { method: "DELETE" }),
  getConfig: () => request<UserConfig>("/config"),
  updateConfig: (cfg: UserConfig) =>
    request<UserConfig>("/config", { method: "PUT", body: JSON.stringify(cfg) }),

  getChatConfig: () => request<ChatConfig>("/chat-config"),
  updateChatConfig: (cfg: ChatConfig) =>
    request<ChatConfig>("/chat-config", { method: "PUT", body: JSON.stringify(cfg) }),

  getConnectors: () => request<ConnectorsResponse>("/connectors"),
  authorizeManagedConnector: (toolkit: string) =>
    request<{ redirectUrl: string }>(
      `/connectors/managed/${encodeURIComponent(toolkit)}/authorize`,
      { method: "POST" }
    ),
  disconnectManagedConnector: (toolkit: string) =>
    request<{ ok: true }>(`/connectors/managed/${encodeURIComponent(toolkit)}`, {
      method: "DELETE",
    }),
  addCustomConnector: (
    name: string,
    config: Record<string, unknown>,
    inputs: Record<string, string>
  ) =>
    request<CustomConnector>("/connectors/custom", {
      method: "POST",
      body: JSON.stringify({ name, config, inputs, acknowledgeRisk: true }),
    }),
  updateCustomConnector: (
    id: number,
    name: string,
    config: Record<string, unknown>,
    inputs: Record<string, string>
  ) =>
    request<CustomConnector>(`/connectors/custom/${id}`, {
      method: "PUT",
      body: JSON.stringify({ name, config, inputs, acknowledgeRisk: true }),
    }),
  deleteCustomConnector: (id: number) =>
    request<{ ok: true }>(`/connectors/custom/${id}`, { method: "DELETE" }),

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
  getAuditEvents: () => request<AuditEvent[]>("/audit/events"),

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
