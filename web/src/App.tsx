import { useState, useEffect } from "react";
import { ConfigSection } from "./sections/ConfigSection";
import { McpSection } from "./sections/McpSection";
import { PreferencesSection } from "./sections/PreferencesSection";
import { MemorySection } from "./sections/MemorySection";
import { StatsSection } from "./sections/StatsSection";

type Tab = "config" | "mcp" | "prefs" | "memory" | "stats";

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: "config", label: "API", icon: "🔑" },
  { id: "mcp", label: "MCP", icon: "🔌" },
  { id: "prefs", label: "Prefs", icon: "⚙️" },
  { id: "memory", label: "Memory", icon: "🧠" },
  { id: "stats", label: "Stats", icon: "📊" },
];

export function App() {
  const [tab, setTab] = useState<Tab>("config");

  useEffect(() => {
    const handler = () => {
      const tg = window.Telegram.WebApp;
      if (tg.colorScheme === "dark") {
        document.documentElement.classList.add("dark");
      }
    };
    handler();
    window.Telegram.WebApp.onEvent("themeChanged", handler);
    return () => window.Telegram.WebApp.offEvent("themeChanged", handler);
  }, []);

  return (
    <div className="min-h-screen bg-tg-bg">
      <nav className="sticky top-0 z-10 flex border-b border-tg-section-separator bg-tg-bg">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => {
              setTab(t.id);
              window.Telegram.WebApp.HapticFeedback.selectionChanged();
            }}
            className={`flex-1 py-3 text-center text-xs font-medium transition-colors ${
              tab === t.id
                ? "text-tg-accent border-b-2 border-tg-accent"
                : "text-tg-hint"
            }`}
          >
            <span className="block text-base">{t.icon}</span>
            {t.label}
          </button>
        ))}
      </nav>

      <main className="p-4 pb-20">
        {tab === "config" && <ConfigSection />}
        {tab === "mcp" && <McpSection />}
        {tab === "prefs" && <PreferencesSection />}
        {tab === "memory" && <MemorySection />}
        {tab === "stats" && <StatsSection />}
      </main>
    </div>
  );
}
