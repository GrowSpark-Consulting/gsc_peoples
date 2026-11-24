export interface RelationMeta {
  target: string;
  list: boolean;
}

export interface ModelMeta {
  hasCompanyId: boolean;
  relations: Record<string, RelationMeta>;
}

export type TenantMeta = Record<string, ModelMeta>;

export interface TenantContext {
  /** Comes ONLY from a validated, ACTIVE CompanyMembership. Never from request input. */
  companyId: string;
}
