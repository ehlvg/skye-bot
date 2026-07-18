import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { ReactNode } from "react";
import {
  api,
  type BillingAccount,
  type AboutInfo,
  type AdminPrincipalsResponse,
  type ChatConfig,
  type McpServer,
  type Memory,
  type ModelEntry,
  type Plans,
  type Stats,
  type UserConfig,
} from "./lib/api";
import {
  alertDialog,
  confirmDialog,
  haptic,
  openInvoice,
  ready,
  currentUser,
} from "./lib/telegram";
import type { TabKey } from "./components/TabBar";

interface BillingState {
  account: BillingAccount | null;
  models: ModelEntry[];
  defaultModelId: string;
  plans: Plans | null;
  busy: boolean;
}

interface AppState {
  loading: boolean;
  error: string | null;
  user: { name: string; handle: string };

  tab: TabKey;
  setTab: (t: TabKey) => void;

  config: UserConfig;
  chatConfig: ChatConfig;
  mcpServers: McpServer[];
  memories: Memory[];
  stats: Stats;
  billing: BillingState;
  about: AboutInfo | null;
  admins: AdminPrincipalsResponse | null;
  adminBusy: boolean;

  aboutOpen: boolean;
  adminOpen: boolean;
  openAbout: () => void;
  closeAbout: () => void;
  openAdmin: () => Promise<void>;
  closeAdmin: () => void;
  addAdmin: (userId: number) => Promise<void>;
  removeAdmin: (userId: number) => Promise<void>;

  dirty: boolean;
  markDirty: () => void;
  updateConfig: (patch: Partial<UserConfig>) => void;
  saveConfig: () => Promise<void>;

  toggleVoice: () => Promise<void>;

  // MCP editor
  editor: { open: boolean; server: McpServer | null };
  openMcpEditor: (server: McpServer | null) => void;
  closeMcpEditor: () => void;
  saveMcpServer: (
    id: number | null,
    name: string,
    config: Record<string, unknown>,
    inputs: Record<string, string>,
  ) => Promise<void>;
  deleteMcpServer: (id: number) => Promise<void>;

  deleteMemory: (m: Memory) => Promise<void>;

  selectModel: (id: string) => Promise<void>;
  subscribe: () => Promise<void>;
  buyPack: (packId: string) => Promise<void>;
  cancelSubscription: () => Promise<void>;
}

const Ctx = createContext<AppState | null>(null);

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useApp must be used inside AppProvider");
  return v;
}

const EMPTY = {
  config: { systemPrompt: "", personality: "skye" as const },
  chatConfig: { voiceMode: false },
  mcpServers: [],
  memories: [],
  stats: { totalRequests: 0, requestsToday: 0, avgLatencyMs: 0, errorRate: 0 },
};

export function AppProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [user, setUser] = useState({ name: "", handle: "" });
  const [tab, setTabState] = useState<TabKey>("profile");

  const [config, setConfig] = useState<UserConfig>(EMPTY.config);
  const [chatConfig, setChatConfig] = useState<ChatConfig>(EMPTY.chatConfig);
  const [mcpServers, setMcpServers] = useState<McpServer[]>(EMPTY.mcpServers);
  const [memories, setMemories] = useState<Memory[]>(EMPTY.memories);
  const [stats, setStats] = useState<Stats>(EMPTY.stats);
  const [billing, setBilling] = useState<BillingState>({
    account: null,
    models: [],
    defaultModelId: "",
    plans: null,
    busy: false,
  });
  const [about, setAbout] = useState<AboutInfo | null>(null);
  const [admins, setAdmins] = useState<AdminPrincipalsResponse | null>(null);
  const [adminBusy, setAdminBusy] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);

  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editor, setEditor] = useState<{ open: boolean; server: McpServer | null }>({
    open: false,
    server: null,
  });

  const setTab = useCallback((t: TabKey) => {
    setTabState(t);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  const load = useCallback(async () => {
    try {
      const u = currentUser();
      if (u) {
        const name = [u.first_name, u.last_name].filter(Boolean).join(" ") || "Guest";
        setUser({ name, handle: u.username ? `@${u.username}` : `id: ${u.id}` });
      }
      const [cfg, chatCfg, mcps, mems, st, bill, modelsInfo, plans, aboutInfo] = await Promise.all([
        api.getConfig(),
        api.getChatConfig(),
        api.getMcpServers(),
        api.getMemories(),
        api.getStats(),
        api.getBillingAccount(),
        api.getModels(),
        api.getPlans(),
        api.getAbout(),
      ]);
      setConfig(cfg);
      setChatConfig(chatCfg);
      setMcpServers(mcps);
      setMemories(mems);
      setStats(st);
      setBilling({
        account: bill,
        models: modelsInfo.models,
        defaultModelId: modelsInfo.defaultModelId,
        plans,
        busy: false,
      });
      setAbout(aboutInfo);
      if (aboutInfo.isAdmin) {
        setAdmins(await api.getAdminPrincipals());
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
      ready();
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const markDirty = useCallback(() => setDirty(true), []);

  const openAbout = useCallback(() => {
    haptic.light();
    setAboutOpen(true);
  }, []);

  const closeAbout = useCallback(() => setAboutOpen(false), []);

  const openAdmin = useCallback(async () => {
    haptic.light();
    setAdminOpen(true);
    setAdminBusy(true);
    try {
      setAdmins(await api.getAdminPrincipals());
    } catch (e) {
      haptic.error();
      alertDialog(`Could not load administrators: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setAdminBusy(false);
    }
  }, []);

  const closeAdmin = useCallback(() => setAdminOpen(false), []);

  const addAdmin = useCallback(async (userId: number) => {
    setAdminBusy(true);
    try {
      const result = await api.addAdminPrincipal(userId);
      setAdmins((current) => current ? { ...current, admins: result.admins } : current);
      haptic.success();
    } catch (e) {
      haptic.error();
      alertDialog(`Could not add administrator: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setAdminBusy(false);
    }
  }, []);

  const removeAdmin = useCallback(async (userId: number) => {
    const ok = await confirmDialog(`Remove Telegram user ${userId} from administrators?`);
    if (!ok) return;
    setAdminBusy(true);
    try {
      const result = await api.removeAdminPrincipal(userId);
      setAdmins((current) => current ? { ...current, admins: result.admins } : current);
      haptic.success();
    } catch (e) {
      haptic.error();
      alertDialog(`Could not remove administrator: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setAdminBusy(false);
    }
  }, []);

  const updateConfig = useCallback((patch: Partial<UserConfig>) => {
    setConfig((c) => ({ ...c, ...patch }));
    setDirty(true);
  }, []);

  const saveConfig = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    try {
      const updated = await api.updateConfig(config);
      setConfig(updated);
      setDirty(false);
      haptic.success();
    } catch (e) {
      haptic.error();
      alertDialog(`Save failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  }, [config, saving]);

  const toggleVoice = useCallback(async () => {
    const next = !chatConfig.voiceMode;
    setChatConfig({ voiceMode: next });
    haptic.selection();
    try {
      const updated = await api.updateChatConfig({ voiceMode: next });
      setChatConfig(updated);
    } catch (e) {
      setChatConfig({ voiceMode: !next });
      haptic.error();
      alertDialog(`Update failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [chatConfig.voiceMode]);

  const openMcpEditor = useCallback((server: McpServer | null) => {
    haptic.light();
    setEditor({ open: true, server });
  }, []);

  const closeMcpEditor = useCallback(() => {
    setEditor((e) => ({ ...e, open: false }));
  }, []);

  const saveMcpServer = useCallback(
    async (
      id: number | null,
      name: string,
      cfg: Record<string, unknown>,
      inputs: Record<string, string>,
    ) => {
      try {
        if (id != null) {
          const updated = await api.updateMcpServer(id, name, cfg, inputs);
          setMcpServers((list) => list.map((s) => (s.id === updated.id ? updated : s)));
        } else {
          const created = await api.addMcpServer(name, cfg, inputs);
          setMcpServers((list) => [...list, created]);
        }
        haptic.success();
        setEditor((e) => ({ ...e, open: false }));
      } catch (e) {
        haptic.error();
        alertDialog(`Save failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
    [],
  );

  const deleteMcpServer = useCallback(async (id: number) => {
    const ok = await confirmDialog("Delete this server?");
    if (!ok) return;
    try {
      await api.deleteMcpServer(id);
      setMcpServers((list) => list.filter((s) => s.id !== id));
      haptic.success();
      setEditor((e) => ({ ...e, open: false }));
    } catch (e) {
      haptic.error();
      alertDialog(`Delete failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, []);

  const deleteMemory = useCallback(async (m: Memory) => {
    const ok = await confirmDialog("Delete this memory?");
    if (!ok) return;
    try {
      await api.deleteMemory(m.chatId, m.id);
      setMemories((list) => list.filter((x) => !(x.id === m.id && x.chatId === m.chatId)));
      haptic.success();
    } catch (e) {
      haptic.error();
      alertDialog(`Delete failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, []);

  const refreshAccount = useCallback(async () => {
    try {
      const acc = await api.getBillingAccount();
      setBilling((b) => ({ ...b, account: acc }));
    } catch {
      /* ignore */
    }
  }, []);

  const selectModel = useCallback(
    async (id: string) => {
      setBilling((b) => ({ ...b, busy: true }));
      haptic.selection();
      try {
        await api.selectModel(id);
        await refreshAccount();
        haptic.success();
      } catch (e) {
        haptic.error();
        alertDialog(`Update failed: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        setBilling((b) => ({ ...b, busy: false }));
      }
    },
    [refreshAccount],
  );

  const subscribe = useCallback(async () => {
    setBilling((b) => ({ ...b, busy: true }));
    try {
      const { url } = await api.createSubscriptionInvoice();
      await openInvoice(url);
      haptic.success();
      await refreshAccount();
    } catch (e) {
      haptic.error();
      alertDialog(`Failed to start subscription: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBilling((b) => ({ ...b, busy: false }));
    }
  }, [refreshAccount]);

  const buyPack = useCallback(
    async (packId: string) => {
      setBilling((b) => ({ ...b, busy: true }));
      try {
        const { url } = await api.createPackInvoice(packId);
        await openInvoice(url);
        haptic.success();
        await refreshAccount();
      } catch (e) {
        haptic.error();
        alertDialog(e instanceof Error ? e.message : "Failed to start purchase");
      } finally {
        setBilling((b) => ({ ...b, busy: false }));
      }
    },
    [refreshAccount],
  );

  const cancelSubscription = useCallback(async () => {
    const ok = await confirmDialog(
      "Cancel your Skye Plus subscription? Access continues until the renewal date, then ends.",
    );
    if (!ok) return;
    try {
      await api.cancelSubscription();
      await refreshAccount();
      haptic.success();
    } catch (e) {
      haptic.error();
      alertDialog(`Could not cancel: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [refreshAccount]);

  const value = useMemo<AppState>(
    () => ({
      loading,
      error,
      user,
      tab,
      setTab,
      config,
      chatConfig,
      mcpServers,
      memories,
      stats,
      billing,
      about,
      admins,
      adminBusy,
      aboutOpen,
      adminOpen,
      openAbout,
      closeAbout,
      openAdmin,
      closeAdmin,
      addAdmin,
      removeAdmin,
      dirty,
      markDirty,
      updateConfig,
      saveConfig,
      toggleVoice,
      editor,
      openMcpEditor,
      closeMcpEditor,
      saveMcpServer,
      deleteMcpServer,
      deleteMemory,
      selectModel,
      subscribe,
      buyPack,
      cancelSubscription,
    }),
    [
      loading,
      error,
      user,
      tab,
      setTab,
      config,
      chatConfig,
      mcpServers,
      memories,
      stats,
      billing,
      about,
      admins,
      adminBusy,
      aboutOpen,
      adminOpen,
      openAbout,
      closeAbout,
      openAdmin,
      closeAdmin,
      addAdmin,
      removeAdmin,
      dirty,
      markDirty,
      updateConfig,
      saveConfig,
      toggleVoice,
      editor,
      openMcpEditor,
      closeMcpEditor,
      saveMcpServer,
      deleteMcpServer,
      deleteMemory,
      selectModel,
      subscribe,
      buyPack,
      cancelSubscription,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
