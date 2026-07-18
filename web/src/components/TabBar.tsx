import { TabIcon } from "./Icon";
import { haptic } from "../lib/telegram";

export type TabKey = "profile" | "tools" | "memory" | "plus" | "stats";

const TABS: { key: TabKey; label: string }[] = [
  { key: "profile", label: "Profile" },
  { key: "tools", label: "Connectors" },
  { key: "memory", label: "Memory" },
  { key: "plus", label: "Plus" },
  { key: "stats", label: "Usage" },
];

export function TabBar({
  active,
  onChange,
  billingEnabled,
}: {
  active: TabKey;
  onChange: (t: TabKey) => void;
  billingEnabled: boolean;
}) {
  const tabs = TABS.map((tab) =>
    tab.key === "plus" && !billingEnabled ? { ...tab, label: "Models" } : tab
  );
  return (
    <nav className="tabbar" style={{ gridTemplateColumns: `repeat(${tabs.length}, 1fr)` }}>
      {tabs.map((t) => {
        const isActive = active === t.key;
        const { on, off } = TabIcon[t.key];
        const I = isActive ? on : off;
        return (
          <button
            key={t.key}
            type="button"
            className={`tab${isActive ? " is-active" : ""}`}
            onClick={() => {
              if (isActive) return;
              haptic.selection();
              onChange(t.key);
            }}
          >
            <span className="tab-pill" />
            <span className="tab-icon">
              <I />
            </span>
            <span className="tab-label">{t.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
