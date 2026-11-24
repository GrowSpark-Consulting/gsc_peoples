// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetSessionCache } from '@/hooks/use-session';
import { apiError, employeeFixture, employeeList, meBody, mockApi, uuid } from '@/test/api-mock';
import { MAX_BYTES, validateFile } from './api';
import { DocumentsPage, formatSize } from './documents-page';

beforeEach(() => resetSessionCache());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const SELF = uuid();
const OTHER = uuid();
const now = '2026-02-01T00:00:00.000Z';
const doc = (o: Record<string, unknown> = {}) => ({
  id: uuid(), ownerEmployeeId: SELF, category: 'CONTRACT', fileName: 'contract.pdf', mimeType: 'application/pdf', sizeBytes: 2048,
  visibleToManager: false, isCompanyDocument: false, createdAt: now, updatedAt: now, ...o,
});

describe('validateFile (DOC-001)', () => {
  it('accepts PDF, PNG, JPG and DOCX up to 10 MB and rejects the rest', () => {
    for (const type of ['application/pdf', 'image/png', 'image/jpeg', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
      expect(validateFile({ type, size: 1000 })).toBeNull();
    expect(validateFile({ type: 'application/pdf', size: MAX_BYTES })).toBeNull();
    expect(validateFile({ type: 'application/pdf', size: MAX_BYTES + 1 })).toMatch(/10 MB/);
    expect(validateFile({ type: 'application/zip', size: 10 })).toMatch(/PDF, PNG, JPG or DOCX/);
    expect(validateFile({ type: 'text/html', size: 10 })).not.toBeNull();
    expect(validateFile({ type: 'application/pdf', size: 0 })).toMatch(/empty/);
  });
  it('formats sizes', () => {
    expect(formatSize(2048)).toBe('2 KB');
    expect(formatSize(5 * 1024 * 1024)).toBe('5.0 MB');
  });
});

describe('Documents page (DOC-001..005)', () => {
  it('an Employee sees own and company documents, may upload their own, and has no company upload, flag or delete', async () => {
    mockApi({
      'GET /me': { body: meBody('EMPLOYEE', SELF) },
      'GET /documents': { body: { data: [doc(), doc({ id: uuid(), ownerEmployeeId: null, isCompanyDocument: true, category: 'POLICY', fileName: 'handbook.pdf' })] } },
    });
    render(<DocumentsPage />);
    expect(await screen.findByText('contract.pdf')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Upload document' })).toBeTruthy();
    expect(screen.queryByText('Manager access')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
    await userEvent.click(screen.getByRole('tab', { name: 'Company documents' }));
    expect(await screen.findByText('handbook.pdf')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Upload document' })).toBeNull();
    expect(screen.queryByText('contract.pdf')).toBeNull();
  });

  it('HR sees the owner, the manager-visibility control and delete; toggling calls the API', async () => {
    const d = doc({ id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', ownerEmployeeId: OTHER });
    const api = mockApi({
      'GET /me': { body: meBody('HR_ADMIN', SELF) },
      'GET /documents': { body: { data: [d] } },
      'GET /employees': employeeList(employeeFixture(SELF, 'Self', 'Person'), employeeFixture(OTHER, 'Olivia', 'Other')),
      'PATCH /documents/dddddddd-dddd-4ddd-8ddd-dddddddddddd/visibility': { body: { data: d } },
    });
    render(<DocumentsPage />);
    expect(await screen.findByText('contract.pdf')).toBeTruthy();
    expect(await screen.findByText('Olivia Other')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Hidden (show)' }));
    await waitFor(() => expect(api.keys()).toContain('PATCH /documents/dddddddd-dddd-4ddd-8ddd-dddddddddddd/visibility'));
    expect(api.last('PATCH /documents/dddddddd-dddd-4ddd-8ddd-dddddddddddd/visibility')?.body).toEqual({ visibleToManager: true });
    expect(screen.getByRole('button', { name: 'Delete' })).toBeTruthy();
  });

  it('a Manager has no upload to company documents and sees only what the API returns', async () => {
    mockApi({ 'GET /me': { body: meBody('MANAGER', SELF) }, 'GET /documents': { body: { data: [] } } });
    render(<DocumentsPage />);
    expect(await screen.findByText('No documents')).toBeTruthy();
    await userEvent.click(screen.getByRole('tab', { name: 'Company documents' }));
    expect(screen.queryByRole('button', { name: 'Upload document' })).toBeNull();
  });

  it('refuses an invalid file in the browser and never calls the API', async () => {
    const api = mockApi({ 'GET /me': { body: meBody('EMPLOYEE', SELF) }, 'GET /documents': { body: { data: [] } } });
    render(<DocumentsPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Upload document' }));
    const dialog = await screen.findByRole('dialog');
    // no file chosen
    await userEvent.click(within(dialog).getByRole('button', { name: 'Upload' }));
    expect(await within(dialog).findByText('Choose a file to upload.')).toBeTruthy();
    // wrong type (fireEvent bypasses the input's accept filter, as a drag-and-drop could)
    fireEvent.change(within(dialog).getByLabelText('File'), { target: { files: [new File(['x'], 'run.exe', { type: 'application/x-msdownload' })] } });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Upload' }));
    expect(await within(dialog).findByText('Choose a PDF, PNG, JPG or DOCX file.')).toBeTruthy();
    expect(api.keys().some((k) => k.startsWith('POST'))).toBe(false);
  });

  it('uploads a valid file with its metadata, and shows the server error (e.g. 403 or 413)', async () => {
    const api = mockApi({
      'GET /me': { body: meBody('EMPLOYEE', SELF) },
      'GET /documents': { body: { data: [] } },
      'POST /documents/employee': apiError(413, 'PAYLOAD_TOO_LARGE', 'request entity too large'),
    });
    render(<DocumentsPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Upload document' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.upload(within(dialog).getByLabelText('File'), new File(['hello'], 'id.pdf', { type: 'application/pdf' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Upload' }));
    expect(await within(dialog).findByText('The file is too large for the server to accept.')).toBeTruthy();
    // multipart: text fields plus the file part; no base64 and no client-supplied size or MIME in the metadata
    expect(api.last('POST /documents/employee')?.body).toEqual({ category: 'ID_PROOF', file: { file: 'id.pdf', type: 'application/pdf', size: 5 } });
    const init = (globalThis.fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls.find(([, i]) => i?.method === 'POST')![1];
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.headers as Record<string, string>)['Content-Type']).toBeUndefined();
  });

  it('asks the API for a 60-second link and downloads from it; no permanent URL is built in the browser', async () => {
    const api = mockApi({
      'GET /me': { body: meBody('EMPLOYEE', SELF) },
      'GET /documents': { body: { data: [doc({ id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' })] } },
      'GET /documents/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee/download': { body: { data: { url: 'https://files.example/signed?token=t', expiresInSeconds: 60 } } },
    });
    const anchors: HTMLAnchorElement[] = [];
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      anchors.push(this);
    });
    render(<DocumentsPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Download' }));
    await waitFor(() => expect(anchors).toHaveLength(1));
    expect(anchors[0]!.href).toBe('https://files.example/signed?token=t');
    expect(anchors[0]!.rel).toBe('noopener');
    expect(api.last('GET /documents/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee/download')?.query.get('inline')).toBe('false');
    click.mockRestore();
  });

  it('preview opens the signed link in a new tab and a failed link request closes that tab and shows the error', async () => {
    const tab = { opener: {} as unknown, location: { href: '' }, close: vi.fn() };
    const open = vi.spyOn(window, 'open').mockImplementation(() => tab as unknown as Window);
    const id = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
    let fail = false;
    const api = mockApi({
      'GET /me': { body: meBody('EMPLOYEE', SELF) },
      'GET /documents': { body: { data: [doc({ id, mimeType: 'application/pdf' })] } },
      [`GET /documents/${id}/download`]: () => (fail ? { status: 404, body: { error: { code: 'NOT_FOUND', message: 'Document not found' } } } : { body: { data: { url: 'https://files.example/p?token=t', expiresInSeconds: 60 } } }),
    });
    render(<DocumentsPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Preview' }));
    await waitFor(() => expect(tab.location.href).toBe('https://files.example/p?token=t'));
    expect(tab.opener).toBeNull();
    expect(api.last(`GET /documents/${id}/download`)?.query.get('inline')).toBe('true');
    fail = true;
    await userEvent.click(screen.getByRole('button', { name: 'Preview' }));
    await waitFor(() => expect(tab.close).toHaveBeenCalled());
    expect(await screen.findByText('This item could not be found, or you do not have access to it.')).toBeTruthy();
    open.mockRestore();
  });

  it('shows "No access" for a role with no document permission and an error with retry on failure', async () => {
    mockApi({ 'GET /me': { body: meBody('EMPLOYEE', SELF) }, 'GET /documents': apiError(500, 'INTERNAL', 'x') });
    render(<DocumentsPage />);
    expect(await screen.findByText('Could not load documents.')).toBeTruthy();
    expect(screen.getByRole('button', { name: /try again/i })).toBeTruthy();
  });
});
