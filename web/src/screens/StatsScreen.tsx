import { Fragment, useEffect, useState } from "react";
import { useApp } from "../store";
import { Caption, Footnote, LargeTitle, Section } from "../components/ui";
import { List } from "../components/Row";
import { Row } from "../components/Row";
import { Icon } from "../components/Icon";
import { api, type AuditEvent, type Monitoring } from "../lib/api";

function eventTitle(event: AuditEvent): string {
  if (event.kind === "request") return `${event.action} request`;
  return event.action.replaceAll("_", " ");
}

function activityDetails(event: AuditEvent): string | null {
  if (event.details && typeof event.details === "object") {
    return Object.entries(event.details as Record<string, unknown>)
      .map(([key, value]) => `${key}: ${typeof value === "string" ? value : JSON.stringify(value)}`)
      .join("\n");
  }
  if (event.details) return String(event.details);
  return null;
}

function toolSummary(toolCalls: unknown): string | null {
  if (!Array.isArray(toolCalls) || toolCalls.length === 0) return null;
  return toolCalls
    .map((call) => {
      if (!call || typeof call !== "object") return "Tool call";
      const tool = call as { name?: unknown; isMcp?: unknown; args?: unknown };
      const keys = tool.args && typeof tool.args === "object" ? Object.keys(tool.args as object) : [];
      return `${tool.isMcp ? "MCP" : "Tool"}: ${String(tool.name ?? "unknown")}${keys.length ? ` (${keys.join(", ")})` : ""}`;
    })
    .join(" · ");
}

export function StatsScreen() {
  const { stats } = useApp();
  const [monitoring, setMonitoring] = useState<Monitoring | null>(null);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [filter, setFilter] = useState<"all" | AuditEvent["kind"]>("all");
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    void api.getMonitoring().then(setMonitoring).catch(() => setMonitoring(null));
    void api.getAuditEvents().then(setEvents).catch(() => setEvents([]));
  }, []);

  const visibleEvents = events.filter((event) => filter === "all" || event.kind === filter);

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
          <Footnote>Live process status. Only bot administrators can see the audit timeline below.</Footnote>
        </Section>
      )}
      {events.length > 0 && (
        <Section>
          <Caption>Audit timeline</Caption>
          <div className="audit-filters">
            {(["all", "request", "activity", "billing"] as const).map((value) => (
              <button
                key={value}
                type="button"
                className={filter === value ? "audit-filter is-active" : "audit-filter"}
                onClick={() => setFilter(value)}
              >
                {value === "all" ? "All" : value}
              </button>
            ))}
          </div>
          <div className="audit-scroll">
            <table className="audit-table">
              <thead>
                <tr>
                  <th>Event</th>
                  <th>Time</th>
                  <th>Info</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
            {visibleEvents.map((event) => {
              const key = `${event.kind}-${event.id}`;
              const details = activityDetails(event);
              const tools = toolSummary(event.toolCalls);
              const isOpen = expanded === key;
              return (
                <Fragment key={key}>
                  <tr
                    className={`audit-row audit-${event.kind}${isOpen ? " is-open" : ""}`}
                    tabIndex={0}
                    role="button"
                    aria-expanded={isOpen}
                    onClick={() => setExpanded(isOpen ? null : key)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setExpanded(isOpen ? null : key);
                      }
                    }}
                  >
                    <td>
                      <div className="audit-title">{eventTitle(event)}</div>
                      <div className="audit-meta">user {event.userId}</div>
                    </td>
                    <td className="audit-time">{new Date(event.ts).toLocaleTimeString()}</td>
                    <td className="audit-info">
                      {event.model || "—"}
                      {event.latencyMs != null ? ` · ${event.latencyMs} ms` : ""}
                    </td>
                    <td>{event.status && <span className={`audit-status is-${event.status}`}>{event.status}</span>}</td>
                  </tr>
                  {isOpen && (
                    <tr className="audit-expanded-row">
                      <td colSpan={4}>
                        {event.inputText && <pre className="audit-detail"><strong>Request</strong>{`\n${event.inputText}`}</pre>}
                        {event.outputText && <pre className="audit-detail"><strong>Response</strong>{`\n${event.outputText}`}</pre>}
                        {tools && <div className="audit-facts">{tools}</div>}
                        {details && <pre className={event.error ? "audit-detail is-error" : "audit-detail"}>{details}</pre>}
                        {!event.inputText && !event.outputText && !details && !tools && (
                          <div className="audit-empty">No detailed content was captured for this older event.</div>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
              </tbody>
            </table>
          </div>
        </Section>
      )}
    </div>
  );
}
