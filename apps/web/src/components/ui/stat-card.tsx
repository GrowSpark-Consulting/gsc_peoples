import { Triangle, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { formatINR, formatINRShort, formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Skeleton } from './skeleton';

export type StatFormat = 'number' | 'inr' | 'inr-short' | 'raw';
export type ComparisonTone = 'success' | 'warning' | 'danger' | 'neutral';

export interface StatComparison {
  /** Arrow direction. Whether the change is good or bad is set by `tone`. */
  direction: 'up' | 'down' | 'flat';
  /** Emphasised part, e.g. "12%" or "9". */
  value: string;
  /** Rest of the sentence, e.g. "vs last month". */
  label?: string;
  tone?: ComparisonTone;
}

export interface StatCardProps extends Omit<React.ComponentProps<'div'>, 'children'> {
  label: string;
  value: number | string;
  /** How to render a numeric value. Strings are shown as-is. */
  format?: StatFormat;
  comparison?: StatComparison;
  loading?: boolean;
  /** Small icon in the top-right corner (decorative). */
  icon?: LucideIcon;
  /** Background class for a legend dot before the label, e.g. `bg-data-1` (ties the card to a chart). */
  marker?: string;
  /** Makes the whole card a link to the page where the number can be acted on. */
  href?: string;
  /** `plain` drops the border and shadow, for cards grouped inside another surface. */
  appearance?: 'card' | 'plain';
}

const TONE: Record<ComparisonTone, string> = {
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
  neutral: 'text-muted',
};

const TONE_WORD: Record<ComparisonTone, string> = {
  success: 'favourable',
  warning: 'needs attention',
  danger: 'unfavourable',
  neutral: '',
};

const DIRECTION_WORD = { up: 'Up', down: 'Down', flat: 'No change' } as const;

function formatValue(value: number | string, format: StatFormat): string {
  if (typeof value === 'string' || format === 'raw') return String(value);
  if (format === 'inr') return formatINR(value);
  if (format === 'inr-short') return formatINRShort(value);
  return formatNumber(value);
}

export function StatCard({
  label,
  value,
  format = 'number',
  comparison,
  loading = false,
  icon: Icon,
  marker,
  href,
  appearance = 'card',
  className,
  ...props
}: StatCardProps) {
  const tone = comparison?.tone ?? 'neutral';
  const classes = cn(
    'relative block min-w-0 rounded-lg p-5',
    appearance === 'card' ? 'border border-line bg-surface shadow-sm' : 'bg-sunken/60 p-4',
    href &&
      'group cursor-pointer transition-[border-color,box-shadow,background-color] duration-[120ms] hover:border-line-strong hover:shadow-md',
    className,
  );
  // The label stays a direct child of the root so the value is always inside the label's parent.
  const body = (
    <>
      {Icon ? (
        <Icon
          aria-hidden
          strokeWidth={1.75}
          className="absolute right-4 top-4 size-[18px] text-muted transition-colors duration-[120ms] group-hover:text-primary"
        />
      ) : null}
      <p className={cn('flex items-center gap-2 text-body text-muted', Icon && 'pr-7')}>
        {marker ? <span aria-hidden className={cn('size-2 shrink-0 rounded-full', marker)} /> : null}
        {label}
      </p>
      {loading ? (
        <div className="mt-2 flex flex-col gap-2">
          <Skeleton className="h-9 w-32" />
          <Skeleton className="h-5 w-40" />
          <span className="sr-only">Loading</span>
        </div>
      ) : (
        <>
          <p className="gs-num mt-1 text-display font-semibold text-ink">
            {formatValue(value, format)}
          </p>
          {comparison ? (
            <p className="mt-1 flex items-center gap-1.5 text-small text-muted">
              <span className={cn('inline-flex items-center gap-1 font-medium', TONE[tone])}>
                {comparison.direction !== 'flat' ? (
                  <Triangle
                    className={cn(
                      'size-2.5 fill-current',
                      comparison.direction === 'down' && 'rotate-180',
                    )}
                    aria-hidden
                  />
                ) : (
                  <span aria-hidden className="w-2.5 text-center">
                    –
                  </span>
                )}
                <span className="sr-only">{DIRECTION_WORD[comparison.direction]}, </span>
                <span className="gs-num">{comparison.value}</span>
                {TONE_WORD[tone] ? <span className="sr-only"> ({TONE_WORD[tone]})</span> : null}
              </span>
              {comparison.label ? <span>{comparison.label}</span> : null}
            </p>
          ) : null}
        </>
      )}
    </>
  );

  if (href) {
    return (
      <Link href={href} aria-busy={loading || undefined} className={classes}>
        {body}
      </Link>
    );
  }
  return (
    <div aria-busy={loading || undefined} className={classes} {...props}>
      {body}
    </div>
  );
}
