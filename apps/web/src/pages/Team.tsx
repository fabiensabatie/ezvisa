import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import {
  Button,
  FieldRow,
  FormDialog,
  IconButton,
  nullable,
  optional,
  SelectField,
  TextField,
} from "../components/controls";
import { Icon } from "../components/Icon";
import { CreateTokenDialog } from "../components/TokenDialog";
import { Avatar, Card, CardTitle, Chip, PageHeader, QueryView } from "../components/ui";
import { useCan } from "../lib/can";
import { toast } from "../lib/toast";
import type { Tone } from "../lib/tones";
import { errorMessage, type Outputs, useTRPC } from "../trpc";

type Role = Outputs["team"]["roles"]["items"][number];
type Employee = Outputs["team"]["employees"]["items"][number];

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

function PersonDialog({
  employee,
  roles,
  onClose,
  onCreated,
}: {
  employee?: Employee;
  roles: Role[];
  onClose: () => void;
  onCreated?: (employee: Employee) => void;
}) {
  const trpc = useTRPC();
  const create = useMutation(trpc.team.createEmployee.mutationOptions({ meta: { quiet: true } }));
  const update = useMutation(trpc.team.updateEmployee.mutationOptions({ meta: { quiet: true } }));
  const mutation = employee ? update : create;
  const [name, setName] = useState(employee?.name ?? "");
  const [email, setEmail] = useState(employee?.email ?? "");
  const [phone, setPhone] = useState(employee?.phone ?? "");
  const [roleId, setRoleId] = useState(
    employee?.role.id ?? roles.find((r) => r.name === "Validator")?.id ?? roles[0]?.id ?? "",
  );
  const [kind, setKind] = useState<"HUMAN" | "ASSISTANT">("HUMAN");

  return (
    <FormDialog
      open
      onClose={onClose}
      title={employee ? `Edit ${employee.name}` : "Add an employee"}
      description={
        employee
          ? "A new role applies to their very next request."
          : "They sign in with a token you create for them next."
      }
      submitLabel={employee ? "Save" : "Add"}
      pending={mutation.isPending}
      error={mutation.error ? errorMessage(mutation.error) : null}
      onSubmit={async () => {
        if (employee) {
          const saved = await update
            .mutateAsync({
              employeeId: employee.id,
              name: name.trim(),
              email: nullable(email),
              phone: nullable(phone),
              ...(roleId !== employee.role.id ? { roleId } : {}),
            })
            .catch(() => null);
          if (saved) {
            toast.success(`${saved.name} saved`);
            onClose();
          }
          return;
        }
        const created = await create
          .mutateAsync({
            name: name.trim(),
            email: optional(email),
            phone: optional(phone),
            roleId,
            kind,
          })
          .catch(() => null);
        if (created) {
          toast.success(`${created.name} added`);
          onCreated?.(created);
        }
      }}
    >
      <TextField label="Name" required value={name} onChange={(e) => setName(e.target.value)} />
      <FieldRow>
        <TextField
          label="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <TextField
          label="Phone"
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
      </FieldRow>
      <FieldRow>
        <SelectField
          label="Role"
          options={roles.map((r) => ({ value: r.id, label: r.name }))}
          value={roleId}
          onChange={(e) => setRoleId(e.target.value)}
          hint="The table below shows what each role can do."
        />
        {!employee && (
          <SelectField
            label="Kind"
            options={[
              { value: "HUMAN", label: "A person" },
              { value: "ASSISTANT", label: "An AI assistant" },
            ]}
            value={kind}
            onChange={(e) => setKind(e.target.value as "HUMAN" | "ASSISTANT")}
            hint={kind === "ASSISTANT" ? "Can never verify items or approve packs." : undefined}
          />
        )}
      </FieldRow>
    </FormDialog>
  );
}

function PersonCard({ e, roles, isMe }: { e: Employee; roles: Role[]; isMe: boolean }) {
  const trpc = useTRPC();
  const { can } = useCan();
  const deactivate = useMutation(trpc.team.deactivateEmployee.mutationOptions());
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState(false);

  return (
    <Card>
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
      {can("team", "edit") && (
        <div className="mt-3 flex justify-end gap-1 border-t border-line pt-3">
          {can("team", "full") && !isMe && (
            <IconButton
              icon="trash"
              label={`Deactivate ${e.name}`}
              variant="ghost"
              onClick={() => setRemoving(true)}
            />
          )}
          <IconButton
            icon="edit"
            label={`Edit ${e.name}`}
            variant="ghost"
            onClick={() => setEditing(true)}
          />
        </div>
      )}
      {editing && <PersonDialog employee={e} roles={roles} onClose={() => setEditing(false)} />}
      <FormDialog
        open={removing}
        onClose={() => setRemoving(false)}
        title={`Deactivate ${e.name}?`}
        description="Their tokens are revoked at once, which signs them out everywhere, including Claude. Their open cases become unassigned. Their history stays."
        submitLabel="Deactivate"
        submitVariant="danger"
        pending={deactivate.isPending}
        onSubmit={async () => {
          const done = await deactivate.mutateAsync({ employeeId: e.id }).catch(() => null);
          setRemoving(false);
          if (done) toast.success(`${e.name} deactivated`);
        }}
      />
    </Card>
  );
}

export function TeamPage() {
  const trpc = useTRPC();
  const { can, me } = useCan();
  const employees = useQuery(trpc.team.employees.queryOptions({ includeInactive: false }));
  const roles = useQuery(trpc.team.roles.queryOptions());
  const [adding, setAdding] = useState(false);
  const [tokenFor, setTokenFor] = useState<string | null>(null);

  return (
    <>
      <PageHeader
        title="Team & roles"
        subtitle="Everyone signs in with their own token, in the dashboard and through MCP"
      >
        {can("team", "edit") && roles.data && (
          <Button variant="soft" icon="plus" onClick={() => setAdding(true)}>
            Add employee
          </Button>
        )}
      </PageHeader>
      <div className="flex flex-col gap-6">
        <QueryView query={employees} what="the team">
          {(data) => (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {data.items.map((e) => (
                <PersonCard
                  key={e.id}
                  e={e}
                  roles={roles.data?.items ?? []}
                  isMe={e.id === me?.employeeId}
                />
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

        {can("team", "full") && (
          <p className="flex items-center gap-2 text-sm text-text-soft">
            <Icon name="key" size={16} />
            Access tokens are created and revoked in{" "}
            <Link to="/settings" className="font-extrabold text-ink underline">
              Settings
            </Link>
            .
          </p>
        )}
      </div>
      {adding && roles.data && (
        <PersonDialog
          roles={roles.data.items}
          onClose={() => setAdding(false)}
          onCreated={(created) => {
            setAdding(false);
            if (can("team", "full")) setTokenFor(created.id);
          }}
        />
      )}
      {tokenFor && <CreateTokenDialog employeeId={tokenFor} onClose={() => setTokenFor(null)} />}
    </>
  );
}
