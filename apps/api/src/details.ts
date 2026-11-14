import { bankOf, emailOf, fail, ifscOf, optional, panOf } from './http';

export const MARITAL = ['', 'Single', 'Married', 'Other'];
export const BLOOD = ['', 'A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-'];
export const REGIMES = ['', 'new', 'old'];

/** Fields a person may change about themselves straight away. */
export const SELF_FIELDS: Record<string, { label: string; read: (value: unknown) => string }> = {
  phone: { label: 'Phone', read: (value) => phoneOf(value, 'Phone') },
  personalEmail: { label: 'Personal email', read: (value) => (optional(value, 120) ? emailOf(value) : '') },
  maritalStatus: { label: 'Marital status', read: (value) => pick(value, MARITAL, 'Marital status') },
  nationality: { label: 'Nationality', read: (value) => optional(value, 40) },
  bloodGroup: { label: 'Blood group', read: (value) => pick(value, BLOOD, 'Blood group') },
  fatherName: { label: "Father's name", read: (value) => optional(value, 80) },
  spouseName: { label: "Spouse's name", read: (value) => optional(value, 80) },
  emergencyName: { label: 'Emergency contact', read: (value) => optional(value, 80) },
  emergencyRelation: { label: 'Relation', read: (value) => optional(value, 40) },
  emergencyPhone: { label: 'Emergency phone', read: (value) => phoneOf(value, 'Emergency phone') },
  address: { label: 'Current address', read: (value) => optional(value, 240) },
  city: { label: 'City', read: (value) => optional(value, 80) },
  state: { label: 'State', read: (value) => optional(value, 60) },
  pincode: { label: 'PIN code', read: pincodeOf },
  permanentAddress: { label: 'Permanent address', read: (value) => optional(value, 240) },
  nomineeName: { label: 'Nominee', read: (value) => optional(value, 80) },
  nomineeRelation: { label: 'Nominee relation', read: (value) => optional(value, 40) },
};

/** Fields that payroll relies on. A person's own change waits for HR. */
export const REVIEW_FIELDS: Record<string, { label: string; read: (value: unknown) => string; secret: boolean }> = {
  pan: { label: 'PAN', read: panOf, secret: false },
  aadhaar: { label: 'Aadhaar', read: aadhaarOf, secret: true },
  uan: { label: 'UAN', read: uanOf, secret: false },
  esicNo: { label: 'ESIC number', read: esicOf, secret: false },
  bankName: { label: 'Bank', read: (value) => optional(value, 80), secret: false },
  bankAccount: { label: 'Account number', read: bankOf, secret: true },
  ifsc: { label: 'IFSC', read: ifscOf, secret: false },
  taxRegime: { label: 'Tax regime', read: (value) => pick(value, REGIMES, 'Tax regime'), secret: false },
};

/** Column for each review field. Sealed ones are stored encrypted. */
export const REVIEW_COLUMNS: Record<string, { column: string; sealed: boolean }> = {
  pan: { column: 'panEnc', sealed: true },
  aadhaar: { column: 'aadhaarEnc', sealed: true },
  uan: { column: 'uan', sealed: false },
  esicNo: { column: 'esicNo', sealed: false },
  bankName: { column: 'bankName', sealed: false },
  bankAccount: { column: 'bankEnc', sealed: true },
  ifsc: { column: 'ifscEnc', sealed: true },
  taxRegime: { column: 'taxRegime', sealed: false },
};

export function regimeLabel(value: string): string {
  return value === 'new' ? 'New regime' : value === 'old' ? 'Old regime' : 'Not chosen';
}

function pick(value: unknown, allowed: string[], label: string): string {
  const cleaned = optional(value, 40);
  if (!allowed.includes(cleaned)) fail(400, `${label} is not one of the choices.`);
  return cleaned;
}

function phoneOf(value: unknown, label: string): string {
  const cleaned = optional(value, 20);
  if (cleaned && !/^\+?[0-9][0-9 -]{6,18}$/.test(cleaned)) fail(400, `${label} should be digits, with an optional + and spaces.`);
  return cleaned;
}

function pincodeOf(value: unknown): string {
  const cleaned = optional(value, 6);
  if (cleaned && !/^[1-9][0-9]{5}$/.test(cleaned)) fail(400, 'PIN code is 6 digits and does not start with 0.');
  return cleaned;
}

export function uanOf(value: unknown): string {
  const cleaned = optional(value, 14).replace(/\s+/g, '');
  if (cleaned && !/^[0-9]{12}$/.test(cleaned)) fail(400, 'UAN is 12 digits.');
  return cleaned;
}

export function esicOf(value: unknown): string {
  const cleaned = optional(value, 20).replace(/\s+/g, '');
  if (cleaned && !/^([0-9]{10}|[0-9]{17})$/.test(cleaned)) fail(400, 'ESIC number is 10 or 17 digits.');
  return cleaned;
}

export function aadhaarOf(value: unknown): string {
  const cleaned = optional(value, 14).replace(/[\s-]+/g, '');
  if (!cleaned) return '';
  if (!/^[2-9][0-9]{11}$/.test(cleaned) || !verhoeff(cleaned)) fail(400, 'That Aadhaar number does not look right. Check the 12 digits.');
  return cleaned;
}

const D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 2, 3, 4, 0, 6, 7, 8, 9, 5], [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7], [4, 0, 1, 2, 3, 9, 5, 6, 7, 8], [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2], [7, 6, 5, 9, 8, 2, 1, 0, 4, 3], [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];
const P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 5, 7, 6, 2, 8, 3, 0, 9, 4], [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7], [9, 4, 5, 3, 1, 2, 6, 8, 7, 0], [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5], [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];

function verhoeff(digits: string): boolean {
  let check = 0;
  const reversed = digits.split('').reverse().map(Number);
  for (let index = 0; index < reversed.length; index++) check = D[check][P[index % 8][reversed[index]]];
  return check === 0;
}
