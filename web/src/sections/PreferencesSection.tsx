import { useState, useEffect } from "react";
import { Stack, HStack, Box, Button, Text, Heading, Switch, Textarea } from "@chakra-ui/react";
import { Field } from "@chakra-ui/react";
import { api, type UserConfig, type ChatConfig } from "../api";

export function PreferencesSection() {
  const [config, setConfig] = useState<UserConfig>({});
  const [chatConfig, setChatConfig] = useState<ChatConfig>({
    fastMode: false,
    voiceMode: false,
  });
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

  if (loading) {
    return (
      <Stack gap={4}>
        <Text color="fg.muted">Loading...</Text>
      </Stack>
    );
  }

  return (
    <Stack gap={5}>
      <Box bg="bg.default" rounded="2xl" p={4}>
        <Heading size="sm" mb={1}>
          Chat Toggles
        </Heading>
        <Text fontSize="sm" color="fg.muted" mb={4}>
          Per-chat behavior settings
        </Text>

        <Stack gap={4}>
          <HStack justify="space-between" align="start">
            <Stack gap={0.5} flex={1}>
              <Text fontWeight="medium">Fast Mode</Text>
              <Text fontSize="sm" color="fg.muted">
                Use local Ollama for ultra-low latency responses
              </Text>
            </Stack>
            <Switch.Root
              checked={chatConfig.fastMode}
              onCheckedChange={() => toggleChat("fastMode")}
            >
              <Switch.HiddenInput />
              <Switch.Control>
                <Switch.Thumb />
              </Switch.Control>
            </Switch.Root>
          </HStack>

          <HStack justify="space-between" align="start">
            <Stack gap={0.5} flex={1}>
              <Text fontWeight="medium">Voice Mode</Text>
              <Text fontSize="sm" color="fg.muted">
                Send responses as voice notes via ElevenLabs TTS
              </Text>
            </Stack>
            <Switch.Root
              checked={chatConfig.voiceMode}
              onCheckedChange={() => toggleChat("voiceMode")}
            >
              <Switch.HiddenInput />
              <Switch.Control>
                <Switch.Thumb />
              </Switch.Control>
            </Switch.Root>
          </HStack>
        </Stack>
      </Box>

      <Box bg="bg.default" rounded="2xl" p={4}>
        <Heading size="sm" mb={1}>
          System Prompt
        </Heading>
        <Text fontSize="sm" color="fg.muted" mb={4}>
          Customize the bot's personality
        </Text>

        <Field.Root>
          <Field.Label>Custom Instructions</Field.Label>
          <Textarea
            value={config.systemPrompt ?? ""}
            onChange={(e) =>
              updateConfig({ systemPrompt: e.target.value || undefined })
            }
            placeholder="e.g. Always respond in Spanish. Be more formal."
            rows={5}
            rounded="lg"
          />
          <Field.HelperText>
            Append to the default system prompt
          </Field.HelperText>
        </Field.Root>
      </Box>

      {dirty && (
        <Button
          bg="accent.default"
          color="accent.fg"
          rounded="xl"
          size="lg"
          onClick={save}
          disabled={saving}
          loading={saving}
          _hover={{ opacity: 0.9 }}
          _active={{ opacity: 0.8 }}
        >
          {saving ? "Saving..." : "Save Changes"}
        </Button>
      )}
    </Stack>
  );
}
