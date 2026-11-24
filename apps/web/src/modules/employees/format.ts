import type { EmploymentStatus, EmploymentType } from '@gsc/contracts';

export const STATUS_LABEL: Record<EmploymentStatus, string> = {
  ONBOARDING: 'Onboarding',
  ACTIVE: 'Active',
  ON_LEAVE: 'On leave',
  ON_NOTICE: 'On notice',
  INACTIVE: 'Inactive',
  TERMINATED: 'Terminated',
};

export const TYPE_LABEL: Record<EmploymentType, string> = {
  FULL_TIME: 'Full-time',
  PART_TIME: 'Part-time',
  CONTRACT: 'Contract',
  INTERN: 'Intern',
};

export const fullName = (p: { firstName: string; lastName: string }) =>
  `${p.firstName} ${p.lastName}`;

/** "2024-03-05" -> "5 Mar 2024". Dates are calendar days, so format in UTC to avoid timezone shifts. */
export function formatDay(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(`${iso}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(d);
}

export function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return (
    new Intl.DateTimeFormat('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'UTC',
    }).format(d) + ' UTC'
  );
}
