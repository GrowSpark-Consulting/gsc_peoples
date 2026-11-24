import path from 'node:path';
import type { Env } from '../../config/env';
import { createLocalDocumentStorage } from './local-storage';
import { createSupabaseDocumentStorage } from './supabase-storage';
import type { DocumentStorage } from './types';

export * from './types';
export { LOCAL_FILE_ROUTE, createLocalDocumentStorage, type LocalDocumentStorage } from './local-storage';
export { createSupabaseDocumentStorage } from './supabase-storage';

/** Builds the configured driver. The env schema already guarantees the supabase variables are present. */
export function createDocumentStorage(env: Pick<Env, 'DOCUMENT_STORAGE_DRIVER' | 'DOCUMENTS_STORAGE_DIR' | 'DOCUMENTS_LOCAL_SIGNING_SECRET' | 'SUPABASE_STORAGE_URL' | 'SUPABASE_STORAGE_SERVICE_KEY' | 'SUPABASE_STORAGE_BUCKET'>): DocumentStorage {
  if (env.DOCUMENT_STORAGE_DRIVER === 'supabase') {
    if (!env.SUPABASE_STORAGE_URL || !env.SUPABASE_STORAGE_SERVICE_KEY) throw new Error('Supabase document storage is not configured');
    return createSupabaseDocumentStorage({ url: env.SUPABASE_STORAGE_URL, serviceKey: env.SUPABASE_STORAGE_SERVICE_KEY, bucket: env.SUPABASE_STORAGE_BUCKET });
  }
  return createLocalDocumentStorage({ root: env.DOCUMENTS_STORAGE_DIR ?? path.join(process.cwd(), 'storage', 'documents'), secret: env.DOCUMENTS_LOCAL_SIGNING_SECRET });
}
