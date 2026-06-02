import { useState, useEffect } from "react";
import { Stack, Box, Text, Heading, SimpleGrid, Card } from "@chakra-ui/react";
import { api, type UsageStats } from "../api";

export function StatsSection() {
  const [stats, setStats] = useState<UsageStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getUsageStats().then(setStats).finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <Stack gap={4}>
        <Text color="fg.muted">Loading...</Text>
      </Stack>
    );
  }

  if (!stats) {
    return (
      <Stack gap={4}>
        <Text color="fg.muted">No data available</Text>
      </Stack>
    );
  }

  const statItems = [
    { label: "Total Requests", value: stats.totalRequests.toLocaleString() },
    { label: "Today", value: stats.requestsToday.toLocaleString() },
    { label: "Avg Latency", value: `${Math.round(stats.avgLatencyMs)}ms` },
    {
      label: "Error Rate",
      value: `${(stats.errorRate * 100).toFixed(1)}%`,
      color: stats.errorRate > 0.1 ? "danger.default" : undefined,
    },
  ];

  return (
    <Stack gap={5}>
      <Box>
        <Heading size="sm" mb={1}>
          Usage Statistics
        </Heading>
        <Text fontSize="sm" color="fg.muted">
          Your request history
        </Text>
      </Box>

      <SimpleGrid columns={2} gap={3}>
        {statItems.map((item) => (
          <Card.Root
            key={item.label}
            rounded="xl"
            bg="bg.default"
          >
            <Card.Body p={4}>
              <Stack gap={1}>
                <Text fontSize="xs" color="fg.muted" fontWeight="medium">
                  {item.label}
                </Text>
                <Text
                  fontSize="xl"
                  fontWeight="bold"
                  color={item.color ?? "fg.default"}
                >
                  {item.value}
                </Text>
              </Stack>
            </Card.Body>
          </Card.Root>
        ))}
      </SimpleGrid>
    </Stack>
  );
}
