import crypto from 'node:crypto';

/**
 * Field-level encryption for government ID numbers (AES-256-GCM, application-managed key).
 *
 * Envelope: `v<version>:<iv b64>:<auth tag b64>:<ciphertext b64>`. The additional authenticated data binds a
 * ciphertext to its tenant, employee and document type, so a value copied into another row (or another
 * company's row) fails authentication instead of decrypting. Nothing here logs, and errors carry no input.
 */
export interface IdentityCipher {
  readonly version: number;
  encrypt(plain: string, aad: string): string;
  decrypt(envelope: string, aad: string): string;
}

export class IdentityCipherError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IdentityCipherError';
  }
}

export const identityAad = (companyId: string, employeeId: string, documentType: string) => `gsc-identity-v1|${companyId}|${employeeId}|${documentType}`;

export function createIdentityCipher(keyBase64: string, version = 1): IdentityCipher {
  const key = Buffer.from(keyBase64, 'base64');
  if (key.length !== 32) throw new IdentityCipherError('Identity encryption key must be 32 bytes');
  return {
    version,
    encrypt(plain, aad) {
      const iv = crypto.randomBytes(12);
      const c = crypto.createCipheriv('aes-256-gcm', key, iv);
      c.setAAD(Buffer.from(aad, 'utf8'));
      const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
      return `v${version}:${iv.toString('base64')}:${c.getAuthTag().toString('base64')}:${ct.toString('base64')}`;
    },
    decrypt(envelope, aad) {
      const m = /^v(\d+):([A-Za-z0-9+/=]+):([A-Za-z0-9+/=]+):([A-Za-z0-9+/=]+)$/.exec(envelope);
      if (!m) throw new IdentityCipherError('Malformed ciphertext');
      if (Number(m[1]) !== version) throw new IdentityCipherError('Ciphertext was written with a different key version');
      try {
        const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(m[2]!, 'base64'));
        d.setAAD(Buffer.from(aad, 'utf8'));
        d.setAuthTag(Buffer.from(m[3]!, 'base64'));
        return Buffer.concat([d.update(Buffer.from(m[4]!, 'base64')), d.final()]).toString('utf8');
      } catch {
        throw new IdentityCipherError('Ciphertext could not be authenticated');
      }
    },
  };
}
