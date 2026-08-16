-- Operator-editable copy for platform mail. Platform-wide by design: no
-- tenantId column, not even a nullable one, because there is only one kind.
-- A missing row falls back to the built-in default, so mail never depends on
-- anyone having opened the editor.
CREATE TABLE "email_templates" (
    "code" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "heading" TEXT NOT NULL,
    "intro" TEXT NOT NULL,
    "actionLabel" TEXT,
    "outro" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "email_templates_pkey" PRIMARY KEY ("code")
);
