-- CANDIDATE MIGRATION - NOT APPLIED. Do not copy into migrations/ until reviewed and authorised.
-- Purpose: employee-change audit log (employee_audit_logs).
-- Order:   applies AFTER ../candidate-migration/migration.sql (needs "employees" and "users").
-- Safety:  additive only (1 enum, 1 table, 4 indexes, 3 foreign keys). No DROP/TRUNCATE/DELETE and
--          no change to any existing table. The statements up to the hand-written section are exactly
--          `prisma migrate diff` output between the schema before and after the model was added.

-- CreateEnum
CREATE TYPE "EmployeeAuditAction" AS ENUM ('CREATED', 'UPDATED', 'DEPARTMENT_CHANGED', 'MANAGER_CHANGED', 'STATUS_CHANGED');

-- CreateTable
CREATE TABLE "employee_audit_logs" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "action" "EmployeeAuditAction" NOT NULL,
    "changes" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employee_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "employee_audit_logs_companyId_employeeId_createdAt_idx" ON "employee_audit_logs"("companyId", "employeeId", "createdAt");

-- CreateIndex
CREATE INDEX "employee_audit_logs_companyId_createdAt_idx" ON "employee_audit_logs"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "employee_audit_logs_actorUserId_idx" ON "employee_audit_logs"("actorUserId");

-- CreateIndex
CREATE UNIQUE INDEX "employee_audit_logs_companyId_id_key" ON "employee_audit_logs"("companyId", "id");

-- AddForeignKey
ALTER TABLE "employee_audit_logs" ADD CONSTRAINT "employee_audit_logs_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_audit_logs" ADD CONSTRAINT "employee_audit_logs_companyId_employeeId_fkey" FOREIGN KEY ("companyId", "employeeId") REFERENCES "employees"("companyId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "employee_audit_logs" ADD CONSTRAINT "employee_audit_logs_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- HAND-WRITTEN SECTION (Prisma cannot express privileges)
-- Append-only: the runtime role may insert and read audit rows but never rewrite history.
-- (infrastructure default privileges would otherwise grant hr_app UPDATE and DELETE.)
-- Guarded so the migration also runs where the hr_app role does not exist.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hr_app') THEN
    REVOKE UPDATE, DELETE, TRUNCATE ON "hr"."employee_audit_logs" FROM hr_app;
  END IF;
END
$$;
