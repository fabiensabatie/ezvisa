import type { Db } from "@ezvisa/db";
import type { Context } from "../context.js";
import { isDomainError } from "../errors.js";
import type { Permissions } from "../permissions.js";
import { caseWhere } from "../refs.js";

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

type Checked = { input: Record<string, unknown> } | { refused: string };
type Rule = (db: Db, input: Record<string, unknown>, clientId: string | null) => Promise<Checked>;

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

/** No client data involved: open before the client is identified. */
const open: Rule = async (_db, input) => ({ input });

/** `field` must name the identified client. */
const clientField =
  (field: string): Rule =>
  async (_db, input, clientId) => {
    if (!clientId) return { refused: NOT_IDENTIFIED };
    return input[field] === clientId ? { input } : { refused: NOT_THEIRS };
  };

/** The case in `field` must be the identified client's; with `optional`, it may be absent. */
const caseField =
  (field: string, optional = false): Rule =>
  async (db, input, clientId) => {
    if (optional && input[field] === undefined) return { input };
    if (!clientId) return { refused: NOT_IDENTIFIED };
    return (await caseOwner(db, input[field])) === clientId ? { input } : { refused: NOT_THEIRS };
  };

const documentField =
  (field: string): Rule =>
  async (db, input, clientId) => {
    if (!clientId) return { refused: NOT_IDENTIFIED };
    return (await documentOwner(db, input[field])) === clientId
      ? { input }
      : { refused: NOT_THEIRS };
  };

/** Lists are filtered to the identified client, whatever the agent asked. */
const forceClient =
  (field: string): Rule =>
  async (_db, input, clientId) => {
    if (!clientId) return { refused: NOT_IDENTIFIED };
    return { input: { ...input, [field]: clientId } };
  };

const all =
  (...rules: Rule[]): Rule =>
  async (db, input, clientId) => {
    let current = input;
    for (const rule of rules) {
      const checked = await rule(db, current, clientId);
      if ("refused" in checked) return checked;
      current = checked.input;
    }
    return { input: current };
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
  get_client: clientField("clientId"),
  update_client: clientField("clientId"),
  list_cases: forceClient("clientId"),
  get_case: caseField("case"),
  create_case: clientField("clientId"),
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
  clientId: string | null,
): Promise<Checked> {
  const rule = CLIENT_SCOPE[name];
  if (!rule) return { refused: `${name} is not available in a client conversation.` };
  return rule(db, input, clientId);
}
