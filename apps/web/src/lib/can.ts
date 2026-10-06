import { useQuery } from "@tanstack/react-query";
import { type Outputs, useTRPC } from "../trpc";

type Permissions = Outputs["me"]["permissions"];
export type Resource = Exclude<keyof Permissions, "approvePacks" | "markSubmitted">;
type Level = "none" | "view" | "edit" | "full";

const ORDER: Level[] = ["none", "view", "edit", "full"];

/**
 * What the signed-in person may do, to hide controls their role cannot use.
 * The server checks every request again; this only keeps the screens tidy.
 */
export function useCan() {
  const trpc = useTRPC();
  const me = useQuery(trpc.me.queryOptions());
  const p = me.data?.permissions;
  return {
    me: me.data,
    can: (resource: Resource, level: Level) =>
      p ? ORDER.indexOf(p[resource]) >= ORDER.indexOf(level) : false,
    approvePacks: Boolean(p?.approvePacks),
    markSubmitted: Boolean(p?.markSubmitted),
    human: me.data?.kind === "HUMAN",
  };
}
