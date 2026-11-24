import { Alert } from '@/components/ui/alert';
import { cn } from '@/lib/utils';

/** Group of related fields with a heading. Use 16px between fields, 24px between sections. */
export function FormSection({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <fieldset className={cn('min-w-0 border-0 p-0', className)}>
      <legend className="text-h3 font-semibold text-ink">{title}</legend>
      {description ? <p className="mt-0.5 text-small text-muted">{description}</p> : null}
      <div className="mt-4 grid gap-4 sm:grid-cols-2">{children}</div>
    </fieldset>
  );
}

/** Form-level (non-field) error, e.g. a failed submit. Announced to assistive tech. */
export function FormError({ title = 'Could not save.', message }: { title?: string; message: string | null | undefined }) {
  if (!message) return null;
  return (
    <Alert variant="danger" title={title}>
      {message}
    </Alert>
  );
}
