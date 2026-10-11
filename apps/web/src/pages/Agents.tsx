import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import {
  Button,
  CheckboxField,
  Dialog,
  FormDialog,
  RadioCards,
  SelectField,
  TextAreaField,
  TextField,
} from "../components/controls";
import { Icon } from "../components/Icon";
import { Card, CardTitle, Chip, Empty, PageHeader, QueryView } from "../components/ui";
import { useCan } from "../lib/can";
import { toast } from "../lib/toast";
import { TONE } from "../lib/tones";
import { errorMessage, type Outputs, useTRPC } from "../trpc";

type Data = Outputs["agents"]["list"];
type Agent = Data["agents"][number];
type Audience = "CLIENTS" | "TEAM";

const AUDIENCES = [
  {
    value: "CLIENTS" as const,
    label: "Clients",
    description:
      "Answers clients. Checks who they are first; its tools then work on that client's records only.",
  },
  {
    value: "TEAM" as const,
    label: "The team",
    description:
      "Answers people on the team whose chat accounts are linked, with no more than their own permissions.",
  },
];

const STARTER: Record<Audience, string> = {
  CLIENTS:
    "You are the agency's first answer on LINE. Greet warmly, find out what the client needs, check who they are before talking about a case, and send their upload link when documents are missing.",
  TEAM: "Help the team look up clients and cases, open cases and update checklists. Keep answers short.",
};

function AgentDialog({ data, agent, onClose }: { data: Data; agent?: Agent; onClose: () => void }) {
  const trpc = useTRPC();
  const create = useMutation(trpc.agents.create.mutationOptions({ meta: { quiet: true } }));
  const update = useMutation(trpc.agents.update.mutationOptions({ meta: { quiet: true } }));
  const mutation = agent ? update : create;
  const defaultRole =
    data.roles.find((r) => r.name === "Client agent")?.id ?? data.roles[0]?.id ?? "";
  const [name, setName] = useState(agent?.name ?? "");
  const [audience, setAudience] = useState<Audience>(agent?.audience ?? "CLIENTS");
  const [roleId, setRoleId] = useState(agent?.role.id ?? defaultRole);
  const [model, setModel] = useState(agent?.model ?? data.models[0]?.id ?? "");
  const [instructions, setInstructions] = useState(agent?.instructions ?? STARTER.CLIENTS);
  const [enabled, setEnabled] = useState(agent?.enabled ?? true);
  const role = data.roles.find((r) => r.id === roleId);

  return (
    <FormDialog
      open
      wide
      onClose={onClose}
      title={agent ? `Edit ${agent.name}` : "New agent"}
      description="It answers in the inboxes you give it, with the MCP tools its role allows. Like any assistant, it can never verify an item or approve a pack."
      submitLabel={agent ? "Save" : "Create agent"}
      pending={mutation.isPending}
      error={mutation.error ? errorMessage(mutation.error) : null}
      onSubmit={async () => {
        const values = { name: name.trim(), audience, roleId, model, instructions, enabled };
        const saved = agent
          ? await update.mutateAsync({ agentId: agent.id, ...values }).catch(() => null)
          : await create.mutateAsync(values).catch(() => null);
        if (saved) {
          toast.success(agent ? "Agent saved" : `${saved.name} created. Give it an inbox next.`);
          onClose();
        }
      }}
    >
      <TextField
        label="Name"
        required
        maxLength={60}
        placeholder="e.g. LINE front desk"
        hint="Shown to the team, and as the bot's name in Chatwoot. Clients see the channel's name."
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <RadioCards
        legend="Who it talks to"
        value={audience}
        onChange={(value) => {
          if (!agent && instructions === STARTER[audience]) setInstructions(STARTER[value]);
          setAudience(value);
        }}
        options={AUDIENCES}
      />
      <SelectField
        label="Role"
        hint={
          role?.description ?? "Decides which MCP tools the agent may use, as for an MCP token."
        }
        options={data.roles.map((r) => ({ value: r.id, label: r.name }))}
        value={roleId}
        onChange={(e) => setRoleId(e.target.value)}
      />
      <SelectField
        label="Model"
        options={data.models.map((m) => ({ value: m.id, label: m.label }))}
        value={model}
        onChange={(e) => setModel(e.target.value)}
      />
      <TextAreaField
        label="Instructions"
        rows={7}
        maxLength={8000}
        hint="Its job, tone and what to ask. The rules for its audience and the agency notes (Settings) are always added."
        value={instructions}
        onChange={(e) => setInstructions(e.target.value)}
      />
      <CheckboxField
        label="On"
        hint="Off, its inboxes wait for the team."
        checked={enabled}
        onChange={setEnabled}
      />
    </FormDialog>
  );
}

function InboxesDialog({
  data,
  agent,
  onClose,
}: {
  data: Data;
  agent: Agent;
  onClose: () => void;
}) {
  const trpc = useTRPC();
  const save = useMutation(trpc.agents.setInboxes.mutationOptions({ meta: { quiet: true } }));
  const [chosen, setChosen] = useState(new Set(agent.inboxIds));
  return (
    <FormDialog
      open
      onClose={onClose}
      title={`Inboxes for ${agent.name}`}
      description="New conversations in these inboxes go to this agent first. An inbox has one agent."
      submitLabel="Save inboxes"
      pending={save.isPending}
      error={save.error ? errorMessage(save.error) : null}
      onSubmit={() =>
        save.mutate(
          { agentId: agent.id, inboxIds: [...chosen] },
          {
            onSuccess: () => {
              toast.success("Inboxes saved");
              onClose();
            },
          },
        )
      }
    >
      {data.inboxes.length === 0 ? (
        <Empty>No inboxes yet. Connect LINE, Messenger or WhatsApp in Chatwoot first.</Empty>
      ) : (
        data.inboxes.map((inbox) => {
          const other = data.agents.find((a) => a.id === inbox.agentId && a.id !== agent.id);
          return (
            <CheckboxField
              key={inbox.id}
              label={`${inbox.name} · ${inbox.channel}`}
              hint={
                other
                  ? `Answered by ${other.name} now: ticking moves it here.`
                  : inbox.otherBot
                    ? `Answered by another bot (${inbox.otherBot}): ticking replaces it.`
                    : undefined
              }
              checked={chosen.has(inbox.id)}
              onChange={(on) => {
                const next = new Set(chosen);
                if (on) next.add(inbox.id);
                else next.delete(inbox.id);
                setChosen(next);
              }}
            />
          );
        })
      )}
    </FormDialog>
  );
}

function DeleteDialog({ agent, onClose }: { agent: Agent; onClose: () => void }) {
  const trpc = useTRPC();
  const remove = useMutation(trpc.agents.delete.mutationOptions());
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Delete ${agent.name}?`}
      description="Its inboxes go back to the team. Its past actions stay in the activity log."
    >
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="danger"
          icon="trash"
          pending={remove.isPending}
          onClick={() =>
            remove.mutate(
              { agentId: agent.id },
              {
                onSuccess: () => {
                  toast.success(`${agent.name} deleted`);
                  onClose();
                },
              },
            )
          }
        >
          Delete agent
        </Button>
      </div>
    </Dialog>
  );
}

function AgentCard({ data, agent, canEdit }: { data: Data; agent: Agent; canEdit: boolean }) {
  const [dialog, setDialog] = useState<"edit" | "inboxes" | "delete" | null>(null);
  const inboxes = data.inboxes.filter((i) => agent.inboxIds.includes(i.id));
  const model = data.models.find((m) => m.id === agent.model)?.label.split(" (")[0] ?? agent.model;
  return (
    <Card>
      <CardTitle
        icon={{ name: "sparkle", tone: agent.enabled ? "accent" : "mute" }}
        aside={
          canEdit && (
            <span className="flex flex-wrap gap-2">
              <Button variant="outline" icon="message" onClick={() => setDialog("inboxes")}>
                Inboxes
              </Button>
              <Button variant="outline" icon="edit" onClick={() => setDialog("edit")}>
                Edit
              </Button>
              <Button variant="ghost" icon="trash" onClick={() => setDialog("delete")}>
                Delete
              </Button>
            </span>
          )
        }
      >
        {agent.name}
      </CardTitle>
      <div className="flex flex-wrap gap-1.5">
        {!agent.enabled && <Chip tone="warn">Off</Chip>}
        <Chip tone={agent.audience === "CLIENTS" ? "accent" : "info"}>
          {agent.audience === "CLIENTS" ? "Talks to clients" : "Talks to the team"}
        </Chip>
        <Chip>Role: {agent.role.name}</Chip>
        <Chip>{model}</Chip>
        {inboxes.length === 0 ? (
          <Chip tone="warn">No inbox yet</Chip>
        ) : (
          inboxes.map((i) => (
            <Chip key={i.id} tone="ok" icon="message">
              {i.name}
            </Chip>
          ))
        )}
      </div>
      {agent.instructions && (
        <p className="mt-3 line-clamp-3 whitespace-pre-line text-sm text-text-soft">
          {agent.instructions}
        </p>
      )}
      {dialog === "edit" && (
        <AgentDialog data={data} agent={agent} onClose={() => setDialog(null)} />
      )}
      {dialog === "inboxes" && (
        <InboxesDialog data={data} agent={agent} onClose={() => setDialog(null)} />
      )}
      {dialog === "delete" && <DeleteDialog agent={agent} onClose={() => setDialog(null)} />}
    </Card>
  );
}

/** The AI agents that answer in the shared inbox. */
export function AgentsPage() {
  const trpc = useTRPC();
  const { can } = useCan();
  const canEdit = can("team", "full");
  const list = useQuery(trpc.agents.list.queryOptions());
  const [creating, setCreating] = useState(false);

  return (
    <>
      <PageHeader
        title="Agents"
        subtitle="AI agents answering in the shared inbox. Each works through EzVisa's MCP tools, as allowed by its role."
      >
        {canEdit && (
          <Button icon="plus" onClick={() => setCreating(true)}>
            New agent
          </Button>
        )}
      </PageHeader>
      <QueryView query={list} what="the agents">
        {(data) => (
          <div className="flex flex-col gap-5">
            {(data.chatError || !data.modelReady) && (
              <p className={`flex gap-2 rounded-2xl px-3.5 py-3 text-sm font-bold ${TONE.warn}`}>
                <Icon name="alert" size={17} className="mt-px shrink-0" />
                {data.chatError
                  ? `${data.chatError} Agents answer once Chatwoot is connected (Settings).`
                  : "ANTHROPIC_API_KEY is not set on the server: agents hand every conversation to the team."}
              </p>
            )}
            {data.agents.length === 0 ? (
              <Card>
                <Empty>
                  No agent yet. Create one for clients on your LINE channel, give it the LINE inbox,
                  and it starts answering new conversations.
                </Empty>
              </Card>
            ) : (
              data.agents.map((agent) => (
                <AgentCard key={agent.id} data={data} agent={agent} canEdit={canEdit} />
              ))
            )}
            <p className="text-sm text-muted">
              What every agent should know (hours, prices, address) is in{" "}
              <Link to="/settings" className="font-bold text-ink underline">
                Settings
              </Link>
              . Their conversations are in the{" "}
              <Link to="/inbox" className="font-bold text-ink underline">
                Inbox
              </Link>
              .
            </p>
            {creating && <AgentDialog data={data} onClose={() => setCreating(false)} />}
          </div>
        )}
      </QueryView>
    </>
  );
}
