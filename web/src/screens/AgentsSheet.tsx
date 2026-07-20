import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Button, CloseButton } from "../components/Button";
import { Icon } from "../components/Icon";
import { Sheet } from "../components/Sheet";
import { EmptyState } from "../components/ui";
import {
  api,
  type AgentsResponse,
  type PersonalAgent,
  type PersonalAgentInput,
} from "../lib/api";
import { confirmDialog, haptic } from "../lib/telegram";
import { useApp } from "../store";

const EMPTY_DRAFT: PersonalAgentInput = {
  name: "",
  description: "",
  instructions: "",
  modelId: null,
};

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function AgentsSheet() {
  const { agentsOpen, closeAgents } = useApp();
  const [data, setData] = useState<AgentsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<PersonalAgent | "new" | null>(null);
  const [draft, setDraft] = useState<PersonalAgentInput>(EMPTY_DRAFT);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.getAgents();
      setData(result);
      if (new URLSearchParams(window.location.search).get("agents") === "create") {
        setEditing("new");
        setDraft(EMPTY_DRAFT);
      }
    } catch (cause) {
      setError(message(cause));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (agentsOpen && !data && !loading) void load();
  }, [agentsOpen, data, loading]);

  const modelNames = useMemo(
    () => new Map(data?.models.map((model) => [model.id, model.name]) ?? []),
    [data?.models]
  );

  const beginCreate = () => {
    haptic.light();
    setDraft(EMPTY_DRAFT);
    setError(null);
    setEditing("new");
  };

  const beginEdit = (agent: PersonalAgent) => {
    haptic.light();
    setDraft({
      name: agent.name,
      description: agent.description,
      instructions: agent.instructions,
      modelId: agent.modelId,
    });
    setError(null);
    setEditing(agent);
  };

  const closeEditor = () => {
    setEditing(null);
    setError(null);
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!data || busy || !draft.name.trim() || !draft.instructions.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const input = {
        ...draft,
        name: draft.name.trim(),
        description: draft.description.trim(),
        instructions: draft.instructions.trim(),
      };
      if (editing === "new") {
        const created = await api.createAgent(input);
        await api.selectAgent(created.id);
        setData({
          ...data,
          agents: [...data.agents, created],
          activeAgentId: created.id,
        });
      } else if (editing) {
        const updated = await api.updateAgent(editing.id, input);
        setData({
          ...data,
          agents: data.agents.map((agent) => (agent.id === updated.id ? updated : agent)),
        });
      }
      haptic.success();
      closeEditor();
    } catch (cause) {
      haptic.error();
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  };

  const select = async (agentId: string | null) => {
    if (!data || busy || data.activeAgentId === agentId) return;
    setBusy(true);
    setError(null);
    haptic.selection();
    try {
      await api.selectAgent(agentId);
      setData({ ...data, activeAgentId: agentId });
      haptic.success();
    } catch (cause) {
      haptic.error();
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (agent: PersonalAgent) => {
    const confirmed = await confirmDialog(`Delete “${agent.name}”?`);
    if (!confirmed || !data) return;
    setBusy(true);
    setError(null);
    try {
      await api.deleteAgent(agent.id);
      setData({
        ...data,
        agents: data.agents.filter((item) => item.id !== agent.id),
        activeAgentId: data.activeAgentId === agent.id ? null : data.activeAgentId,
      });
      haptic.success();
      closeEditor();
    } catch (cause) {
      haptic.error();
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  };

  const title = editing === "new" ? "New agent" : editing ? "Edit agent" : "Personal agents";
  const canSave =
    draft.name.trim().length > 0 &&
    draft.description.trim().length > 0 &&
    draft.instructions.trim().length > 0;

  return (
    <Sheet
      open={agentsOpen}
      onClose={editing ? closeEditor : closeAgents}
      title={title}
      headerLeft={
        editing ? (
          <button type="button" className="sheet-action" onClick={closeEditor} aria-label="Back">
            <Icon.ArrowLeft />
          </button>
        ) : undefined
      }
      headerRight={<CloseButton onClick={closeAgents} />}
    >
      {editing ? (
        <form className="agent-form fade-in" onSubmit={(event) => void save(event)}>
          <p className="agent-form-lede">
            Give this agent a clear role. It will be private and visible only to you.
          </p>

          <label className="agent-field">
            <span className="agent-field-head">
              <span>Name</span>
              <span>{draft.name.length}/80</span>
            </span>
            <input
              required
              autoFocus
              maxLength={80}
              placeholder="For example, Product strategist"
              value={draft.name}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            />
          </label>

          <label className="agent-field">
            <span className="agent-field-head">
              <span>Specialty</span>
              <span>{draft.description.length}/500</span>
            </span>
            <textarea
              required
              rows={2}
              maxLength={500}
              placeholder="What this agent is best at"
              value={draft.description}
              onChange={(event) => setDraft({ ...draft, description: event.target.value })}
            />
          </label>

          <label className="agent-field">
            <span className="agent-field-head">
              <span>Instructions</span>
              <span>{draft.instructions.length}/16000</span>
            </span>
            <textarea
              required
              rows={7}
              maxLength={16_000}
              placeholder="Describe the role, approach, priorities and preferred response style"
              value={draft.instructions}
              onChange={(event) => setDraft({ ...draft, instructions: event.target.value })}
            />
          </label>

          <fieldset className="agent-models">
            <legend>Model</legend>
            <button
              type="button"
              className={`agent-model${draft.modelId === null ? " is-selected" : ""}`}
              onClick={() => {
                haptic.selection();
                setDraft({ ...draft, modelId: null });
              }}
            >
              <span>
                <strong>Current chat model</strong>
                <small>Follows your main model setting</small>
              </span>
              {draft.modelId === null && <Icon.Check />}
            </button>
            {data?.models.map((model) => (
              <button
                type="button"
                className={`agent-model${draft.modelId === model.id ? " is-selected" : ""}`}
                key={model.id}
                onClick={() => {
                  haptic.selection();
                  setDraft({ ...draft, modelId: model.id });
                }}
              >
                <span>
                  <strong>{model.name}</strong>
                  <small>{model.multiplier}× token cost</small>
                </span>
                {draft.modelId === model.id && <Icon.Check />}
              </button>
            ))}
          </fieldset>

          {error && <div className="agent-error">{error}</div>}

          <div className="agent-form-actions">
            <Button type="submit" icon={<Icon.Check />} disabled={busy || !canSave}>
              {busy ? "Saving…" : editing === "new" ? "Create and activate" : "Save changes"}
            </Button>
            {editing !== "new" && editing && (
              <Button
                type="button"
                variant="destructive"
                icon={<Icon.Trash />}
                disabled={busy}
                onClick={() => void remove(editing)}
              >
                Delete agent
              </Button>
            )}
          </div>
        </form>
      ) : (
        <div className="agent-list-view fade-in">
          {loading && !data ? (
            <div className="agent-skeletons" aria-label="Loading agents">
              <div className="agent-skeleton" />
              <div className="agent-skeleton" />
              <div className="agent-skeleton" />
            </div>
          ) : error && !data ? (
            <div className="agent-load-error">
              <Icon.Warning />
              <strong>Couldn’t load agents</strong>
              <span>{error}</span>
              <Button variant="glass" onClick={() => void load()}>
                Try again
              </Button>
            </div>
          ) : data ? (
            <>
              <div className="agent-intro">
                <div>
                  <strong>Your specialist team</strong>
                  <span>
                    {data.agents.length} of {data.maxAgents} agents
                  </span>
                </div>
                <Icon.LockClosed />
              </div>

              <div className="agent-cards">
                <button
                  type="button"
                  className={`agent-card agent-default${data.activeAgentId === null ? " is-active" : ""}`}
                  disabled={busy}
                  onClick={() => void select(null)}
                >
                  <span className="agent-avatar"><Icon.Sparkles /></span>
                  <span className="agent-card-copy">
                    <strong>Default Skye</strong>
                    <small>Your main personality and current model</small>
                  </span>
                  {data.activeAgentId === null && <span className="agent-active">Active</span>}
                </button>

                {data.agents.length === 0 ? (
                  <EmptyState
                    icon={Icon.Identification}
                    title="Build your first agent"
                    sub="Create a focused specialist with its own instructions and model."
                  />
                ) : (
                  data.agents.map((agent) => {
                    const active = data.activeAgentId === agent.id;
                    return (
                      <article className={`agent-card${active ? " is-active" : ""}`} key={agent.id}>
                        <button
                          type="button"
                          className="agent-card-main"
                          disabled={busy}
                          onClick={() => void select(agent.id)}
                        >
                          <span className="agent-avatar"><Icon.Identification /></span>
                          <span className="agent-card-copy">
                            <strong>{agent.name}</strong>
                            <small>{agent.description || "Personal specialist"}</small>
                            <span className="agent-model-name">
                              {agent.modelId ? modelNames.get(agent.modelId) ?? agent.modelId : "Current chat model"}
                            </span>
                          </span>
                          {active && <span className="agent-active">Active</span>}
                        </button>
                        <button
                          type="button"
                          className="agent-edit"
                          onClick={() => beginEdit(agent)}
                          aria-label={`Edit ${agent.name}`}
                        >
                          <Icon.Edit />
                        </button>
                      </article>
                    );
                  })
                )}
              </div>

              {error && <div className="agent-error">{error}</div>}

              <div className="agent-list-actions">
                <Button
                  icon={<Icon.Plus />}
                  disabled={busy || data.agents.length >= data.maxAgents}
                  onClick={beginCreate}
                >
                  New agent
                </Button>
                {data.agents.length >= data.maxAgents && (
                  <span>You’ve reached the limit of {data.maxAgents} personal agents.</span>
                )}
              </div>
            </>
          ) : null}
        </div>
      )}
    </Sheet>
  );
}
