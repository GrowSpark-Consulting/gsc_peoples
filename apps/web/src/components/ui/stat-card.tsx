import { Triangle } from 'lucide-react';
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
  className,
  ...props
}: StatCardProps) {
  const tone = comparison?.tone ?? 'neutral';
  return (
    <div
      aria-busy={loading || undefined}
      className={cn('rounded-lg border border-line bg-surface p-5 shadow-sm', className)}
      {...props}
    >
      <p className="text-body text-muted">{label}</p>
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
    </div>
  );
}
