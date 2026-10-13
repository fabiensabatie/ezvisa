import { links } from "@ezvisa/core";
import { canView, defineTool } from "../tool.js";

/** Read only: the team keeps this list in the dashboard, and agents never change it. */
export const linkTools = [
  defineTool({
    name: "list_links",
    title: "List useful links",
    description:
      "Official websites the agency uses, such as the Thai e-Visa portal or e-WorkPermit, each with a note on when to use it and whether clients apply there themselves. Share these addresses rather than guessing one.",
    input: links.listLinksInput,
    annotations: { readOnlyHint: true },
    visibleTo: canView("links"),
    run: (ctx, input) => links.listLinks(ctx, input),
  }),
];
