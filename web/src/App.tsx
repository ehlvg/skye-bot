import { useState, useEffect } from "react";
import { Box, Flex, Text } from "@chakra-ui/react";
import {
  LuKey,
  LuCpu,
  LuSlidersHorizontal,
  LuBrain,
  LuChartBar,
} from "react-icons/lu";
import { useColorMode } from "./components/ui/color-mode";
import { ConfigSection } from "./sections/ConfigSection";
import { McpSection } from "./sections/McpSection";
import { PreferencesSection } from "./sections/PreferencesSection";
import { MemorySection } from "./sections/MemorySection";
import { StatsSection } from "./sections/StatsSection";

type Tab = "config" | "mcp" | "prefs" | "memory" | "stats";

const tabs: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: "config", label: "API", icon: LuKey },
  { id: "mcp", label: "MCP", icon: LuCpu },
  { id: "prefs", label: "Prefs", icon: LuSlidersHorizontal },
  { id: "memory", label: "Memory", icon: LuBrain },
  { id: "stats", label: "Stats", icon: LuChartBar },
];

function TelegramThemeSync() {
  const { setColorMode } = useColorMode();

  useEffect(() => {
    const tg = window.Telegram.WebApp;
    const sync = () => {
      setColorMode(tg.colorScheme === "dark" ? "dark" : "light");
    };
    sync();
    tg.onEvent("themeChanged", sync);
    return () => tg.offEvent("themeChanged", sync);
  }, [setColorMode]);

  return null;
}

export function App() {
  const [tab, setTab] = useState<Tab>("config");

  return (
    <Box h="100dvh" display="flex" flexDirection="column" bg="bg.subtle">
      <TelegramThemeSync />
      <Box flex="1" overflowY="auto" p={4}>
        {tab === "config" && <ConfigSection />}
        {tab === "mcp" && <McpSection />}
        {tab === "prefs" && <PreferencesSection />}
        {tab === "memory" && <MemorySection />}
        {tab === "stats" && <StatsSection />}
      </Box>

      <Flex
        as="nav"
        borderTopWidth="1px"
        borderColor="border.subtle"
        bg="bg.default"
        px={2}
        py={1}
        justify="space-around"
        align="center"
        h="64px"
        flexShrink={0}
      >
        {tabs.map((t) => {
          const active = tab === t.id;
          return (
            <Flex
              key={t.id}
              direction="column"
              align="center"
              justify="center"
              gap={0.5}
              flex={1}
              cursor="pointer"
              onClick={() => setTab(t.id)}
              color={active ? "teal.500" : "fg.muted"}
              _hover={{ color: active ? "teal.500" : "fg.default" }}
            >
              <t.icon size={20} />
              <Text fontSize="xs" fontWeight={active ? "semibold" : "normal"}>
                {t.label}
              </Text>
            </Flex>
          );
        })}
      </Flex>
    </Box>
  );
}
