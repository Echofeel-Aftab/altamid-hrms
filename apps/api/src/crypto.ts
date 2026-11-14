import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

export function loadSecret(name: string): string {
  const dir = join(process.cwd(), 'storage');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, name);
  if (!existsSync(file)) writeFileSync(file, randomBytes(32).toString('base64url'));
  return readFileSync(file, 'utf8').trim();
}

export function dataKey(): Buffer {
  const key = Buffer.from(loadSecret('data.key'), 'base64url');
  if (key.length !== 32) {
    throw new Error('The data key must be 32 bytes. Remove storage/data.key and start again only if this database is empty.');
  }
  return key;
}

export function seal(plain: string, key: Buffer): string {
  if (!plain) return '';
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString('base64url');
}

export function openSecret(payload: string, key: Buffer): string {
  if (!payload) return '';
  const raw = Buffer.from(payload, 'base64url');
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const encrypted = raw.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

export function maskSecret(value: string): string {
  if (!value) return '';
  if (value.length <= 4) return '••••';
  return '••••' + value.slice(-4);
}
