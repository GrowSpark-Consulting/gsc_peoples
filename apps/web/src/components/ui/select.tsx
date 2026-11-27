import { ChevronDown, CircleAlert } from 'lucide-react';
import { useId } from 'react';
import { cn } from '@/lib/utils';

export interface SelectProps extends React.ComponentProps<'select'> {
  invalid?: boolean;
}

/** Native select (keyboard and screen-reader friendly) styled like Input. */
export function Select({ invalid, className, children, ...props }: SelectProps) {
  return (
    <div className="relative">
      <select
        aria-invalid={invalid || props['aria-invalid'] || undefined}
        className={cn(
          'h-9 w-full min-w-0 cursor-pointer appearance-none truncate rounded-md border border-line-strong bg-surface pl-3 pr-9 text-body text-ink transition-colors duration-[120ms] hover:border-ink/40 focus-visible:border-primary pointer-coarse:h-11 disabled:cursor-not-allowed disabled:bg-sunken disabled:opacity-60 aria-[invalid=true]:border-danger',
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted"
        strokeWidth={1.75}
        aria-hidden
      />
    </div>
  );
}

export interface SelectFieldProps extends Omit<SelectProps, 'invalid'> {
  label: string;
  helper?: string;
  error?: string;
  containerClassName?: string;
}

/** Label + select + helper / error, wired with ids and aria attributes (mirrors Field). */
export function SelectField({
  label,
  helper,
  error,
  required,
  id,
  containerClassName,
  children,
  ...props
}: SelectFieldProps) {
  const autoId = useId();
  const controlId = id ?? autoId;
  const helperId = `${controlId}-helper`;
  const errorId = `${controlId}-error`;
  const describedBy = [error ? errorId : null, helper ? helperId : null].filter(Boolean).join(' ');
  return (
    <div className={cn('flex flex-col gap-1.5', containerClassName)}>
      <label htmlFor={controlId} className="text-label font-medium text-ink">
        {label}
        {required ? (
          <span aria-hidden className="ml-0.5 text-danger">
            *
          </span>
        ) : null}
      </label>
      <Select
        id={controlId}
        required={required}
        aria-describedby={describedBy || undefined}
        aria-invalid={error ? true : undefined}
        {...props}
      >
        {children}
      </Select>
      {error ? (
        <p id={errorId} role="alert" className="flex items-start gap-1.5 text-small text-danger">
          <CircleAlert className="mt-0.5 size-4 shrink-0" strokeWidth={1.75} aria-hidden />
          {error}
        </p>
      ) : null}
      {helper ? (
        <p id={helperId} className="text-small text-muted">
          {helper}
        </p>
      ) : null}
    </div>
  );
}
