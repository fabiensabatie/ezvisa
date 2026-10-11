-- Client agents may now register a new client from a chat (clients: edit), as the preset in
-- @ezvisa/core says. Only the preset role is changed; roles owners created stay as they are.
UPDATE "Role"
SET
  "permissions" = jsonb_set("permissions", '{clients}', '"edit"'),
  "description" = 'For chat agents answering clients: registers new clients, opens their cases from a template and shares the checklist, on one identified client at a time.',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "name" = 'Client agent' AND "isSystem" = true;
