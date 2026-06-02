import { useState, useEffect } from "react";
import { api, type MemoryEntry } from "../api";
import { SectionHeader } from "./ConfigSection";

export function MemorySection() {
  const [memories, setMemories] = useState<MemoryEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const load = () => {
    api.getMemories().then(setMemories).finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const handleDelete = (chatId: number, id: string) => {
    window.Telegram.WebApp.showConfirm("Delete this memory?", async (ok) => {
      if (!ok) return;
      try {
        await api.deleteMemory(chatId, id);
        window.Telegram.WebApp.HapticFeedback.notificationOccurred("success");
        load();
      } catch (e) {
        window.Telegram.WebApp.showAlert(`Failed: ${e}`);
      }
    });
  };

  if (loading) return <div className="py-8 text-center text-tg-hint">Loading...</div>;

  return (
    <div className="space-y-4">
      <SectionHeader title="Saved Memories" subtitle={`${memories.length} memories across all chats`} />

      {memories.length === 0 ? (
        <div className="rounded-lg bg-tg-section-bg p-6 text-center text-sm text-tg-hint">
          No memories saved yet. The bot automatically saves important information during conversations.
        </div>
      ) : (
        <div className="space-y-2">
          {memories.map((m) => (
            <div key={m.id} className="rounded-lg bg-tg-section-bg p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-tg-text">{m.content}</p>
                  <p className="mt-1 text-xs text-tg-hint">
                    {new Date(m.createdAt).toLocaleDateString()} · {m.id}
                  </p>
                </div>
                <button
                  onClick={() => {
                    const chatId = Number(m.id.split("_")[0]) || 0;
                    handleDelete(chatId, m.id);
                  }}
                  className="shrink-0 rounded px-2 py-1 text-xs text-tg-destructive"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
