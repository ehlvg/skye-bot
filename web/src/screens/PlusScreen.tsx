import { useApp } from "../store";
import { Caption, Footnote, LargeTitle, Section, Spinner } from "../components/ui";
import { List, Row } from "../components/Row";
import { Icon } from "../components/Icon";
import { Button } from "../components/Button";
import { fmtTokens, formatDate, formatRelativeSeconds } from "../lib/format";

export function PlusScreen() {
  const { billing, selectModel, subscribe, buyPack, cancelSubscription } = useApp();
  const { account: acc, plans, models, defaultModelId, busy } = billing;

  if (!plans) {
    return (
      <div className="fade-in center">
        <Spinner />
      </div>
    );
  }

  const hasSub = acc?.hasActiveSub ?? false;
  const activeModelId = acc?.modelId || defaultModelId;
  const baseLeft = acc ? Math.max(0, acc.baseQuotaTokens - acc.baseUsedTokens) : 0;
  const total = acc ? acc.baseQuotaTokens + acc.packsTokens : 1;
  const remaining = acc?.remaining ?? 0;
  const usedPct = total > 0 ? Math.round(((total - remaining) / total) * 100) : 0;

  return (
    <div className="fade-in">
      <LargeTitle>{plans.enabled ? "Skye Plus" : "Models"}</LargeTitle>

      {plans.enabled && <Section>
        {hasSub ? (
          <div className="plus-hero">
            <div className="plus-hero-eyebrow">Active</div>
            <div className="plus-hero-title">
              {acc?.subStatus === "cancelled" ? "Cancelling soon" : "Skye Plus"}
            </div>
            <div className="plus-hero-sub">
              {acc?.subStatus === "cancelled"
                ? "Cancels at renewal — no further charges."
                : `Renews ${formatDate(acc!.subExpiresAt * 1000)} · ${formatRelativeSeconds(plans.subscriptionPeriodSeconds)} cycle`}
            </div>
          </div>
        ) : (
          <div className="plus-hero plus-hero-tap" onClick={() => subscribe()}>
            <div className="plus-hero-eyebrow">Unlock</div>
            <div className="plus-hero-title">Skye Plus</div>
            <div className="plus-hero-sub">
              {plans.subscriptionStars} ⭐ / {formatRelativeSeconds(plans.subscriptionPeriodSeconds)} ·{" "}
              {fmtTokens(plans.baseQuotaTokens)} tokens included
            </div>
            <Button
              variant="quiet"
              className="plus-hero-cta"
              icon={<Icon.Sparkles />}
              disabled={busy}
              onClick={(e) => {
                e.stopPropagation();
                void subscribe();
              }}
            >
              Subscribe
            </Button>
          </div>
        )}
      </Section>}

      {plans.enabled && hasSub && (
        <Section>
          <Caption>Token balance</Caption>
          <List>
            <Row
              icon={Icon.Clock}
              color="c-teal"
              title={`${fmtTokens(remaining)} tokens left`}
              chevron={false}
            />
            <Row
              icon={Icon.CircleStack}
              color="c-indigo"
              title="Usage"
              subtitle={`Base ${fmtTokens(baseLeft)} left · Boost ${fmtTokens(acc?.packsTokens ?? 0)}`}
              chevron={false}
              trailing={<span className="row-value">{usedPct}%</span>}
            />
          </List>
          <div className="quota">
            <div className="quota-bar">
              <div className="quota-fill" style={{ width: `${100 - usedPct}%` }} />
            </div>
          </div>
        </Section>
      )}

      {plans.enabled && hasSub && plans.packs.length > 0 && (
        <Section>
          <Caption>Token packs</Caption>
          <List>
            {plans.packs.map((p) => (
              <Row
                key={p.id}
                icon={Icon.Bolt}
                color="c-yellow"
                title={p.name}
                subtitle={`+${fmtTokens(p.tokens)} tokens`}
                onClick={() => buyPack(p.id)}
                trailing={<span className="row-value">{p.stars} ⭐</span>}
              />
            ))}
          </List>
          <Footnote>Packs are spent before base quota and expire when your subscription ends.</Footnote>
        </Section>
      )}

      {plans.enabled && hasSub && acc?.subStatus !== "cancelled" && (
        <Section>
          <Button
            variant="destructive"
            icon={<Icon.XCircle />}
            disabled={busy}
            onClick={() => cancelSubscription()}
          >
            Cancel subscription
          </Button>
        </Section>
      )}

      <Section>
        <Caption>Choose your model</Caption>
        <List>
          {models.map((m) => {
            const selected = activeModelId === m.id;
            return (
              <Row
                key={m.id}
                icon={Icon.Cpu}
                color="c-blue"
                title={m.name}
                subtitle={`${m.multiplier}× token cost`}
                selected={selected}
                onClick={() => selectModel(m.id)}
                chevron={false}
                trailing={selected ? <Icon.Check /> : undefined}
              />
            );
          })}
        </List>
        <Footnote>
          {plans.enabled
            ? "Models differ in power and token cost. You can switch any time."
            : "Choose the model this self-hosted bot uses for your conversations."}
        </Footnote>
      </Section>
    </div>
  );
}
