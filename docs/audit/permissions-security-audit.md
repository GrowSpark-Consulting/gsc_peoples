# Permissions & Security Audit

**Audit Date:** 2026-11-25 (Re-audited after P0 remediation changes)  
**Scope:** 4-role permission matrix (PRD pp. 8–9), shared `can()` helper ([`authorization.ts`](file:///c:/Users/PC/gsc_peoples/packages/contracts/src/authorization.ts)), API route enforcement, tenant isolation, authentication/session security, CSRF/CORS/rate-limiting, and privacy.

---

## 1. Four-Role Permission Matrix Comparison (PRD pp. 8–9 vs. Code)

| Capability | PRD (SA / HR / MGR / EMP) | Shared `ROLE_PERMISSIONS` (`permissions.ts`) | Actual API Route Enforcement | Verdict |
|---|---|---|---|---|
| Company settings | Full / View / — / — | SA: `company:read,write`; HR: `company:read`; MGR/EMP: — | `settings.routes.ts` allows SA & HR on `GET /company` (View) and restricts `PATCH /company` to `SUPER_ADMIN`. | **PASS** |
| Departments, designations, holidays | Full / Full / View / View | SA/HR: `org:read,write`; MGR/EMP: `org:read` | `organization.routes.ts` & `holidays.routes.ts` enforce `ORG_READ`/`ORG_WRITE`. | **PASS** |
| Roles; account activation | Full / Activate only / — / — | SA: `user:read,invite,activate,role:write`; HR: `user:read,invite,activate`; MGR/EMP: — | `settings.routes.ts` & `invitations.ts`: SA-only for `/users/:id/role` and inviting/managing HR/SA; HR limited to MGR/EMP. | **PASS** |
| Employee create/edit/deactivate | Full / Full / — / — | SA/HR: `employee:write,status:write`; MGR/EMP: — | `employees.routes.ts` & `employees.repository.ts`: SA/HR write; only SA can change `employeeNumber` or existing `joiningDate` (W9). | **PASS** |
| Employee profile (all fields) | Full / Full / Team (work fields) / Own | SA/HR: `employee:read:all`; MGR: `employee:read:team`; EMP: `employee:read:self` | `employees.service.ts` `forViewer()` strips `address` & `emergencyContact` unless `EMPLOYEE_READ_ALL` or owner; `/directory` returns only limited fields. | **PASS** |
| Onboarding checklists | Full / Full / — / Own tasks | SA/HR: `onboarding:manage,own`; MGR: **—**; EMP: `onboarding:own` | `onboarding.routes.ts` now enforces `can(user, 'onboarding.completeTask', ...)` and blocks Managers from viewing/completing checklists. | **PASS** |
| Check-in/out, request correction | Own / Own / Own / Own | `EVERYONE`: `attendance:self` | `attendance.routes.ts` scopes `/check-in`, `/check-out`, `/corrections` to `req.user.employeeId`. | **PASS** |
| View attendance | Full / Full / Team / Own | SA/HR: `all`; MGR: `team`; EMP: `self` | `attendance.routes.ts` uses `resolveTeamEmployeeIds()` (direct + indirect reports) for `team`. | **PASS** |
| Approve correction / leave | Full / Full / Team / — | SA/HR: `decide:all`; MGR: `decide:team`; EMP: — | Both `attendance.routes.ts` and `leave.routes.ts` use `resolveTeamEmployeeIds()` (direct + indirect) and block self-approval. | **PASS** |
| Manual attendance correction | Full / Full / — / — | SA/HR: `attendance:manual:write`; MGR/EMP: — | `attendance.routes.ts` enforces `ATTENDANCE_CORRECT_MANUAL` and blocks self-correction. | **PASS** |
| Leave types, balances | Full / Full / View team / Own | SA/HR: `leave:manage,read:all`; MGR: `leave:read:team`; EMP: `leave:read:self` | `leave.routes.ts` `GET /balances` & `GET /requests` use `readableIds()` (`resolveTeamEmployeeIds()`). | **PASS** |
| Employee documents | Full / Full / Only if flagged / Own | SA/HR: `read:all`; MGR: `read:team` (`visibleToManager`); EMP: `read:self` | `canReadEmployeeDoc` uses `resolveTeamEmployeeIds()`. **Minor gap:** `GET /documents` without `?employeeId=` still filters `where.OR = [{ ownerEmployeeId: req.user!.employeeId }, { isCompanyDocument: true }]`, so Managers only see flagged team docs when querying by `?employeeId=`. | **PARTIAL** |
| Company documents | Upload / Upload / View / View | SA/HR: `company-document:write,read`; MGR/EMP: `company-document:read` | `documents.routes.ts` enforces `DOCUMENT_COMPANY_MANAGE` for upload; all active users can view/download. | **PASS** |
| Audit logs | Full / — / — / — | SA: `audit:read`; HR/MGR/EMP: — | `settings.routes.ts` gates `/audit-logs` to `requireRole('SUPER_ADMIN')`. | **PASS** |

---

## 2. Security & Authorization Findings

### Resolved Since Last Audit
- **Onboarding Authorization Bypass:** Fixed in `onboarding.routes.ts` (`can(toAuthzUser(req.user!), 'onboarding.completeTask', ...)` + Manager access removed).
- **Manager Privacy Leak:** Fixed in `employees.service.ts` (`forViewer()` strips `address` & `emergencyContact`) and `GET /employees/directory` (limited fields only).
- **Team Scope Consistency:** Fixed across `leave.routes.ts`, `documents.routes.ts`, and `dashboard.routes.ts` using `resolveTeamEmployeeIds()`.
- **Offboarding Account Disabling:** Fixed in `employees.repository.ts` (`offboard()` sets `User.status = 'DISABLED'`, `CompanyMembership.status = 'SUSPENDED'`, and revokes sessions).

### Remaining Minor Findings
1. **[LOW] `GET /documents` Manager Listing Filter (`documents.routes.ts:64`):** When a Manager calls `GET /documents` without `?employeeId=`, `where.OR` omits `ownerEmployeeId: { in: teamIds }`, so flagged team documents only appear when `?employeeId=` is supplied.
2. **[LOW] Sidebar Navigation Not Filtered by Role (`apps/web/src/config/navigation.ts`):** Sidebar renders all 9 links (including `Settings`, `Reports`) to all roles; the API still enforces 403/AccessDenied on the page, so this is a UX issue rather than an auth bypass.

### Verified Security Controls
- **Session & Cookie Security:** `gsc_session` is `httpOnly`, `sameSite: 'lax'`, `secure` in production, 8-hour `expiresAt` and 8-hour `lastActivityAt` idle timeout.
- **CSRF Protection:** Double-submit `gsc_csrf` cookie validated against `csrfHash` in `user_sessions` for all state-changing methods on cookie-authenticated requests.
- **Tenant & Role Derivation:** `resolveTenant.ts` derives `companyId`, `roleKey`, and `permissions` exclusively from PostgreSQL `UserSession` -> `CompanyMembership` -> `Role`.
- **Login Rate Limiting:** 5 failed attempts per 15 minutes per `ip:email` + global IP rate limiting.
- **Document Storage Security:** Private bucket only, 60-second signed URLs after server-side permission check, magic-byte + MIME + 10 MB checks, no service key in `apps/web`.
- **Mail Transport Security:** `smtp-mailer.ts` enforces `requireTLS` in production and `disableFileAccess`/`disableUrlAccess`.
