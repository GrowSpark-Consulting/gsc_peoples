-- PRD P0 backend modules (additive, non-destructive).
-- Adds org/onboarding/attendance/leave/document/notification primitives and extends employees/company audit.
--
-- Repaired before first application (this migration had not been applied to any database):
--   * holidays already exists from 20261120090000 (and already has RLS from 20261120100000): the previous
--     unconditional ADD CONSTRAINT "holidays_companyId_fkey" failed and "isActive" was never added. The
--     column is now added with IF NOT EXISTS (existing rows become active) and every foreign key is guarded.
--   * PRD integrity rules that live in the database (attendance out after in, one pending correction per
--     day, no overlapping Pending/Approved leave, single-date half days, 10 MB file cap, document owner).
--   * Row Level Security + runtime grants for every tenant-owned table created here (same policy shape as
--     20261120100000: company isolation on every command, fail closed without a tenant context).
-- Existing rows are never modified except: holidays gain isActive = true, and employee_number_sequences is
-- seeded so the next generated number continues after the highest existing EMP-<n> (existing numbers are
-- never rewritten; new numbers use four digits, e.g. EMP-0007).

-- Enums
ALTER TYPE "EmploymentStatus" ADD VALUE IF NOT EXISTS 'ON_NOTICE';
ALTER TYPE "EmploymentStatus" ADD VALUE IF NOT EXISTS 'INACTIVE';

ALTER TYPE "EmployeeAuditAction" ADD VALUE IF NOT EXISTS 'INVITATION_SENT';
ALTER TYPE "EmployeeAuditAction" ADD VALUE IF NOT EXISTS 'INVITATION_RESENT';
ALTER TYPE "EmployeeAuditAction" ADD VALUE IF NOT EXISTS 'INVITATION_ACTIVATED';
ALTER TYPE "EmployeeAuditAction" ADD VALUE IF NOT EXISTS 'ONBOARDING_UPDATED';
ALTER TYPE "EmployeeAuditAction" ADD VALUE IF NOT EXISTS 'ATTENDANCE_CORRECTED';
ALTER TYPE "EmployeeAuditAction" ADD VALUE IF NOT EXISTS 'LEAVE_APPLIED';
ALTER TYPE "EmployeeAuditAction" ADD VALUE IF NOT EXISTS 'LEAVE_APPROVED';
ALTER TYPE "EmployeeAuditAction" ADD VALUE IF NOT EXISTS 'LEAVE_REJECTED';
ALTER TYPE "EmployeeAuditAction" ADD VALUE IF NOT EXISTS 'LEAVE_CANCELLED';
ALTER TYPE "EmployeeAuditAction" ADD VALUE IF NOT EXISTS 'DOCUMENT_UPLOADED';
ALTER TYPE "EmployeeAuditAction" ADD VALUE IF NOT EXISTS 'DOCUMENT_DELETED';

DO $$ BEGIN
  CREATE TYPE "OnboardingAssigneeType" AS ENUM ('HR', 'EMPLOYEE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "AttendanceCorrectionStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "LeaveRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "LeaveDayType" AS ENUM ('FULL_DAY', 'HALF_DAY');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "LeaveHalfSession" AS ENUM ('FIRST_HALF', 'SECOND_HALF');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "DocumentCategory" AS ENUM ('ID_PROOF', 'CONTRACT', 'OFFER_LETTER', 'CERTIFICATE', 'OTHER', 'POLICY', 'HANDBOOK', 'FORM');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Employees extensions
ALTER TABLE "employees"
  ADD COLUMN IF NOT EXISTS "phone" TEXT,
  ADD COLUMN IF NOT EXISTS "address" TEXT,
  ADD COLUMN IF NOT EXISTS "emergencyContact" TEXT,
  ADD COLUMN IF NOT EXISTS "designationId" TEXT,
  ADD COLUMN IF NOT EXISTS "joiningDate" DATE,
  ADD COLUMN IF NOT EXISTS "exitDate" DATE;

-- Designations
CREATE TABLE IF NOT EXISTS "designations" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "designations_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "designations_companyId_id_key" ON "designations"("companyId", "id");
CREATE UNIQUE INDEX IF NOT EXISTS "designations_companyId_name_key" ON "designations"("companyId", "name");
CREATE UNIQUE INDEX IF NOT EXISTS "designations_companyId_lower_name_key" ON "designations"("companyId", lower("name"));
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'designations_companyId_fkey' AND conrelid = to_regclass('"designations"')) THEN
    ALTER TABLE "designations" ADD CONSTRAINT "designations_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- Employee designation relation
CREATE INDEX IF NOT EXISTS "employees_companyId_designationId_idx" ON "employees"("companyId", "designationId");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'employees_companyId_designationId_fkey' AND conrelid = to_regclass('"employees"')) THEN
    ALTER TABLE "employees" ADD CONSTRAINT "employees_companyId_designationId_fkey"
      FOREIGN KEY ("companyId", "designationId") REFERENCES "designations"("companyId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
  END IF;
END $$;

-- Holidays
CREATE TABLE IF NOT EXISTS "holidays" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "date" DATE NOT NULL,
  "name" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "holidays_pkey" PRIMARY KEY ("id")
);
-- holidays pre-exists (20261120090000): bring it up to the current model without touching existing rows.
ALTER TABLE "holidays" ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN NOT NULL DEFAULT true;
CREATE UNIQUE INDEX IF NOT EXISTS "holidays_companyId_id_key" ON "holidays"("companyId", "id");
CREATE UNIQUE INDEX IF NOT EXISTS "holidays_companyId_date_key" ON "holidays"("companyId", "date");
CREATE INDEX IF NOT EXISTS "holidays_companyId_date_idx" ON "holidays"("companyId", "date");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'holidays_companyId_fkey' AND conrelid = to_regclass('"holidays"')) THEN
    ALTER TABLE "holidays" ADD CONSTRAINT "holidays_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- Employee number sequence per company
CREATE TABLE IF NOT EXISTS "employee_number_sequences" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "nextValue" INTEGER NOT NULL DEFAULT 1,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "employee_number_sequences_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "employee_number_sequences_companyId_key" ON "employee_number_sequences"("companyId");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'employee_number_sequences_companyId_fkey' AND conrelid = to_regclass('"employee_number_sequences"')) THEN
    ALTER TABLE "employee_number_sequences" ADD CONSTRAINT "employee_number_sequences_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- Onboarding
CREATE TABLE IF NOT EXISTS "onboarding_template_tasks" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "dueOffsetDays" INTEGER,
  "assigneeType" "OnboardingAssigneeType" NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "onboarding_template_tasks_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "onboarding_template_tasks_companyId_id_key" ON "onboarding_template_tasks"("companyId", "id");
CREATE INDEX IF NOT EXISTS "onboarding_template_tasks_companyId_isActive_idx" ON "onboarding_template_tasks"("companyId", "isActive");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'onboarding_template_tasks_companyId_fkey' AND conrelid = to_regclass('"onboarding_template_tasks"')) THEN
    ALTER TABLE "onboarding_template_tasks" ADD CONSTRAINT "onboarding_template_tasks_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "onboarding_tasks" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "dueDate" DATE,
  "assigneeType" "OnboardingAssigneeType" NOT NULL,
  "assigneeEmployeeId" TEXT,
  "completed" BOOLEAN NOT NULL DEFAULT false,
  "completedAt" TIMESTAMP(3),
  "completedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "onboarding_tasks_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "onboarding_tasks_companyId_id_key" ON "onboarding_tasks"("companyId", "id");
CREATE INDEX IF NOT EXISTS "onboarding_tasks_companyId_employeeId_idx" ON "onboarding_tasks"("companyId", "employeeId");
CREATE INDEX IF NOT EXISTS "onboarding_tasks_companyId_completed_idx" ON "onboarding_tasks"("companyId", "completed");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'onboarding_tasks_companyId_fkey' AND conrelid = to_regclass('"onboarding_tasks"')) THEN
    ALTER TABLE "onboarding_tasks" ADD CONSTRAINT "onboarding_tasks_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'onboarding_tasks_companyId_employeeId_fkey' AND conrelid = to_regclass('"onboarding_tasks"')) THEN
    ALTER TABLE "onboarding_tasks" ADD CONSTRAINT "onboarding_tasks_companyId_employeeId_fkey"
      FOREIGN KEY ("companyId", "employeeId") REFERENCES "employees"("companyId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
  END IF;
END $$;

-- Attendance
CREATE TABLE IF NOT EXISTS "attendance_records" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "date" DATE NOT NULL,
  "checkInAt" TIMESTAMP(3),
  "checkOutAt" TIMESTAMP(3),
  "workedMinutes" INTEGER,
  "originalCheckInAt" TIMESTAMP(3),
  "originalCheckOutAt" TIMESTAMP(3),
  "correctionReason" TEXT,
  "lastCorrectedAt" TIMESTAMP(3),
  "lastCorrectedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "attendance_records_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "attendance_records_out_after_in" CHECK ("checkOutAt" IS NULL OR "checkInAt" IS NULL OR "checkOutAt" > "checkInAt") -- PRD ATT-001
);
CREATE UNIQUE INDEX IF NOT EXISTS "attendance_records_companyId_id_key" ON "attendance_records"("companyId", "id");
CREATE UNIQUE INDEX IF NOT EXISTS "attendance_records_companyId_employeeId_date_key" ON "attendance_records"("companyId", "employeeId", "date");
CREATE INDEX IF NOT EXISTS "attendance_records_companyId_date_idx" ON "attendance_records"("companyId", "date");
CREATE INDEX IF NOT EXISTS "attendance_records_companyId_employeeId_date_idx" ON "attendance_records"("companyId", "employeeId", "date");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'attendance_records_companyId_fkey' AND conrelid = to_regclass('"attendance_records"')) THEN
    ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'attendance_records_companyId_employeeId_fkey' AND conrelid = to_regclass('"attendance_records"')) THEN
    ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_companyId_employeeId_fkey"
      FOREIGN KEY ("companyId", "employeeId") REFERENCES "employees"("companyId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "attendance_corrections" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "date" DATE NOT NULL,
  "proposedCheckInAt" TIMESTAMP(3) NOT NULL,
  "proposedCheckOutAt" TIMESTAMP(3) NOT NULL,
  "reason" TEXT NOT NULL,
  "status" "AttendanceCorrectionStatus" NOT NULL DEFAULT 'PENDING',
  "reviewerId" TEXT,
  "reviewerComment" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "originalCheckInAt" TIMESTAMP(3),
  "originalCheckOutAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "attendance_corrections_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "attendance_corrections_out_after_in" CHECK ("proposedCheckOutAt" > "proposedCheckInAt") -- PRD W7: out after in
);
CREATE UNIQUE INDEX IF NOT EXISTS "attendance_corrections_companyId_id_key" ON "attendance_corrections"("companyId", "id");
CREATE INDEX IF NOT EXISTS "attendance_corrections_companyId_employeeId_date_idx" ON "attendance_corrections"("companyId", "employeeId", "date");
-- PRD ATT-005: one pending correction per employee and date.
CREATE UNIQUE INDEX IF NOT EXISTS "attendance_corrections_one_pending_key" ON "attendance_corrections"("companyId", "employeeId", "date") WHERE "status" = 'PENDING';
CREATE INDEX IF NOT EXISTS "attendance_corrections_companyId_status_idx" ON "attendance_corrections"("companyId", "status");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'attendance_corrections_companyId_fkey' AND conrelid = to_regclass('"attendance_corrections"')) THEN
    ALTER TABLE "attendance_corrections" ADD CONSTRAINT "attendance_corrections_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'attendance_corrections_companyId_employeeId_fkey' AND conrelid = to_regclass('"attendance_corrections"')) THEN
    ALTER TABLE "attendance_corrections" ADD CONSTRAINT "attendance_corrections_companyId_employeeId_fkey"
      FOREIGN KEY ("companyId", "employeeId") REFERENCES "employees"("companyId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'attendance_corrections_reviewerId_fkey' AND conrelid = to_regclass('"attendance_corrections"')) THEN
    ALTER TABLE "attendance_corrections" ADD CONSTRAINT "attendance_corrections_reviewerId_fkey"
      FOREIGN KEY ("reviewerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- Leave
CREATE TABLE IF NOT EXISTS "leave_types" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "annualAllocation" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "isPaid" BOOLEAN NOT NULL DEFAULT true,
  "allowHalfDay" BOOLEAN NOT NULL DEFAULT true,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "leave_types_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "leave_types_companyId_id_key" ON "leave_types"("companyId", "id");
CREATE UNIQUE INDEX IF NOT EXISTS "leave_types_companyId_name_key" ON "leave_types"("companyId", "name");
CREATE UNIQUE INDEX IF NOT EXISTS "leave_types_companyId_lower_name_key" ON "leave_types"("companyId", lower("name"));
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leave_types_companyId_fkey' AND conrelid = to_regclass('"leave_types"')) THEN
    ALTER TABLE "leave_types" ADD CONSTRAINT "leave_types_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "leave_balances" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "leaveTypeId" TEXT NOT NULL,
  "year" INTEGER NOT NULL,
  "allocated" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "adjusted" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "used" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "pendingReserved" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "leave_balances_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "leave_balances_companyId_id_key" ON "leave_balances"("companyId", "id");
CREATE UNIQUE INDEX IF NOT EXISTS "leave_balances_companyId_employeeId_leaveTypeId_year_key" ON "leave_balances"("companyId", "employeeId", "leaveTypeId", "year");
CREATE INDEX IF NOT EXISTS "leave_balances_companyId_employeeId_year_idx" ON "leave_balances"("companyId", "employeeId", "year");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leave_balances_companyId_fkey' AND conrelid = to_regclass('"leave_balances"')) THEN
    ALTER TABLE "leave_balances" ADD CONSTRAINT "leave_balances_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leave_balances_companyId_employeeId_fkey' AND conrelid = to_regclass('"leave_balances"')) THEN
    ALTER TABLE "leave_balances" ADD CONSTRAINT "leave_balances_companyId_employeeId_fkey"
      FOREIGN KEY ("companyId", "employeeId") REFERENCES "employees"("companyId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leave_balances_companyId_leaveTypeId_fkey' AND conrelid = to_regclass('"leave_balances"')) THEN
    ALTER TABLE "leave_balances" ADD CONSTRAINT "leave_balances_companyId_leaveTypeId_fkey"
      FOREIGN KEY ("companyId", "leaveTypeId") REFERENCES "leave_types"("companyId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "leave_requests" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "leaveTypeId" TEXT NOT NULL,
  "startDate" DATE NOT NULL,
  "endDate" DATE NOT NULL,
  "dayType" "LeaveDayType" NOT NULL DEFAULT 'FULL_DAY',
  "halfDaySession" "LeaveHalfSession",
  "reason" TEXT NOT NULL,
  "days" DOUBLE PRECISION NOT NULL,
  "status" "LeaveRequestStatus" NOT NULL DEFAULT 'PENDING',
  "approverUserId" TEXT,
  "originalApproverUserId" TEXT,
  "decisionComment" TEXT,
  "decidedAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "cancelledByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "leave_requests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "leave_requests_dates_valid" CHECK ("endDate" >= "startDate"),
  CONSTRAINT "leave_requests_days_positive" CHECK ("days" > 0),
  CONSTRAINT "leave_requests_half_day_valid" CHECK (("dayType" = 'FULL_DAY' AND "halfDaySession" IS NULL) OR ("dayType" = 'HALF_DAY' AND "halfDaySession" IS NOT NULL AND "startDate" = "endDate")) -- PRD LEAVE-003: a half day is one date
);
CREATE UNIQUE INDEX IF NOT EXISTS "leave_requests_companyId_id_key" ON "leave_requests"("companyId", "id");
CREATE INDEX IF NOT EXISTS "leave_requests_companyId_employeeId_startDate_endDate_idx" ON "leave_requests"("companyId", "employeeId", "startDate", "endDate");
CREATE INDEX IF NOT EXISTS "leave_requests_companyId_status_idx" ON "leave_requests"("companyId", "status");
CREATE INDEX IF NOT EXISTS "leave_requests_companyId_approverUserId_status_idx" ON "leave_requests"("companyId", "approverUserId", "status");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leave_requests_companyId_fkey' AND conrelid = to_regclass('"leave_requests"')) THEN
    ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leave_requests_companyId_employeeId_fkey' AND conrelid = to_regclass('"leave_requests"')) THEN
    ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_companyId_employeeId_fkey"
      FOREIGN KEY ("companyId", "employeeId") REFERENCES "employees"("companyId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leave_requests_companyId_leaveTypeId_fkey' AND conrelid = to_regclass('"leave_requests"')) THEN
    ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_companyId_leaveTypeId_fkey"
      FOREIGN KEY ("companyId", "leaveTypeId") REFERENCES "leave_types"("companyId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leave_requests_approverUserId_fkey' AND conrelid = to_regclass('"leave_requests"')) THEN
    ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_approverUserId_fkey"
      FOREIGN KEY ("approverUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- Documents
CREATE TABLE IF NOT EXISTS "employee_documents" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "ownerEmployeeId" TEXT,
  "isCompanyDocument" BOOLEAN NOT NULL DEFAULT false,
  "category" "DocumentCategory" NOT NULL DEFAULT 'OTHER',
  "fileName" TEXT NOT NULL,
  "storedPath" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "visibleToManager" BOOLEAN NOT NULL DEFAULT false,
  "uploadedByUserId" TEXT,
  "deletedAt" TIMESTAMP(3),
  "purgeAfterAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "employee_documents_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "employee_documents_size_positive" CHECK ("sizeBytes" > 0),
  CONSTRAINT "employee_documents_size_max" CHECK ("sizeBytes" <= 10485760), -- PRD DOC-001: 10 MB
  CONSTRAINT "employee_documents_owner_matches_flag" CHECK (("isCompanyDocument" AND "ownerEmployeeId" IS NULL) OR (NOT "isCompanyDocument" AND "ownerEmployeeId" IS NOT NULL)) -- PRD: employee_id null = company document
);
CREATE UNIQUE INDEX IF NOT EXISTS "employee_documents_companyId_id_key" ON "employee_documents"("companyId", "id");
CREATE INDEX IF NOT EXISTS "employee_documents_companyId_ownerEmployeeId_idx" ON "employee_documents"("companyId", "ownerEmployeeId");
CREATE INDEX IF NOT EXISTS "employee_documents_companyId_isCompanyDocument_idx" ON "employee_documents"("companyId", "isCompanyDocument");
CREATE INDEX IF NOT EXISTS "employee_documents_companyId_deletedAt_idx" ON "employee_documents"("companyId", "deletedAt");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'employee_documents_companyId_fkey' AND conrelid = to_regclass('"employee_documents"')) THEN
    ALTER TABLE "employee_documents" ADD CONSTRAINT "employee_documents_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'employee_documents_companyId_ownerEmployeeId_fkey' AND conrelid = to_regclass('"employee_documents"')) THEN
    ALTER TABLE "employee_documents" ADD CONSTRAINT "employee_documents_companyId_ownerEmployeeId_fkey"
      FOREIGN KEY ("companyId", "ownerEmployeeId") REFERENCES "employees"("companyId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
  END IF;
END $$;

-- Notifications
CREATE TABLE IF NOT EXISTS "notifications" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "message" TEXT,
  "link" TEXT,
  "isRead" BOOLEAN NOT NULL DEFAULT false,
  "readAt" TIMESTAMP(3),
  "dedupeKey" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "notifications_companyId_id_key" ON "notifications"("companyId", "id");
CREATE UNIQUE INDEX IF NOT EXISTS "notifications_companyId_dedupeKey_key" ON "notifications"("companyId", "dedupeKey");
CREATE INDEX IF NOT EXISTS "notifications_companyId_userId_isRead_createdAt_idx" ON "notifications"("companyId", "userId", "isRead", "createdAt");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'notifications_companyId_fkey' AND conrelid = to_regclass('"notifications"')) THEN
    ALTER TABLE "notifications" ADD CONSTRAINT "notifications_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'notifications_userId_fkey' AND conrelid = to_regclass('"notifications"')) THEN
    ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- Leave overlap (PRD data model: "exclusion constraint blocks overlapping Pending/Approved ranges").
-- A trigger is used instead of EXCLUDE ... USING gist because that needs the btree_gist extension and the
-- privilege to create it. The advisory lock serialises concurrent requests of one employee, so two
-- simultaneous applications cannot both pass the check. Raises 23P01 (exclusion_violation), like the constraint.
-- Like the manager-cycle trigger: every object is schema-qualified and the function pins its own search_path,
-- so it behaves the same whatever search_path the calling session has.
CREATE OR REPLACE FUNCTION "hr"."leave_requests_prevent_overlap"() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = hr, pg_temp
  AS $$
BEGIN
  IF NEW."status" NOT IN ('PENDING', 'APPROVED') THEN
    RETURN NEW;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('leave_requests.overlap:' || NEW."companyId" || ':' || NEW."employeeId", 0));
  IF EXISTS (
    SELECT 1 FROM "hr"."leave_requests" l
    WHERE l."companyId" = NEW."companyId"
      AND l."employeeId" = NEW."employeeId"
      AND l."id" <> NEW."id"
      AND l."status" IN ('PENDING', 'APPROVED')
      AND l."startDate" <= NEW."endDate"
      AND l."endDate" >= NEW."startDate"
  ) THEN
    RAISE EXCEPTION 'leave request overlaps an existing pending or approved request'
      USING ERRCODE = '23P01', CONSTRAINT = 'leave_requests_no_overlap';
  END IF;
  RETURN NEW;
END
$$;
DROP TRIGGER IF EXISTS "leave_requests_no_overlap" ON "hr"."leave_requests";
CREATE TRIGGER "leave_requests_no_overlap"
  BEFORE INSERT OR UPDATE OF "employeeId", "startDate", "endDate", "status" ON "hr"."leave_requests"
  FOR EACH ROW EXECUTE FUNCTION "hr"."leave_requests_prevent_overlap"();

-- Continue employee numbering after the highest existing EMP-<n> (never rewrite existing numbers).
INSERT INTO "employee_number_sequences" ("id", "companyId", "nextValue", "updatedAt")
SELECT gen_random_uuid()::text, e."companyId", COALESCE(MAX(substring(e."employeeNumber" FROM '^EMP-([0-9]+)$')::int), 0) + 1, CURRENT_TIMESTAMP
FROM "employees" e
GROUP BY e."companyId"
ON CONFLICT ("companyId") DO NOTHING;

-- Row Level Security for every tenant-owned table created here. Same design and rationale as
-- 20261120100000_row_level_security: policies compare "companyId" with current_company_id() (set per
-- transaction by the API from the validated membership), the runtime role hr_app is NOBYPASSRLS and not the
-- owner, so with no tenant context it sees and changes nothing. The owner (hr_migrator) is not forced.
-- Per-user rules (own notifications, team scope, document visibility) stay in the API; RLS guarantees the
-- company boundary even if that code has a bug.
ALTER TABLE "designations" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "designations_tenant_isolation" ON "designations";
CREATE POLICY "designations_tenant_isolation" ON "designations" FOR ALL
  USING ("companyId" = "current_company_id"()) WITH CHECK ("companyId" = "current_company_id"());

ALTER TABLE "employee_number_sequences" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "employee_number_sequences_tenant_isolation" ON "employee_number_sequences";
CREATE POLICY "employee_number_sequences_tenant_isolation" ON "employee_number_sequences" FOR ALL
  USING ("companyId" = "current_company_id"()) WITH CHECK ("companyId" = "current_company_id"());

ALTER TABLE "onboarding_template_tasks" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "onboarding_template_tasks_tenant_isolation" ON "onboarding_template_tasks";
CREATE POLICY "onboarding_template_tasks_tenant_isolation" ON "onboarding_template_tasks" FOR ALL
  USING ("companyId" = "current_company_id"()) WITH CHECK ("companyId" = "current_company_id"());

ALTER TABLE "onboarding_tasks" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "onboarding_tasks_tenant_isolation" ON "onboarding_tasks";
CREATE POLICY "onboarding_tasks_tenant_isolation" ON "onboarding_tasks" FOR ALL
  USING ("companyId" = "current_company_id"()) WITH CHECK ("companyId" = "current_company_id"());

ALTER TABLE "attendance_records" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "attendance_records_tenant_isolation" ON "attendance_records";
CREATE POLICY "attendance_records_tenant_isolation" ON "attendance_records" FOR ALL
  USING ("companyId" = "current_company_id"()) WITH CHECK ("companyId" = "current_company_id"());

ALTER TABLE "attendance_corrections" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "attendance_corrections_tenant_isolation" ON "attendance_corrections";
CREATE POLICY "attendance_corrections_tenant_isolation" ON "attendance_corrections" FOR ALL
  USING ("companyId" = "current_company_id"()) WITH CHECK ("companyId" = "current_company_id"());

ALTER TABLE "leave_types" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "leave_types_tenant_isolation" ON "leave_types";
CREATE POLICY "leave_types_tenant_isolation" ON "leave_types" FOR ALL
  USING ("companyId" = "current_company_id"()) WITH CHECK ("companyId" = "current_company_id"());

ALTER TABLE "leave_balances" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "leave_balances_tenant_isolation" ON "leave_balances";
CREATE POLICY "leave_balances_tenant_isolation" ON "leave_balances" FOR ALL
  USING ("companyId" = "current_company_id"()) WITH CHECK ("companyId" = "current_company_id"());

ALTER TABLE "leave_requests" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "leave_requests_tenant_isolation" ON "leave_requests";
CREATE POLICY "leave_requests_tenant_isolation" ON "leave_requests" FOR ALL
  USING ("companyId" = "current_company_id"()) WITH CHECK ("companyId" = "current_company_id"());

ALTER TABLE "employee_documents" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "employee_documents_tenant_isolation" ON "employee_documents";
CREATE POLICY "employee_documents_tenant_isolation" ON "employee_documents" FOR ALL
  USING ("companyId" = "current_company_id"()) WITH CHECK ("companyId" = "current_company_id"());

ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "notifications_tenant_isolation" ON "notifications";
CREATE POLICY "notifications_tenant_isolation" ON "notifications" FOR ALL
  USING ("companyId" = "current_company_id"()) WITH CHECK ("companyId" = "current_company_id"());

-- HAND-WRITTEN SECTION (Prisma cannot express privileges)
-- Minimum runtime privileges on the new tables: row access only (no TRUNCATE, no DDL). Guarded so the
-- migration also runs where the hr_app role does not exist. There are no sequences (ids are text).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hr_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON
      "designations", "employee_number_sequences", "onboarding_template_tasks", "onboarding_tasks",
      "attendance_records", "attendance_corrections", "leave_types", "leave_balances", "leave_requests",
      "employee_documents", "notifications"
    TO hr_app;
  END IF;
END
$$;
