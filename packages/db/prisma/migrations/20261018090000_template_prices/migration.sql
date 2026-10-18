-- Price list per template: THB per person, government fee included.
ALTER TABLE "Template" ADD COLUMN     "prices" JSONB NOT NULL DEFAULT '[]';

-- The agency's Chiang Mai price grid of 2026-10-18. Templates missing here are left without prices.
UPDATE "Template" SET "prices" = '[{"label": "90-day report", "amountThb": 800, "from": false, "note": null}]' WHERE "slug" = 'ninety-day-report';
UPDATE "Template" SET "prices" = '[{"label": "TM.30 notification", "amountThb": 500, "from": false, "note": null}]' WHERE "slug" = 'tm30-notification';
UPDATE "Template" SET "prices" = '[{"label": "Single re-entry", "amountThb": 2000, "from": false, "note": null}, {"label": "Multiple re-entry", "amountThb": 4800, "from": false, "note": null}]' WHERE "slug" = 're-entry-permit';
UPDATE "Template" SET "prices" = '[{"label": "Residence certificate", "amountThb": 1500, "from": false, "note": null}]' WHERE "slug" = 'residence-certificate';
UPDATE "Template" SET "prices" = '[{"label": "Transfer of stamps", "amountThb": 2000, "from": false, "note": null}]' WHERE "slug" = 'stamp-transfer-new-passport';
UPDATE "Template" SET "prices" = '[{"label": "30-day extension", "amountThb": 3900, "from": false, "note": null}]' WHERE "slug" = 'visa-exempt-extension';
UPDATE "Template" SET "prices" = '[{"label": "180-day extension", "amountThb": 4900, "from": false, "note": null}]' WHERE "slug" = 'dtv-extension';
UPDATE "Template" SET "prices" = '[{"label": "Change of status to Non-O (90 days)", "amountThb": 10000, "from": false, "note": null}, {"label": "Retirement package: change of status + 1-year extension", "amountThb": 18000, "from": false, "note": "Both filings. Opened as the \"Retirement visa\" template."}]' WHERE "slug" = 'change-of-status-non-o';
UPDATE "Template" SET "prices" = '[{"label": "Change of status to Non-ED (15 months)", "amountThb": 53000, "from": false, "note": null}]' WHERE "slug" = 'change-of-status-non-ed';
UPDATE "Template" SET "prices" = '[{"label": "Change of status to Non-B (90 days)", "amountThb": 12000, "from": false, "note": null}, {"label": "Work visa (Non-B) + work permit package", "amountThb": 35000, "from": true, "note": "On quote"}]' WHERE "slug" = 'change-of-status-non-b';
UPDATE "Template" SET "prices" = '[{"label": "1-year extension", "amountThb": 9900, "from": false, "note": null}, {"label": "Retirement package: change of status + 1-year extension", "amountThb": 18000, "from": false, "note": "Both filings. Opened as the \"Retirement visa\" template."}]' WHERE "slug" = 'retirement-extension';
UPDATE "Template" SET "prices" = '[{"label": "Retirement package: change of status + 1-year extension", "amountThb": 18000, "from": false, "note": "Both filings. Opened as the \"Retirement visa\" template."}]' WHERE "slug" = 'retirement-visa';
UPDATE "Template" SET "prices" = '[{"label": "1-year extension", "amountThb": 14000, "from": false, "note": "Includes the return visit after the 30-day consideration"}]' WHERE "slug" = 'marriage-extension';
UPDATE "Template" SET "prices" = '[{"label": "Return visit", "amountThb": 0, "from": false, "note": "Included in the first filing"}]' WHERE "slug" = 'marriage-1-year-approval';
UPDATE "Template" SET "prices" = '[{"label": "1-year extension", "amountThb": 9900, "from": false, "note": null}]' WHERE "slug" = 'dependent-extension';
UPDATE "Template" SET "prices" = '[{"label": "Study extension", "amountThb": 5900, "from": false, "note": null}]' WHERE "slug" = 'education-extension';
UPDATE "Template" SET "prices" = '[{"label": "1-year extension", "amountThb": 13900, "from": false, "note": "Work permit not included"}]' WHERE "slug" = 'volunteer-extension';
UPDATE "Template" SET "prices" = '[{"label": "1-year renewal", "amountThb": 18000, "from": false, "note": "Includes the return visit after the 30-day consideration"}]' WHERE "slug" = 'non-b-work-extension';
UPDATE "Template" SET "prices" = '[{"label": "Return visit", "amountThb": 0, "from": false, "note": "Included in the first filing"}]' WHERE "slug" = 'non-b-work-1-year-approval';
UPDATE "Template" SET "prices" = '[{"label": "Work visa (Non-B) + work permit package", "amountThb": 35000, "from": true, "note": "On quote"}, {"label": "Work permit only, client already on a Non-B", "amountThb": 15000, "from": true, "note": "On quote"}]' WHERE "slug" = 'work-permit-application';
UPDATE "Template" SET "prices" = '[{"label": "Work permit renewal", "amountThb": 8900, "from": false, "note": null}]' WHERE "slug" = 'work-permit-renewal';
UPDATE "Template" SET "prices" = '[{"label": "Bank account opening", "amountThb": 3500, "from": false, "note": "Initial deposit not included"}]' WHERE "slug" = 'thai-bank-account';
