import { verhoeffValid } from '@gsc/contracts';
import { describe, expect, it } from 'vitest';
import { EMPTY_IDENTITY_DRAFT, validateIdentityDraft, type IdentityDraft } from './form-model';

export function validAadhaar(): string {
  for (let d = 0; d <= 9; d++) if (verhoeffValid(`23456789012${d}`)) return `23456789012${d}`;
  throw new Error('unreachable');
}
const jpg = (name = 'front.jpg', size = 1000) => new File([new Uint8Array(size)], name, { type: 'image/jpeg' });
const draft = (patch: Partial<IdentityDraft>): IdentityDraft => ({ ...EMPTY_IDENTITY_DRAFT, consent: true, ...patch });

describe('validateIdentityDraft', () => {
  it('requires every part of an empty draft', () => {
    const r = validateIdentityDraft(EMPTY_IDENTITY_DRAFT);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(['consent', 'documentType', 'front']);
  });

  it('Aadhaar, driving licence and voter ID need both sides; PAN only the front', () => {
    for (const [documentType, documentNumber] of [['AADHAAR', validAadhaar()], ['DRIVING_LICENCE', 'MH1220110012345'], ['VOTER_ID', 'ABC1234567']] as const) {
      const r = validateIdentityDraft(draft({ documentType, documentNumber, front: jpg() }));
      expect(r.ok, documentType).toBe(false);
      if (!r.ok) expect(r.errors.back).toMatch(/back side/);
    }
    const pan = validateIdentityDraft(draft({ documentType: 'PAN', documentNumber: 'abcpe1234f', front: jpg() }));
    expect(pan).toMatchObject({ ok: true, input: { documentType: 'PAN', documentNumber: 'ABCPE1234F', back: null } });
  });

  it('returns the normalised number when valid', () => {
    const n = validAadhaar();
    const r = validateIdentityDraft(draft({ documentType: 'AADHAAR', documentNumber: `${n.slice(0, 4)} ${n.slice(4, 8)} ${n.slice(8)}`, front: jpg(), back: jpg('back.jpg') }));
    expect(r).toMatchObject({ ok: true, input: { documentNumber: n } });
  });

  it('reports a bad number, a bad file type, an oversized file and missing consent', () => {
    const r = validateIdentityDraft({
      documentType: 'PAN',
      documentNumber: 'ABCDE1234',
      front: new File(['x'], 'front.gif', { type: 'image/gif' }),
      back: jpg('back.jpg', 5 * 1024 * 1024 + 1),
      consent: false,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.documentNumber).toMatch(/10 characters/);
      expect(r.errors.front).toMatch(/JPG, PNG or PDF/);
      expect(r.errors.back).toMatch(/5 MB/);
      expect(r.errors.consent).toBeTruthy();
      expect(JSON.stringify(r.errors)).not.toContain('ABCDE1234');
    }
  });
});
