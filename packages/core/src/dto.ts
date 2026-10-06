import type {
  ApiToken,
  Case,
  CaseItem,
  Client,
  Document,
  Employee,
  Reminder,
  ReminderRule,
  Role,
  Template,
  TemplateFile,
  TemplateItem,
  TemplateVersion,
} from "@ezvisa/db";
import { formatDateOnlyOrNull } from "./dates.js";
import { parsePermissions } from "./permissions.js";
import { caseNumber } from "./refs.js";
import { maskToken } from "./tokens.js";

// Plain JSON shapes returned by services, the dashboard API and MCP tools.
// Calendar dates are YYYY-MM-DD; timestamps are ISO 8601 in UTC.

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

export function clientDto(c: Client) {
  return {
    id: c.id,
    fullName: c.fullName,
    nationality: c.nationality,
    passportNo: c.passportNo,
    dateOfBirth: formatDateOnlyOrNull(c.dateOfBirth),
    email: c.email,
    phone: c.phone,
    channel: c.channel,
    channelHandle: c.channelHandle,
    address: c.address,
    visaType: c.visaType,
    stayUntil: formatDateOnlyOrNull(c.stayUntil),
    nextReportDue: formatDateOnlyOrNull(c.nextReportDue),
    notes: c.notes,
    consentAt: iso(c.consentAt),
    createdAt: iso(c.createdAt),
    updatedAt: iso(c.updatedAt),
  };
}
export type ClientDto = ReturnType<typeof clientDto>;

export function employeeDto(e: Employee & { role: Role }) {
  return {
    id: e.id,
    name: e.name,
    email: e.email,
    phone: e.phone,
    kind: e.kind,
    active: e.active,
    role: { id: e.role.id, name: e.role.name },
    createdAt: iso(e.createdAt),
  };
}
export type EmployeeDto = ReturnType<typeof employeeDto>;

export function roleDto(r: Role & { _count?: { employees: number } }) {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    isSystem: r.isSystem,
    permissions: parsePermissions(r.permissions),
    employeeCount: r._count?.employees ?? null,
  };
}
export type RoleDto = ReturnType<typeof roleDto>;

export function tokenDto(t: ApiToken & { employee: Employee }, now: Date) {
  const status = t.revokedAt ? "revoked" : t.expiresAt && t.expiresAt <= now ? "expired" : "active";
  return {
    id: t.id,
    employee: { id: t.employee.id, name: t.employee.name },
    label: t.label,
    token: maskToken(t.last4),
    status,
    createdAt: iso(t.createdAt),
    lastUsedAt: iso(t.lastUsedAt),
    expiresAt: iso(t.expiresAt),
    revokedAt: iso(t.revokedAt),
  };
}
export type TokenDto = ReturnType<typeof tokenDto>;

export function templateItemDto(i: TemplateItem) {
  return {
    id: i.id,
    position: i.position,
    label: i.label,
    description: i.description,
    kind: i.kind,
    required: i.required,
    rules: i.rules as Record<string, unknown> | null,
    formFileId: i.formFileId,
  };
}

export function templateFileDto(f: TemplateFile) {
  return {
    id: f.id,
    name: f.name,
    kind: f.kind,
    mimeType: f.mimeType,
    sizeBytes: f.sizeBytes,
  };
}

export function templateVersionDto(
  v: TemplateVersion & { items: TemplateItem[]; files: TemplateFile[] },
) {
  return {
    id: v.id,
    version: v.version,
    status: v.status,
    knownFailures: v.knownFailures,
    notes: v.notes,
    publishedAt: iso(v.publishedAt),
    items: [...v.items].sort((a, b) => a.position - b.position).map(templateItemDto),
    files: v.files.map(templateFileDto),
  };
}
export type TemplateVersionDto = ReturnType<typeof templateVersionDto>;

type VersionWithCount = TemplateVersion & { _count?: { items: number }; items?: unknown[] };

export function templateSummaryDto(t: Template & { versions: VersionWithCount[] }) {
  const published = t.versions.find((v) => v.status === "PUBLISHED");
  const draft = t.versions.find((v) => v.status === "DRAFT");
  const current = published ?? draft;
  return {
    id: t.id,
    slug: t.slug,
    name: t.name,
    description: t.description,
    office: t.office,
    deadlineKind: t.deadlineKind,
    archived: t.archivedAt !== null,
    publishedVersion: published?.version ?? null,
    draftVersion: draft?.version ?? null,
    itemCount: current?.items?.length ?? current?._count?.items ?? null,
  };
}
export type TemplateSummaryDto = ReturnType<typeof templateSummaryDto>;

export function documentDto(d: Document) {
  return {
    id: d.id,
    clientId: d.clientId,
    caseId: d.caseId,
    caseItemId: d.caseItemId,
    filename: d.filename,
    mimeType: d.mimeType,
    sizeBytes: d.sizeBytes,
    sha256: d.sha256,
    extracted: d.extracted as Record<string, unknown> | null,
    createdAt: iso(d.createdAt),
  };
}
export type DocumentDto = ReturnType<typeof documentDto>;

export function caseItemDto(i: CaseItem & { documents?: Array<{ id: string }> }) {
  return {
    id: i.id,
    position: i.position,
    label: i.label,
    kind: i.kind,
    required: i.required,
    status: i.status,
    note: i.note,
    flaggedBy: i.flaggedByKind,
    documentIds: i.documents?.map((d) => d.id) ?? [],
    updatedAt: iso(i.updatedAt),
  };
}

function progress(items: CaseItem[]) {
  const required = items.filter((i) => i.required);
  return {
    requiredItems: required.length,
    received: required.filter((i) => ["RECEIVED", "VERIFIED", "WAIVED"].includes(i.status)).length,
    verified: required.filter((i) => ["VERIFIED", "WAIVED"].includes(i.status)).length,
    flagged: items.filter((i) => i.status === "FLAGGED").length,
  };
}

export type CaseWithRelations = Case & {
  client: Client;
  assignee: Employee | null;
  templateVersion: TemplateVersion & { template: Template };
  items: Array<CaseItem & { documents?: Array<{ id: string }> }>;
};

export function caseSummaryDto(c: CaseWithRelations) {
  return {
    id: c.id,
    number: caseNumber(c.number),
    stage: c.stage,
    outcome: c.outcome,
    client: { id: c.client.id, fullName: c.client.fullName },
    template: {
      slug: c.templateVersion.template.slug,
      name: c.templateVersion.template.name,
      version: c.templateVersion.version,
    },
    assignee: c.assignee ? { id: c.assignee.id, name: c.assignee.name } : null,
    dueDate: formatDateOnlyOrNull(c.dueDate),
    progress: progress(c.items),
    createdAt: iso(c.createdAt),
    updatedAt: iso(c.updatedAt),
    closedAt: iso(c.closedAt),
  };
}
export type CaseSummaryDto = ReturnType<typeof caseSummaryDto>;

export function caseDetailDto(c: CaseWithRelations & { documents: Document[] }) {
  return {
    ...caseSummaryDto(c),
    notes: c.notes,
    knownFailures: c.templateVersion.knownFailures,
    items: [...c.items].sort((a, b) => a.position - b.position).map(caseItemDto),
    documents: c.documents.filter((d) => !d.deletedAt).map(documentDto),
  };
}
export type CaseDetailDto = ReturnType<typeof caseDetailDto>;

export function reminderRuleDto(r: ReminderRule) {
  return {
    kind: r.kind,
    offsetsDays: r.offsetsDays,
    messageTemplate: r.messageTemplate,
    active: r.active,
  };
}

export function reminderDto(r: Reminder & { client: Client }, message: string | null) {
  return {
    id: r.id,
    client: { id: r.client.id, fullName: r.client.fullName },
    kind: r.kind,
    deadline: formatDateOnlyOrNull(r.deadline),
    offsetDays: r.offsetDays,
    sendOn: formatDateOnlyOrNull(r.sendOn),
    status: r.status,
    channel: r.channel,
    message: r.message ?? message,
    sentAt: iso(r.sentAt),
  };
}
export type ReminderDto = ReturnType<typeof reminderDto>;
