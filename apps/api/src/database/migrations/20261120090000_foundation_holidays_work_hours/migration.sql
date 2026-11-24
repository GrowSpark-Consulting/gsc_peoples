-- Slice 1 (Foundation): company configuration that attendance and leave depend on.
-- Additive and non-destructive: no existing row is modified, dropped or truncated.

-- 1) PRD A3 / W1: default working hours are 09:00-18:00. Only the column DEFAULT changes (applies to
--    companies created from now on). Existing companies keep whatever hours they already have.
ALTER TABLE "companies" ALTER COLUMN "workEndTime" SET DEFAULT '18:00';

-- 2) PRD ORG-004: holiday calendar. One holiday per company-local date; excluded from leave-day counts
--    and from "absent".
CREATE TABLE "holidays" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "date" DATE NOT NULL,
  "name" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "holidays_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "holidays_companyId_date_key" ON "holidays"("companyId", "date");
CREATE UNIQUE INDEX "holidays_companyId_id_key" ON "holidays"("companyId", "id");

ALTER TABLE "holidays" ADD CONSTRAINT "holidays_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "holidays" ADD CONSTRAINT "holidays_name_not_blank" CHECK (btrim("name") <> '');
