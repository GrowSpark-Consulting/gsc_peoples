/**
 * Retention purge for soft-deleted documents (DOC-005), run from source. Same job and arguments as the built
 * `node dist/purge-documents.js` (see src/jobs/purge-documents.ts):
 *
 *   tsx scripts/purge-documents.ts --company <uuid>             dry run (default)
 *   tsx scripts/purge-documents.ts --company <uuid> --execute   removes due objects and rows
 *
 * It uses only the API's runtime configuration (including verified TLS for DB_TARGET=supabase). The earlier version
 * listed companies with the migration credential over a connection without that TLS configuration; the company is
 * now named explicitly instead.
 */
import '../src/jobs/purge-documents';
