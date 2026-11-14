import { HttpException } from '@nestjs/common';

export function fail(status: number, message: string): never {
  throw new HttpException({ message }, status);
}

export function bag(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    fail(400, 'Send a JSON object.');
  }
  return body as Record<string, unknown>;
}

export function text(value: unknown, label: string, max: number): string {
  const cleaned = clean(value);
  if (!cleaned) fail(400, `${label} is required.`);
  if (cleaned.length > max) fail(400, `${label} is too long.`);
  return cleaned;
}

export function optional(value: unknown, max: number): string {
  const cleaned = clean(value);
  if (cleaned.length > max) fail(400, 'That value is too long.');
  return cleaned;
}

function clean(value: unknown): string {
  return String(value ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
}

export function emailOf(value: unknown): string {
  const cleaned = String(value ?? '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleaned)) fail(400, 'Enter a valid email address.');
  return cleaned;
}

export function loginPassword(value: unknown): string {
  const cleaned = String(value ?? '');
  if (!cleaned || cleaned.length > 200) fail(400, 'Enter your password.');
  return cleaned;
}

export function passwordOf(value: unknown): string {
  const cleaned = String(value ?? '');
  if (cleaned.length < 8 || cleaned.length > 200) fail(400, 'Use 8 to 200 characters.');
  if (!/[A-Za-z]/.test(cleaned) || !/[0-9]/.test(cleaned)) fail(400, 'Use a letter and a number in the password.');
  return cleaned;
}

export function dayOf(value: unknown, label: string): string {
  const cleaned = String(value ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cleaned) || Number.isNaN(Date.parse(cleaned + 'T00:00:00Z'))) {
    fail(400, `${label} needs a real date.`);
  }
  return cleaned;
}

export function optionalDay(value: unknown): string {
  const cleaned = String(value ?? '').trim();
  if (!cleaned) return '';
  return dayOf(cleaned, 'Date');
}

export function optionalId(value: unknown): string | null {
  const cleaned = String(value ?? '').trim();
  if (!cleaned) return null;
  if (!/^c[a-z0-9]{8,}$/i.test(cleaned)) fail(400, 'That selection is not valid.');
  return cleaned;
}

export function panOf(value: unknown): string {
  const cleaned = optional(value, 10).toUpperCase();
  if (!cleaned) return '';
  if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(cleaned)) fail(400, 'Enter a valid PAN, or leave it blank.');
  return cleaned;
}

export function ifscOf(value: unknown): string {
  const cleaned = optional(value, 11).toUpperCase();
  if (!cleaned) return '';
  if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(cleaned)) fail(400, 'Enter a valid IFSC, or leave it blank.');
  return cleaned;
}

export function bankOf(value: unknown): string {
  const cleaned = optional(value, 18).replace(/\s+/g, '');
  if (!cleaned) return '';
  if (!/^\d{9,18}$/.test(cleaned)) fail(400, 'Enter the bank account number as 9 to 18 digits, or leave it blank.');
  return cleaned;
}

export function oneOf(value: unknown, allowed: readonly string[], label: string): string {
  const cleaned = String(value ?? '').trim();
  if (!allowed.includes(cleaned)) fail(400, `${label} is not one of the allowed choices.`);
  return cleaned;
}
