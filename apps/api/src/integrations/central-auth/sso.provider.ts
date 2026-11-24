import { createPublicKey, verify as verifySignature, type JsonWebKey } from 'node:crypto';
import { normalizeEmail } from '@gsc/shared';
import { getPrisma } from '../../database/client';
import { UnauthorizedError } from '../../shared/errors';
import type { CentralAuthProvider, VerifiedIdentity } from './types';

interface Jwk {
  kty: string;
  kid?: string;
  use?: string;
  alg?: string;
  n?: string;
  e?: string;
  crv?: string;
  x?: string;
  y?: string;
}

export interface SsoConfig {
  jwksUrl: string;
  issuer: string;
  audience: string;
}

export class SsoProvider implements CentralAuthProvider {
  readonly kind = 'sso' as const;
  private jwks: Jwk[] | undefined;

  constructor(private readonly config: SsoConfig) {}

  private decodeSegment(segment: string): Buffer {
    return Buffer.from(segment.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  }

  private decodeJson<T>(segment: string): T {
    return JSON.parse(this.decodeSegment(segment).toString('utf8')) as T;
  }

  private async getJwks(): Promise<Jwk[]> {
    if (this.jwks) return this.jwks;
    const response = await fetch(this.config.jwksUrl, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new UnauthorizedError('Central Authentication key service unavailable');
    const body = await response.json() as { keys?: Jwk[] };
    if (!Array.isArray(body.keys) || body.keys.length === 0) {
      throw new UnauthorizedError('Central Authentication has no usable signing keys');
    }
    this.jwks = body.keys;
    return this.jwks;
  }

  async verifyToken(token: string): Promise<VerifiedIdentity> {
    const parts = token.split('.');
    if (parts.length !== 3) throw new UnauthorizedError('Invalid Central Authentication token');
    const [encodedHeader, encodedPayload, encodedSignature] = parts;
    if (!encodedHeader || !encodedPayload || !encodedSignature) {
      throw new UnauthorizedError('Invalid Central Authentication token');
    }

    let header: { kid?: string; alg?: string };
    let payload: Record<string, unknown>;
    try {
      header = this.decodeJson(encodedHeader);
      payload = this.decodeJson(encodedPayload);
    } catch {
      throw new UnauthorizedError('Invalid Central Authentication token');
    }

    if (header.alg !== 'RS256' && header.alg !== 'ES256') {
      throw new UnauthorizedError('Unsupported Central Authentication token algorithm');
    }

    const keys = await this.getJwks();
    const key = keys.find((candidate) =>
      candidate.kty === (header.alg === 'RS256' ? 'RSA' : 'EC')
      && (!header.kid || candidate.kid === header.kid)
      && (!candidate.alg || candidate.alg === header.alg)
      && candidate.use !== 'enc',
    );
    if (!key) throw new UnauthorizedError('Central Authentication signing key not found');

    try {
      const publicKey = createPublicKey({ key: key as JsonWebKey, format: 'jwk' });
      const signingInput = Buffer.from(`${encodedHeader}.${encodedPayload}`);
      const signature = this.decodeSegment(encodedSignature);
      const algorithm = header.alg === 'RS256' ? 'RSA-SHA256' : 'SHA256';
      if (!verifySignature(algorithm, signingInput, publicKey, signature)) {
        throw new UnauthorizedError('Invalid Central Authentication signature');
      }
    } catch (error) {
      if (error instanceof UnauthorizedError) throw error;
      throw new UnauthorizedError('Invalid Central Authentication signature');
    }

    const now = Math.floor(Date.now() / 1000);
    const expiresAt = typeof payload.exp === 'number' ? payload.exp : undefined;
    if (!expiresAt || expiresAt <= now) throw new UnauthorizedError('Central Authentication token expired');
    if (payload.iss !== this.config.issuer) throw new UnauthorizedError('Invalid Central Authentication issuer');

    const audiences = Array.isArray(payload.aud)
      ? payload.aud
      : typeof payload.aud === 'string' ? [payload.aud] : [];
    if (!audiences.includes(this.config.audience)) {
      throw new UnauthorizedError('Invalid Central Authentication audience');
    }

    const externalId = typeof payload.sub === 'string' ? payload.sub : undefined;
    const companyId = typeof payload.company_id === 'string'
      ? payload.company_id
      : typeof payload.tenant_id === 'string' ? payload.tenant_id : undefined;
    if (!externalId || !companyId) {
      throw new UnauthorizedError('Central Authentication identity claims are incomplete');
    }

    return {
      externalId,
      companyId,
      ...(typeof payload.email === 'string' ? { email: normalizeEmail(payload.email) } : {}),
      ...(typeof payload.name === 'string' ? { name: payload.name } : {}),
    };
  }

  resolveAccess(): Promise<{ roles: string[]; permissions: string[] }> {
    return Promise.resolve({ roles: [], permissions: [] });
  }

  async syncUser(identity: VerifiedIdentity): Promise<void> {
    if (!identity.email) throw new UnauthorizedError('Central Authentication identity email is missing');
    await getPrisma().user.upsert({
      where: { externalId: identity.externalId },
      create: { externalId: identity.externalId, email: normalizeEmail(identity.email), name: identity.name ?? null },
      update: { email: normalizeEmail(identity.email), name: identity.name ?? null, lastLoginAt: new Date() },
    });
  }
}
