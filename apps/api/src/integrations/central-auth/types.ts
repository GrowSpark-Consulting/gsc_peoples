/**
 * Contract between the HR app and the platform's Central Authentication.
 * The real token claims, endpoints and user mapping are NOT known yet; every
 * production-facing detail stays behind this interface and configuration.
 */

export interface AuthenticatedUser {
  /** Local `users.id` (global identity record). */
  userId: string;
  /** The validated ACTIVE `company_memberships.id` this request acts through. */
  membershipId: string;
  /** The caller's own employee profile in this company, when linked (drives self/team scope). */
  employeeId: string | null;
  /** Stable identity issued by Central Authentication. */
  externalId: string;
  email?: string;
  name?: string;
  /**
   * Company (tenant) the request acts for. Set ONLY by `resolveTenant`, from a validated ACTIVE
   * membership. Never taken from request headers, params, query or body.
   */
  companyId: string;
  /** Role keys from the membership (e.g. HR_ADMIN). */
  roles: string[];
  /** Registry permissions granted to that role in this company. */
  permissions: string[];
}

/** Claims extracted from a verified token, before role/permission resolution. */
export interface VerifiedIdentity {
  externalId: string;
  email?: string;
  name?: string;
  companyId: string;
  rawRoles?: string[];
}

export interface CentralAuthProvider {
  readonly kind: 'development' | 'sso';
  /** Verify a bearer token and extract the caller's identity. Throws UnauthorizedError on failure. */
  verifyToken(token: string): Promise<VerifiedIdentity>;
  /**
   * Legacy hook, NOT used for HR authorisation: roles and permissions come from the caller's
   * validated CompanyMembership (see middleware/auth/resolve-tenant.ts).
   */
  resolveAccess(identity: VerifiedIdentity): Promise<{ roles: string[]; permissions: string[] }>;
  /** Create or update the local HR user record for this identity. */
  syncUser(identity: VerifiedIdentity): Promise<void>;
}
