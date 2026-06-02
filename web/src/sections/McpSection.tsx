import { useState, useEffect } from "react";
import {
  Stack,
  Box,
  Button,
  Input,
  Text,
  Heading,
  Badge,
  HStack,
  Card,
  Textarea,
} from "@chakra-ui/react";
import { Field } from "@chakra-ui/react";
import { RadioGroup } from "@chakra-ui/react";
import { api, type McpServer } from "../api";

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
    const formData = configToForm(server.config);
    setForm({ ...formData, name: server.name });
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
    window.Telegram.WebApp.showConfirm(
      `Delete "${server.name}"?`,
      async (ok) => {
        if (!ok) return;
        try {
          await api.deleteMcpServer(server.id);
          window.Telegram.WebApp.HapticFeedback.notificationOccurred("success");
          load();
        } catch (e) {
          window.Telegram.WebApp.showAlert(`Failed: ${e}`);
        }
      }
    );
  };

  if (loading) {
    return (
      <Stack gap={4}>
        <Text color="fg.muted">Loading...</Text>
      </Stack>
    );
  }

  if (showForm) {
    return (
      <Stack gap={5}>
        <Heading size="sm">
          {editingId ? "Edit Server" : "Add MCP Server"}
        </Heading>

        <Box bg="bg.default" rounded="2xl" p={4}>
          <Stack gap={4}>
            <Field.Root>
              <Field.Label>Name</Field.Label>
              <Input
                value={form.name}
                onChange={(e) =>
                  setForm((f) => ({ ...f, name: e.target.value }))
                }
                placeholder="my-server"
                rounded="lg"
              />
            </Field.Root>

            <Box>
              <Text fontSize="sm" fontWeight="medium" mb={2}>
                Type
              </Text>
              <RadioGroup.Root
                value={form.type}
                onValueChange={(details) =>
                  setForm((f) => ({ ...f, type: details.value as "http" | "stdio" }))
                }
              >
                <HStack gap={4}>
                  <RadioGroup.Item value="http">
                    <RadioGroup.ItemHiddenInput />
                    <RadioGroup.ItemControl />
                    <RadioGroup.ItemText>HTTP</RadioGroup.ItemText>
                  </RadioGroup.Item>
                  <RadioGroup.Item value="stdio">
                    <RadioGroup.ItemHiddenInput />
                    <RadioGroup.ItemControl />
                    <RadioGroup.ItemText>Stdio</RadioGroup.ItemText>
                  </RadioGroup.Item>
                </HStack>
              </RadioGroup.Root>
            </Box>

            {form.type === "http" ? (
              <>
                <Field.Root>
                  <Field.Label>URL</Field.Label>
                  <Input
                    type="url"
                    value={form.url}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, url: e.target.value }))
                    }
                    placeholder="https://example.com/mcp"
                    rounded="lg"
                  />
                </Field.Root>
                <Field.Root>
                  <Field.Label>Headers (JSON)</Field.Label>
                  <Textarea
                    value={form.headers}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, headers: e.target.value }))
                    }
                    placeholder='{"Authorization": "Bearer token"}'
                    rows={3}
                    rounded="lg"
                  />
                  <Field.HelperText>
                    e.g. {"{"}"Authorization": "Bearer ..."{"}"}
                  </Field.HelperText>
                </Field.Root>
              </>
            ) : (
              <>
                <Field.Root>
                  <Field.Label>Command</Field.Label>
                  <Input
                    value={form.command}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, command: e.target.value }))
                    }
                    placeholder="npx"
                    rounded="lg"
                  />
                </Field.Root>
                <Field.Root>
                  <Field.Label>Args (JSON array or space-separated)</Field.Label>
                  <Input
                    value={form.args}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, args: e.target.value }))
                    }
                    placeholder='["-y", "my-mcp-server"]'
                    rounded="lg"
                  />
                </Field.Root>
                <Field.Root>
                  <Field.Label>Environment (JSON)</Field.Label>
                  <Textarea
                    value={form.env}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, env: e.target.value }))
                    }
                    placeholder='{"API_KEY": "..."}'
                    rows={3}
                    rounded="lg"
                  />
                  <Field.HelperText>Additional env vars</Field.HelperText>
                </Field.Root>
              </>
            )}
          </Stack>
        </Box>

        <HStack gap={3}>
          <Button
            variant="outline"
            flex={1}
            onClick={() => {
              setShowForm(false);
              setEditingId(null);
            }}
            rounded="xl"
          >
            Cancel
          </Button>
          <Button
            flex={1}
            onClick={handleSave}
            disabled={saving}
            loading={saving}
            rounded="xl"
            bg="accent.default"
            color="accent.fg"
            _hover={{ opacity: 0.9 }}
            _active={{ opacity: 0.8 }}
          >
            {saving ? "Saving..." : "Save"}
          </Button>
        </HStack>
      </Stack>
    );
  }

  return (
    <Stack gap={5}>
      <Box>
        <Heading size="sm" mb={1}>
          MCP Servers
        </Heading>
        <Text fontSize="sm" color="fg.muted">
          {servers.length} server(s) configured
        </Text>
      </Box>

      <Stack gap={3}>
        {servers.length === 0 ? (
          <Text color="fg.muted">
            No MCP servers configured. Add one to extend the bot with external
            tools.
          </Text>
        ) : (
          servers.map((server) => (
            <Card.Root
              key={server.id}
              rounded="xl"
              bg="bg.default"
            >
              <Card.Body p={4}>
                <HStack justify="space-between" align="start" gap={3}>
                  <Stack gap={1} flex={1}>
                    <HStack gap={2} align="center">
                      <Text fontWeight="semibold">{server.name}</Text>
                      <Badge
                        size="sm"
                        rounded="full"
                        px={2}
                        py={0.5}
                        bg={server.connected ? "green.500" : "red.500"}
                        color="white"
                      >
                        {server.connected ? "Connected" : "Disconnected"}
                      </Badge>
                    </HStack>
                    <Text fontSize="xs" color="fg.muted">
                      {server.config.type === "http" || server.config.url
                        ? `HTTP: ${server.config.url}`
                        : `Stdio: ${server.config.command}`}
                      {server.toolCount != null &&
                        ` · ${server.toolCount} tools`}
                    </Text>
                  </Stack>
                  <HStack gap={2}>
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() => openEdit(server)}
                      rounded="lg"
                      color="accent.default"
                    >
                      Edit
                    </Button>
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() => handleDelete(server)}
                      rounded="lg"
                      color="danger.default"
                    >
                      Delete
                    </Button>
                  </HStack>
                </HStack>
              </Card.Body>
            </Card.Root>
          ))
        )}
      </Stack>

      <Button
        bg="accent.default"
        color="accent.fg"
        rounded="xl"
        size="lg"
        onClick={openAdd}
        w="full"
        _hover={{ opacity: 0.9 }}
        _active={{ opacity: 0.8 }}
      >
        + Add Server
      </Button>
    </Stack>
  );
}
