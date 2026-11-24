'use client';

import { Drawer } from '@/components/ui/drawer';
import { EmployeeProfile } from './employee-profile';

export interface EmployeeProfileDrawerProps {
  /** The employee to show, or null when closed. */
  id: string | null;
  onClose: () => void;
  /** Open another employee in the same drawer (e.g. a manager). */
  onOpen: (id: string) => void;
  /** A status change succeeded; the list behind the drawer should refresh. */
  onChanged?: () => void;
}

/**
 * Employee profile in the shared right-side Drawer, so the directory stays visible behind it.
 * Focus is trapped, Escape/backdrop/Close dismiss it and focus returns to the row that opened it.
 */
export function EmployeeProfileDrawer({ id, onClose, onOpen, onChanged }: EmployeeProfileDrawerProps) {
  return (
    <Drawer open={id !== null} onClose={onClose} title="Employee profile" size="lg">
      {id ? <EmployeeProfile key={id} id={id} embedded onOpenEmployee={onOpen} onChanged={onChanged} /> : null}
    </Drawer>
  );
}
