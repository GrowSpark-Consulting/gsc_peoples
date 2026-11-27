-- Government ID / identity proof documents (additive, non-destructive). No existing table or row is changed.
--
-- One table, one ACTIVE row per employee (partial unique index). A replacement soft-deletes the current row and
-- inserts a new one in the same transaction, so history is kept and the old files remain recoverable until the
-- retention purge (30 days) removes them. Files live in a dedicated PRIVATE storage bucket; the database only
-- holds their storage keys. The document number is stored as AES-256-GCM ciphertext produced by the API with an
-- application key held in environment secrets; only the last four characters are stored in clear, for masking.
--
-- Same tenant model as every other tenant table: company isolation by Row Level Security on every command,
-- composite (companyId, employeeId) foreign key, runtime role gets row access only.
-- Reversal, if ever needed: DROP TABLE "employee_identity_documents"; DROP TYPE "IdentityDocumentType";

DO $$ BEGIN
  CREATE TYPE "IdentityDocumentType" AS ENUM ('AADHAAR', 'PAN', 'DRIVING_LICENCE', 'VOTER_ID');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "employee_identity_documents" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "documentType" "IdentityDocumentType" NOT NULL,
  "numberCiphertext" TEXT NOT NULL,
  "numberLast4" TEXT NOT NULL,
  "frontPath" TEXT NOT NULL,
  "frontMimeType" TEXT NOT NULL,
  "frontSizeBytes" INTEGER NOT NULL,
  "backPath" TEXT,
  "backMimeType" TEXT,
  "backSizeBytes" INTEGER,
  "consentRecordedAt" TIMESTAMP(3) NOT NULL,
  "consentRecordedByUserId" TEXT,
  "uploadedByUserId" TEXT,
  "firstUploadedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),
  "purgeAfterAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "employee_identity_documents_pkey" PRIMARY KEY ("id"),
  -- 5 MB per file, never empty
  CONSTRAINT "employee_identity_documents_front_size" CHECK ("frontSizeBytes" > 0 AND "frontSizeBytes" <= 5242880),
  CONSTRAINT "employee_identity_documents_back_size" CHECK ("backSizeBytes" IS NULL OR ("backSizeBytes" > 0 AND "backSizeBytes" <= 5242880)),
  CONSTRAINT "employee_identity_documents_mime" CHECK (
    "frontMimeType" IN ('image/jpeg', 'image/png', 'application/pdf')
    AND ("backMimeType" IS NULL OR "backMimeType" IN ('image/jpeg', 'image/png', 'application/pdf'))
  ),
  -- back file columns are all set or all null
  CONSTRAINT "employee_identity_documents_back_complete" CHECK (
    ("backPath" IS NULL AND "backMimeType" IS NULL AND "backSizeBytes" IS NULL)
    OR ("backPath" IS NOT NULL AND "backMimeType" IS NOT NULL AND "backSizeBytes" IS NOT NULL)
  ),
  -- back side is required for every type except PAN
  CONSTRAINT "employee_identity_documents_back_required" CHECK ("documentType" = 'PAN' OR "backPath" IS NOT NULL),
  CONSTRAINT "employee_identity_documents_last4" CHECK (char_length("numberLast4") = 4),
  -- ciphertext envelope written by the API: v<key version>:<iv>:<tag>:<data>; never a plain number
  CONSTRAINT "employee_identity_documents_ciphertext" CHECK ("numberCiphertext" ~ '^v[0-9]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$'),
  CONSTRAINT "employee_identity_documents_purge_after_delete" CHECK ("purgeAfterAt" IS NULL OR "deletedAt" IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS "employee_identity_documents_companyId_id_key" ON "employee_identity_documents"("companyId", "id");
CREATE INDEX IF NOT EXISTS "employee_identity_documents_companyId_employeeId_idx" ON "employee_identity_documents"("companyId", "employeeId");
CREATE INDEX IF NOT EXISTS "employee_identity_documents_companyId_deletedAt_idx" ON "employee_identity_documents"("companyId", "deletedAt");
-- HAND-WRITTEN (Prisma cannot express partial indexes): one active identity document per employee.
CREATE UNIQUE INDEX IF NOT EXISTS "employee_identity_documents_one_active_key" ON "employee_identity_documents"("companyId", "employeeId") WHERE "deletedAt" IS NULL;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'employee_identity_documents_companyId_fkey' AND conrelid = to_regclass('"employee_identity_documents"')) THEN
    ALTER TABLE "employee_identity_documents" ADD CONSTRAINT "employee_identity_documents_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'employee_identity_documents_companyId_employeeId_fkey' AND conrelid = to_regclass('"employee_identity_documents"')) THEN
    ALTER TABLE "employee_identity_documents" ADD CONSTRAINT "employee_identity_documents_companyId_employeeId_fkey"
      FOREIGN KEY ("companyId", "employeeId") REFERENCES "employees"("companyId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
  END IF;
END $$;

-- HAND-WRITTEN: Row Level Security, same policy shape as every other tenant table (fail closed without context).
ALTER TABLE "employee_identity_documents" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "employee_identity_documents_tenant_isolation" ON "employee_identity_documents";
CREATE POLICY "employee_identity_documents_tenant_isolation" ON "employee_identity_documents" FOR ALL
  USING ("companyId" = "current_company_id"()) WITH CHECK ("companyId" = "current_company_id"());

-- HAND-WRITTEN: runtime privileges, row access only. Guarded so the migration runs where hr_app does not exist.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hr_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "employee_identity_documents" TO hr_app;
  END IF;
END
$$;
