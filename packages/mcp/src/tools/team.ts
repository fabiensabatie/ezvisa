import { team } from "@ezvisa/core";
import { z } from "zod";
import { canAdminister, canEdit, canView, defineTool } from "../tool.js";

export const teamTools = [
  defineTool({
    name: "list_employees",
    title: "List employees",
    description:
      "Lists employees with their role. Deactivated employees are hidden unless asked for.",
    input: team.listEmployeesInput,
    annotations: { readOnlyHint: true },
    visibleTo: canView("team"),
    run: (ctx, input) => team.listEmployees(ctx, input),
  }),
  defineTool({
    name: "get_employee",
    title: "Get an employee",
    description: "One employee with their role and number of open cases assigned.",
    input: team.getEmployeeInput,
    annotations: { readOnlyHint: true },
    visibleTo: canView("team"),
    run: (ctx, input) => team.getEmployee(ctx, input),
  }),
  defineTool({
    name: "create_employee",
    title: "Create an employee",
    description:
      "Adds a person (or an AI assistant) to the team with a role. Tokens are created separately by the owner.",
    input: team.createEmployeeInput,
    visibleTo: canEdit("team"),
    run: (ctx, input) => team.createEmployee(ctx, input),
  }),
  defineTool({
    name: "update_employee",
    title: "Update an employee",
    description: "Changes name, contact details or role. Nobody can change their own role.",
    input: team.updateEmployeeInput,
    annotations: { idempotentHint: true },
    visibleTo: canEdit("team"),
    run: (ctx, input) => team.updateEmployee(ctx, input),
  }),
  defineTool({
    name: "deactivate_employee",
    title: "Deactivate an employee",
    description:
      "Deactivates an employee, revokes all their tokens, ends their sessions and unassigns their open cases.",
    input: team.deactivateEmployeeInput,
    annotations: { destructiveHint: true },
    visibleTo: canAdminister("team"),
    run: (ctx, input) => team.deactivateEmployee(ctx, input),
  }),
  defineTool({
    name: "list_roles",
    title: "List roles",
    description: "Every role with its permissions and how many employees have it.",
    input: z.object({}),
    annotations: { readOnlyHint: true },
    visibleTo: canView("team"),
    run: (ctx) => team.listRoles(ctx),
  }),
  defineTool({
    name: "get_role",
    title: "Get a role",
    description: "One role with its permissions.",
    input: team.getRoleInput,
    annotations: { readOnlyHint: true },
    visibleTo: canView("team"),
    run: (ctx, input) => team.getRole(ctx, input),
  }),
  defineTool({
    name: "create_role",
    title: "Create a role",
    description:
      "Creates a role. Levels per area are none, view, edit (create and update) or full (also delete). approvePacks and markSubmitted are separate switches.",
    input: team.createRoleInput,
    visibleTo: canAdminister("team"),
    run: (ctx, input) => team.createRole(ctx, input),
  }),
  defineTool({
    name: "update_role",
    title: "Update a role",
    description:
      "Changes a role's name, description or permissions. Built-in roles keep their names, and the Owner role keeps full access.",
    input: team.updateRoleInput,
    annotations: { idempotentHint: true },
    visibleTo: canAdminister("team"),
    run: (ctx, input) => team.updateRole(ctx, input),
  }),
  defineTool({
    name: "delete_role",
    title: "Delete a role",
    description: "Deletes a custom role that no employee uses. Built-in roles cannot be deleted.",
    input: team.deleteRoleInput,
    annotations: { destructiveHint: true },
    visibleTo: canAdminister("team"),
    run: (ctx, input) => team.deleteRole(ctx, input),
  }),
  defineTool({
    name: "list_tokens",
    title: "List access tokens",
    description:
      "Lists access tokens, masked, with their status and last use. Tokens are created by script, never through MCP.",
    input: team.listTokensInput,
    annotations: { readOnlyHint: true },
    visibleTo: canAdminister("team"),
    run: (ctx, input) => team.listTokens(ctx, input),
  }),
  defineTool({
    name: "revoke_token",
    title: "Revoke an access token",
    description:
      "Revokes a token immediately and ends its dashboard sessions. The next request with it is refused.",
    input: team.revokeTokenInput,
    annotations: { destructiveHint: true },
    visibleTo: canAdminister("team"),
    run: (ctx, input) => team.revokeToken(ctx, input),
  }),
];
