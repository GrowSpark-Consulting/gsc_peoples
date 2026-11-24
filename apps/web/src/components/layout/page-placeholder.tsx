import type { LucideIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';

/** Stand-in body for routes whose features are built in later tasks. No business logic. */
export function PagePlaceholder({
  icon,
  title,
  description,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
}) {
  return (
    <section
      aria-label={`${title} placeholder`}
      className="rounded-lg border border-line bg-surface shadow-sm"
    >
      <div className="px-6 pt-5">
        <Badge variant="neutral">Placeholder</Badge>
      </div>
      <EmptyState icon={icon} title={title} description={description} />
    </section>
  );
}
