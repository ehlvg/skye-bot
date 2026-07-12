import { useEffect, useState } from "react";
import { useApp } from "../store";
import { Caption, Footnote, LargeTitle, Section } from "../components/ui";
import { List } from "../components/Row";
import { Row } from "../components/Row";
import { Icon } from "../components/Icon";
import { api, type Monitoring } from "../lib/api";

export function StatsScreen() {
  const { stats } = useApp();
  const [monitoring, setMonitoring] = useState<Monitoring | null>(null);

  useEffect(() => {
    void api.getMonitoring().then(setMonitoring).catch(() => setMonitoring(null));
  }, []);

  const tiles = [
    { icon: Icon.ChartBar, color: "c-blue", label: "Total Requests", value: stats.totalRequests },
    { icon: Icon.Calendar, color: "c-indigo", label: "Today", value: stats.requestsToday },
    { icon: Icon.Clock, color: "c-teal", label: "Avg Latency", value: `${Math.round(stats.avgLatencyMs)} ms` },
    { icon: Icon.Warning, color: "c-red", label: "Error Rate", value: `${(stats.errorRate * 100).toFixed(1)}%` },
  ] as const;

  return (
    <div className="fade-in">
      <LargeTitle>Usage</LargeTitle>
      <Section>
        <Caption>Activity</Caption>
        <List>
          {tiles.map((t) => (
            <Row
              key={t.label}
              icon={t.icon}
              color={t.color}
              title={t.label}
              chevron={false}
              trailing={<span className="row-value">{t.value}</span>}
            />
          ))}
        </List>
        <Footnote>
          Computed from the server-side audit log. Older entries are pruned automatically.
        </Footnote>
      </Section>
      {monitoring && (
        <Section>
          <Caption>Server</Caption>
          <List>
            <Row
              icon={Icon.Server}
              color="c-green"
              title="Online"
              subtitle={`Uptime ${Math.floor(monitoring.uptimeSeconds / 60)} min`}
              chevron={false}
            />
          </List>
          <div className="log-viewer">
            {[...monitoring.logs.error, ...monitoring.logs.out].slice(-250).join("\n") || "No log entries yet."}
          </div>
          <Footnote>Latest PM2 logs. This section is visible only to bot administrators.</Footnote>
        </Section>
      )}
    </div>
  );
}
