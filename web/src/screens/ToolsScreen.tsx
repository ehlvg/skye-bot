import { Button } from "../components/Button";
import { Icon } from "../components/Icon";
import { List, Row } from "../components/Row";
import { Caption, EmptyState, Footnote, LargeTitle, Section } from "../components/ui";
import { useApp } from "../store";

export function ToolsScreen() {
  const {
    connectors,
    openCustomConnector,
    connectManagedConnector,
    disconnectManagedConnector,
    refreshConnectors,
  } = useApp();
  const connectedCount = connectors.managed.connectors.filter((item) => item.connected).length;

  return (
    <div className="fade-in connectors-screen">
      <div className="connectors-title-row">
        <div>
          <LargeTitle>Connectors</LargeTitle>
          <p className="connectors-lede">Give Skye access to the services you choose.</p>
        </div>
        <button
          type="button"
          className="connector-refresh"
          onClick={() => void refreshConnectors()}
          aria-label="Refresh connectors"
        >
          <Icon.Refresh />
        </button>
      </div>

      <div className="connector-summary glass">
        <div className="connector-summary-mark">
          <Icon.Bolt />
        </div>
        <div>
          <strong>
            {connectedCount > 0 ? `${connectedCount} connected` : "Ready when you are"}
          </strong>
          <span>Each account stays private to your Telegram user.</span>
        </div>
      </div>

      <Section>
        <Caption>Apps</Caption>
        {!connectors.managed.enabled ? (
          <div className="glass">
            <EmptyState
              icon={Icon.Squares}
              title="Managed connectors are off"
              sub="The operator can enable one-click connections with a Composio project key."
            />
          </div>
        ) : connectors.managed.connectors.length === 0 ? (
          <div className="glass">
            <EmptyState
              icon={Icon.Refresh}
              title={
                connectors.managedUnavailable ? "Apps temporarily unavailable" : "No apps enabled"
              }
              sub="Refresh in a moment or ask the bot operator to check the connector configuration."
            />
          </div>
        ) : (
          <div className="connector-grid">
            {connectors.managed.connectors.map((connector) => (
              <article
                className={`connector-card glass${connector.connected ? " is-connected" : ""}`}
                key={connector.slug}
              >
                <div className="connector-card-head">
                  <span className="connector-logo connector-logo-fallback">
                    <Icon.Globe />
                    {connector.logo && (
                      <img
                        src={connector.logo}
                        alt=""
                        className="connector-logo-image"
                        onError={(event) => event.currentTarget.remove()}
                      />
                    )}
                  </span>
                  <span className={`connector-state${connector.connected ? " is-on" : ""}`}>
                    {connector.connected ? "Connected" : "Available"}
                  </span>
                </div>
                <h3>{connector.name}</h3>
                <button
                  type="button"
                  className={`connector-action${connector.connected ? " is-disconnect" : ""}`}
                  onClick={() =>
                    void (connector.connected
                      ? disconnectManagedConnector(connector.slug)
                      : connectManagedConnector(connector.slug))
                  }
                >
                  {connector.connected ? "Disconnect" : "Connect"}
                </button>
              </article>
            ))}
          </div>
        )}
        <Footnote>
          Managed connections use a secure OAuth page. Skye never receives your password or OAuth
          token.
        </Footnote>
      </Section>

      {connectors.customEnabled && (
        <Section>
          <Caption>Advanced</Caption>
          {connectors.custom.length > 0 && (
            <List>
              {connectors.custom.map((connector) => (
                <Row
                  key={connector.id}
                  icon={Icon.Globe}
                  color="c-orange"
                  title={connector.name}
                  subtitle={`${connector.toolCount} ${connector.toolCount === 1 ? "tool" : "tools"} · ${connector.connected ? "connected" : "unavailable"}`}
                  onClick={() => openCustomConnector(connector)}
                />
              ))}
            </List>
          )}
          <Button
            variant="glass"
            icon={<Icon.Plus />}
            disabled={connectors.custom.length >= connectors.maxCustom}
            onClick={() => openCustomConnector(null)}
          >
            Add custom HTTPS connector
          </Button>
          <Footnote>
            Custom connectors are not reviewed by Skye. They can see tool requests and return
            untrusted content.
          </Footnote>
        </Section>
      )}
    </div>
  );
}
