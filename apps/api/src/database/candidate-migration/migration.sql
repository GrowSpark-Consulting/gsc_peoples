-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('INVITED', 'ACTIVE', 'SUSPENDED', 'REVOKED');

-- CreateEnum
CREATE TYPE "EmploymentType" AS ENUM ('FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN');

-- CreateEnum
CREATE TYPE "EmploymentStatus" AS ENUM ('ONBOARDING', 'ACTIVE', 'ON_LEAVE', 'TERMINATED');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "permission" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "departments" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_memberships" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "employeeId" TEXT,
    "status" "MembershipStatus" NOT NULL DEFAULT 'INVITED',
    "invitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "joinedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employees" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeNumber" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "workEmail" TEXT,
    "jobTitle" TEXT,
    "employmentType" "EmploymentType" NOT NULL DEFAULT 'FULL_TIME',
    "status" "EmploymentStatus" NOT NULL DEFAULT 'ONBOARDING',
    "hireDate" DATE,
    "terminationDate" DATE,
    "departmentId" TEXT,
    "managerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employees_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_externalId_key" ON "users"("externalId");

-- CreateIndex
CREATE INDEX "users_email_idx" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "roles_companyId_id_key" ON "roles"("companyId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "roles_companyId_key_key" ON "roles"("companyId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "role_permissions_companyId_roleId_permission_key" ON "role_permissions"("companyId", "roleId", "permission");

-- CreateIndex
CREATE UNIQUE INDEX "departments_companyId_id_key" ON "departments"("companyId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "departments_companyId_name_key" ON "departments"("companyId", "name");

-- CreateIndex
CREATE INDEX "company_memberships_userId_idx" ON "company_memberships"("userId");

-- CreateIndex
CREATE INDEX "company_memberships_companyId_roleId_idx" ON "company_memberships"("companyId", "roleId");

-- CreateIndex
CREATE UNIQUE INDEX "company_memberships_companyId_userId_key" ON "company_memberships"("companyId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "company_memberships_companyId_employeeId_key" ON "company_memberships"("companyId", "employeeId");

-- CreateIndex
CREATE INDEX "employees_companyId_departmentId_idx" ON "employees"("companyId", "departmentId");

-- CreateIndex
CREATE INDEX "employees_companyId_managerId_idx" ON "employees"("companyId", "managerId");

-- CreateIndex
CREATE INDEX "employees_companyId_status_idx" ON "employees"("companyId", "status");

-- CreateIndex
CREATE INDEX "employees_companyId_lastName_firstName_idx" ON "employees"("companyId", "lastName", "firstName");

-- CreateIndex
CREATE UNIQUE INDEX "employees_companyId_id_key" ON "employees"("companyId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "employees_companyId_employeeNumber_key" ON "employees"("companyId", "employeeNumber");

-- CreateIndex
CREATE UNIQUE INDEX "employees_companyId_workEmail_key" ON "employees"("companyId", "workEmail");

-- AddForeignKey
ALTER TABLE "roles" ADD CONSTRAINT "roles_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_companyId_roleId_fkey" FOREIGN KEY ("companyId", "roleId") REFERENCES "roles"("companyId", "id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "departments" ADD CONSTRAINT "departments_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_memberships" ADD CONSTRAINT "company_memberships_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_memberships" ADD CONSTRAINT "company_memberships_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_memberships" ADD CONSTRAINT "company_memberships_companyId_roleId_fkey" FOREIGN KEY ("companyId", "roleId") REFERENCES "roles"("companyId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "company_memberships" ADD CONSTRAINT "company_memberships_companyId_employeeId_fkey" FOREIGN KEY ("companyId", "employeeId") REFERENCES "employees"("companyId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_companyId_departmentId_fkey" FOREIGN KEY ("companyId", "departmentId") REFERENCES "departments"("companyId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_companyId_managerId_fkey" FOREIGN KEY ("companyId", "managerId") REFERENCES "employees"("companyId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;


-- ═════════════════════════════════════════════════════════════════════════
-- HAND-WRITTEN SECTION (Prisma cannot express CHECK constraints or triggers)
-- ═════════════════════════════════════════════════════════════════════════

-- CHECK: identity / email normalisation (stored trimmed + lower-case, never blank), so the
-- unique indexes on email behave case-insensitively. Covers BOTH email columns in the model.
-- The application also normalises before writing; these constraints are the backstop.
ALTER TABLE "users" ADD CONSTRAINT "users_email_normalized"
  CHECK ("email" <> '' AND "email" = lower(btrim("email")));

ALTER TABLE "employees" ADD CONSTRAINT "employees_work_email_normalized"
  CHECK ("workEmail" IS NULL OR ("workEmail" <> '' AND "workEmail" = lower(btrim("workEmail"))));

-- CHECK: date rules (both date columns in the model).
ALTER TABLE "employees" ADD CONSTRAINT "employees_termination_after_hire"
  CHECK ("terminationDate" IS NULL OR "hireDate" IS NULL OR "terminationDate" >= "hireDate");

-- CHECK: lifecycle rule. A TERMINATED employee must have a termination date.
-- (Other statuses may carry one, e.g. a future-dated exit.)
ALTER TABLE "employees" ADD CONSTRAINT "employees_terminated_requires_termination_date"
  CHECK ("status" <> 'TERMINATED' OR "terminationDate" IS NOT NULL);

-- CHECK: an employee cannot be their own manager. (The trigger below cannot see a row that is
-- being inserted, so this constraint is what covers the INSERT case.)
ALTER TABLE "employees" ADD CONSTRAINT "employees_no_self_manager"
  CHECK ("managerId" IS NULL OR "managerId" <> "id");

-- TRIGGER: no reporting cycles of any length (A -> B -> C -> A), safe under concurrency.
--  * Every object is schema-qualified ("hr"."...") and the function pins its own search_path,
--    so behaviour does not depend on the caller's session search_path. Creating the trigger on
--    "hr"."employees" fails loudly if the migration ran against the wrong schema.
--  * pg_advisory_xact_lock serialises manager changes PER COMPANY until commit, so two
--    concurrent transactions cannot each pass the check and together create a cycle.
--  * In READ COMMITTED (Prisma's default) every statement takes a fresh snapshot, so after the
--    lock is granted the walk sees the other transaction's committed change. Do NOT run manager
--    changes under REPEATABLE READ/SERIALIZABLE without adding retry handling.
--  * UNION (not UNION ALL) makes the walk terminate even if bad data already contains a loop.
CREATE FUNCTION "hr"."employees_prevent_manager_cycle"() RETURNS trigger
LANGUAGE plpgsql
SET search_path = hr, pg_temp
AS $$
BEGIN
  IF NEW."managerId" IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW."managerId" IS NOT DISTINCT FROM OLD."managerId" THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('hr.employees.manager:' || NEW."companyId", 0));

  IF EXISTS (
    WITH RECURSIVE chain("id", "managerId") AS (
      SELECT e."id", e."managerId"
      FROM "hr"."employees" e
      WHERE e."companyId" = NEW."companyId" AND e."id" = NEW."managerId"
      UNION
      SELECT e."id", e."managerId"
      FROM "hr"."employees" e
      JOIN chain c ON e."id" = c."managerId"
      WHERE e."companyId" = NEW."companyId"
    )
    SELECT 1 FROM chain WHERE "id" = NEW."id"
  ) THEN
    RAISE EXCEPTION 'Reporting cycle: employee % cannot report, directly or indirectly, to themselves', NEW."id"
      USING ERRCODE = '23514', CONSTRAINT = 'employees_no_manager_cycle';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "employees_no_manager_cycle"
  BEFORE INSERT OR UPDATE OF "managerId" ON "hr"."employees"
  FOR EACH ROW EXECUTE FUNCTION "hr"."employees_prevent_manager_cycle"();
