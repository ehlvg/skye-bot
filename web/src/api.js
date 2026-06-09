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

  getSkills: () => request("/skills"),
  uploadSkill: (formData) =>
    fetch("/api/skills", {
      method: "POST",
      headers: { "x-telegram-init-data": window.Telegram?.WebApp?.initData ?? "" },
      body: formData,
    }).then((res) => {
      if (!res.ok) return res.json().then((body) => { throw new Error(body?.error || `${res.status}`); });
      return res.json();
    }),
  toggleSkill: (id, enabled) =>
    request(`/skills/${id}`, { method: "PUT", body: JSON.stringify({ enabled }) }),
  deleteSkill: (id) => request(`/skills/${id}`, { method: "DELETE" }),
};
