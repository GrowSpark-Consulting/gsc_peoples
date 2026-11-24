import type { EmploymentStatus } from '@gsc/contracts';
import { Badge } from '@/components/ui/badge';
import { STATUS_LABEL } from '../format';

const VARIANT: Record<EmploymentStatus, 'success' | 'info' | 'warning' | 'neutral'> = {
  ACTIVE: 'success',
  ONBOARDING: 'info',
  ON_LEAVE: 'warning',
  ON_NOTICE: 'warning',
  INACTIVE: 'neutral',
  TERMINATED: 'neutral',
};

/** Status is always conveyed by the text label as well as colour. */
export function StatusBadge({ status }: { status: EmploymentStatus }) {
  return <Badge variant={VARIANT[status]}>{STATUS_LABEL[status]}</Badge>;
}
