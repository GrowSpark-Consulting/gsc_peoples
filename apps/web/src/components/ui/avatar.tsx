import { cva, type VariantProps } from 'class-variance-authority';
import { getInitials } from '@/lib/format';
import { cn } from '@/lib/utils';

const avatarVariants = cva(
  'inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full bg-sunken font-medium text-ink',
  {
    variants: {
      size: {
        sm: 'size-6 text-caption',
        md: 'size-7 text-caption',
        lg: 'size-9 text-label',
      },
    },
    defaultVariants: { size: 'md' },
  },
);

export interface AvatarProps
  extends Omit<React.ComponentProps<'span'>, 'children'>,
    VariantProps<typeof avatarVariants> {
  /** Full name. Used for initials and as the accessible name. */
  name: string;
  /** Optional photo. Initials are shown when absent. */
  src?: string;
}

export function Avatar({ name, src, size, className, ...props }: AvatarProps) {
  return (
    <span
      role="img"
      aria-label={name}
      className={cn(avatarVariants({ size }), className)}
      {...props}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className="size-full object-cover" />
      ) : (
        <span aria-hidden>{getInitials(name)}</span>
      )}
    </span>
  );
}

export { avatarVariants };
