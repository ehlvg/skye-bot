import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  api,
  type BillingAccount,
  type AboutInfo,
  type AdminPrincipalsResponse,
  type ChatConfig,
  type ConnectorsResponse,
  type CustomConnector,
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
  openLink,
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
  connectors: ConnectorsResponse;
  memories: Memory[];
  stats: Stats;
  billing: BillingState;
  about: AboutInfo | null;
  admins: AdminPrincipalsResponse | null;
  adminBusy: boolean;

  aboutOpen: boolean;
  adminOpen: boolean;
  agentsOpen: boolean;
  openAbout: () => void;
  closeAbout: () => void;
  openAgents: () => void;
  closeAgents: () => void;
  openAdmin: () => Promise<void>;
  closeAdmin: () => void;
  addAdmin: (userId: number) => Promise<void>;
  removeAdmin: (userId: number) => Promise<void>;

  dirty: boolean;
  markDirty: () => void;
  updateConfig: (patch: Partial<UserConfig>) => void;
  saveConfig: () => Promise<void>;

  setVoiceReplyMode: (mode: ChatConfig["voiceReplyMode"]) => Promise<void>;

  editor: { open: boolean; connector: CustomConnector | null };
  openCustomConnector: (connector: CustomConnector | null) => void;
  closeCustomConnector: () => void;
  saveCustomConnector: (
    id: number | null,
    name: string,
    config: Record<string, unknown>,
    inputs: Record<string, string>
  ) => Promise<void>;
  deleteCustomConnector: (id: number) => Promise<void>;
  connectManagedConnector: (slug: string) => Promise<void>;
  disconnectManagedConnector: (slug: string) => Promise<void>;
  refreshConnectors: () => Promise<void>;

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
  chatConfig: { voiceReplyMode: "text" as const },
  connectors: {
    managed: { enabled: false, connectors: [] },
    custom: [],
    customEnabled: true,
    maxCustom: 8,
  } satisfies ConnectorsResponse,
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
  const [connectors, setConnectors] = useState<ConnectorsResponse>(EMPTY.connectors);
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
  const [agentsOpen, setAgentsOpen] = useState(
    () => new URLSearchParams(window.location.search).has("agents")
  );

  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editor, setEditor] = useState<{
    open: boolean;
    connector: CustomConnector | null;
  }>({
    open: false,
    connector: null,
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
      const [cfg, chatCfg, connectorInfo, mems, st, bill, modelsInfo, plans, aboutInfo] =
        await Promise.all([
          api.getConfig(),
          api.getChatConfig(),
          api.getConnectors(),
          api.getMemories(),
          api.getStats(),
          api.getBillingAccount(),
          api.getModels(),
          api.getPlans(),
          api.getAbout(),
        ]);
      setConfig(cfg);
      setChatConfig(chatCfg);
      setConnectors(connectorInfo);
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

  const openAgents = useCallback(() => {
    haptic.light();
    setAgentsOpen(true);
  }, []);

  const closeAgents = useCallback(() => setAgentsOpen(false), []);

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
      setAdmins((current) => (current ? { ...current, admins: result.admins } : current));
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
      setAdmins((current) => (current ? { ...current, admins: result.admins } : current));
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

  const setVoiceReplyMode = useCallback(async (mode: ChatConfig["voiceReplyMode"]) => {
    const previous = chatConfig.voiceReplyMode;
    setChatConfig({ voiceReplyMode: mode });
    haptic.selection();
    try {
      const updated = await api.updateChatConfig({ voiceReplyMode: mode });
      setChatConfig(updated);
    } catch (e) {
      setChatConfig({ voiceReplyMode: previous });
      haptic.error();
      alertDialog(`Update failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [chatConfig.voiceReplyMode]);

  const openCustomConnector = useCallback((connector: CustomConnector | null) => {
    haptic.light();
    setEditor({ open: true, connector });
  }, []);

  const closeCustomConnector = useCallback(() => {
    setEditor((e) => ({ ...e, open: false }));
  }, []);

  const saveCustomConnector = useCallback(
    async (
      id: number | null,
      name: string,
      cfg: Record<string, unknown>,
      inputs: Record<string, string>
    ) => {
      try {
        if (id != null) {
          const updated = await api.updateCustomConnector(id, name, cfg, inputs);
          setConnectors((state) => ({
            ...state,
            custom: state.custom.map((item) => (item.id === updated.id ? updated : item)),
          }));
        } else {
          const created = await api.addCustomConnector(name, cfg, inputs);
          setConnectors((state) => ({ ...state, custom: [...state.custom, created] }));
        }
        haptic.success();
        setEditor((e) => ({ ...e, open: false }));
      } catch (e) {
        haptic.error();
        alertDialog(`Save failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
    []
  );

  const deleteCustomConnector = useCallback(async (id: number) => {
    const ok = await confirmDialog("Delete this custom connector?");
    if (!ok) return;
    try {
      await api.deleteCustomConnector(id);
      setConnectors((state) => ({
        ...state,
        custom: state.custom.filter((item) => item.id !== id),
      }));
      haptic.success();
      setEditor((e) => ({ ...e, open: false }));
    } catch (e) {
      haptic.error();
      alertDialog(`Delete failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, []);

  const refreshConnectors = useCallback(async () => {
    try {
      setConnectors(await api.getConnectors());
    } catch (e) {
      haptic.error();
      alertDialog(`Could not refresh connectors: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, []);

  const connectManagedConnector = useCallback(async (slug: string) => {
    try {
      const { redirectUrl } = await api.authorizeManagedConnector(slug);
      haptic.success();
      openLink(redirectUrl);
    } catch (e) {
      haptic.error();
      alertDialog(`Could not connect: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, []);

  const disconnectManagedConnector = useCallback(async (slug: string) => {
    const ok = await confirmDialog("Disconnect this account from Skye?");
    if (!ok) return;
    try {
      await api.disconnectManagedConnector(slug);
      setConnectors((state) => ({
        ...state,
        managed: {
          ...state.managed,
          connectors: state.managed.connectors.map((item) =>
            item.slug === slug ? { ...item, connected: false, status: undefined } : item
          ),
        },
      }));
      haptic.success();
    } catch (e) {
      haptic.error();
      alertDialog(`Could not disconnect: ${e instanceof Error ? e.message : String(e)}`);
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
    [refreshAccount]
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
    [refreshAccount]
  );

  const cancelSubscription = useCallback(async () => {
    const ok = await confirmDialog(
      "Cancel your Skye Plus subscription? Access continues until the renewal date, then ends."
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
      connectors,
      memories,
      stats,
      billing,
      about,
      admins,
      adminBusy,
      aboutOpen,
      adminOpen,
      agentsOpen,
      openAbout,
      closeAbout,
      openAgents,
      closeAgents,
      openAdmin,
      closeAdmin,
      addAdmin,
      removeAdmin,
      dirty,
      markDirty,
      updateConfig,
      saveConfig,
      setVoiceReplyMode,
      editor,
      openCustomConnector,
      closeCustomConnector,
      saveCustomConnector,
      deleteCustomConnector,
      connectManagedConnector,
      disconnectManagedConnector,
      refreshConnectors,
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
      connectors,
      memories,
      stats,
      billing,
      about,
      admins,
      adminBusy,
      aboutOpen,
      adminOpen,
      agentsOpen,
      openAbout,
      closeAbout,
      openAgents,
      closeAgents,
      openAdmin,
      closeAdmin,
      addAdmin,
      removeAdmin,
      dirty,
      markDirty,
      updateConfig,
      saveConfig,
      setVoiceReplyMode,
      editor,
      openCustomConnector,
      closeCustomConnector,
      saveCustomConnector,
      deleteCustomConnector,
      connectManagedConnector,
      disconnectManagedConnector,
      refreshConnectors,
      deleteMemory,
      selectModel,
      subscribe,
      buyPack,
      cancelSubscription,
    ]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
