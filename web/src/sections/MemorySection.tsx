import { useState, useEffect } from "react";
import { Stack, Box, Button, Text, Heading, Card, HStack } from "@chakra-ui/react";
import { api, type MemoryEntry } from "../api";

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

  if (loading) {
    return (
      <Stack gap={4}>
        <Text color="fg.muted">Loading...</Text>
      </Stack>
    );
  }

  return (
    <Stack gap={6}>
      <Box>
        <Heading size="sm" mb={1}>
          Saved Memories
        </Heading>
        <Text fontSize="sm" color="fg.muted">
          {memories.length} memories across all chats
        </Text>
      </Box>

      <Stack gap={3}>
        {memories.length === 0 ? (
          <Text color="fg.muted">
            No memories saved yet. The bot automatically saves important
            information during conversations.
          </Text>
        ) : (
          memories.map((m) => (
            <Card.Root key={m.id} variant="outline">
              <Card.Body p={3}>
                <HStack justify="space-between" align="start" gap={3}>
                  <Stack gap={1} flex={1}>
                    <Text fontSize="sm" lineHeight="short">
                      {m.content}
                    </Text>
                    <Text fontSize="xs" color="fg.muted">
                      {new Date(m.createdAt).toLocaleDateString()} · {m.id}
                    </Text>
                  </Stack>
                  <Button
                    size="xs"
                    variant="outline"
                    colorPalette="red"
                    onClick={() => {
                      const chatId = Number(m.id.split("_")[0]) || 0;
                      handleDelete(chatId, m.id);
                    }}
                  >
                    Delete
                  </Button>
                </HStack>
              </Card.Body>
            </Card.Root>
          ))
        )}
      </Stack>
    </Stack>
  );
}
