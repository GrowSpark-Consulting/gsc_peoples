import { RotateCw, SearchX, ShieldAlert } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';

/** Request failed. Always offers a retry; never substitutes sample data. */
export function ErrorState({
  title = 'Could not load this list.',
  message,
  onRetry,
}: {
  title?: string;
  message: string;
  onRetry?: () => void;
}) {
  return (
    <Alert
      variant="danger"
      title={title}
      action={
        onRetry ? (
          <Button size="sm" variant="secondary" icon={<RotateCw />} onClick={onRetry}>
            Try again
          </Button>
        ) : undefined
      }
    >
      {message}
    </Alert>
  );
}

/** Filters or search matched nothing. */
export function NoResultsState({ onClear, noun = 'results' }: { onClear?: () => void; noun?: string }) {
  return (
    <EmptyState
      icon={SearchX}
      title={`No ${noun} match`}
      description="Try a different search or remove some filters."
      action={
        onClear ? (
          <Button variant="secondary" onClick={onClear}>
            Clear filters
          </Button>
        ) : undefined
      }
    />
  );
}

/** The API answered 403: the signed-in user may not view this. */
export function AccessDeniedState({ message = 'You do not have permission to view this page.' }: { message?: string }) {
  return <EmptyState icon={ShieldAlert} title="No access" description={message} />;
}
