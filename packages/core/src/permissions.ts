import { z } from "zod";

export const LEVELS = ["none", "view", "edit", "full"] as const;
export type Level = (typeof LEVELS)[number];

export const RESOURCES = [
  "clients",
  "cases",
  "documents",
  "templates",
  "reminders",
  "team",
  "settings",
] as const;
export type Resource = (typeof RESOURCES)[number];

const levelSchema = z.enum(LEVELS);

export const permissionsSchema = z.object({
  clients: levelSchema,
  cases: levelSchema,
  documents: levelSchema,
  templates: levelSchema,
  reminders: levelSchema,
  team: levelSchema,
  settings: levelSchema,
  /** Move a case to SUBMISSION. Humans only, enforced separately. */
  approvePacks: z.boolean(),
  /** Move a case from SUBMISSION to DONE and record the outcome. */
  markSubmitted: z.boolean(),
});

export type Permissions = z.infer<typeof permissionsSchema>;

/** Parses the JSON stored on a role. Throws if the shape is wrong. */
export function parsePermissions(value: unknown): Permissions {
  return permissionsSchema.parse(value);
}

/** True when the permission on `resource` is at least `min`. */
export function hasLevel(permissions: Permissions, resource: Resource, min: Level): boolean {
  return LEVELS.indexOf(permissions[resource]) >= LEVELS.indexOf(min);
}

export const NO_PERMISSIONS: Permissions = {
  clients: "none",
  cases: "none",
  documents: "none",
  templates: "none",
  reminders: "none",
  team: "none",
  settings: "none",
  approvePacks: false,
  markSubmitted: false,
};

export type RolePreset = {
  name: string;
  description: string;
  permissions: Permissions;
};

/** The roles seeded into every environment. Matches the spec, section 5.4. */
export const ROLE_PRESETS: readonly RolePreset[] = [
  {
    name: "Owner",
    description: "Runs the agency. Full access.",
    permissions: {
      clients: "full",
      cases: "full",
      documents: "full",
      templates: "full",
      reminders: "full",
      team: "full",
      settings: "full",
      approvePacks: true,
      markSubmitted: true,
    },
  },
  {
    name: "Senior agent",
    description: "Handles complex cases and signs off packs.",
    permissions: {
      clients: "full",
      cases: "full",
      documents: "full",
      templates: "edit",
      reminders: "edit",
      team: "view",
      settings: "view",
      approvePacks: true,
      markSubmitted: true,
    },
  },
  {
    name: "Validator",
    description: "Checks packs against the originals.",
    permissions: {
      clients: "edit",
      cases: "edit",
      documents: "edit",
      templates: "view",
      reminders: "edit",
      team: "none",
      settings: "none",
      approvePacks: true,
      markSubmitted: false,
    },
  },
  {
    name: "Runner",
    description: "Files packs at immigration and records the outcome.",
    permissions: {
      clients: "view",
      cases: "view",
      documents: "view",
      templates: "view",
      reminders: "view",
      team: "none",
      settings: "none",
      approvePacks: false,
      markSubmitted: true,
    },
  },
  {
    name: "Client agent",
    description:
      "For chat agents answering clients: reads the identified client's cases and documents and shares their upload link.",
    permissions: {
      clients: "view",
      cases: "edit",
      documents: "view",
      templates: "view",
      reminders: "none",
      team: "none",
      settings: "none",
      approvePacks: false,
      markSubmitted: false,
    },
  },
  {
    name: "Assistant (MCP)",
    description: "An AI assistant connected through MCP. Drafts and flags, never approves.",
    permissions: {
      clients: "edit",
      cases: "edit",
      documents: "edit",
      templates: "view",
      reminders: "view",
      team: "none",
      settings: "none",
      approvePacks: false,
      markSubmitted: false,
    },
  },
];

/** What both may do: the lower level on each resource, and a flag only if both have it. */
export function intersectPermissions(a: Permissions, b: Permissions): Permissions {
  const lower = (x: Level, y: Level) => (LEVELS.indexOf(x) <= LEVELS.indexOf(y) ? x : y);
  return {
    clients: lower(a.clients, b.clients),
    cases: lower(a.cases, b.cases),
    documents: lower(a.documents, b.documents),
    templates: lower(a.templates, b.templates),
    reminders: lower(a.reminders, b.reminders),
    team: lower(a.team, b.team),
    settings: lower(a.settings, b.settings),
    approvePacks: a.approvePacks && b.approvePacks,
    markSubmitted: a.markSubmitted && b.markSubmitted,
  };
}
