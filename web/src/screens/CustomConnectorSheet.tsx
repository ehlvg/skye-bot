import { useEffect, useState } from "react";
import { Button, CloseButton } from "../components/Button";
import { TextField } from "../components/Field";
import { Icon } from "../components/Icon";
import { Sheet } from "../components/Sheet";
import { Caption, Footnote } from "../components/ui";
import { useApp } from "../store";

interface HeaderRow {
  key: string;
  value: string;
  inputId: string;
}

function inputIdFor(header: string, index: number): string {
  const normalized = header
    .toUpperCase()
    .replace(/[^A-Z0-9_]/g, "_")
    .replace(/^([^A-Z_])/, "_$1");
  return `HEADER_${normalized || index + 1}_${index + 1}`.slice(0, 64);
}

function existingHeaders(config: Record<string, unknown> | undefined): HeaderRow[] {
  const source = config?.headers;
  if (!source || typeof source !== "object" || Array.isArray(source)) return [];
  return Object.entries(source as Record<string, unknown>).map(([key, raw], index) => {
    const value = String(raw ?? "");
    const match = value.match(/^\$\{input:([A-Za-z_][A-Za-z0-9_]{0,63})\}$/);
    return { key, value: "", inputId: match?.[1] ?? inputIdFor(key, index) };
  });
}

export function CustomConnectorSheet() {
  const { editor, closeCustomConnector, saveCustomConnector, deleteCustomConnector } = useApp();
  const editing = editor.connector;
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [headers, setHeaders] = useState<HeaderRow[]>([]);
  const [acknowledged, setAcknowledged] = useState(false);

  useEffect(() => {
    if (!editor.open) return;
    setName(editing?.name ?? "");
    setUrl(String(editing?.config.url ?? ""));
    setHeaders(existingHeaders(editing?.config));
    setAcknowledged(false);
  }, [editor.open, editing]);

  const save = () => {
    const cleanHeaders: Record<string, string> = {};
    const inputs: Record<string, string> = {};
    headers.forEach((header, index) => {
      const key = header.key.trim();
      if (!key) return;
      const inputId = header.inputId || inputIdFor(key, index);
      cleanHeaders[key] = `\${input:${inputId}}`;
      if (header.value) inputs[inputId] = header.value;
    });
    void saveCustomConnector(
      editing?.id ?? null,
      name.trim(),
      {
        type: "http",
        url: url.trim(),
        ...(Object.keys(cleanHeaders).length ? { headers: cleanHeaders } : {}),
      },
      inputs
    );
  };

  const valid = name.trim().length > 0 && url.trim().startsWith("https://") && acknowledged;

  return (
    <Sheet
      open={editor.open}
      onClose={closeCustomConnector}
      title={editing ? "Custom connector" : "New custom connector"}
      headerRight={<CloseButton onClick={closeCustomConnector} />}
    >
      <div className="connector-warning">
        <Icon.Warning />
        <div>
          <strong>Only connect services you trust</strong>
          <p>
            This endpoint can see data sent to its tools and can return malicious or misleading
            content.
          </p>
        </div>
      </div>

      <div className="section custom-connector-form">
        <Caption>Connection</Caption>
        <div className="list glass">
          <TextField value={name} onChange={setName} placeholder="My connector" left="Name" />
          <TextField
            value={url}
            onChange={setUrl}
            placeholder="https://connector.example.com/mcp"
            left="URL"
            mono
          />
        </div>
        <Footnote>
          HTTPS is required. Local, private-network, and redirected endpoints are rejected.
        </Footnote>

        <Caption>Secret headers</Caption>
        <div className="connector-headers glass">
          {headers.map((header, index) => (
            <div className="connector-header-row" key={`${header.inputId}-${index}`}>
              <input
                value={header.key}
                placeholder="Authorization"
                aria-label="Header name"
                onChange={(event) =>
                  setHeaders((current) =>
                    current.map((item, itemIndex) =>
                      itemIndex === index ? { ...item, key: event.target.value } : item
                    )
                  )
                }
              />
              <input
                type="password"
                value={header.value}
                placeholder={editing ? "Leave blank to keep" : "Secret value"}
                aria-label="Header secret"
                autoComplete="off"
                onChange={(event) =>
                  setHeaders((current) =>
                    current.map((item, itemIndex) =>
                      itemIndex === index ? { ...item, value: event.target.value } : item
                    )
                  )
                }
              />
              <button
                type="button"
                className="connector-header-remove"
                aria-label="Remove header"
                onClick={() =>
                  setHeaders((current) => current.filter((_, itemIndex) => itemIndex !== index))
                }
              >
                <Icon.Trash />
              </button>
            </div>
          ))}
          <button
            type="button"
            className="connector-header-add"
            onClick={() =>
              setHeaders((current) => [
                ...current,
                { key: "", value: "", inputId: inputIdFor("", current.length) },
              ])
            }
          >
            <Icon.Plus /> Add header
          </button>
        </div>

        <label className="connector-consent glass">
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(event) => setAcknowledged(event.target.checked)}
          />
          <span>
            I trust this operator and understand that Skye cannot verify how it handles my data.
          </span>
        </label>
      </div>

      <div className="sheet-actions">
        <Button icon={<Icon.Check />} disabled={!valid} onClick={save}>
          Save connector
        </Button>
        {editing && (
          <Button
            variant="destructive"
            icon={<Icon.Trash />}
            onClick={() => void deleteCustomConnector(editing.id)}
          >
            Delete connector
          </Button>
        )}
      </div>
    </Sheet>
  );
}
