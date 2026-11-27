// @vitest-environment jsdom
import { verhoeffValid, type IdentityDocument } from '@gsc/contracts';
import { screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../errors';
import { renderEmployees } from '../testing/render';
import type { EmployeesService } from '../service';
import { EmployeeForm } from './employee-form';

const DESIGNATION = '44444444-4444-4444-8444-444444444444';
vi.mock('../record-api', async (orig) => ({
  ...(await orig<typeof import('../record-api')>()),
  listDesignationOptions: vi.fn(async () => [{ id: DESIGNATION, name: 'Engineer', isActive: true }]),
}));
const upload = vi.hoisted(() => vi.fn());
vi.mock('@/modules/identity-documents/api', async (orig) => ({
  ...(await orig<typeof import('@/modules/identity-documents/api')>()),
  uploadIdentityDocument: upload,
}));

function aadhaar(): string {
  for (let d = 0; d <= 9; d++) if (verhoeffValid(`23456789012${d}`)) return `23456789012${d}`;
  throw new Error('unreachable');
}
const textbox = (name: RegExp) => screen.getByRole('textbox', { name });
const fileInputs = () => Array.from(document.querySelectorAll<HTMLInputElement>('input[type=file]'));

function setup() {
  const onSaved = vi.fn();
  const create = vi.fn();
  const utils = renderEmployees(<EmployeeForm mode="create" onSaved={onSaved} onCancel={vi.fn()} />, {
    // Live mode: the identity section only exists against the real API.
    wrap: (s) => ({ ...s, kind: 'http', create: (i) => (create(i), s.create(i)) }) as EmployeesService,
  });
  return { ...utils, onSaved, create };
}

async function fillEmployee(user: ReturnType<typeof setup>['user']) {
  await user.type(textbox(/First name/), 'Tara');
  await user.type(textbox(/Last name/), 'Banerjee');
  await user.type(textbox(/Work email/), 'tara.banerjee@growspark.example');
  await user.type(screen.getByLabelText(/Hire date/), '2026-01-05');
  await user.selectOptions(screen.getByRole('combobox', { name: 'Department' }), 'Engineering');
  await waitFor(() => expect(screen.getByRole('option', { name: 'Engineer' })).toBeInTheDocument());
  await user.selectOptions(screen.getByRole('combobox', { name: /Designation/ }), DESIGNATION);
}

async function fillIdentity(user: ReturnType<typeof setup>['user']) {
  await user.selectOptions(screen.getByRole('combobox', { name: /Document type/ }), 'AADHAAR');
  await user.type(screen.getByLabelText(/Document number/), aadhaar());
  const [front, back] = fileInputs();
  await user.upload(front!, new File([new Uint8Array(100)], 'front.jpg', { type: 'image/jpeg' }));
  await user.upload(back!, new File([new Uint8Array(100)], 'back.pdf', { type: 'application/pdf' }));
  await user.click(screen.getByLabelText(/The employee has been given this notice/));
}

const DOC = (employeeId: string): IdentityDocument => ({
  id: '33333333-3333-4333-8333-333333333333',
  employeeId,
  documentType: 'AADHAAR',
  maskedNumber: 'XXXX XXXX 0000',
  front: { mimeType: 'image/jpeg', sizeBytes: 100 },
  back: { mimeType: 'application/pdf', sizeBytes: 100 },
  uploadedAt: '2026-11-27T00:00:00.000Z',
  updatedAt: '2026-11-27T00:00:00.000Z',
  consentRecordedAt: '2026-11-27T00:00:00.000Z',
});

beforeEach(() => {
  upload.mockReset();
});

describe('Add employee: mandatory government ID (two steps)', () => {
  it('shows the section and blocks creation until the document is complete', async () => {
    const { user, create } = setup();
    expect(screen.getByRole('heading', { name: 'Government ID / Identity proof' })).toBeInTheDocument();
    await fillEmployee(user);
    await user.click(screen.getByRole('button', { name: 'Create employee' }));
    expect(await screen.findByText('Complete the identity document section before creating the employee.')).toBeInTheDocument();
    expect(screen.getByText('Choose a document type.')).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
  });

  it('shows identity errors together with employee field errors', async () => {
    const { user, create } = setup();
    await user.click(screen.getByRole('button', { name: 'Create employee' }));
    expect(await screen.findByText('Enter a first name')).toBeInTheDocument();
    expect(screen.getByText('Upload the front side of the document.')).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();
  });

  it('creates the employee, then uploads the document for that employee, then continues', async () => {
    upload.mockImplementation(async (id: string, _input: unknown, onProgress?: (n: number) => void) => {
      onProgress?.(0.5);
      return DOC(id);
    });
    const { user, create, onSaved } = setup();
    await fillEmployee(user);
    await fillIdentity(user);
    await user.click(screen.getByRole('button', { name: 'Create employee' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(create).toHaveBeenCalledTimes(1);
    const savedId = onSaved.mock.calls[0]![0].id;
    expect(upload).toHaveBeenCalledWith(savedId, expect.objectContaining({ documentType: 'AADHAAR', documentNumber: aadhaar() }), expect.any(Function));
  });

  it('if the upload fails after creation: retry state, never a second employee, retry or continue', async () => {
    upload.mockRejectedValueOnce(new ApiError(503, 'SERVICE_UNAVAILABLE', 'Document storage is temporarily unavailable'));
    const { user, create, onSaved } = setup();
    await fillEmployee(user);
    await fillIdentity(user);
    await user.click(screen.getByRole('button', { name: 'Create employee' }));
    expect(await screen.findByText('The employee was created, but the identity document was not saved.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create employee' })).toBeNull();
    expect(textbox(/First name/)).toBeDisabled();
    expect(onSaved).not.toHaveBeenCalled();

    upload.mockImplementationOnce(async (id: string) => DOC(id));
    await user.click(screen.getByRole('button', { name: 'Retry document upload' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(create).toHaveBeenCalledTimes(1);
    expect(upload).toHaveBeenCalledTimes(2);
    expect(upload.mock.calls[1]![0]).toBe(upload.mock.calls[0]![0]);
  });

  it('continue without document is possible after a failed upload', async () => {
    upload.mockImplementation(async () => {
      throw new ApiError(0, 'NETWORK_ERROR', 'Could not reach the server');
    });
    const { user, onSaved, create } = setup();
    await fillEmployee(user);
    await fillIdentity(user);
    await user.click(screen.getByRole('button', { name: 'Create employee' }));
    await user.click(await screen.findByRole('button', { name: 'Continue without document' }));
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('server-side field errors from the upload are placed on the identity fields', async () => {
    upload.mockRejectedValueOnce(new ApiError(400, 'VALIDATION_ERROR', 'The file content does not match its type.', [{ path: 'front', message: 'The file content does not match its type.' }]));
    const { user } = setup();
    await fillEmployee(user);
    await fillIdentity(user);
    await user.click(screen.getByRole('button', { name: 'Create employee' }));
    expect(await screen.findAllByText('The file content does not match its type.')).not.toHaveLength(0);
  });
});
