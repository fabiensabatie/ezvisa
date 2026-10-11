import type { Db } from "@ezvisa/db";
import type { Context } from "../context.js";
import { isDomainError } from "../errors.js";
import type { Permissions } from "../permissions.js";
import { caseNumber, caseWhere, templateWhere } from "../refs.js";
import { nameKey } from "./names.js";

export type AgentToolSpec = {
  name: string;
  description: string;
  input_schema: { type: "object"; [key: string]: unknown };
};

export type AgentToolContent =
  | { type: "text"; text: string }
  | { type: "image"; mediaType: string; data: string }
  | { type: "document"; mediaType: "application/pdf"; data: string };

export type AgentToolOutcome = { content: AgentToolContent[]; isError: boolean };

/**
 * EzVisa's MCP tools, for agents. The server builds it from @ezvisa/mcp, so an agent sees
 * exactly what an MCP token with the same permissions sees; tests build a small one.
 */
export interface AgentToolbox {
  /** The house rules MCP clients receive. */
  readonly instructions: string;
  /** The tools a role can use, as MCP lists them for a token with these permissions. */
  list(permissions: Permissions): AgentToolSpec[];
  run(ctx: Context, name: string, input: Record<string, unknown>): Promise<AgentToolOutcome>;
}

// ---- client agents: one client's records, nothing else ---------------------------------------

/** What a client agent's tool call is checked against. */
export type ClientScope = {
  /** The client this conversation is linked to, once identified. */
  clientId: string | null;
  /** The conversation's channel in EzVisa's terms, for new clients. */
  channel: "LINE" | "WHATSAPP" | "MESSENGER" | "EMAIL" | "PHONE" | null;
  /** The contact's phone number, as the channel reports it (WhatsApp). */
  phone: string | null;
};

type Checked = { input: Record<string, unknown> } | { refused: string };
type Rule = (db: Db, input: Record<string, unknown>, scope: ClientScope) => Promise<Checked>;

const NOT_IDENTIFIED = "The client is not identified yet. Use check_identity first.";
const NOT_THEIRS = "That is not one of this client's records.";

async function caseOwner(db: Db, ref: unknown): Promise<string | null> {
  if (typeof ref !== "string") return null;
  try {
    const row = await db.case.findUnique({ where: caseWhere(ref), select: { clientId: true } });
    return row?.clientId ?? null;
  } catch (error) {
    if (isDomainError(error)) return null;
    throw error;
  }
}

async function documentOwner(db: Db, id: unknown): Promise<string | null> {
  if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  const row = await db.document.findUnique({ where: { id }, select: { clientId: true } });
  return row?.clientId ?? null;
}

/** Keeps only `fields` of the input. */
const only = (input: Record<string, unknown>, fields: readonly string[]) =>
  Object.fromEntries(Object.entries(input).filter(([key]) => fields.includes(key)));

/** No client data involved: open before the client is identified. */
const open: Rule = async (_db, input) => ({ input });

/** `field` must name the identified client. */
const clientField =
  (field: string): Rule =>
  async (_db, input, scope) => {
    if (!scope.clientId) return { refused: NOT_IDENTIFIED };
    return input[field] === scope.clientId ? { input } : { refused: NOT_THEIRS };
  };

/** The case in `field` must be the identified client's; with `optional`, it may be absent. */
const caseField =
  (field: string, optional = false): Rule =>
  async (db, input, scope) => {
    if (optional && input[field] === undefined) return { input };
    if (!scope.clientId) return { refused: NOT_IDENTIFIED };
    return (await caseOwner(db, input[field])) === scope.clientId
      ? { input }
      : { refused: NOT_THEIRS };
  };

const documentField =
  (field: string): Rule =>
  async (db, input, scope) => {
    if (!scope.clientId) return { refused: NOT_IDENTIFIED };
    return (await documentOwner(db, input[field])) === scope.clientId
      ? { input }
      : { refused: NOT_THEIRS };
  };

/** Lists are filtered to the identified client, whatever the agent asked. */
const forceClient =
  (field: string): Rule =>
  async (_db, input, scope) => {
    if (!scope.clientId) return { refused: NOT_IDENTIFIED };
    return { input: { ...input, [field]: scope.clientId } };
  };

const all =
  (...rules: Rule[]): Rule =>
  async (db, input, scope) => {
    let current = input;
    for (const rule of rules) {
      const checked = await rule(db, current, scope);
      if ("refused" in checked) return checked;
      current = checked.input;
    }
    return { input: current };
  };

/** What a new client may give in a chat: no passport number, and never consent on their behalf. */
const NEW_CLIENT_FIELDS = [
  "fullName",
  "nationality",
  "dateOfBirth",
  "email",
  "phone",
  "channel",
  "channelHandle",
  "address",
  "visaType",
  "stayUntil",
  "nextReportDue",
] as const;

/**
 * Someone who is not a client yet becomes one: only while the conversation is not linked,
 * with a date of birth (for later identity checks), and never a second record for someone
 * already known. Consent is given by the client on the upload page, not here.
 */
const createClient: Rule = async (db, input, scope) => {
  if (scope.clientId) {
    return { refused: "This conversation is already linked to a client: work on that client." };
  }
  const dob = typeof input.dateOfBirth === "string" ? input.dateOfBirth : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dob) || typeof input.fullName !== "string") {
    return {
      refused:
        "A new client needs their full name as in the passport, nationality and date of birth (YYYY-MM-DD).",
    };
  }
  const sameBirthday = await db.client.findMany({
    where: { deletedAt: null, dateOfBirth: new Date(`${dob}T00:00:00.000Z`) },
    select: { fullName: true },
  });
  if (sameBirthday.some((c) => nameKey(c.fullName) === nameKey(input.fullName as string))) {
    return {
      refused:
        "A client with this name and date of birth already exists. Use check_identity with the same details instead.",
    };
  }
  return {
    input: {
      ...only(input, NEW_CLIENT_FIELDS),
      channel: input.channel ?? scope.channel ?? undefined,
      phone: input.phone ?? scope.phone ?? undefined,
    },
  };
};

/** A client keeps their identity details; through chat they can change how to reach them. */
const updateClient: Rule = async (db, input, scope) => {
  const checked = await clientField("clientId")(db, input, scope);
  if ("refused" in checked) return checked;
  return {
    input: only(input, ["clientId", "email", "phone", "channel", "channelHandle", "address"]),
  };
};

/**
 * Opens a case (and so its checklist) for the identified client, unless one is already open
 * for the same service: then that one is shared instead. Agents do not assign the team.
 */
const createCase: Rule = async (db, input, scope) => {
  const checked = await clientField("clientId")(db, input, scope);
  if ("refused" in checked) return checked;
  const ref = typeof input.template === "string" ? input.template : "";
  const template = ref ? await db.template.findUnique({ where: templateWhere(ref) }) : null;
  if (template) {
    const existing = await db.case.findFirst({
      where: {
        clientId: scope.clientId as string,
        stage: { notIn: ["DONE", "CANCELLED"] },
        templateVersion: { templateId: template.id },
      },
    });
    if (existing) {
      return {
        refused: `${caseNumber(existing.number)} is already open for ${template.name}. Share that case's checklist with create_client_upload_link instead of opening another.`,
      };
    }
  }
  return { input: only(input, ["clientId", "template", "dueDate", "notes"]) };
};

/**
 * The tools a client agent may use, each with how it is tied to the identified client.
 * Anything not listed (listing every client, reminders, the team, template editing, the
 * inbox) is unavailable to client agents, whatever their role.
 */
const CLIENT_SCOPE: Record<string, Rule> = {
  whoami: open,
  list_templates: open,
  get_template: open,
  get_template_file: caseField("case", true),
  read_template_file: caseField("case", true),
  create_client: createClient,
  get_client: clientField("clientId"),
  update_client: updateClient,
  list_cases: forceClient("clientId"),
  get_case: caseField("case"),
  create_case: createCase,
  update_case: caseField("case"),
  move_case_stage: caseField("case"),
  update_case_item: caseField("case"),
  close_case: caseField("case"),
  create_client_upload_link: caseField("case"),
  revoke_client_upload_link: caseField("case"),
  list_documents: all(forceClient("clientId"), caseField("case", true)),
  get_document: documentField("documentId"),
  read_document: documentField("documentId"),
  update_document: documentField("documentId"),
  delete_document: documentField("documentId"),
  upload_document: all(clientField("clientId"), caseField("case", true)),
  create_document_upload: all(clientField("clientId"), caseField("case", true)),
  confirm_document_upload: all(clientField("clientId"), caseField("case", true)),
};

export function clientScopedTools(tools: AgentToolSpec[]): AgentToolSpec[] {
  return tools.filter((t) => t.name in CLIENT_SCOPE);
}

/** Ties a client agent's tool call to the identified client, or says why it cannot run. */
export async function scopeToClient(
  db: Db,
  name: string,
  input: Record<string, unknown>,
  scope: ClientScope,
): Promise<Checked> {
  const rule = CLIENT_SCOPE[name];
  if (!rule) return { refused: `${name} is not available in a client conversation.` };
  return rule(db, input, scope);
}
