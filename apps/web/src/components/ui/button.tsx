import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex shrink-0 cursor-pointer select-none items-center justify-center gap-2 whitespace-nowrap rounded-md font-medium transition-[color,background-color,border-color,box-shadow,transform] duration-[120ms] active:translate-y-px motion-reduce:active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-55 disabled:active:translate-y-0 aria-busy:cursor-progress [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        primary: 'bg-primary text-on-primary shadow-sm hover:bg-primary-hover',
        secondary: 'border border-line-strong bg-surface text-ink hover:border-ink/40 hover:bg-hover',
        outline: 'border border-primary bg-transparent text-primary hover:bg-primary-soft',
        ghost: 'bg-transparent text-ink hover:bg-hover',
        destructive: 'border border-danger bg-surface text-danger hover:bg-danger-soft',
      },
      /*
       * Desktop sizes keep data screens dense. On touch screens (coarse pointer) every size reaches a
       * 44px target: md/icon grow, sm grows to 36px and extends its hit area invisibly by 4px each side.
       */
      size: {
        sm: "relative h-[30px] px-3 text-label pointer-coarse:h-9 pointer-coarse:after:absolute pointer-coarse:after:inset-x-0 pointer-coarse:after:-inset-y-1 pointer-coarse:after:content-['']",
        md: 'h-9 px-4 text-body pointer-coarse:h-11',
        lg: 'h-11 px-5 text-body',
        icon: 'size-9 p-0 text-body pointer-coarse:size-11',
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
  /**
   * Label shown while `loading` (e.g. "Saving..."). Both labels are laid out in the same grid cell and the inactive
   * one is hidden (also from the accessible name), so the button keeps exactly the same size in both states.
   */
  loadingText?: React.ReactNode;
}

const spinner = <Loader2 className="animate-spin motion-reduce:animate-none" strokeWidth={1.75} aria-hidden />;

export function Button({
  variant,
  size,
  loading = false,
  icon,
  loadingText,
  className,
  children,
  disabled,
  type = 'button',
  ...props
}: ButtonProps) {
  if (loadingText !== undefined) {
    // Fixed-size variant: idle label (with its icon) and busy label (with the spinner) share one grid cell.
    const layer = 'col-start-1 row-start-1 inline-flex items-center justify-center gap-2';
    return (
      <button
        type={type}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        className={cn(buttonVariants({ variant, size }), className)}
        {...props}
      >
        <span className="grid">
          <span className={cn(layer, loading && 'invisible')} aria-hidden={loading || undefined}>
            {icon}
            {children}
          </span>
          <span className={cn(layer, !loading && 'invisible')} aria-hidden={!loading || undefined}>
            {spinner}
            {loadingText}
          </span>
        </span>
      </button>
    );
  }
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    >
      {loading ? spinner : icon}
      {children}
    </button>
  );
}

export { buttonVariants };
