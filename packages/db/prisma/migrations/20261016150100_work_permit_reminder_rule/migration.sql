-- Default reminder rule for work permits, as in seed-base.ts. The seed only runs on new environments.
INSERT INTO "ReminderRule" ("id", "kind", "offsetsDays", "messageTemplate", "active", "updatedAt")
VALUES (
    gen_random_uuid(),
    'WORK_PERMIT_ENDS',
    ARRAY[60, 30, 14, 7],
    'Hi {first_name}, your work permit expires on {deadline}, in {days_left} days. Reply here and we will start the renewal. {agent_name}, EzVisa',
    true,
    CURRENT_TIMESTAMP
)
ON CONFLICT ("kind") DO NOTHING;
