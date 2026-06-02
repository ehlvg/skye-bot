import { useState, useEffect } from "react";
import { api, type UsageStats } from "../api";
import { SectionHeader } from "./ConfigSection";

export function StatsSection() {
  const [stats, setStats] = useState<UsageStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getUsageStats().then(setStats).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="py-8 text-center text-tg-hint">Loading...</div>;
  if (!stats) return <div className="py-8 text-center text-tg-hint">No data available</div>;

  return (
    <div className="space-y-4">
      <SectionHeader title="Usage Statistics" subtitle="Your request history" />

      <div className="grid grid-cols-2 gap-3">
        <StatCard label="Total Requests" value={stats.totalRequests.toLocaleString()} />
        <StatCard label="Today" value={stats.requestsToday.toLocaleString()} />
        <StatCard label="Avg Latency" value={`${Math.round(stats.avgLatencyMs)}ms`} />
        <StatCard
          label="Error Rate"
          value={`${(stats.errorRate * 100).toFixed(1)}%`}
          highlight={stats.errorRate > 0.1}
        />
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="rounded-lg bg-tg-section-bg p-4">
      <div className="text-xs text-tg-hint">{label}</div>
      <div
        className={`mt-1 text-2xl font-semibold ${
          highlight ? "text-tg-destructive" : "text-tg-text"
        }`}
      >
        {value}
      </div>
    </div>
  );
}
