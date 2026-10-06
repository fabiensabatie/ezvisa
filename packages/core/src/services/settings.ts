import type { Context } from "../context.js";

/** Settings every signed-in person may read: the theme and the agent's name. */
export async function getPublicSettings(ctx: Context) {
  const rows = await ctx.db.setting.findMany({
    where: { key: { in: ["theme.accent", "agent.name"] } },
  });
  const value = (key: string) => rows.find((r) => r.key === key)?.value;
  const accent = value("theme.accent");
  const agentName = value("agent.name");
  return {
    accent: typeof accent === "string" ? accent : "#EC5F9E",
    agentName: typeof agentName === "string" ? agentName : "EzVisa",
  };
}
