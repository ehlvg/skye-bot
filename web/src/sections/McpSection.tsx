import { useState, useEffect } from "react";
import { api, type McpServer } from "../api";
import { SectionHeader, Field } from "./ConfigSection";

type ServerForm = {
  name: string;
  type: "http" | "stdio";
  url: string;
  headers: string;
  command: string;
  args: string;
  env: string;
};

const emptyForm: ServerForm = {
  name: "",
  type: "http",
  url: "",
  headers: "",
  command: "",
  args: "",
  env: "",
};

function formToConfig(form: ServerForm): McpServer["config"] {
  if (form.type === "http") {
    const config: McpServer["config"] = { type: "http", url: form.url };
    if (form.headers.trim()) {
      try {
        config.headers = JSON.parse(form.headers);
      } catch {
        // ignore
      }
    }
    return config;
  }
  const config: McpServer["config"] = { type: "stdio", command: form.command };
  if (form.args.trim()) {
    try {
      config.args = JSON.parse(form.args);
    } catch {
      config.args = form.args.split(/\s+/).filter(Boolean);
    }
  }
  if (form.env.trim()) {
    try {
      config.env = JSON.parse(form.env);
    } catch {
      // ignore
    }
  }
  return config;
}

function configToForm(config: McpServer["config"]): ServerForm {
  return {
    name: "",
    type: config.type ?? (config.url ? "http" : "stdio"),
    url: config.url ?? "",
    headers: config.headers ? JSON.stringify(config.headers, null, 2) : "",
    command: config.command ?? "",
    args: config.args ? JSON.stringify(config.args) : "",
    env: config.env ? JSON.stringify(config.env, null, 2) : "",
  };
}

export function McpSection() {
  const [servers, setServers] = useState<McpServer[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<ServerForm>(emptyForm);
  const [saving, setSaving] = useState(false);

  const load = () => {
    api.getMcpServers().then(setServers).finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const openAdd = () => {
    setForm(emptyForm);
    setEditingId(null);
    setShowForm(true);
  };

  const openEdit = (server: McpServer) => {
    const form = configToForm(server.config);
    setForm({ ...form, name: server.name });
    setEditingId(server.id);
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      window.Telegram.WebApp.showAlert("Server name is required");
      return;
    }
    setSaving(true);
    try {
      const config = formToConfig(form);
      if (editingId) {
        await api.updateMcpServer(editingId, form.name, config);
      } else {
        await api.addMcpServer(form.name, config);
      }
      setShowForm(false);
      setForm(emptyForm);
      setEditingId(null);
      window.Telegram.WebApp.HapticFeedback.notificationOccurred("success");
      load();
    } catch (e) {
      window.Telegram.WebApp.showAlert(`Failed: ${e}`);
      window.Telegram.WebApp.HapticFeedback.notificationOccurred("error");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (server: McpServer) => {
    window.Telegram.WebApp.showConfirm(`Delete "${server.name}"?`, async (ok) => {
      if (!ok) return;
      try {
        await api.deleteMcpServer(server.id);
        window.Telegram.WebApp.HapticFeedback.notificationOccurred("success");
        load();
      } catch (e) {
        window.Telegram.WebApp.showAlert(`Failed: ${e}`);
      }
    });
  };

  if (loading) return <div className="py-8 text-center text-tg-hint">Loading...</div>;

  if (showForm) {
    return (
      <div className="space-y-4">
        <SectionHeader
          title={editingId ? "Edit Server" : "Add MCP Server"}
          subtitle={editingId ? "Update server configuration" : "Connect a new MCP server"}
        />

        <Field label="Name">
          <input
            type="text"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="my-server"
            className="w-full rounded-lg bg-tg-secondary-bg px-3 py-2.5 text-sm text-tg-text outline-none placeholder:text-tg-hint focus:ring-1 focus:ring-tg-accent"
          />
        </Field>

        <div className="flex gap-2">
          {(["http", "stdio"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setForm((f) => ({ ...f, type: t }))}
              className={`flex-1 rounded-lg py-2 text-sm font-medium transition-colors ${
                form.type === t
                  ? "bg-tg-button text-tg-button-text"
                  : "bg-tg-secondary-bg text-tg-hint"
              }`}
            >
              {t === "http" ? "HTTP" : "Stdio"}
            </button>
          ))}
        </div>

        {form.type === "http" ? (
          <>
            <Field label="URL">
              <input
                type="url"
                value={form.url}
                onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
                placeholder="https://example.com/mcp"
                className="w-full rounded-lg bg-tg-secondary-bg px-3 py-2.5 text-sm text-tg-text outline-none placeholder:text-tg-hint focus:ring-1 focus:ring-tg-accent"
              />
            </Field>
            <Field label="Headers (JSON)" hint='e.g. {"Authorization": "Bearer ..."}'>
              <textarea
                value={form.headers}
                onChange={(e) => setForm((f) => ({ ...f, headers: e.target.value }))}
                placeholder='{"Authorization": "Bearer token"}'
                rows={3}
                className="w-full rounded-lg bg-tg-secondary-bg px-3 py-2.5 font-mono text-xs text-tg-text outline-none placeholder:text-tg-hint focus:ring-1 focus:ring-tg-accent"
              />
            </Field>
          </>
        ) : (
          <>
            <Field label="Command">
              <input
                type="text"
                value={form.command}
                onChange={(e) => setForm((f) => ({ ...f, command: e.target.value }))}
                placeholder="npx"
                className="w-full rounded-lg bg-tg-secondary-bg px-3 py-2.5 text-sm text-tg-text outline-none placeholder:text-tg-hint focus:ring-1 focus:ring-tg-accent"
              />
            </Field>
            <Field label="Args (JSON array or space-separated)">
              <input
                type="text"
                value={form.args}
                onChange={(e) => setForm((f) => ({ ...f, args: e.target.value }))}
                placeholder='["-y", "my-mcp-server"]'
                className="w-full rounded-lg bg-tg-secondary-bg px-3 py-2.5 font-mono text-xs text-tg-text outline-none placeholder:text-tg-hint focus:ring-1 focus:ring-tg-accent"
              />
            </Field>
            <Field label="Environment (JSON)" hint="Additional env vars">
              <textarea
                value={form.env}
                onChange={(e) => setForm((f) => ({ ...f, env: e.target.value }))}
                placeholder='{"API_KEY": "..."}'
                rows={3}
                className="w-full rounded-lg bg-tg-secondary-bg px-3 py-2.5 font-mono text-xs text-tg-text outline-none placeholder:text-tg-hint focus:ring-1 focus:ring-tg-accent"
              />
            </Field>
          </>
        )}

        <div className="flex gap-2">
          <button
            onClick={() => {
              setShowForm(false);
              setEditingId(null);
            }}
            className="flex-1 rounded-lg bg-tg-secondary-bg py-2.5 text-sm font-medium text-tg-text"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 rounded-lg bg-tg-button py-2.5 text-sm font-medium text-tg-button-text disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <SectionHeader title="MCP Servers" subtitle={`${servers.length} server(s) configured`} />
        <button
          onClick={openAdd}
          className="rounded-lg bg-tg-button px-3 py-1.5 text-xs font-medium text-tg-button-text"
        >
          + Add
        </button>
      </div>

      {servers.length === 0 ? (
        <div className="rounded-lg bg-tg-section-bg p-6 text-center text-sm text-tg-hint">
          No MCP servers configured. Add one to extend the bot with external tools.
        </div>
      ) : (
        <div className="space-y-2">
          {servers.map((server) => (
            <div
              key={server.id}
              className="rounded-lg bg-tg-section-bg p-3"
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-tg-text">{server.name}</span>
                    <span
                      className={`inline-block h-2 w-2 rounded-full ${
                        server.connected ? "bg-green-500" : "bg-red-400"
                      }`}
                    />
                  </div>
                  <div className="mt-0.5 text-xs text-tg-hint">
                    {server.config.type === "http" || server.config.url
                      ? `HTTP: ${server.config.url}`
                      : `Stdio: ${server.config.command}`}
                    {server.toolCount != null && ` · ${server.toolCount} tools`}
                  </div>
                </div>
                <div className="flex gap-1">
                  <button
                    onClick={() => openEdit(server)}
                    className="rounded px-2 py-1 text-xs text-tg-link"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleDelete(server)}
                    className="rounded px-2 py-1 text-xs text-tg-destructive"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
