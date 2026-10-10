import { z } from "zod";
import { audit } from "../audit.js";
import { type Context, requireLevel, type Tx } from "../context.js";

const DEFAULTS = { accent: "#EC5F9E", agentName: "EzVisa" };
const KEYS = { accent: "theme.accent", agentName: "agent.name" } as const;

export const updateSettingsInput = z.object({
  accent: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "Use a hex colour such as #EC5F9E")
    .optional()
    .describe("The agency colour every dashboard starts from"),
  agentName: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .optional()
    .describe("Signs reminder messages, e.g. Namtarn"),
});

async function read(tx: Tx) {
  const rows = await tx.setting.findMany({ where: { key: { in: Object.values(KEYS) } } });
  const value = (key: string) => rows.find((r) => r.key === key)?.value;
  const accent = value(KEYS.accent);
  const agentName = value(KEYS.agentName);
  return {
    accent: typeof accent === "string" ? accent : DEFAULTS.accent,
    agentName: typeof agentName === "string" ? agentName : DEFAULTS.agentName,
  };
}

/** Settings every signed-in person may read: the theme and the agent's name. */
export async function getPublicSettings(ctx: Context) {
  return read(ctx.db);
}

export async function updateSettings(ctx: Context, raw: z.input<typeof updateSettingsInput>) {
  requireLevel(ctx, "settings", "edit");
  const input = updateSettingsInput.parse(raw);
  return ctx.db.$transaction(async (tx) => {
    const before = await read(tx);
    for (const field of ["accent", "agentName"] as const) {
      const value = field === "accent" ? input.accent?.toUpperCase() : input[field];
      if (value === undefined) continue;
      await tx.setting.upsert({
        where: { key: KEYS[field] },
        update: { value },
        create: { key: KEYS[field], value },
      });
    }
    const after = await read(tx);
    await audit(tx, ctx, {
      action: "settings.updated",
      entity: "Setting",
      entityId: "public",
      before,
      after,
    });
    return after;
  });
}
