import { cva, type VariantProps } from 'class-variance-authority';
import { CircleCheck, CircleX, Info, TriangleAlert, X, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

const alertVariants = cva('flex items-start gap-3 rounded-lg px-4 py-3 text-body text-ink', {
  variants: {
    variant: {
      success: 'bg-success-soft',
      warning: 'bg-warning-soft',
      danger: 'bg-danger-soft',
      info: 'bg-info-soft',
    },
  },
  defaultVariants: { variant: 'info' },
});

type AlertVariant = NonNullable<VariantProps<typeof alertVariants>['variant']>;

const ICONS: Record<AlertVariant, LucideIcon> = {
  success: CircleCheck,
  warning: TriangleAlert,
  danger: CircleX,
  info: Info,
};

const ICON_COLOR: Record<AlertVariant, string> = {
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
  info: 'text-info',
};

export interface AlertProps
  extends Omit<React.ComponentProps<'div'>, 'title'>,
    VariantProps<typeof alertVariants> {
  /** Bold lead-in, e.g. "Invoice sent." */
  title?: string;
  /** Optional action, usually a small Button or link. */
  action?: React.ReactNode;
  /** When provided a dismiss button is shown. */
  onDismiss?: () => void;
}

export function Alert({
  variant = 'info',
  title,
  action,
  onDismiss,
  className,
  children,
  ...props
}: AlertProps) {
  const v: AlertVariant = variant ?? 'info';
  const Icon = ICONS[v];
  return (
    <div
      role={v === 'danger' || v === 'warning' ? 'alert' : 'status'}
      className={cn(alertVariants({ variant: v }), className)}
      {...props}
    >
      <Icon className={cn('mt-0.5 size-[18px] shrink-0', ICON_COLOR[v])} strokeWidth={1.75} aria-hidden />
      <div className="min-w-0 flex-1">
        {title ? <span className="font-semibold">{title} </span> : null}
        {children}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
      {onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="-mr-1 inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-sm text-muted transition-colors duration-[120ms] hover:text-ink"
        >
          <X className="size-4" strokeWidth={1.75} aria-hidden />
        </button>
      ) : null}
    </div>
  );
}

export { alertVariants };
