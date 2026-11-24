-- Phase 1: company configuration and local authentication/session primitives.
-- Additive migration: existing rows and data are preserved.

ALTER TABLE "companies"
  ADD COLUMN "logoUrl" TEXT,
  ADD COLUMN "timezone" TEXT NOT NULL DEFAULT 'UTC',
  ADD COLUMN "workingDays" INTEGER[] NOT NULL DEFAULT ARRAY[1,2,3,4,5],
  ADD COLUMN "workStartTime" TEXT NOT NULL DEFAULT '09:00',
  ADD COLUMN "workEndTime" TEXT NOT NULL DEFAULT '17:00';

ALTER TABLE "companies" ADD CONSTRAINT "companies_timezone_not_blank"
  CHECK (btrim("timezone") <> '');
ALTER TABLE "companies" ADD CONSTRAINT "companies_working_hours_valid"
  CHECK ("workStartTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
     AND "workEndTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
     AND "workStartTime" < "workEndTime");
-- PostgreSQL forbids subqueries directly in CHECK constraints, so the rule lives in an IMMUTABLE
-- helper: 1-7 distinct day numbers, each between 1 and 7, no NULL elements.
-- (`<@` is false when any element is NULL or outside 1..7.) Created in the migration's schema (hr).
CREATE FUNCTION "working_days_valid"(days INTEGER[]) RETURNS BOOLEAN
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
  AS $$ SELECT days IS NOT NULL
               AND cardinality(days) BETWEEN 1 AND 7
               AND days <@ ARRAY[1,2,3,4,5,6,7]
               AND cardinality(days) = (SELECT COUNT(DISTINCT d) FROM unnest(days) AS d) $$;
ALTER TABLE "companies" ADD CONSTRAINT "companies_working_days_valid"
  CHECK ("working_days_valid"("workingDays"));

ALTER TABLE "users"
  ADD COLUMN "passwordHash" TEXT,
  ADD COLUMN "passwordVersion" INTEGER NOT NULL DEFAULT 1;

CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

CREATE TABLE "user_sessions" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "csrfHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "user_sessions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "user_sessions_tokenHash_key" ON "user_sessions"("tokenHash");
CREATE INDEX "user_sessions_companyId_userId_idx" ON "user_sessions"("companyId", "userId");
CREATE INDEX "user_sessions_expiresAt_idx" ON "user_sessions"("expiresAt");
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "password_reset_tokens" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "password_reset_tokens_tokenHash_key" ON "password_reset_tokens"("tokenHash");
CREATE INDEX "password_reset_tokens_companyId_userId_idx" ON "password_reset_tokens"("companyId", "userId");
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "invitation_tokens" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "membershipId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "invitation_tokens_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "invitation_tokens_tokenHash_key" ON "invitation_tokens"("tokenHash");
CREATE INDEX "invitation_tokens_companyId_membershipId_idx" ON "invitation_tokens"("companyId", "membershipId");
CREATE INDEX "invitation_tokens_expiresAt_idx" ON "invitation_tokens"("expiresAt");
ALTER TABLE "invitation_tokens" ADD CONSTRAINT "invitation_tokens_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "invitation_tokens" ADD CONSTRAINT "invitation_tokens_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "invitation_tokens" ADD CONSTRAINT "invitation_tokens_membershipId_fkey"
  FOREIGN KEY ("membershipId") REFERENCES "company_memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "audit_logs" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "actorId" TEXT,
  "action" TEXT NOT NULL,
  "entity" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "oldValue" JSONB,
  "newValue" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "audit_logs_companyId_entity_entityId_createdAt_idx"
  ON "audit_logs"("companyId", "entity", "entityId", "createdAt");
CREATE INDEX "audit_logs_companyId_createdAt_idx" ON "audit_logs"("companyId", "createdAt");
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actorId_fkey"
  FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

REVOKE UPDATE, DELETE, TRUNCATE ON "audit_logs" FROM PUBLIC;
REVOKE UPDATE, DELETE, TRUNCATE ON "audit_logs" FROM "hr_app";
