/**
 * Private object storage for HR documents. Implementations are server-side only: the browser never receives
 * a permanent or public URL, only a signed link that expires after `SIGNED_URL_TTL_SECONDS`.
 */

/** PRD DOC-003: download links live for exactly 60 seconds. Fixed, not configurable. */
export const SIGNED_URL_TTL_SECONDS = 60;

export interface PutObjectInput {
  /** Object key, `<companyId>/<ownerEmployeeId|company>/<uuid>`. Never contains a user-supplied file name. */
  key: string;
  body: Buffer;
  contentType: string;
}

export interface SignedUrlOptions {
  expiresInSeconds: number;
  /** Suggested download file name (sent as Content-Disposition by the storage service). */
  fileName?: string;
  /** Needed by drivers that sign a link to this API (local driver). */
  requestOrigin?: string;
  /** Content type the local driver serves the file with. */
  contentType?: string;
  /** Show in the browser (preview) instead of forcing a download. `fileName` is then ignored. */
  inline?: boolean;
}

export interface DocumentStorage {
  readonly driver: 'local' | 'supabase';
  /** Stores a new object. Fails (never overwrites) when the key already exists. */
  put(input: PutObjectInput): Promise<void>;
  /** A link that works for `expiresInSeconds` and then stops working. */
  createSignedDownloadUrl(key: string, options: SignedUrlOptions): Promise<string>;
  /** Removes an object. Used by the retention purge job and to undo an upload whose DB row failed. */
  remove(key: string): Promise<void>;
}

export class StorageError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'StorageError';
  }
}
