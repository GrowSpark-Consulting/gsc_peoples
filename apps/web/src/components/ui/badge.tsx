import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex h-5 shrink-0 items-center align-middle gap-1.5 whitespace-nowrap rounded-sm px-2 text-caption font-medium [&_svg]:size-3 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        success: 'bg-success-soft text-success',
        warning: 'bg-warning-soft text-warning',
        danger: 'bg-danger-soft text-danger',
        info: 'bg-info-soft text-info',
        neutral: 'bg-sunken text-muted',
        /** Brand moments only, e.g. "New". */
        accent: 'bg-accent-soft text-accent',
      },
    },
    defaultVariants: { variant: 'neutral' },
  },
);

export interface BadgeProps
  extends React.ComponentProps<'span'>,
    VariantProps<typeof badgeVariants> {
  /** Leading marker. Defaults to a dot; pass a Lucide icon to replace it, or null to hide it. */
  icon?: React.ReactNode;
}

/**
 * Status is always carried by the text label (plus a marker), never by colour alone.
 */
export function Badge({ variant, icon, className, children, ...props }: BadgeProps) {
  const marker =
    icon === undefined ? <span aria-hidden className="size-1.5 rounded-full bg-current" /> : icon;
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props}>
      {marker}
      {children}
    </span>
  );
}

export { badgeVariants };
