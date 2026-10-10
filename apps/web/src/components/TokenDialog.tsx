import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "../lib/toast";
import { TONE } from "../lib/tones";
import { errorMessage, useTRPC } from "../trpc";
import { Button, Dialog, FieldRow, FormDialog, SelectField, TextField } from "./controls";
import { Icon } from "./Icon";

const EXPIRY = [
  { value: "", label: "Never" },
  { value: "30", label: "In 30 days" },
  { value: "90", label: "In 90 days" },
  { value: "365", label: "In a year" },
];

/**
 * Creates an access token, then shows it once. It is the person's login for the
 * dashboard and for MCP clients such as Claude.
 */
export function CreateTokenDialog({
  onClose,
  employeeId: preset,
}: {
  onClose: () => void;
  employeeId?: string;
}) {
  const trpc = useTRPC();
  const employees = useQuery(trpc.team.employees.queryOptions({ includeInactive: false }));
  const create = useMutation(trpc.team.createToken.mutationOptions({ meta: { quiet: true } }));
  const [employeeId, setEmployeeId] = useState(preset ?? "");
  const [label, setLabel] = useState("");
  const [expires, setExpires] = useState("");
  const [secret, setSecret] = useState<{ value: string; for: string } | null>(null);

  if (secret) {
    return (
      <Dialog
        open
        onClose={onClose}
        title={`Token for ${secret.for}`}
        description="Copy it now and give it to them privately. It is not shown again."
      >
        <div className="flex flex-col gap-4">
          <code className="block break-all rounded-2xl bg-bg px-4 py-3.5 font-mono text-sm">
            {secret.value}
          </code>
          <p className={`flex gap-2 rounded-2xl px-3.5 py-3 text-sm font-bold ${TONE.warn}`}>
            <Icon name="key" size={17} className="mt-px" />
            It signs in to this dashboard and connects Claude with this person's role. Anyone who
            has it can act as them, so send it through a private chat.
          </p>
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              variant="outline"
              icon="copy"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(secret.value);
                  toast.success("Token copied");
                } catch {
                  toast.error("Copy failed. Select the token and copy it by hand.");
                }
              }}
            >
              Copy token
            </Button>
            <Button onClick={onClose}>Done</Button>
          </div>
        </div>
      </Dialog>
    );
  }

  return (
    <FormDialog
      open
      onClose={onClose}
      title="Create a token"
      description="For now a token is the login. Create one per device or per Claude connection, so each can be revoked on its own."
      submitLabel="Create token"
      pending={create.isPending}
      error={create.error ? errorMessage(create.error) : null}
      onSubmit={async () => {
        const created = await create
          .mutateAsync({
            employeeId,
            label: label.trim(),
            ...(expires ? { expiresInDays: Number(expires) } : {}),
          })
          .catch(() => null);
        if (created) setSecret({ value: created.secret, for: created.employee.name });
      }}
    >
      <SelectField
        label="Person"
        required
        value={employeeId}
        onChange={(e) => setEmployeeId(e.target.value)}
        options={[
          { value: "", label: employees.isPending ? "Loading…" : "Choose someone" },
          ...(employees.data?.items ?? []).map((e) => ({
            value: e.id,
            label: `${e.name} (${e.role.name})`,
          })),
        ]}
      />
      <FieldRow>
        <TextField
          label="Label"
          required
          placeholder="e.g. Ploy phone, Claude Code"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
        <SelectField
          label="Expires"
          options={EXPIRY}
          value={expires}
          onChange={(e) => setExpires(e.target.value)}
        />
      </FieldRow>
    </FormDialog>
  );
}
