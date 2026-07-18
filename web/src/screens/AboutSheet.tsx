import { Button, CloseButton } from "../components/Button";
import { Icon } from "../components/Icon";
import { List, Row } from "../components/Row";
import { Sheet } from "../components/Sheet";
import { Caption, Footnote, Section } from "../components/ui";
import { openLink } from "../lib/telegram";
import { useApp } from "../store";

export function AboutSheet() {
  const { about, aboutOpen, closeAbout } = useApp();
  if (!about) return null;

  return (
    <Sheet
      open={aboutOpen}
      onClose={closeAbout}
      title="About Skye"
      headerRight={<CloseButton onClick={closeAbout} />}
    >
      <div className="about-hero">
        <div className="about-mark"><Icon.Sparkles /></div>
        <h3>Free software, by design.</h3>
        <p>Inspect it, run it, improve it, and share it under the GNU Affero GPL.</p>
      </div>

      <Section>
        <Caption>Build</Caption>
        <List>
          <Row title="Version" trailing={<span className="row-value">{about.version}</span>} chevron={false} />
          <Row
            title="Commit"
            trailing={<span className="row-value row-mono">{about.commit?.slice(0, 12) ?? "not supplied"}</span>}
            chevron={false}
          />
          <Row title="License" trailing={<span className="row-value">{about.license}</span>} chevron={false} />
        </List>
        <Footnote>
          A commit-specific source link is shown when the operator supplies the deployed revision.
        </Footnote>
      </Section>

      <Section>
        <Caption>Maintainer</Caption>
        <List>
          <Row
            icon={Icon.Identification}
            color="c-indigo"
            title={about.maintainer.name}
            subtitle={`Also known as ${about.maintainer.alias}`}
            chevron={false}
          />
          <Row
            icon={Icon.Chat}
            color="c-blue"
            title={about.maintainer.telegram}
            subtitle="Telegram security and support contact"
            onClick={() => openLink(`https://t.me/${about.maintainer.telegram.replace(/^@/, "")}`)}
          />
        </List>
      </Section>

      <div className="sheet-actions">
        <Button icon={<Icon.Code />} onClick={() => openLink(about.sourceUrl)}>View source code</Button>
        <Button variant="glass" icon={<Icon.Shield />} onClick={() => openLink(about.securityUrl)}>
          Security policy
        </Button>
      </div>
    </Sheet>
  );
}
