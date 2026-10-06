import { useQuery } from "@tanstack/react-query";
import { Icon } from "../components/Icon";
import { Avatar, Card, CardTitle, Chip, Empty, PageHeader, QueryView } from "../components/ui";
import { timeAgo } from "../lib/format";
import type { Tone } from "../lib/tones";
import { type Outputs, useTRPC } from "../trpc";

type Role = Outputs["team"]["roles"]["items"][number];

const COLUMNS: Array<{ key: keyof Role["permissions"]; label: string }> = [
  { key: "clients", label: "Clients" },
  { key: "cases", label: "Cases" },
  { key: "documents", label: "Documents" },
  { key: "templates", label: "Templates" },
  { key: "reminders", label: "Reminders" },
  { key: "team", label: "Team" },
  { key: "approvePacks", label: "Approve packs" },
  { key: "markSubmitted", label: "Record outcomes" },
];

function permission(value: string | boolean): { label: string; tone: Tone } {
  if (value === true || value === "full")
    return { label: value === true ? "Yes" : "Full", tone: "ok" };
  if (value === "edit") return { label: "Edit", tone: "accent" };
  if (value === "view") return { label: "View", tone: "info" };
  return { label: value === false ? "No" : "None", tone: "mute" };
}

function roleTone(name: string): Tone {
  if (name === "Owner") return "accent";
  if (name === "Validator") return "info";
  if (name === "Runner") return "ok";
  return "mute";
}

export function TeamPage() {
  const trpc = useTRPC();
  const me = useQuery(trpc.me.queryOptions());
  const employees = useQuery(trpc.team.employees.queryOptions({ includeInactive: false }));
  const roles = useQuery(trpc.team.roles.queryOptions());
  const canSeeTokens = me.data?.permissions.team === "full";
  const tokens = useQuery({ ...trpc.team.tokens.queryOptions(), enabled: canSeeTokens });

  return (
    <>
      <PageHeader
        title="Team & roles"
        subtitle="Everyone signs in with their own token, in the dashboard and through MCP"
      />
      <div className="flex flex-col gap-6">
        <QueryView query={employees} what="the team">
          {(data) => (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {data.items.map((e) => (
                <Card key={e.id}>
                  <div className="flex items-center gap-3">
                    <Avatar name={e.name} id={e.id} size="lg" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-base font-extrabold">{e.name}</div>
                      <div className="truncate text-sm text-muted">{e.email ?? "No email"}</div>
                    </div>
                    <Chip tone={roleTone(e.role.name)}>{e.role.name}</Chip>
                  </div>
                  {e.kind === "ASSISTANT" && (
                    <p className="mt-3 flex items-center gap-2 rounded-2xl bg-bg px-3 py-2 text-sm text-text-soft">
                      <Icon name="sparkle" size={16} className="text-ink" />
                      AI assistant: drafts and flags, never approves.
                    </p>
                  )}
                </Card>
              ))}
            </div>
          )}
        </QueryView>

        <Card>
          <CardTitle sub="What each role can do, in the dashboard and through the MCP server.">
            Roles and permissions
          </CardTitle>
          <QueryView query={roles} what="roles">
            {(data) => (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[900px] text-left text-sm">
                  <thead className="text-xs font-extrabold uppercase tracking-wide text-muted">
                    <tr>
                      <th className="px-3 py-3">Role</th>
                      {COLUMNS.map((c) => (
                        <th key={c.key} className="px-3 py-3">
                          {c.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.map((r) => (
                      <tr key={r.id} className="border-t border-line">
                        <td className="px-3 py-3">
                          <div className="font-extrabold">{r.name}</div>
                          <div className="text-xs text-muted">
                            {r.employeeCount ?? 0} {r.employeeCount === 1 ? "person" : "people"}
                          </div>
                        </td>
                        {COLUMNS.map((c) => {
                          const p = permission(r.permissions[c.key]);
                          return (
                            <td key={c.key} className="px-3 py-3">
                              <Chip tone={p.tone}>{p.label}</Chip>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </QueryView>
        </Card>

        {canSeeTokens && (
          <Card>
            <CardTitle
              icon={{ name: "key" }}
              sub="Tokens are created with pnpm token:create and shown once. Only masked forms appear here."
            >
              Access tokens
            </CardTitle>
            <QueryView query={tokens} what="tokens">
              {(data) =>
                data.items.length === 0 ? (
                  <Empty>No tokens.</Empty>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[640px] text-left text-sm">
                      <thead className="text-xs font-extrabold uppercase tracking-wide text-muted">
                        <tr>
                          <th className="px-3 py-3">Employee</th>
                          <th className="px-3 py-3">Label</th>
                          <th className="px-3 py-3">Token</th>
                          <th className="px-3 py-3">Last used</th>
                          <th className="px-3 py-3">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.items.map((t) => (
                          <tr key={t.id} className="border-t border-line">
                            <td className="px-3 py-3 font-extrabold">{t.employee.name}</td>
                            <td className="px-3 py-3 text-text-soft">{t.label}</td>
                            <td className="px-3 py-3 font-mono text-text-soft">{t.token}</td>
                            <td className="px-3 py-3 text-text-soft">
                              {t.lastUsedAt ? timeAgo(t.lastUsedAt) : "Never"}
                            </td>
                            <td className="px-3 py-3">
                              <Chip tone={t.status === "active" ? "ok" : "mute"}>{t.status}</Chip>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )
              }
            </QueryView>
          </Card>
        )}
      </div>
    </>
  );
}
