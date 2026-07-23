import { useApp } from "../store";
import { Caption, Footnote, Hint, LargeTitle, Section } from "../components/ui";
import { List, Row } from "../components/Row";
import { Icon } from "../components/Icon";
import { fmtTokens, formatDate } from "../lib/format";
import { haptic } from "../lib/telegram";
import { Segmented } from "../components/Segmented";

const PERSONALITIES = [
  { value: "skye", label: "Skye", description: "Calm, warm and concise" },
  { value: "skye.exe", label: "Skye.exe", description: "Chaotic Gen Z energy" },
  { value: "operator", label: "Operator", description: "Focused and decisive" },
  { value: "muse", label: "Muse", description: "Creative co-author" },
] as const;

export function ProfileScreen() {
  const {
    user,
    config,
    chatConfig,
    billing,
    dirty,
    updateConfig,
    saveConfig,
    setVoiceReplyMode,
    setTab,
    about,
    openAbout,
    openAdmin,
    openAgents,
  } = useApp();

  const acc = billing.account;
  const activeModelId = acc?.modelId || billing.defaultModelId;
  const model = billing.models.find((m) => m.id === activeModelId);
  const hasSub = acc?.hasActiveSub ?? false;

  return (
    <div className="fade-in">
      <LargeTitle>Settings</LargeTitle>

      <Section>
        <Caption>Account</Caption>
        <List>
          <Row
            icon={Icon.UserCircle}
            color="c-blue"
            title={user.name || "Guest"}
            subtitle={user.handle}
            chevron={false}
          />
        </List>
      </Section>

      {billing.plans?.enabled && (
        <Section>
          <Caption>Skye Plus</Caption>
          <List>
            <Row
              icon={Icon.Sparkles}
              color="c-purple"
              title={hasSub ? "Skye Plus Active" : "Unlock Skye Plus"}
              subtitle={
                hasSub
                  ? `${fmtTokens(acc?.remaining)} tokens · renews ${formatDate(acc!.subExpiresAt * 1000)}`
                  : `${billing.plans?.subscriptionStars ?? 1899} ⭐ / 30 days`
              }
              onClick={() => {
                haptic.light();
                setTab("plus");
              }}
            />
          </List>
        </Section>
      )}

      <Section>
        <Caption>Model</Caption>
        <List>
          <Row
            icon={Icon.Cpu}
            color="c-indigo"
            title={model?.name ?? "Default"}
            subtitle={`${model?.multiplier ?? 1}× token cost`}
            onClick={() => setTab("plus")}
          />
        </List>
      </Section>

      <Section>
        <Caption>Agents</Caption>
        <List>
          <Row
            icon={Icon.Identification}
            color="c-teal"
            title="Personal agents"
            subtitle="Create specialists with their own instructions and models"
            onClick={openAgents}
          />
        </List>
      </Section>

      <Section>
        <Caption>Project</Caption>
        <List>
          {about?.isAdmin && (
            <Row
              icon={Icon.Shield}
              color="c-indigo"
              title="Administration"
              subtitle={`${about.isOwner ? "Primary owner" : "Administrator"} · ${about.accessMode} access`}
              onClick={() => void openAdmin()}
            />
          )}
          <Row
            icon={Icon.Info}
            color="c-gray"
            title="About Skye"
            subtitle={`Version ${about?.version ?? "—"} · ${about?.license ?? "free software"}`}
            onClick={openAbout}
          />
        </List>
      </Section>

      <Section>
        <Caption>Personality</Caption>
        <Segmented
          value={config.personality ?? "skye"}
          options={PERSONALITIES.map(({ value, label }) => ({ value, label }))}
          onChange={(personality) => {
            haptic.selection();
            updateConfig({ personality });
          }}
        />
        <Footnote>
          {PERSONALITIES.find((item) => item.value === (config.personality ?? "skye"))?.description}
          . This fully replaces the active character. A custom prompt set with /set_prompt overrides
          the personality in that chat or topic until /reset_prompt.
        </Footnote>
      </Section>

      <Section>
        <Caption>Custom Instructions</Caption>
        <List>
          <li className="row no-sep">
            <textarea
              className="field textarea"
              rows={5}
              placeholder="e.g. Always respond in Spanish. Be more formal."
              value={config.systemPrompt ?? ""}
              spellCheck={false}
              onChange={(e) => updateConfig({ systemPrompt: e.target.value })}
            />
          </li>
        </List>
        <Footnote>Applied immediately on top of the selected personality.</Footnote>
      </Section>

      <Section>
        <Caption>Voice Replies</Caption>
        <Segmented
          value={chatConfig.voiceReplyMode}
          options={[
            { value: "text", label: "Text" },
            { value: "auto", label: "Auto" },
            { value: "always", label: "Always" },
          ]}
          onChange={(mode) => void setVoiceReplyMode(mode)}
        />
        <Hint>
          {chatConfig.voiceReplyMode === "text"
            ? "Skye uses text unless you explicitly ask for a voice note."
            : chatConfig.voiceReplyMode === "auto"
              ? "Skye chooses voice when delivery, emotion, or pronunciation benefits from it."
              : "Every regular response is sent as a voice note."}
        </Hint>
      </Section>

      {dirty && (
        <div className="savebar">
          <button className="button button-fill" onClick={() => saveConfig()}>
            Save Changes
          </button>
        </div>
      )}
    </div>
  );
}
