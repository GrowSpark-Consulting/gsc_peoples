-- PRD ORG-002: department names are unique per company ignoring case. Designations and leave types already have
-- this index (20261121130000); departments only had the case-sensitive one.
-- Additive: one unique index, no table or data change. It fails (and changes nothing) if two departments of one
-- company already differ only by case; check first with:
--   SELECT "companyId", lower("name") FROM "hr"."departments" GROUP BY 1, 2 HAVING count(*) > 1;
-- Reversal, if ever needed: DROP INDEX "departments_companyId_lower_name_key";
CREATE UNIQUE INDEX "departments_companyId_lower_name_key" ON "departments"("companyId", lower("name"));
