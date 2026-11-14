import { createPublicKey, verify as cryptoVerify, KeyObject } from 'crypto';
import { canonicalJson } from './canonical';

const ED_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

export function rawPublicKey(key: KeyObject): string {
  const der = key.export({ type: 'spki', format: 'der' }) as Buffer;
  return Buffer.from(der.subarray(der.length - 32)).toString('base64url');
}

export function verifyLeaseSignature(lease: unknown, signature: string, publicKeyRaw: string): boolean {
  try {
    const body = Buffer.from(publicKeyRaw, 'base64url');
    if (body.length !== 32) return false;
    const key = createPublicKey({ key: Buffer.concat([ED_PREFIX, body]), format: 'der', type: 'spki' });
    const bytes = Buffer.from(canonicalJson(lease), 'utf8');
    return cryptoVerify(null, bytes, key, Buffer.from(signature, 'base64url'));
  } catch {
    return false;
  }
}
