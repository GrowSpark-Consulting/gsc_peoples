// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Dialog } from './dialog';
import { Drawer } from './drawer';

afterEach(() => {
  cleanup();
  document.body.style.overflow = '';
});

function Harness({ withDialog = false }: { withDialog?: boolean }) {
  const [drawer, setDrawer] = useState(false);
  const [dialog, setDialog] = useState(false);
  return (
    <>
      <button onClick={() => setDrawer(true)}>open drawer</button>
      <Drawer open={drawer} onClose={() => setDrawer(false)} title="Profile" description="Details" footer={<button>save</button>}>
        <input aria-label="name" />
        {withDialog ? <button onClick={() => setDialog(true)}>open dialog</button> : null}
      </Drawer>
      <Dialog open={dialog} onClose={() => setDialog(false)} title="Change status" footer={<button>confirm</button>}>
        <input aria-label="date" />
      </Dialog>
    </>
  );
}

const key = (k: string, opts: KeyboardEventInit = {}) =>
  act(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, ...opts }));
  });

describe('Drawer', () => {
  it('is a labelled modal dialog and moves focus inside', () => {
    render(<Harness />);
    const opener = screen.getByText('open drawer');
    opener.focus();
    fireEvent.click(opener);
    const dlg = screen.getByRole('dialog', { name: 'Profile' });
    expect(dlg.getAttribute('aria-modal')).toBe('true');
    expect(dlg.contains(document.activeElement)).toBe(true);
  });

  it('closes on Escape and returns focus to the opener, restoring scroll', () => {
    render(<Harness />);
    const opener = screen.getByText('open drawer');
    opener.focus();
    fireEvent.click(opener);
    expect(document.body.style.overflow).toBe('hidden');
    key('Escape');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
    expect(document.body.style.overflow).toBe('');
  });

  it('closes on backdrop click and on the Close button', () => {
    render(<Harness />);
    fireEvent.click(screen.getByText('open drawer'));
    fireEvent.click(screen.getByTestId('drawer-backdrop'));
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByText('open drawer'));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('traps Tab inside the panel in both directions', () => {
    render(<Harness />);
    fireEvent.click(screen.getByText('open drawer'));
    const close = screen.getByRole('button', { name: 'Close' });
    const save = screen.getByText('save');
    save.focus();
    key('Tab');
    expect(document.activeElement).toBe(close);
    close.focus();
    key('Tab', { shiftKey: true });
    expect(document.activeElement).toBe(save);
  });
});

describe('Dialog stacked over a Drawer', () => {
  it('Escape closes only the top-most surface; scroll stays locked until the last closes', () => {
    render(<Harness withDialog />);
    fireEvent.click(screen.getByText('open drawer'));
    fireEvent.click(screen.getByText('open dialog'));
    expect(screen.getAllByRole('dialog')).toHaveLength(2);

    key('Escape');
    expect(screen.queryByRole('dialog', { name: 'Change status' })).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Profile' })).toBeTruthy();
    expect(document.body.style.overflow).toBe('hidden');

    key('Escape');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.body.style.overflow).toBe('');
  });

  it('calls onClose from the backdrop', () => {
    const onClose = vi.fn();
    render(<Dialog open onClose={onClose} title="Confirm" />);
    fireEvent.click(screen.getByTestId('dialog-backdrop'));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
