import { useEffect } from "react";
import { AppProvider, useApp } from "./store";
import { TabBar, type TabKey } from "./components/TabBar";
import { ProfileScreen } from "./screens/ProfileScreen";
import { ToolsScreen } from "./screens/ToolsScreen";
import { MemoryScreen } from "./screens/MemoryScreen";
import { PlusScreen } from "./screens/PlusScreen";
import { StatsScreen } from "./screens/StatsScreen";
import { McpEditor } from "./screens/McpEditor";
import { Spinner } from "./components/ui";
import { AboutSheet } from "./screens/AboutSheet";
import { AdminSheet } from "./screens/AdminSheet";
import {
  applyScheme,
  colorScheme,
  onThemeChanged,
  syncTelegramChrome,
  useBackButton,
} from "./lib/telegram";

function Screen() {
  const { tab } = useApp();
  switch (tab) {
    case "profile":
      return <ProfileScreen />;
    case "tools":
      return <ToolsScreen />;
    case "memory":
      return <MemoryScreen />;
    case "plus":
      return <PlusScreen />;
    case "stats":
      return <StatsScreen />;
  }
}

function Shell() {
  const {
    loading,
    error,
    tab,
    setTab,
    editor,
    closeMcpEditor,
    aboutOpen,
    closeAbout,
    adminOpen,
    closeAdmin,
    billing,
  } = useApp();

  // Re-apply theme + chrome whenever Telegram pushes a theme change.
  useEffect(() => {
    applyScheme();
    syncTelegramChrome();
    return onThemeChanged(() => {
      applyScheme();
      syncTelegramChrome();
    });
  }, []);

  // Telegram back button closes the MCP editor when it's open.
  useEffect(() => {
    if (adminOpen) return useBackButton(closeAdmin);
    if (aboutOpen) return useBackButton(closeAbout);
    if (editor.open) return useBackButton(closeMcpEditor);
  }, [adminOpen, closeAdmin, aboutOpen, closeAbout, editor.open, closeMcpEditor]);

  if (loading) {
    return (
      <div className="splash">
        <Spinner large />
        <div className="splash-name">Skye</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="splash">
        <div className="splash-name">Couldn't load</div>
        <p style={{ color: "var(--hint)", maxWidth: 320, textAlign: "center" }}>{error}</p>
      </div>
    );
  }

  return (
    <div className="app">
      <div className="safe-top" />
      <main className="scroll" key={tab}>
        <Screen />
      </main>
      <TabBar active={tab as TabKey} onChange={setTab} billingEnabled={billing.plans?.enabled ?? false} />
      <McpEditor />
      <AboutSheet />
      <AdminSheet />
    </div>
  );
}

export function App() {
  // Reflect the current scheme before first paint to avoid a flash.
  useEffect(() => {
    document.documentElement.setAttribute("data-color-scheme", colorScheme());
  }, []);

  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  );
}
