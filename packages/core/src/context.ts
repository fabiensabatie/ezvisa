import type { Db } from "@ezvisa/db";
import type { Permissions } from "./permissions.js";

export type Via = "DASHBOARD" | "MCP" | "SYSTEM";

/** Who is acting. Built from a token for both the dashboard and MCP. */
export type Actor = {
  employeeId: string;
  kind: "HUMAN" | "ASSISTANT";
  permissions: Permissions;
  tokenId: string;
};

/** Passed to every domain service. */
export type Context = {
  actor: Actor;
  via: Via;
  db: Db;
  now: () => Date;
};
