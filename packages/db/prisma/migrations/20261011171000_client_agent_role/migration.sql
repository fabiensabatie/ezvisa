-- The preset role for chat agents answering clients (ROLE_PRESETS in @ezvisa/core). Seeding
-- adds presets to new environments; this adds it to environments seeded before it existed.
INSERT INTO "Role" ("id", "name", "description", "permissions", "isSystem", "createdAt", "updatedAt")
VALUES (
  gen_random_uuid(),
  'Client agent',
  'For chat agents answering clients: reads the identified client''s cases and documents and shares their upload link.',
  '{"clients":"view","cases":"edit","documents":"view","templates":"view","reminders":"none","team":"none","settings":"none","approvePacks":false,"markSubmitted":false}'::jsonb,
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("name") DO NOTHING;
