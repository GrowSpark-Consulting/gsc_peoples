import type { TenantDb } from '../../database/tenant';

/**
 * In-app notifications (PRD NOTIF-002): one notification per recipient per event, with a link. Created in the
 * same tenant transaction as the event. The unique (company, dedupeKey) index makes a retried or repeated
 * event a no-op instead of a duplicate.
 */
export type NotificationType =
  | 'LEAVE_REQUESTED'
  | 'LEAVE_APPROVED'
  | 'LEAVE_REJECTED'
  | 'LEAVE_CANCELLED'
  | 'CORRECTION_REQUESTED'
  | 'CORRECTION_APPROVED'
  | 'CORRECTION_REJECTED'
  | 'ATTENDANCE_CORRECTED'
  | 'ONBOARDING_TASK_ASSIGNED'
  | 'ONBOARDING_TASK_COMPLETED'
  | 'ONBOARDING_COMPLETED'
  | 'INVITATION_ACCEPTED'
  | 'REPORTS_NEED_MANAGER';

export interface NotificationInput {
  type: NotificationType;
  /** Identifies the event occurrence, e.g. the leave request id. Combined with type and recipient. */
  eventKey: string;
  recipients: readonly (string | null | undefined)[];
  title: string;
  message?: string;
  /** Same-site relative path in the web app. */
  link: string;
  /** The person who caused the event never notifies themselves. */
  actorUserId?: string | null;
}

export async function notify(db: TenantDb, input: NotificationInput): Promise<void> {
  const recipients = [...new Set(input.recipients.filter((r): r is string => Boolean(r) && r !== input.actorUserId))];
  if (recipients.length === 0) return;
  await db.notification.createMany({
    data: recipients.map((userId) => ({
      userId,
      type: input.type,
      title: input.title,
      message: input.message ?? null,
      link: input.link,
      dedupeKey: `${input.type}:${input.eventKey}:${userId}`,
    })),
    skipDuplicates: true,
  });
}

/** Login (user id) of an employee, only while both the membership and the account are active. */
export async function userIdForEmployee(db: TenantDb, employeeId: string | null | undefined): Promise<string | null> {
  if (!employeeId) return null;
  const m = await db.companyMembership.findFirst({
    where: { employeeId, status: 'ACTIVE', user: { status: 'ACTIVE' } },
    select: { userId: true },
  });
  return m?.userId ?? null;
}

/** Active HR Admin and Super Admin logins of the company (the "HR" queue). */
export async function hrUserIds(db: TenantDb): Promise<string[]> {
  const rows: { userId: string }[] = await db.companyMembership.findMany({
    where: { status: 'ACTIVE', user: { status: 'ACTIVE' }, role: { key: { in: ['HR_ADMIN', 'SUPER_ADMIN'] } } },
    select: { userId: true },
  });
  return rows.map((r) => r.userId);
}
