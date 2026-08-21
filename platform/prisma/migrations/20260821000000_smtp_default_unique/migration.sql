-- Only one platform-default SMTP config may exist.
--
-- smtp_configs."tenantId" is nullable-unique, and Postgres treats NULLs as
-- distinct in a unique index, so the constraint protected every tenant row and
-- none of the default ones. The only guard was application code that says so
-- itself: "tenantId is nullable-unique, so upsert manually for the NULL
-- default row" (email.service.ts). Two concurrent PUT /admin/smtp calls both
-- see no existing row and both create; resolveConfig then findFirst()s one
-- arbitrarily, so every platform email silently routes through a relay nobody
-- chose, and editing the config in the console may update the row not in use.
--
-- This is the same fix users got in 20260731120000_platform_user_email_unique.
CREATE UNIQUE INDEX "smtp_configs_platform_default_key"
  ON "smtp_configs" (("tenantId" IS NULL)) WHERE "tenantId" IS NULL;
