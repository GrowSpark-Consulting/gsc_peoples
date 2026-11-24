import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface EmptyStateProps extends Omit<React.ComponentProps<'div'>, 'title'> {
  icon?: LucideIcon;
  title: string;
  /** Explain what the page is for. */
  description?: string;
  /** One action, usually a Button. */
  action?: React.ReactNode;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
  ...props
}: EmptyStateProps) {
  return (
    <div
      className={cn('flex flex-col items-center gap-2 px-6 py-10 text-center', className)}
      {...props}
    >
      {Icon ? <Icon className="size-6 text-muted" strokeWidth={1.75} aria-hidden /> : null}
      <p className="text-h3 font-semibold text-ink">{title}</p>
      {description ? <p className="max-w-sm text-small text-muted">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
