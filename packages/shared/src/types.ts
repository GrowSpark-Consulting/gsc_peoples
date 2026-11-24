/** Identifier of the company (tenant) that owns a record. */
export type CompanyId = string;

export interface PaginationParams {
  page: number;
  pageSize: number;
}

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export type Result<T, E = Error> = { ok: true; value: T } | { ok: false; error: E };
