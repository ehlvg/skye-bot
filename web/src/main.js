import Alpine from "alpinejs";

import { api } from "./api.js";
import { icons } from "./icons.js";
import "./styles.css";

const tg = window.Telegram?.WebApp;

/**
 * Reflect Telegram's color scheme onto <html data-color-scheme="…">.
 * Telegram itself injects --tg-theme-* CSS variables on document.documentElement,
 * so we only mirror the scheme flag for our own dark/light branches.
 */
function applyScheme() {
  const scheme = tg?.colorScheme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  document.documentElement.setAttribute("data-color-scheme", scheme);
}

/**
 * Sync the Telegram header / bottom bar colors with the panel's surfaces.
 * Without this the native chrome stays default-blue and clashes with our UI.
 */
function syncTelegramChrome() {
  if (!tg) return;
  try {
    tg.setHeaderColor?.("secondary_bg_color");
    tg.setBackgroundColor?.("secondary_bg_color");
    tg.setBottomBarColor?.("bg_color");
  } catch {
    // Older Telegram clients reject named colors — non-fatal.
  }
}

const haptic = {
  selection: () => tg?.HapticFeedback?.selectionChanged?.(),
  light: () => tg?.HapticFeedback?.impactOccurred?.("light"),
  success: () => tg?.HapticFeedback?.notificationOccurred?.("success"),
  warning: () => tg?.HapticFeedback?.notificationOccurred?.("warning"),
  error: () => tg?.HapticFeedback?.notificationOccurred?.("error"),
};

const popupConfirm = (message) =>
  new Promise((resolve) => {
    if (tg?.showConfirm) {
      tg.showConfirm(message, (ok) => resolve(!!ok));
    } else {
      resolve(window.confirm(message));
    }
  });

const popupAlert = (message) => {
  if (tg?.showAlert) tg.showAlert(message);
  else window.alert(message);
};

const PLACEHOLDER_PATTERN = /\$\{input:([^}]+)\}/g;

/**
 * Extract `${input:foo}` keys from a JSON config string. Returns a sorted
 * unique list so the editor can render an input field per placeholder.
 */
function extractInputKeys(configString) {
  if (!configString) return [];
  const keys = new Set();
  let match;
  while ((match = PLACEHOLDER_PATTERN.exec(configString)) !== null) {
    keys.add(match[1]);
  }
  return [...keys].sort();
}

document.addEventListener("alpine:init", () => {
  Alpine.data("app", () => ({
    // Inline SVG catalogue — referenced from templates as `icons.brainFill` etc.
    icons,

    // --- Tab navigation ---
    tab: "profile",
    setTab(next) {
      if (this.tab === next) return;
      this.tab = next;
      haptic.selection();
      window.scrollTo({ top: 0, behavior: "smooth" });
    },

    // --- User identity from initData ---
    user: { name: "", handle: "" },

    // --- Loaded state ---
    loading: true,
    saving: false,
    dirty: false,

    config: { apiKey: "", baseUrl: "", model: "", maxTokens: null, systemPrompt: "" },
    chatConfig: { voiceMode: false },
    mcpServers: [],
    memories: [],
    stats: { totalRequests: 0, requestsToday: 0, avgLatencyMs: 0, errorRate: 0 },

    // --- MCP editor sheet state ---
    editor: {
      open: false,
      id: null,
      name: "",
      config: "",
      inputs: {},
      inputKeys: [],
    },

    async init() {
      const u = tg?.initDataUnsafe?.user;
      if (u) {
        const parts = [u.first_name, u.last_name].filter(Boolean);
        this.user.name = parts.join(" ");
        this.user.handle = u.username ? `@${u.username}` : `id:${u.id}`;
      }

      // Wire up Telegram's MainButton as a save action when there are unsaved
      // text changes. Toggles save immediately so they don't go through this.
      if (tg?.MainButton) {
        tg.MainButton.setText("Save Changes");
        tg.MainButton.color = getComputedStyle(document.documentElement)
          .getPropertyValue("--accent")
          .trim() || "#007aff";
        tg.MainButton.onClick(() => this.saveConfig());
        this.$watch("dirty", (next) => {
          if (next) tg.MainButton.show();
          else tg.MainButton.hide();
        });
      }

      // Re-render scheme + chrome on theme changes pushed by the client.
      tg?.onEvent?.("themeChanged", () => {
        applyScheme();
        syncTelegramChrome();
      });

      try {
        const [cfg, chatCfg, mcps, mems, st] = await Promise.all([
          api.getConfig(),
          api.getChatConfig(),
          api.getMcpServers(),
          api.getMemories(),
          api.getStats(),
        ]);
        Object.assign(this.config, cfg);
        Object.assign(this.chatConfig, chatCfg);
        this.mcpServers = mcps;
        this.memories = mems;
        this.stats = st;
      } catch (e) {
        popupAlert(`Failed to load: ${e.message}`);
      } finally {
        this.loading = false;
        tg?.ready?.();
        tg?.expand?.();
      }
    },

    markDirty() {
      if (!this.dirty) {
        this.dirty = true;
      }
    },

    async saveConfig() {
      if (this.saving) return;
      this.saving = true;
      tg?.MainButton?.showProgress?.();
      try {
        const cleaned = {};
        for (const [k, v] of Object.entries(this.config)) {
          if (v !== undefined && v !== "" && v !== null) cleaned[k] = v;
        }
        const updated = await api.updateConfig(cleaned);
        Object.assign(this.config, updated);
        this.dirty = false;
        haptic.success();
      } catch (e) {
        haptic.error();
        popupAlert(`Save failed: ${e.message}`);
      } finally {
        this.saving = false;
        tg?.MainButton?.hideProgress?.();
      }
    },

    async toggleVoice() {
      const next = !this.chatConfig.voiceMode;
      this.chatConfig.voiceMode = next;
      haptic.selection();
      try {
        const updated = await api.updateChatConfig({ voiceMode: next });
        this.chatConfig.voiceMode = updated.voiceMode;
      } catch (e) {
        this.chatConfig.voiceMode = !next;
        haptic.error();
        popupAlert(`Update failed: ${e.message}`);
      }
    },

    // --- MCP server editor ---
    openServerEditor(server) {
      haptic.light();
      if (server) {
        this.editor = {
          open: true,
          id: server.id,
          name: server.name,
          config: JSON.stringify(server.config, null, 2),
          inputs: {},
          inputKeys: [],
        };
      } else {
        this.editor = {
          open: true,
          id: null,
          name: "",
          config: "",
          inputs: {},
          inputKeys: [],
        };
      }
      this.refreshInputKeys();
      this.$watch("editor.config", () => this.refreshInputKeys());
      tg?.BackButton?.show?.();
      tg?.BackButton?.onClick?.(() => this.closeServerEditor());
    },

    closeServerEditor() {
      this.editor.open = false;
      tg?.BackButton?.hide?.();
      tg?.BackButton?.offClick?.(() => {});
    },

    refreshInputKeys() {
      const keys = extractInputKeys(this.editor.config);
      this.editor.inputKeys = keys;
      // Preserve existing values, drop dropped keys.
      const next = {};
      for (const k of keys) next[k] = this.editor.inputs[k] ?? "";
      this.editor.inputs = next;
    },

    async saveServer() {
      let parsed;
      try {
        parsed = JSON.parse(this.editor.config);
      } catch {
        popupAlert("Server config is not valid JSON.");
        haptic.error();
        return;
      }
      try {
        if (this.editor.id) {
          const updated = await api.updateMcpServer(
            this.editor.id,
            this.editor.name,
            parsed,
            this.editor.inputs
          );
          const idx = this.mcpServers.findIndex((s) => s.id === updated.id);
          if (idx >= 0) this.mcpServers[idx] = updated;
        } else {
          const created = await api.addMcpServer(this.editor.name, parsed, this.editor.inputs);
          this.mcpServers.push(created);
        }
        haptic.success();
        this.closeServerEditor();
      } catch (e) {
        haptic.error();
        popupAlert(`Save failed: ${e.message}`);
      }
    },

    async deleteServer() {
      if (!this.editor.id) return;
      const ok = await popupConfirm(`Delete "${this.editor.name}"?`);
      if (!ok) return;
      try {
        await api.deleteMcpServer(this.editor.id);
        this.mcpServers = this.mcpServers.filter((s) => s.id !== this.editor.id);
        haptic.success();
        this.closeServerEditor();
      } catch (e) {
        haptic.error();
        popupAlert(`Delete failed: ${e.message}`);
      }
    },

    // --- Memory deletion ---
    async confirmDeleteMemory(memory) {
      const ok = await popupConfirm("Delete this memory?");
      if (!ok) return;
      try {
        await api.deleteMemory(memory.chatId, memory.id);
        this.memories = this.memories.filter(
          (m) => !(m.id === memory.id && m.chatId === memory.chatId)
        );
        haptic.success();
      } catch (e) {
        haptic.error();
        popupAlert(`Delete failed: ${e.message}`);
      }
    },

    formatDate(iso) {
      try {
        const d = new Date(iso);
        return d.toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        });
      } catch {
        return iso ?? "";
      }
    },
  }));
});

applyScheme();
syncTelegramChrome();
window.Alpine = Alpine;
Alpine.start();
