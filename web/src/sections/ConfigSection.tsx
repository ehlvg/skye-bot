import { useState, useEffect } from "react";
import { api, type UserConfig } from "../api";

export function ConfigSection() {
  const [config, setConfig] = useState<UserConfig>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    api.getConfig().then(setConfig).finally(() => setLoading(false));
  }, []);

  const update = (patch: Partial<UserConfig>) => {
    setConfig((c) => ({ ...c, ...patch }));
    setDirty(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      const updated = await api.updateConfig(config);
      setConfig(updated);
      setDirty(false);
      window.Telegram.WebApp.HapticFeedback.notificationOccurred("success");
    } catch (e) {
      window.Telegram.WebApp.showAlert(`Failed to save: ${e}`);
      window.Telegram.WebApp.HapticFeedback.notificationOccurred("error");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="py-8 text-center text-tg-hint">Loading...</div>;

  return (
    <div className="space-y-6">
      <SectionHeader title="API Configuration" subtitle="Override default model and provider settings" />

      <Field label="API Key" hint="Your OpenAI-compatible API key">
        <input
          type="password"
          value={config.apiKey ?? ""}
          onChange={(e) => update({ apiKey: e.target.value || undefined })}
          placeholder="sk-..."
          className="w-full rounded-lg bg-tg-secondary-bg px-3 py-2.5 text-sm text-tg-text outline-none placeholder:text-tg-hint focus:ring-1 focus:ring-tg-accent"
        />
      </Field>

      <Field label="Base URL" hint="API endpoint (default: OpenRouter)">
        <input
          type="url"
          value={config.baseUrl ?? ""}
          onChange={(e) => update({ baseUrl: e.target.value || undefined })}
          placeholder="https://openrouter.ai/api/v1"
          className="w-full rounded-lg bg-tg-secondary-bg px-3 py-2.5 text-sm text-tg-text outline-none placeholder:text-tg-hint focus:ring-1 focus:ring-tg-accent"
        />
      </Field>

      <Field label="Model" hint="Model ID (e.g. openai/gpt-oss-120b)">
        <input
          type="text"
          value={config.model ?? ""}
          onChange={(e) => update({ model: e.target.value || undefined })}
          placeholder="openai/gpt-oss-120b"
          className="w-full rounded-lg bg-tg-secondary-bg px-3 py-2.5 text-sm text-tg-text outline-none placeholder:text-tg-hint focus:ring-1 focus:ring-tg-accent"
        />
      </Field>

      <Field label="Max Tokens" hint={`Current: ${config.maxTokens ?? 500}`}>
        <input
          type="range"
          min={100}
          max={4096}
          step={100}
          value={config.maxTokens ?? 500}
          onChange={(e) => update({ maxTokens: Number(e.target.value) })}
          className="w-full accent-tg-button"
        />
        <div className="mt-1 text-right text-xs text-tg-hint">{config.maxTokens ?? 500}</div>
      </Field>

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

export function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-2">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-tg-section-header">
        {title}
      </h2>
      {subtitle && <p className="mt-0.5 text-xs text-tg-subtitle">{subtitle}</p>}
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="block text-sm font-medium text-tg-text">{label}</label>
      {children}
      {hint && <p className="text-xs text-tg-hint">{hint}</p>}
    </div>
  );
}
