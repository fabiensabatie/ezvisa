import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useId, useState } from "react";
import { COUNTRIES, countryName } from "../lib/format";
import { toast } from "../lib/toast";
import { CHANNEL_LABEL } from "../lib/tones";
import { errorMessage, type Outputs, useTRPC } from "../trpc";
import {
  CheckboxField,
  FieldRow,
  FormDialog,
  nullable,
  optional,
  SelectField,
  TextAreaField,
  TextField,
} from "./controls";

type Client = Outputs["clients"]["get"];
type Channel = "LINE" | "WHATSAPP" | "MESSENGER" | "EMAIL" | "PHONE";

const CHANNELS = Object.entries(CHANNEL_LABEL).map(([value, label]) => ({ value, label }));

/** Adds a client, or edits one when `client` is given. */
export function ClientDialog({
  open,
  onClose,
  client,
}: {
  open: boolean;
  onClose: () => void;
  client?: Client;
}) {
  const trpc = useTRPC();
  const navigate = useNavigate();
  const countriesId = useId();
  const create = useMutation(trpc.clients.create.mutationOptions({ meta: { quiet: true } }));
  const update = useMutation(trpc.clients.update.mutationOptions({ meta: { quiet: true } }));
  const mutation = client ? update : create;

  const [form, setForm] = useState({
    fullName: client?.fullName ?? "",
    nationality: client?.nationality ?? "",
    passportNo: client?.passportNo ?? "",
    dateOfBirth: client?.dateOfBirth ?? "",
    email: client?.email ?? "",
    phone: client?.phone ?? "",
    channel: (client?.channel ?? "LINE") as Channel,
    channelHandle: client?.channelHandle ?? "",
    address: client?.address ?? "",
    visaType: client?.visaType ?? "",
    stayUntil: client?.stayUntil ?? "",
    nextReportDue: client?.nextReportDue ?? "",
    notes: client?.notes ?? "",
    consent: Boolean(client?.consentAt),
  });
  const set =
    <K extends keyof typeof form>(key: K) =>
    (value: (typeof form)[K]) =>
      setForm((f) => ({ ...f, [key]: value }));

  async function save() {
    const nationality = form.nationality.trim().toUpperCase();
    if (client) {
      const saved = await update
        .mutateAsync({
          clientId: client.id,
          fullName: form.fullName.trim(),
          nationality,
          passportNo: nullable(form.passportNo),
          dateOfBirth: nullable(form.dateOfBirth),
          email: nullable(form.email),
          phone: nullable(form.phone),
          channel: form.channel,
          channelHandle: nullable(form.channelHandle),
          address: nullable(form.address),
          visaType: nullable(form.visaType),
          stayUntil: nullable(form.stayUntil),
          nextReportDue: nullable(form.nextReportDue),
          notes: nullable(form.notes),
          ...(form.consent !== Boolean(client.consentAt) ? { consentGiven: form.consent } : {}),
        })
        .catch(() => null);
      if (saved) {
        toast.success(`${saved.fullName} saved`);
        onClose();
      }
      return;
    }
    const created = await create
      .mutateAsync({
        fullName: form.fullName.trim(),
        nationality,
        passportNo: optional(form.passportNo),
        dateOfBirth: optional(form.dateOfBirth),
        email: optional(form.email),
        phone: optional(form.phone),
        channel: form.channel,
        channelHandle: optional(form.channelHandle),
        address: optional(form.address),
        visaType: optional(form.visaType),
        stayUntil: optional(form.stayUntil),
        nextReportDue: optional(form.nextReportDue),
        notes: optional(form.notes),
        consentGiven: form.consent,
      })
      .catch(() => null);
    if (created) {
      toast.success(`${created.fullName} added`);
      onClose();
      void navigate({ to: "/clients/$clientId", params: { clientId: created.id } });
    }
  }

  return (
    <FormDialog
      open={open}
      wide
      onClose={() => {
        mutation.reset();
        onClose();
      }}
      title={client ? `Edit ${client.fullName}` : "New client"}
      description="Dates drive the reminders: changing them reschedules the messages."
      submitLabel={client ? "Save" : "Add client"}
      pending={mutation.isPending}
      error={mutation.error ? errorMessage(mutation.error) : null}
      onSubmit={save}
    >
      <FieldRow>
        <TextField
          label="Full name"
          hint="Exactly as on the passport"
          required
          autoComplete="off"
          value={form.fullName}
          onChange={(e) => set("fullName")(e.target.value)}
        />
        <TextField
          label="Nationality"
          hint={
            form.nationality.length === 2
              ? countryName(form.nationality)
              : "Two-letter country code, e.g. GB, DE, US"
          }
          required
          minLength={2}
          maxLength={2}
          pattern="[A-Za-z]{2}"
          list={countriesId}
          value={form.nationality}
          onChange={(e) => set("nationality")(e.target.value.toUpperCase())}
        />
        <datalist id={countriesId}>
          {Object.entries(COUNTRIES).map(([code, name]) => (
            <option key={code} value={code}>
              {name}
            </option>
          ))}
        </datalist>
      </FieldRow>
      <FieldRow>
        <TextField
          label="Passport number"
          value={form.passportNo}
          onChange={(e) => set("passportNo")(e.target.value)}
        />
        <TextField
          label="Date of birth"
          type="date"
          value={form.dateOfBirth}
          onChange={(e) => set("dateOfBirth")(e.target.value)}
        />
      </FieldRow>
      <FieldRow>
        <SelectField
          label="Preferred channel"
          options={CHANNELS}
          value={form.channel}
          onChange={(e) => set("channel")(e.target.value as Channel)}
        />
        <TextField
          label="LINE id or number"
          value={form.channelHandle}
          onChange={(e) => set("channelHandle")(e.target.value)}
        />
      </FieldRow>
      <FieldRow>
        <TextField
          label="Email"
          type="email"
          value={form.email}
          onChange={(e) => set("email")(e.target.value)}
        />
        <TextField
          label="Phone"
          type="tel"
          placeholder="+66 …"
          value={form.phone}
          onChange={(e) => set("phone")(e.target.value)}
        />
      </FieldRow>
      <TextField
        label="Address in Thailand"
        value={form.address}
        onChange={(e) => set("address")(e.target.value)}
      />
      <FieldRow>
        <TextField
          label="Current visa"
          placeholder="e.g. Non-O retirement, DTV"
          value={form.visaType}
          onChange={(e) => set("visaType")(e.target.value)}
        />
        <div />
      </FieldRow>
      <FieldRow>
        <TextField
          label="Permission to stay ends"
          type="date"
          value={form.stayUntil}
          onChange={(e) => set("stayUntil")(e.target.value)}
        />
        <TextField
          label="Next 90-day report"
          type="date"
          value={form.nextReportDue}
          onChange={(e) => set("nextReportDue")(e.target.value)}
        />
      </FieldRow>
      <TextAreaField
        label="Notes"
        value={form.notes}
        onChange={(e) => set("notes")(e.target.value)}
      />
      <CheckboxField
        label="The client accepted the privacy notice"
        hint={
          client?.consentAt && !form.consent
            ? "Unticking records that consent was withdrawn. No new documents can be stored."
            : "Required before any of their documents can be stored (PDPA)."
        }
        checked={form.consent}
        onChange={set("consent")}
      />
    </FormDialog>
  );
}
