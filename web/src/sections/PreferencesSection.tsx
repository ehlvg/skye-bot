import { useState, useEffect } from "react";
import { api, type UserConfig, type ChatConfig } from "../api";
import { SectionHeader, Field } from "./ConfigSection";

export function PreferencesSection() {
  const [config, setConfig] = useState<UserConfig>({});
  const [chatConfig, setChatConfig] = useState<ChatConfig>({ fastMode: false, voiceMode: false });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    Promise.all([api.getConfig(), api.getChatConfig()])
      .then(([cfg, chatCfg]) => {
        setConfig(cfg);
        setChatConfig(chatCfg);
      })
      .finally(() => setLoading(false));
  }, []);

  const updateConfig = (patch: Partial<UserConfig>) => {
    setConfig((c) => ({ ...c, ...patch }));
    setDirty(true);
  };

  const toggleChat = async (key: "fastMode" | "voiceMode") => {
    const next = { [key]: !chatConfig[key] };
    setChatConfig((c) => ({ ...c, ...next }));
    try {
      const updated = await api.updateChatConfig(next);
      setChatConfig(updated);
      window.Telegram.WebApp.HapticFeedback.selectionChanged();
    } catch (e) {
      window.Telegram.WebApp.showAlert(`Failed: ${e}`);
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      const updated = await api.updateConfig(config);
      setConfig(updated);
      setDirty(false);
      window.Telegram.WebApp.HapticFeedback.notificationOccurred("success");
    } catch (e) {
      window.Telegram.WebApp.showAlert(`Failed: ${e}`);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="py-8 text-center text-tg-hint">Loading...</div>;

  return (
    <div className="space-y-6">
      <SectionHeader title="Chat Toggles" subtitle="Per-chat behavior settings" />

      <Toggle
        label="Fast Mode"
        description="Use local Ollama for ultra-low latency responses"
        checked={chatConfig.fastMode}
        onChange={() => toggleChat("fastMode")}
      />

      <Toggle
        label="Voice Mode"
        description="Send responses as voice notes via ElevenLabs TTS"
        checked={chatConfig.voiceMode}
        onChange={() => toggleChat("voiceMode")}
      />

      <div className="border-t border-tg-section-separator pt-6">
        <SectionHeader title="System Prompt" subtitle="Customize the bot's personality" />

        <Field label="Custom Instructions" hint="Append to the default system prompt">
          <textarea
            value={config.systemPrompt ?? ""}
            onChange={(e) => updateConfig({ systemPrompt: e.target.value || undefined })}
            placeholder="e.g. Always respond in Spanish. Be more formal."
            rows={5}
            className="w-full rounded-lg bg-tg-secondary-bg px-3 py-2.5 text-sm text-tg-text outline-none placeholder:text-tg-hint focus:ring-1 focus:ring-tg-accent"
          />
        </Field>
      </div>

      {dirty && (
        <button
          onClick={save}
          disabled={saving}
          className="w-full rounded-lg bg-tg-button py-3 text-sm font-medium text-tg-button-text transition-opacity disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save Changes"}
        </button>
      )}
    </div>
  );
}

function Toggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <div className="flex items-center justify-between rounded-lg bg-tg-section-bg p-3">
      <div>
        <div className="text-sm font-medium text-tg-text">{label}</div>
        <div className="mt-0.5 text-xs text-tg-hint">{description}</div>
      </div>
      <button
        onClick={onChange}
        className={`relative h-7 w-12 rounded-full transition-colors ${
          checked ? "bg-tg-button" : "bg-tg-secondary-bg"
        }`}
      >
        <span
          className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform ${
            checked ? "translate-x-5.5" : "translate-x-0.5"
          }`}
        />
      </button>
    </div>
  );
}
