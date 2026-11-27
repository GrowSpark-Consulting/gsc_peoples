// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { EMPTY_IDENTITY_DRAFT, validateIdentityDraft, type IdentityDraft, type IdentityDraftErrors } from './form-model';
import { IdentityDocumentFields } from './identity-document-fields';

function Harness({ audience = 'hr' as 'hr' | 'self', progress = null as number | null }) {
  const [draft, setDraft] = useState<IdentityDraft>(EMPTY_IDENTITY_DRAFT);
  const [errors, setErrors] = useState<IdentityDraftErrors>({});
  return (
    <>
      <IdentityDocumentFields
        draft={draft}
        onChange={setDraft}
        errors={errors}
        onFieldError={(f, m) => setErrors((e) => ({ ...e, [f]: m }))}
        progress={progress}
        audience={audience}
      />
      <button type="button" onClick={() => setErrors((r => (r.ok ? {} : r.errors))(validateIdentityDraft(draft)))}>
        check
      </button>
    </>
  );
}

const fileInputs = () => Array.from(document.querySelectorAll<HTMLInputElement>('input[type=file]'));

describe('IdentityDocumentFields', () => {
  it('shows the number field only after a type is chosen, with a type-specific placeholder', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    expect(screen.queryByLabelText(/Document number/)).toBeNull();
    await user.selectOptions(screen.getByRole('combobox', { name: /Document type/ }), 'PAN');
    const number = screen.getByLabelText(/Document number/);
    expect(number).toHaveAttribute('placeholder', 'ABCDE1234F');
    expect(number).toHaveAttribute('autocomplete', 'off');
    expect(screen.getByText(/does not verify the document/)).toBeInTheDocument();
  });

  it('masks the number while typing until Show is pressed', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.selectOptions(screen.getByRole('combobox', { name: /Document type/ }), 'PAN');
    const number = screen.getByLabelText(/Document number/);
    await user.type(number, 'ABCPE1234F');
    expect(number.className).toContain('[-webkit-text-security:disc]');
    await user.click(screen.getByRole('button', { name: 'Show document number' }));
    expect(number.className).not.toContain('[-webkit-text-security:disc]');
  });

  it('marks the back side optional for PAN and required otherwise', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.selectOptions(screen.getByRole('combobox', { name: /Document type/ }), 'PAN');
    expect(screen.getByText('(optional)')).toBeInTheDocument();
    await user.selectOptions(screen.getByRole('combobox', { name: /Document type/ }), 'AADHAAR');
    expect(screen.queryByText('(optional)')).toBeNull();
  });

  it('accepts a file, shows its name, lets the user replace and remove it, and rejects a wrong type inline', async () => {
    const user = userEvent.setup({ applyAccept: false });
    render(<Harness />);
    const [front] = fileInputs();
    await user.upload(front!, new File([new Uint8Array(2048)], 'aadhaar-front.png', { type: 'image/png' }));
    expect(screen.getByText('aadhaar-front.png')).toBeInTheDocument();
    expect(screen.getByText('2 KB')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Replace front side' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Remove front side' }));
    expect(screen.queryByText('aadhaar-front.png')).toBeNull();
    await user.upload(fileInputs()[0]!, new File(['x'], 'scan.gif', { type: 'image/gif' }));
    expect(await screen.findByText('Choose a JPG, PNG or PDF file.')).toBeInTheDocument();
  });

  it('wording of consent depends on who submits, and validation errors are announced', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<Harness audience="self" />);
    expect(screen.getByLabelText(/I have read this notice/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'check' }));
    expect(screen.getByText('Choose a document type.')).toBeInTheDocument();
    expect(screen.getByText('Upload the front side of the document.')).toBeInTheDocument();
    expect(screen.getByText('Confirm the privacy notice to continue.')).toBeInTheDocument();
    unmount();
    render(<Harness audience="hr" />);
    expect(screen.getByLabelText(/The employee has been given this notice/)).toBeInTheDocument();
  });

  it('shows upload progress', () => {
    render(<Harness progress={0.42} />);
    expect(screen.getByRole('progressbar', { name: 'Identity document upload' })).toHaveAttribute('aria-valuenow', '42');
  });
});
