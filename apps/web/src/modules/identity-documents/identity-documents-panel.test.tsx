// @vitest-environment jsdom
import { permissionsForRole, type IdentityDocument, type RoleKey } from '@gsc/contracts';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/modules/employees/errors';
import { IdentityDocumentsPanel, identityAccess } from './identity-documents-panel';

const api = vi.hoisted(() => ({
  getIdentityDocument: vi.fn(),
  revealIdentityNumber: vi.fn(),
  deleteIdentityDocument: vi.fn(),
  openIdentityFile: vi.fn(),
  uploadIdentityDocument: vi.fn(),
}));
vi.mock('./api', async (orig) => ({ ...(await orig<typeof import('./api')>()), ...api }));

const EMP = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const session = (role: RoleKey, employeeId: string | null = OTHER) => ({ permissions: permissionsForRole(role), employeeId });
const DOC: IdentityDocument = {
  id: '33333333-3333-4333-8333-333333333333',
  employeeId: EMP,
  documentType: 'AADHAAR',
  maskedNumber: 'XXXX XXXX 9012',
  front: { mimeType: 'image/jpeg', sizeBytes: 1000 },
  back: { mimeType: 'application/pdf', sizeBytes: 2000 },
  uploadedAt: '2026-11-01T10:00:00.000Z',
  updatedAt: '2026-11-20T10:00:00.000Z',
  consentRecordedAt: '2026-11-20T10:00:00.000Z',
};

beforeEach(() => {
  for (const f of Object.values(api)) f.mockReset();
  api.getIdentityDocument.mockResolvedValue(DOC);
});

describe('identityAccess (mirrors the server rules)', () => {
  it('per role', () => {
    expect(identityAccess(session('SUPER_ADMIN'), EMP)).toEqual({ canRead: true, canWrite: true, canDelete: true, canReveal: true });
    expect(identityAccess(session('HR_ADMIN'), EMP)).toEqual({ canRead: true, canWrite: true, canDelete: true, canReveal: false });
    expect(identityAccess(session('MANAGER'), EMP)).toEqual({ canRead: false, canWrite: false, canDelete: false, canReveal: false });
    expect(identityAccess(session('EMPLOYEE'), EMP)).toEqual({ canRead: false, canWrite: false, canDelete: false, canReveal: false });
    expect(identityAccess(session('EMPLOYEE', EMP), EMP)).toEqual({ canRead: true, canWrite: true, canDelete: false, canReveal: false });
  });
});

describe('IdentityDocumentsPanel', () => {
  it('HR sees type, masked number, dates and preview/download for both sides, but no reveal', async () => {
    render(<IdentityDocumentsPanel employeeId={EMP} session={session('HR_ADMIN')} />);
    expect(await screen.findByText('Aadhaar Card')).toBeInTheDocument();
    expect(screen.getByText('XXXX XXXX 9012')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Preview front side' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download back side' })).toBeInTheDocument();
    expect(screen.getByText('Uploaded')).toBeInTheDocument();
    expect(screen.getByText('Last updated')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Reveal/ })).toBeNull();
    expect(screen.getByRole('button', { name: /Replace document/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Delete/ })).toBeInTheDocument();
    expect(api.revealIdentityNumber).not.toHaveBeenCalled();
  });

  it('Super Admin can reveal the full number, which hides again after 30 seconds', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      api.revealIdentityNumber.mockResolvedValue('234567890124');
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<IdentityDocumentsPanel employeeId={EMP} session={session('SUPER_ADMIN')} />);
      await user.click(await screen.findByRole('button', { name: /Reveal full number/ }));
      expect(await screen.findByText('234567890124')).toBeInTheDocument();
      expect(screen.getByText(/This view was recorded/)).toBeInTheDocument();
      act(() => {
        vi.advanceTimersByTime(30_000);
      });
      expect(screen.queryByText('234567890124')).toBeNull();
      expect(screen.getByText('XXXX XXXX 9012')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('renders nothing for a Manager and never calls the API', () => {
    const { container } = render(<IdentityDocumentsPanel employeeId={EMP} session={session('MANAGER')} />);
    expect(container).toBeEmptyDOMElement();
    expect(api.getIdentityDocument).not.toHaveBeenCalled();
  });

  it('an employee sees their own masked document and can replace it, but not delete or reveal', async () => {
    render(<IdentityDocumentsPanel employeeId={EMP} session={session('EMPLOYEE', EMP)} />);
    expect(await screen.findByText('XXXX XXXX 9012')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Replace document/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Delete/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Reveal/ })).toBeNull();
  });

  it('no document: an employee can add their own', async () => {
    api.getIdentityDocument.mockResolvedValue(null);
    const user = userEvent.setup();
    render(<IdentityDocumentsPanel employeeId={EMP} session={session('EMPLOYEE', EMP)} />);
    expect(await screen.findByText('No identity document on file.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add identity document' }));
    expect(screen.getByLabelText(/I have read this notice/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Submit document' })).toBeInTheDocument();
  });

  it('opens a file through a short-lived link and shows a failure inline', async () => {
    api.openIdentityFile.mockRejectedValueOnce(new ApiError(503, 'SERVICE_UNAVAILABLE', 'Document storage is temporarily unavailable'));
    const user = userEvent.setup();
    render(<IdentityDocumentsPanel employeeId={EMP} session={session('HR_ADMIN')} />);
    await user.click(await screen.findByRole('button', { name: 'Preview front side' }));
    expect(api.openIdentityFile).toHaveBeenCalledWith(EMP, 'front', 'preview');
    expect(await screen.findByText('Something went wrong on our side. Please try again.')).toBeInTheDocument();
  });

  it('delete asks for confirmation in a dialog, then reloads', async () => {
    api.deleteIdentityDocument.mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<IdentityDocumentsPanel employeeId={EMP} session={session('HR_ADMIN')} />);
    await user.click(await screen.findByRole('button', { name: /Delete/ }));
    const dialog = screen.getByRole('dialog', { name: 'Delete identity document' });
    api.getIdentityDocument.mockResolvedValue(null);
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(api.deleteIdentityDocument).toHaveBeenCalledWith(EMP));
    expect(await screen.findByText('Identity document deleted.')).toBeInTheDocument();
  });

  it('a load failure offers a retry', async () => {
    api.getIdentityDocument.mockRejectedValueOnce(new ApiError(503, 'SERVICE_UNAVAILABLE', 'x'));
    const user = userEvent.setup();
    render(<IdentityDocumentsPanel employeeId={EMP} session={session('HR_ADMIN')} />);
    await user.click(await screen.findByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('XXXX XXXX 9012')).toBeInTheDocument();
  });
});
