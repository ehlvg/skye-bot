import { useMemo, useRef, useState } from "react";
import { useApp } from "../store";
import { api } from "../lib/api";
import { alertDialog } from "../lib/telegram";
import { Caption, Footnote, LargeTitle, Section, EmptyState } from "../components/ui";
import { List } from "../components/Row";
import { Row } from "../components/Row";
import { Icon } from "../components/Icon";
import { formatDate } from "../lib/format";

export function MemoryScreen() {
  const { memories, deleteMemory } = useApp();
  const importRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const grouped = useMemo(() => {
    const map = new Map<number, typeof memories>();
    for (const m of memories) {
      const arr = map.get(m.chatId) ?? [];
      arr.push(m);
      map.set(m.chatId, arr);
    }
    return [...map.entries()];
  }, [memories]);

  async function exportAll() {
    setBusy(true);
    try {
      const data = await api.exportMemories();
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = "skye-memory-export.json";
      link.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      alertDialog(`Export failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function importFile(file: File) {
    setBusy(true);
    try {
      const parsed = JSON.parse(await file.text()) as { memories?: Array<Record<string, unknown>> };
      if (!Array.isArray(parsed.memories) || parsed.memories.length === 0) {
        throw new Error("The file does not contain any memories");
      }
      const groups = new Map<number, Record<string, unknown>[]>();
      for (const memory of parsed.memories ?? []) {
        const chatId = Number(memory.chatId);
        if (!Number.isSafeInteger(chatId)) continue;
        const list = groups.get(chatId) ?? [];
        list.push({ content: memory.content, category: memory.category, expiresAt: memory.expiresAt });
        groups.set(chatId, list);
      }
      if (groups.size === 0) throw new Error("The export contains no authorized chats");
      for (const [chatId, records] of groups) await api.importMemories(chatId, records);
      window.location.reload();
    } catch (e) {
      alertDialog(`Import failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fade-in">
      <LargeTitle>Memory</LargeTitle>

      <Section>
        <div className="glass" style={{ display: "flex", gap: 8, padding: 12 }}>
          <button disabled={busy} onClick={() => void exportAll()}>Export memory</button>
          <button disabled={busy} onClick={() => importRef.current?.click()}>Import memory</button>
          <input ref={importRef} type="file" accept="application/json" hidden onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void importFile(file);
            e.target.value = "";
          }} />
        </div>
      </Section>

      {memories.length === 0 ? (
        <Section>
          <div className="glass">
            <EmptyState
              icon={Icon.Book}
              title="No memories yet"
              sub="Ask Skye to remember something during a chat and it will appear here."
            />
          </div>
        </Section>
      ) : (
        grouped.map(([chatId, items]) => (
          <Section key={chatId}>
            <Caption>Chat {chatId}</Caption>
            <List>
              {items.map((m) => (
                <Row
                  key={m.id}
                  icon={Icon.CircleStack}
                  color="c-orange"
                  title={m.content}
                  multiline
                  subtitle={`${m.category} · ${formatDate(m.createdAt)}${m.expiresAt ? ` · expires ${formatDate(m.expiresAt)}` : ""}`}
                  onClick={() => deleteMemory(m)}
                  chevron={false}
                  trailing={
                    <span className="chevron" style={{ color: "var(--destructive)", opacity: 0.7 }}>
                      <Icon.Trash />
                    </span>
                  }
                />
              ))}
            </List>
          </Section>
        ))
      )}

      {memories.length > 0 && (
        <Footnote>
          Tap a memory to delete it. Memories are scoped to a specific chat — clearing them only affects
          that chat's history.
        </Footnote>
      )}
    </div>
  );
}
