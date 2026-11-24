import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-md font-medium transition-colors duration-[120ms] disabled:cursor-not-allowed disabled:opacity-55 [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        primary: 'bg-primary text-on-primary hover:bg-primary-hover',
        secondary: 'border border-line-strong bg-surface text-ink hover:bg-hover',
        outline: 'border border-primary bg-transparent text-primary hover:bg-primary-soft',
        ghost: 'bg-transparent text-ink hover:bg-hover',
        destructive: 'border border-danger bg-surface text-danger hover:bg-danger-soft',
      },
      size: {
        sm: 'h-[30px] px-3 text-label',
        md: 'h-9 px-4 text-body',
        lg: 'h-11 px-5 text-body',
        icon: 'size-9 p-0 text-body',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export interface ButtonProps
  extends React.ComponentProps<'button'>,
    VariantProps<typeof buttonVariants> {
  /** Shows a spinner, sets aria-busy and blocks clicks. */
  loading?: boolean;
  /** Icon rendered before the label. For icon-only buttons pass an aria-label. */
  icon?: React.ReactNode;
}

export function Button({
  variant,
  size,
  loading = false,
  icon,
  className,
  children,
  disabled,
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    >
      {loading ? (
        <Loader2 className="animate-spin motion-reduce:animate-none" strokeWidth={1.75} aria-hidden />
      ) : (
        icon
      )}
      {children}
    </button>
  );
}

export { buttonVariants };
