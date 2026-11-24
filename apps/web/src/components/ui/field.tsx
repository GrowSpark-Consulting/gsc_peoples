import { CircleAlert } from 'lucide-react';
import { useId } from 'react';
import { cn } from '@/lib/utils';

const controlBase =
  'w-full rounded-md border border-line-strong bg-surface px-3 text-body text-ink transition-colors duration-[120ms] placeholder:text-muted read-only:bg-sunken disabled:cursor-not-allowed disabled:bg-sunken disabled:opacity-60 aria-[invalid=true]:border-danger';

export interface InputProps extends React.ComponentProps<'input'> {
  invalid?: boolean;
}

export function Input({ invalid, className, ...props }: InputProps) {
  return (
    <input
      aria-invalid={invalid || props['aria-invalid'] || undefined}
      className={cn(controlBase, 'h-9', className)}
      {...props}
    />
  );
}

export interface TextareaProps extends React.ComponentProps<'textarea'> {
  invalid?: boolean;
}

export function Textarea({ invalid, className, ...props }: TextareaProps) {
  return (
    <textarea
      aria-invalid={invalid || props['aria-invalid'] || undefined}
      className={cn(controlBase, 'min-h-20 py-2', className)}
      {...props}
    />
  );
}

export interface FieldProps extends Omit<InputProps, 'invalid'> {
  label: string;
  helper?: string;
  /** Validation message. Say what to do next. Marks the field invalid. */
  error?: string;
  /** Render a multi-line control. */
  multiline?: boolean;
  containerClassName?: string;
}

/** Label + control + helper text / validation error, wired with ids and aria attributes. */
export function Field({
  label,
  helper,
  error,
  multiline,
  required,
  id,
  containerClassName,
  className,
  ...props
}: FieldProps) {
  const autoId = useId();
  const controlId = id ?? autoId;
  const helperId = `${controlId}-helper`;
  const errorId = `${controlId}-error`;
  const describedBy = [error ? errorId : null, helper ? helperId : null].filter(Boolean).join(' ');

  const shared = {
    id: controlId,
    required,
    'aria-describedby': describedBy || undefined,
    'aria-invalid': error ? true : undefined,
  };

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
      {multiline ? (
        <Textarea
          {...shared}
          className={className}
          {...(props as unknown as React.ComponentProps<'textarea'>)}
        />
      ) : (
        <Input {...shared} className={className} {...props} />
      )}
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
