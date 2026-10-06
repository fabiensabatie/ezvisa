import { clients, team } from "@ezvisa/core";
import { z } from "zod";
import { canAdminister, canEdit, canView, defineTool } from "../tool.js";

export const sessionTools = [
  defineTool({
    name: "whoami",
    title: "Who am I",
    description:
      "Returns the employee this token belongs to, their role and exact permissions. Call it first to know what you are allowed to do.",
    input: z.object({}),
    annotations: { readOnlyHint: true },
    run: (ctx) => team.whoami(ctx),
  }),
];

export const clientTools = [
  defineTool({
    name: "list_clients",
    title: "List clients",
    description:
      "Lists clients alphabetically, with optional search by name, email, phone or passport number, and a filter for stays or 90-day reports ending soon. Paginated.",
    input: clients.listClientsInput,
    annotations: { readOnlyHint: true },
    visibleTo: canView("clients"),
    run: (ctx, input) => clients.listClients(ctx, input),
  }),
  defineTool({
    name: "get_client",
    title: "Get a client",
    description:
      "Full client record with upcoming deadlines (days left), all their cases and stored documents.",
    input: clients.getClientInput,
    annotations: { readOnlyHint: true },
    visibleTo: canView("clients"),
    run: (ctx, input) => clients.getClient(ctx, input),
  }),
  defineTool({
    name: "create_client",
    title: "Create a client",
    description:
      "Creates a client. Copy the name exactly as on the passport. Set consentGiven only when the client has accepted the privacy notice; documents cannot be stored before that. Check with list_clients first to avoid duplicates.",
    input: clients.createClientInput,
    visibleTo: canEdit("clients"),
    run: (ctx, input) => clients.createClient(ctx, input),
  }),
  defineTool({
    name: "update_client",
    title: "Update a client",
    description:
      "Updates the given fields only. Pass null to clear a field. After an approved extension or a filed 90-day report, update stayUntil or nextReportDue so reminders follow the new date.",
    input: clients.updateClientInput,
    annotations: { idempotentHint: true },
    visibleTo: canEdit("clients"),
    run: (ctx, input) => clients.updateClient(ctx, input),
  }),
  defineTool({
    name: "delete_client",
    title: "Delete a client",
    description:
      "Removes a client from lists. Refused while the client has open cases. Data is kept until the retention period ends.",
    input: clients.deleteClientInput,
    annotations: { destructiveHint: true },
    visibleTo: canAdminister("clients"),
    run: (ctx, input) => clients.deleteClient(ctx, input),
  }),
];
