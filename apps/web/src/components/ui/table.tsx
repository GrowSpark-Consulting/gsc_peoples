import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';
import { Avatar } from './avatar';
import { Skeleton } from './skeleton';

const alignVariants = cva('', {
  variants: {
    align: { left: 'text-left', center: 'text-center', right: 'text-right' },
  },
  defaultVariants: { align: 'left' },
});

export interface TableProps extends React.ComponentProps<'table'> {
  /** Accessible name for the scrollable region. */
  label: string;
}

/**
 * Surface container with horizontal overflow handling. The scroll region is focusable so
 * keyboard users can scroll it on narrow screens.
 */
export function Table({ label, className, children, ...props }: TableProps) {
  return (
    <div
      role="region"
      aria-label={label}
      tabIndex={0}
      className="overflow-x-auto rounded-lg border border-line bg-surface shadow-sm"
    >
      <table className={cn('w-full border-collapse text-body', className)} {...props}>
        {children}
      </table>
    </div>
  );
}

export function TableHeader({ className, ...props }: React.ComponentProps<'thead'>) {
  return <thead className={cn('bg-sunken', className)} {...props} />;
}

export function TableBody({ className, ...props }: React.ComponentProps<'tbody'>) {
  return <tbody className={className} {...props} />;
}

export interface TableRowProps extends React.ComponentProps<'tr'> {
  selected?: boolean;
}

export function TableRow({ selected, className, ...props }: TableRowProps) {
  return (
    <tr
      aria-selected={selected || undefined}
      className={cn(
        'h-11 border-b border-line transition-colors duration-[120ms] last:border-b-0',
        selected ? 'bg-primary-soft' : '[tbody_&]:hover:bg-hover',
        className,
      )}
      {...props}
    />
  );
}

export interface TableHeadProps
  extends Omit<React.ComponentProps<'th'>, 'align'>,
    VariantProps<typeof alignVariants> {}

export function TableHead({ align, className, ...props }: TableHeadProps) {
  return (
    <th
      scope="col"
      className={cn(
        'h-10 whitespace-nowrap px-4 text-label font-medium text-muted',
        alignVariants({ align }),
        className,
      )}
      {...props}
    />
  );
}

export interface TableCellProps
  extends Omit<React.ComponentProps<'td'>, 'align'>,
    VariantProps<typeof alignVariants> {
  /** Use for numbers and money: right-aligned with tabular figures. */
  numeric?: boolean;
  /** Secondary text colour. */
  muted?: boolean;
}

export function TableCell({ align, numeric, muted, className, ...props }: TableCellProps) {
  return (
    <td
      className={cn(
        'whitespace-nowrap px-4 py-0 align-middle',
        muted ? 'text-muted' : 'text-ink',
        numeric && 'gs-num',
        alignVariants({ align: align ?? (numeric ? 'right' : 'left') }),
        className,
      )}
      {...props}
    />
  );
}

export interface PersonCellProps {
  name: string;
  /** Optional second line, e.g. role or employee ID. */
  subtitle?: string;
  src?: string;
}

/** Avatar (photo or initials) + name, for employee columns. */
export function PersonCell({ name, subtitle, src }: PersonCellProps) {
  return (
    <div className="flex items-center gap-3">
      <Avatar name={name} src={src} />
      <div className="min-w-0">
        <div className="font-medium text-ink">{name}</div>
        {subtitle ? <div className="text-caption text-muted">{subtitle}</div> : null}
      </div>
    </div>
  );
}

/** Empty state spanning the full table width. Put inside TableBody. */
export function TableEmpty({
  colSpan,
  children,
}: {
  colSpan: number;
  children: React.ReactNode;
}) {
  return (
    <tr>
      <td colSpan={colSpan}>{children}</td>
    </tr>
  );
}

/** Placeholder rows while data loads. Put inside TableBody. */
export function TableSkeleton({ columns, rows = 3 }: { columns: number; rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }, (_, r) => (
        <tr key={r} aria-hidden className="h-11 border-b border-line last:border-b-0">
          {Array.from({ length: columns }, (_, c) => (
            <td key={c} className="px-4">
              <Skeleton className="h-4 w-full max-w-32" />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}
