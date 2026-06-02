import { useState, useEffect } from "react";
import { Stack, Box, Button, Input, Text, Heading } from "@chakra-ui/react";
import { Field } from "@chakra-ui/react";
import { Slider } from "@chakra-ui/react";
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
          API Configuration
        </Heading>
        <Text fontSize="sm" color="fg.muted" mb={4}>
          Override default model and provider settings
        </Text>

        <Stack gap={4}>
          <Field.Root>
            <Field.Label>API Key</Field.Label>
            <Input
              type="password"
              value={config.apiKey ?? ""}
              onChange={(e) =>
                update({ apiKey: e.target.value || undefined })
              }
              placeholder="sk-..."
              rounded="lg"
            />
            <Field.HelperText>
              Your OpenAI-compatible API key
            </Field.HelperText>
          </Field.Root>

          <Field.Root>
            <Field.Label>Base URL</Field.Label>
            <Input
              type="url"
              value={config.baseUrl ?? ""}
              onChange={(e) =>
                update({ baseUrl: e.target.value || undefined })
              }
              placeholder="https://openrouter.ai/api/v1"
              rounded="lg"
            />
            <Field.HelperText>API endpoint (default: OpenRouter)</Field.HelperText>
          </Field.Root>

          <Field.Root>
            <Field.Label>Model</Field.Label>
            <Input
              value={config.model ?? ""}
              onChange={(e) =>
                update({ model: e.target.value || undefined })
              }
              placeholder="openai/gpt-oss-120b"
              rounded="lg"
            />
            <Field.HelperText>Model ID (e.g. openai/gpt-oss-120b)</Field.HelperText>
          </Field.Root>

          <Field.Root>
            <Field.Label>Max Tokens</Field.Label>
            <Slider.Root
              w="full"
              min={100}
              max={4096}
              step={100}
              value={[config.maxTokens ?? 500]}
              onValueChange={(details) =>
                update({ maxTokens: details.value[0] })
              }
            >
              <Slider.Control w="full">
                <Slider.Track bg="bg.subtle" rounded="full" h={2}>
                  <Slider.Range bg="accent.default" rounded="full" />
                </Slider.Track>
                <Slider.Thumb
                  index={0}
                  boxSize={5}
                  bg="accent.default"
                  borderWidth={2}
                  borderColor="bg.default"
                  rounded="full"
                  shadow="md"
                />
              </Slider.Control>
            </Slider.Root>
            <Text fontSize="sm" color="fg.muted" textAlign="right" mt={1}>
              {config.maxTokens ?? 500}
            </Text>
          </Field.Root>
        </Stack>
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
