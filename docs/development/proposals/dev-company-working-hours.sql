-- PROPOSAL ONLY - NOT EXECUTED. For review before anything is run.
--
-- Goal: set the working hours of the local dev company from 09:00-17:00 to the PRD default 09:00-18:00
--       (PRD A3 / W1).
-- Target: local database hr_db ONLY, company id 'dev-company' ("Grow Spark Dev Co"). Nothing else changes.
-- Run as: hr_migrator (table owner). Run in ONE transaction; the guards abort it if the data is not what
--         was reviewed.
--
-- Before running: take a backup, e.g.
--   pg_dump --format=custom --schema=hr --no-owner --dbname=<DIRECT_URL> --file=hr_db_before_hours.dump

BEGIN;

-- 0) Guard: this must be hr_db and the company must still look as reviewed (17:00), otherwise stop.
DO $$
DECLARE cur TEXT;
BEGIN
  IF current_database() <> 'hr_db' THEN
    RAISE EXCEPTION 'refusing to run: connected to %, expected hr_db', current_database();
  END IF;
  SELECT "workEndTime" INTO cur FROM hr.companies WHERE id = 'dev-company';
  IF cur IS DISTINCT FROM '17:00' THEN
    RAISE EXCEPTION 'refusing to run: dev-company workEndTime is %, expected 17:00', cur;
  END IF;
END $$;

-- 1) Before image (for the audit row and for your review).
SELECT id, name, timezone, "workStartTime", "workEndTime", "workingDays" FROM hr.companies WHERE id = 'dev-company';

-- 2) The change: exactly one column on exactly one row. Start time, timezone and working days are untouched.
UPDATE hr.companies
   SET "workEndTime" = '18:00', "updatedAt" = now()
 WHERE id = 'dev-company' AND "workEndTime" = '17:00';
-- expected: UPDATE 1  (the CHECK companies_working_hours_valid requires 09:00 < 18:00, which holds)

-- 3) Audit trail (PRD: every state change is audit-logged). actorId is NULL because this is an
--    administrative SQL change, not an application user.
INSERT INTO hr.audit_logs (id, "companyId", "actorId", action, entity, "entityId", "oldValue", "newValue")
VALUES (gen_random_uuid()::text, 'dev-company', NULL, 'UPDATED', 'company', 'dev-company',
        '{"workEndTime":"17:00","note":"manual SQL, reviewed proposal"}'::jsonb,
        '{"workEndTime":"18:00","note":"manual SQL, reviewed proposal"}'::jsonb);

-- 4) After image: must show workEndTime = 18:00 and nothing else different.
SELECT id, name, timezone, "workStartTime", "workEndTime", "workingDays" FROM hr.companies WHERE id = 'dev-company';

-- Review the two result sets above, then:  COMMIT;   (or ROLLBACK; to abandon)
-- Left as ROLLBACK so that pasting the whole file can never change data by accident.
ROLLBACK;

-- Revert (only if COMMIT was used and the change must be undone):
--   UPDATE hr.companies SET "workEndTime" = '17:00', "updatedAt" = now() WHERE id = 'dev-company';
