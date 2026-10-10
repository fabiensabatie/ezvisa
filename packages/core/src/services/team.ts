import { z } from "zod";
import { audit } from "../audit.js";
import { type Context, requireHuman, requireLevel } from "../context.js";
import { employeeDto, roleDto, tokenDto } from "../dto.js";
import { DomainError } from "../errors.js";
import { permissionsSchema } from "../permissions.js";
import { id, notFound } from "../refs.js";
import { generateToken, hashToken, tokenLast4 } from "../tokens.js";

// ---- whoami ---------------------------------------------------------------

export async function whoami(ctx: Context) {
  const token = await ctx.db.apiToken.findUnique({ where: { id: ctx.actor.tokenId } });
  return {
    employeeId: ctx.actor.employeeId,
    name: ctx.actor.name,
    kind: ctx.actor.kind,
    role: ctx.actor.roleName,
    permissions: ctx.actor.permissions,
    token: token ? { id: token.id, label: token.label } : null,
  };
}

// ---- employees -------------------------------------------------------------

export const listEmployeesInput = z.object({
  includeInactive: z.boolean().default(false).describe("Include deactivated employees"),
});
export const getEmployeeInput = z.object({ employeeId: id("Employee") });
export const createEmployeeInput = z.object({
  name: z.string().trim().min(1).max(120).describe("Display name"),
  email: z.string().trim().email().optional().describe("Work email, unique"),
  phone: z.string().trim().max(40).optional(),
  roleId: id("Role"),
  kind: z.enum(["HUMAN", "ASSISTANT"]).default("HUMAN").describe("ASSISTANT for an AI agent"),
});
export const updateEmployeeInput = z.object({
  employeeId: id("Employee"),
  name: z.string().trim().min(1).max(120).optional(),
  email: z.string().trim().email().nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  roleId: id("Role").optional(),
});
export const deactivateEmployeeInput = z.object({ employeeId: id("Employee") });

const withRole = { role: true } as const;

export async function listEmployees(ctx: Context, raw: z.input<typeof listEmployeesInput>) {
  requireLevel(ctx, "team", "view");
  const input = listEmployeesInput.parse(raw);
  const rows = await ctx.db.employee.findMany({
    where: input.includeInactive ? {} : { active: true },
    include: withRole,
    orderBy: { name: "asc" },
  });
  return { items: rows.map(employeeDto) };
}

/** People a case can be assigned to. Needs only case access, unlike the team list. */
export async function listAssignees(ctx: Context) {
  requireLevel(ctx, "cases", "view");
  const rows = await ctx.db.employee.findMany({
    where: { active: true, kind: "HUMAN" },
    include: withRole,
    orderBy: { name: "asc" },
  });
  return { items: rows.map((e) => ({ id: e.id, name: e.name, role: e.role.name })) };
}

export async function getEmployee(ctx: Context, raw: z.input<typeof getEmployeeInput>) {
  requireLevel(ctx, "team", "view");
  const { employeeId } = getEmployeeInput.parse(raw);
  const row = await ctx.db.employee.findUnique({ where: { id: employeeId }, include: withRole });
  if (!row) throw notFound("employee", employeeId);
  const openCases = await ctx.db.case.count({
    where: { assigneeId: employeeId, stage: { notIn: ["DONE", "CANCELLED"] } },
  });
  return { ...employeeDto(row), openCases };
}

async function assertRole(ctx: Context, roleId: string) {
  const role = await ctx.db.role.findUnique({ where: { id: roleId } });
  if (!role) throw notFound("role", roleId);
  return role;
}

export async function createEmployee(ctx: Context, raw: z.input<typeof createEmployeeInput>) {
  requireLevel(ctx, "team", "edit");
  const input = createEmployeeInput.parse(raw);
  await assertRole(ctx, input.roleId);
  return ctx.db.$transaction(async (tx) => {
    const row = await tx.employee.create({
      data: { ...input, email: input.email?.toLowerCase() },
      include: withRole,
    });
    await audit(tx, ctx, {
      action: "employee.created",
      entity: "Employee",
      entityId: row.id,
      after: employeeDto(row),
    });
    return employeeDto(row);
  });
}

export async function updateEmployee(ctx: Context, raw: z.input<typeof updateEmployeeInput>) {
  requireLevel(ctx, "team", "edit");
  const { employeeId, ...input } = updateEmployeeInput.parse(raw);
  const before = await ctx.db.employee.findUnique({ where: { id: employeeId }, include: withRole });
  if (!before) throw notFound("employee", employeeId);
  if (input.roleId) await assertRole(ctx, input.roleId);
  if (input.roleId && employeeId === ctx.actor.employeeId) {
    throw new DomainError("CONFLICT", "You cannot change your own role.");
  }
  return ctx.db.$transaction(async (tx) => {
    const row = await tx.employee.update({
      where: { id: employeeId },
      data: { ...input, email: input.email === null ? null : input.email?.toLowerCase() },
      include: withRole,
    });
    await audit(tx, ctx, {
      action: "employee.updated",
      entity: "Employee",
      entityId: row.id,
      before: employeeDto(before),
      after: employeeDto(row),
    });
    return employeeDto(row);
  });
}

export async function deactivateEmployee(
  ctx: Context,
  raw: z.input<typeof deactivateEmployeeInput>,
) {
  requireLevel(ctx, "team", "full");
  const { employeeId } = deactivateEmployeeInput.parse(raw);
  if (employeeId === ctx.actor.employeeId) {
    throw new DomainError("CONFLICT", "You cannot deactivate yourself.");
  }
  const before = await ctx.db.employee.findUnique({ where: { id: employeeId }, include: withRole });
  if (!before) throw notFound("employee", employeeId);

  return ctx.db.$transaction(async (tx) => {
    const now = ctx.now();
    const row = await tx.employee.update({
      where: { id: employeeId },
      data: { active: false },
      include: withRole,
    });
    const tokens = await tx.apiToken.findMany({ where: { employeeId, revokedAt: null } });
    await tx.apiToken.updateMany({
      where: { employeeId, revokedAt: null },
      data: { revokedAt: now },
    });
    await tx.session.deleteMany({ where: { tokenId: { in: tokens.map((t) => t.id) } } });
    await tx.oAuthAccessToken.deleteMany({ where: { tokenId: { in: tokens.map((t) => t.id) } } });
    await tx.case.updateMany({
      where: { assigneeId: employeeId, stage: { notIn: ["DONE", "CANCELLED"] } },
      data: { assigneeId: null },
    });
    await audit(tx, ctx, {
      action: "employee.deactivated",
      entity: "Employee",
      entityId: row.id,
      before: employeeDto(before),
      after: { ...employeeDto(row), tokensRevoked: tokens.length },
    });
    return { ...employeeDto(row), tokensRevoked: tokens.length };
  });
}

// ---- roles -----------------------------------------------------------------

export const getRoleInput = z.object({ roleId: id("Role") });
export const createRoleInput = z.object({
  name: z.string().trim().min(1).max(60),
  description: z.string().trim().max(300).optional(),
  permissions: permissionsSchema,
});
export const updateRoleInput = z.object({
  roleId: id("Role"),
  name: z.string().trim().min(1).max(60).optional(),
  description: z.string().trim().max(300).nullable().optional(),
  permissions: permissionsSchema.optional(),
});
export const deleteRoleInput = z.object({ roleId: id("Role") });

const withCount = { _count: { select: { employees: true } } } as const;

export async function listRoles(ctx: Context) {
  requireLevel(ctx, "team", "view");
  const rows = await ctx.db.role.findMany({ include: withCount, orderBy: { createdAt: "asc" } });
  return { items: rows.map(roleDto) };
}

export async function getRole(ctx: Context, raw: z.input<typeof getRoleInput>) {
  requireLevel(ctx, "team", "view");
  const { roleId } = getRoleInput.parse(raw);
  const row = await ctx.db.role.findUnique({ where: { id: roleId }, include: withCount });
  if (!row) throw notFound("role", roleId);
  return roleDto(row);
}

export async function createRole(ctx: Context, raw: z.input<typeof createRoleInput>) {
  requireLevel(ctx, "team", "full");
  const input = createRoleInput.parse(raw);
  return ctx.db.$transaction(async (tx) => {
    const row = await tx.role.create({ data: input, include: withCount });
    await audit(tx, ctx, {
      action: "role.created",
      entity: "Role",
      entityId: row.id,
      after: roleDto(row),
    });
    return roleDto(row);
  });
}

export async function updateRole(ctx: Context, raw: z.input<typeof updateRoleInput>) {
  requireLevel(ctx, "team", "full");
  const { roleId, ...input } = updateRoleInput.parse(raw);
  const before = await ctx.db.role.findUnique({ where: { id: roleId }, include: withCount });
  if (!before) throw notFound("role", roleId);
  if (before.isSystem && input.name && input.name !== before.name) {
    throw new DomainError("CONFLICT", `The built-in ${before.name} role cannot be renamed.`);
  }
  if (before.name === "Owner" && input.permissions) {
    throw new DomainError("CONFLICT", "The Owner role keeps full access so nobody is locked out.");
  }
  return ctx.db.$transaction(async (tx) => {
    const row = await tx.role.update({ where: { id: roleId }, data: input, include: withCount });
    await audit(tx, ctx, {
      action: "role.updated",
      entity: "Role",
      entityId: row.id,
      before: roleDto(before),
      after: roleDto(row),
    });
    return roleDto(row);
  });
}

export async function deleteRole(ctx: Context, raw: z.input<typeof deleteRoleInput>) {
  requireLevel(ctx, "team", "full");
  const { roleId } = deleteRoleInput.parse(raw);
  const row = await ctx.db.role.findUnique({ where: { id: roleId }, include: withCount });
  if (!row) throw notFound("role", roleId);
  if (row.isSystem)
    throw new DomainError("CONFLICT", `The built-in ${row.name} role cannot be deleted.`);
  if (row._count.employees > 0) {
    throw new DomainError(
      "CONFLICT",
      `${row._count.employees} employee(s) still have the ${row.name} role. Move them first.`,
    );
  }
  return ctx.db.$transaction(async (tx) => {
    await tx.role.delete({ where: { id: roleId } });
    await audit(tx, ctx, {
      action: "role.deleted",
      entity: "Role",
      entityId: roleId,
      before: roleDto(row),
    });
    return { deleted: true as const, roleId };
  });
}

// ---- tokens ----------------------------------------------------------------

export const listTokensInput = z.object({
  employeeId: id("Employee").optional().describe("Only this employee's tokens"),
});
export const revokeTokenInput = z.object({ tokenId: id("Token") });
export const createTokenInput = z.object({
  employeeId: id("Employee"),
  label: z.string().trim().min(1).max(80).describe('Where it is used, e.g. "Ploy phone"'),
  expiresInDays: z.number().int().min(1).max(3650).optional(),
});

export async function listTokens(ctx: Context, raw: z.input<typeof listTokensInput>) {
  requireLevel(ctx, "team", "full");
  const input = listTokensInput.parse(raw);
  const rows = await ctx.db.apiToken.findMany({
    where: input.employeeId ? { employeeId: input.employeeId } : {},
    include: { employee: true },
    orderBy: { createdAt: "asc" },
  });
  const now = ctx.now();
  return { items: rows.map((t) => tokenDto(t, now)) };
}

/** Creates an access token. The plain token is returned once and never stored. */
export async function createToken(ctx: Context, raw: z.input<typeof createTokenInput>) {
  requireLevel(ctx, "team", "full");
  requireHuman(ctx, "create access tokens");
  const input = createTokenInput.parse(raw);
  const employee = await ctx.db.employee.findUnique({ where: { id: input.employeeId } });
  if (!employee?.active) throw notFound("active employee", input.employeeId);

  const token = generateToken();
  const now = ctx.now();
  return ctx.db.$transaction(async (tx) => {
    const row = await tx.apiToken.create({
      data: {
        employeeId: employee.id,
        label: input.label,
        hash: hashToken(token),
        last4: tokenLast4(token),
        expiresAt: input.expiresInDays
          ? new Date(now.getTime() + input.expiresInDays * 86_400_000)
          : null,
      },
      include: { employee: true },
    });
    await audit(tx, ctx, {
      action: "token.created",
      entity: "ApiToken",
      entityId: row.id,
      after: { employee: employee.name, label: row.label, expiresAt: row.expiresAt },
    });
    return { ...tokenDto(row, now), secret: token };
  });
}

export async function revokeToken(ctx: Context, raw: z.input<typeof revokeTokenInput>) {
  requireLevel(ctx, "team", "full");
  const { tokenId } = revokeTokenInput.parse(raw);
  const token = await ctx.db.apiToken.findUnique({
    where: { id: tokenId },
    include: { employee: true },
  });
  if (!token) throw notFound("token", tokenId);
  if (token.revokedAt) return tokenDto(token, ctx.now());

  return ctx.db.$transaction(async (tx) => {
    const row = await tx.apiToken.update({
      where: { id: tokenId },
      data: { revokedAt: ctx.now() },
      include: { employee: true },
    });
    const sessions = await tx.session.deleteMany({ where: { tokenId } });
    await tx.oAuthAccessToken.deleteMany({ where: { tokenId } });
    await audit(tx, ctx, {
      action: "token.revoked",
      entity: "ApiToken",
      entityId: tokenId,
      after: { label: row.label, sessionsEnded: sessions.count },
    });
    return tokenDto(row, ctx.now());
  });
}
