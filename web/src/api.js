/**
 * Thin fetch wrapper. Every panel API call must carry the Telegram initData
 * header so the server can validate the caller via HMAC.
 */
const headers = () => ({
  "Content-Type": "application/json",
  "x-telegram-init-data": window.Telegram?.WebApp?.initData ?? "",
});

async function request(path, init = {}) {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { ...headers(), ...(init.headers || {}) },
  });
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (body?.error) msg = body.error;
    } catch {}
    throw new Error(msg);
  }
  if (res.status === 204) return null;
  return res.json();
}

export const api = {
  getConfig: () => request("/config"),
  updateConfig: (cfg) => request("/config", { method: "PUT", body: JSON.stringify(cfg) }),

  getChatConfig: () => request("/chat-config"),
  updateChatConfig: (cfg) =>
    request("/chat-config", { method: "PUT", body: JSON.stringify(cfg) }),

  getMcpServers: () => request("/mcp"),
  addMcpServer: (name, config, inputs) =>
    request("/mcp", { method: "POST", body: JSON.stringify({ name, config, inputs }) }),
  updateMcpServer: (id, name, config, inputs) =>
    request(`/mcp/${id}`, {
      method: "PUT",
      body: JSON.stringify({ name, config, inputs }),
    }),
  deleteMcpServer: (id) => request(`/mcp/${id}`, { method: "DELETE" }),

  getMemories: () => request("/memories"),
  deleteMemory: (chatId, id) =>
    request(`/memories/${chatId}/${encodeURIComponent(id)}`, { method: "DELETE" }),
  clearMemoriesForChat: (chatId) =>
    request(`/memories/${chatId}`, { method: "DELETE" }),

  getStats: () => request("/stats"),

  // --- Skye Plus billing ---
  getBillingAccount: () => request("/billing/account"),
  getModels: () => request("/billing/models"),
  selectModel: (modelId) =>
    request("/billing/model", { method: "PUT", body: JSON.stringify({ modelId }) }),
  getPlans: () => request("/billing/plans"),
  createSubscriptionInvoice: () =>
    request("/billing/invoice/subscription", { method: "POST" }),
  createPackInvoice: (packId) =>
    request("/billing/invoice/pack", { method: "POST", body: JSON.stringify({ packId }) }),
  cancelSubscription: () => request("/billing/cancel", { method: "POST" }),
  getBillingEvents: () => request("/billing/events"),
};