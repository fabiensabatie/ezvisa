import { THEME_PRESETS } from "@ezvisa/ui";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Button, FormDialog, INPUT } from "../components/controls";
import { Icon } from "../components/Icon";
import { CreateTokenDialog } from "../components/TokenDialog";
import { Card, CardTitle, Chip, Empty, Label, PageHeader, QueryView } from "../components/ui";
import { useCan } from "../lib/can";
import { timeAgo } from "../lib/format";
import { toast } from "../lib/toast";
import { useTheme } from "../theme";
import { type Outputs, useTRPC } from "../trpc";

type Token = Outputs["team"]["tokens"]["items"][number];

/** In development the dashboard runs on Vite's port; the MCP server is on the API port. */
function mcpEndpoint(): string {
  const { protocol, hostname, port, origin } = window.location;
  return port === "5173" ? `${protocol}//${hostname}:3000/mcp` : `${origin}/mcp`;
}

function Theme() {
  const trpc = useTRPC();
  const { can } = useCan();
  const { accent, orgAccent, overridden, setAccent } = useTheme();
  const save = useMutation(trpc.settings.update.mutationOptions());
  const canSave = can("settings", "edit");

  return (
    <Card>
      <CardTitle
        icon={{ name: "heart" }}
        sub="Pick a preset or any colour. Tints, buttons and text shades are derived from it and kept readable."
      >
        Theme colour
      </CardTitle>
      <div className="flex flex-wrap items-start gap-2">
        {THEME_PRESETS.map((p) => {
          const on = accent === p.hex.toLowerCase();
          return (
            <button
              key={p.hex}
              type="button"
              aria-pressed={on}
              aria-label={`Use the ${p.name} theme`}
              onClick={() => setAccent(p.hex)}
              className={`flex min-w-20 cursor-pointer flex-col items-center gap-2 rounded-2xl px-2 py-3 ${on ? "bg-bg" : ""}`}
            >
              <span
                className="grid size-12 place-items-center rounded-full text-white"
                style={{
                  background: p.hex,
                  boxShadow: on ? `0 0 0 3px #fff, 0 0 0 5px ${p.hex}` : undefined,
                }}
              >
                {on && <Icon name="check" strokeWidth={3} />}
              </span>
              <span className="text-sm font-extrabold">{p.name}</span>
            </button>
          );
        })}
        <label className="flex min-w-20 cursor-pointer flex-col items-center gap-2 px-2 py-3">
          <input
            type="color"
            value={accent}
            onChange={(e) => setAccent(e.target.value)}
            className="size-12 cursor-pointer rounded-full border-0 bg-transparent p-0"
          />
          <span className="text-sm font-extrabold">Custom</span>
        </label>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3 rounded-2xl bg-bg p-4">
        <span className="text-xs font-extrabold uppercase tracking-wide text-muted">Preview</span>
        <span className="inline-flex min-h-11 items-center rounded-full bg-ink px-5 font-extrabold text-white">
          Primary
        </span>
        <span className="inline-flex min-h-11 items-center rounded-full bg-soft px-5 font-extrabold text-ink">
          Secondary
        </span>
        <Chip tone="accent">Drafting</Chip>
        <span className="font-mono text-sm text-text-soft">{accent}</span>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-line pt-4 text-sm">
        <span className="min-w-0 flex-1 basis-64 text-text-soft">
          {overridden
            ? `This browser uses its own colour. The agency colour, which everyone else starts from, is ${orgAccent}.`
            : `This is the agency colour (${orgAccent}). Everyone starts from it.`}
        </span>
        {overridden && (
          <Button variant="outline" onClick={() => setAccent(null)}>
            Use the agency colour
          </Button>
        )}
        {overridden && canSave && (
          <Button
            pending={save.isPending}
            onClick={() =>
              save.mutate(
                { accent },
                {
                  onSuccess: () => {
                    setAccent(null);
                    toast.success("Agency colour saved for everyone");
                  },
                },
              )
            }
          >
            Make it the agency colour
          </Button>
        )}
      </div>
    </Card>
  );
}

function Agency() {
  const trpc = useTRPC();
  const me = useQuery(trpc.me.queryOptions());
  const save = useMutation(trpc.settings.update.mutationOptions());
  const current = me.data?.settings.agentName ?? "";
  const [name, setName] = useState<string | null>(null);
  const value = name ?? current;

  return (
    <Card>
      <CardTitle
        icon={{ name: "message" }}
        sub="Signs every reminder message, e.g. “Namtarn, EzVisa”."
      >
        Name in messages
      </CardTitle>
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate(
            { agentName: value.trim() },
            {
              onSuccess: () => {
                setName(null);
                toast.success("Name saved");
              },
            },
          );
        }}
      >
        <label htmlFor="agent-name" className="sr-only">
          Name in messages
        </label>
        <input
          id="agent-name"
          required
          maxLength={80}
          value={value}
          onChange={(e) => setName(e.target.value)}
          className={`h-11 min-w-0 flex-1 basis-48 ${INPUT}`}
        />
        <Button type="submit" pending={save.isPending} disabled={value.trim() === current}>
          Save
        </Button>
      </form>
    </Card>
  );
}

function Tokens({ myTokenId }: { myTokenId: string | undefined }) {
  const trpc = useTRPC();
  const tokens = useQuery(trpc.team.tokens.queryOptions());
  const revoke = useMutation(trpc.team.revokeToken.mutationOptions());
  const [creating, setCreating] = useState(false);
  const [revoking, setRevoking] = useState<Token | null>(null);
  const own = revoking?.id === myTokenId;

  return (
    <Card>
      <CardTitle
        icon={{ name: "key" }}
        sub="For now a token is the login. It identifies the person in this dashboard and in the MCP server, and is shown once when created."
        aside={
          <Button icon="plus" onClick={() => setCreating(true)}>
            Create token
          </Button>
        }
      >
        Access tokens
      </CardTitle>
      <QueryView query={tokens} what="tokens">
        {(data) =>
          data.items.length === 0 ? (
            <Empty>No tokens.</Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead className="text-xs font-extrabold uppercase tracking-wide text-muted">
                  <tr>
                    <th className="px-3 py-3">Name</th>
                    <th className="px-3 py-3">Label</th>
                    <th className="px-3 py-3">Token</th>
                    <th className="px-3 py-3">Last used</th>
                    <th className="px-3 py-3">Status</th>
                    <th className="px-3 py-3">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((t) => (
                    <tr key={t.id} className="border-t border-line">
                      <td className="px-3 py-3 font-extrabold">{t.employee.name}</td>
                      <td className="px-3 py-3 text-text-soft">
                        {t.label}
                        {t.id === myTokenId && <Chip className="ml-2">This browser</Chip>}
                      </td>
                      <td className="px-3 py-3 font-mono text-text-soft">{t.token}</td>
                      <td className="px-3 py-3 text-text-soft">
                        {t.lastUsedAt ? timeAgo(t.lastUsedAt) : "Never"}
                      </td>
                      <td className="px-3 py-3">
                        <Chip tone={t.status === "active" ? "ok" : "mute"}>{t.status}</Chip>
                      </td>
                      <td className="px-3 py-2 text-right">
                        {t.status === "active" && (
                          <Button variant="danger" onClick={() => setRevoking(t)}>
                            Revoke
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
      </QueryView>
      {creating && <CreateTokenDialog onClose={() => setCreating(false)} />}
      <FormDialog
        open={revoking !== null}
        onClose={() => setRevoking(null)}
        title={`Revoke “${revoking?.label ?? ""}”?`}
        description={
          own
            ? "This is the token you are signed in with. You will be signed out straight away."
            : `${revoking?.employee.name ?? ""} is signed out wherever this token is used, including Claude. This cannot be undone.`
        }
        submitLabel="Revoke"
        submitVariant="danger"
        pending={revoke.isPending}
        onSubmit={async () => {
          if (!revoking) return;
          const done = await revoke.mutateAsync({ tokenId: revoking.id }).catch(() => null);
          setRevoking(null);
          if (done) toast.success(`Token “${done.label}” revoked`);
        }}
      />
    </Card>
  );
}

export function SettingsPage() {
  const trpc = useTRPC();
  const { can } = useCan();
  const me = useQuery(trpc.me.queryOptions());
  const endpoint = mcpEndpoint();

  return (
    <>
      <PageHeader title="Settings" subtitle="Theme, access tokens and the MCP server" />
      <div className="flex flex-col gap-5">
        <Theme />
        {can("settings", "edit") && <Agency />}
        {can("team", "full") && <Tokens myTokenId={me.data?.token?.id} />}
        <QueryView query={me} what="your account">
          {(m) => (
            <div className="grid items-start gap-5 xl:grid-cols-2">
              <Card>
                <CardTitle icon={{ name: "key" }}>Your access</CardTitle>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <Label>Signed in as</Label>
                    <div className="mt-1 font-bold">{m.name}</div>
                  </div>
                  <div>
                    <Label>Role</Label>
                    <div className="mt-1 font-bold">{m.role}</div>
                  </div>
                  <div>
                    <Label>Token</Label>
                    <div className="mt-1 font-bold">{m.token?.label ?? "Unknown"}</div>
                  </div>
                  <div>
                    <Label>Can approve packs</Label>
                    <div className="mt-1">
                      <Chip tone={m.permissions.approvePacks ? "ok" : "mute"}>
                        {m.permissions.approvePacks ? "Yes" : "No"}
                      </Chip>
                    </div>
                  </div>
                </div>
              </Card>
              <Card>
                <CardTitle
                  icon={{ name: "sparkle" }}
                  sub="Claude and other MCP clients connect with a token and get exactly the permissions of its role."
                >
                  MCP server
                </CardTitle>
                <Label>Endpoint</Label>
                <div className="mt-1.5 break-all rounded-2xl bg-bg px-3.5 py-3 font-mono text-sm">
                  {endpoint}
                </div>
                <div className="mt-4">
                  <Label>Connect Claude Code</Label>
                </div>
                <pre className="mt-1.5 overflow-x-auto whitespace-pre-wrap break-all rounded-2xl bg-bg px-3.5 py-3 font-mono text-xs leading-relaxed">
                  {`claude mcp add --transport http ezvisa ${endpoint} --header "Authorization: Bearer <token>"`}
                </pre>
              </Card>
            </div>
          )}
        </QueryView>
      </div>
    </>
  );
}
