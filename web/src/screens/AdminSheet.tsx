import { useState, type FormEvent } from "react";
import { Button, CloseButton } from "../components/Button";
import { Icon } from "../components/Icon";
import { List, Row } from "../components/Row";
import { Sheet } from "../components/Sheet";
import { Caption, Footnote, Section, Spinner } from "../components/ui";
import { useApp } from "../store";

export function AdminSheet() {
  const {
    about,
    admins,
    adminBusy,
    adminOpen,
    closeAdmin,
    addAdmin,
    removeAdmin,
  } = useApp();
  const [userId, setUserId] = useState("");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const parsed = Number(userId.trim());
    if (!Number.isSafeInteger(parsed) || parsed <= 0) return;
    await addAdmin(parsed);
    setUserId("");
  };

  return (
    <Sheet
      open={adminOpen}
      onClose={closeAdmin}
      title="Administration"
      headerRight={<CloseButton onClick={closeAdmin} />}
    >
      <div className="access-card">
        <span>Access mode</span>
        <strong>{about?.accessMode ?? "unknown"}</strong>
        <p>
          {about?.accessMode === "private" && "Only administrators can use this bot."}
          {about?.accessMode === "allowlist" && "Administrators and approved users or chats can use this bot."}
          {about?.accessMode === "subscription" && "Approved users and active subscribers can use this bot."}
          {about?.accessMode === "open" && "Anyone can use the operator's configured AI provider."}
        </p>
      </div>

      <Section>
        <Caption>Administrators</Caption>
        {adminBusy && !admins ? <Spinner /> : (
          <List>
            {admins?.admins.map((entry) => (
              <Row
                key={entry.userId}
                icon={entry.role === "owner" ? Icon.Shield : Icon.UserCircle}
                color={entry.role === "owner" ? "c-purple" : "c-blue"}
                title={<span className="admin-id">{entry.userId}</span>}
                subtitle={
                  entry.role === "owner"
                    ? "Primary owner · permanent"
                    : entry.removable
                      ? "Delegated administrator"
                      : "Defined in config · protected"
                }
                chevron={false}
                trailing={entry.removable && admins.canManage ? (
                  <button
                    type="button"
                    className="icon-action is-destructive"
                    aria-label={`Remove administrator ${entry.userId}`}
                    disabled={adminBusy}
                    onClick={() => void removeAdmin(entry.userId)}
                  >
                    <Icon.Trash />
                  </button>
                ) : undefined}
              />
            ))}
          </List>
        )}
        <Footnote>
          The primary owner cannot be removed. Administrators defined in config must be changed there.
        </Footnote>
      </Section>

      {admins?.canManage && (
        <Section>
          <Caption>Add administrator</Caption>
          <form onSubmit={(event) => void submit(event)}>
            <List>
              <li className="row row-input no-sep">
                <label className="row-label" htmlFor="admin-user-id">Telegram ID</label>
                <input
                  id="admin-user-id"
                  className="field field-mono"
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="123456789"
                  value={userId}
                  onChange={(event) => setUserId(event.target.value.replace(/\D/g, ""))}
                />
              </li>
            </List>
            <Button type="submit" icon={<Icon.UserPlus />} disabled={adminBusy || !userId}>
              Add administrator
            </Button>
          </form>
          <Footnote>Ask the user to send you their numeric Telegram user ID.</Footnote>
        </Section>
      )}
    </Sheet>
  );
}
