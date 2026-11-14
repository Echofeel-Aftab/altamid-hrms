import { PrismaService } from './prisma.service';

export interface SalaryLine { side: 'earning' | 'deduction' | 'employer'; name: string; rupees: number }

export interface CurrentPay {
  effectiveFrom: string;
  lines: SalaryLine[];
  /** Yearly earnings, which is the taxable salary before exemptions. */
  earnings: number;
  employer: number;
  basic: number;
  hra: number;
  lta: number;
}

const match = (lines: SalaryLine[], pattern: RegExp) => lines.filter((line) => line.side === 'earning' && pattern.test(line.name)).reduce((sum, line) => sum + line.rupees, 0);

/** The published CTC in force on a day, read from the pay structure. Amounts are yearly, in rupees. */
export async function currentPay(prisma: PrismaService, companyId: string, employeeId: string, day: string): Promise<CurrentPay | null> {
  const rows = await prisma.payStructure.findMany({
    where: { companyId, employeeId, published: true },
    orderBy: { effectiveFrom: 'desc' },
  });
  const row = rows.find((item) => item.effectiveFrom <= day) || rows[rows.length - 1];
  if (!row) return null;
  let raw: Array<{ side: SalaryLine['side']; name: string; paise: number }> = [];
  try {
    const parsed = JSON.parse(row.linesJson);
    raw = Array.isArray(parsed) ? parsed : [];
  } catch {
    raw = [];
  }
  const lines = raw.map((line) => ({ side: line.side, name: String(line.name || ''), rupees: Math.round((Number(line.paise) || 0) / 100) }));
  return {
    effectiveFrom: row.effectiveFrom,
    lines,
    earnings: lines.filter((line) => line.side === 'earning').reduce((sum, line) => sum + line.rupees, 0),
    employer: lines.filter((line) => line.side === 'employer').reduce((sum, line) => sum + line.rupees, 0),
    basic: match(lines, /\bbasic\b/i),
    hra: match(lines, /\bhra\b|house\s*rent/i),
    lta: match(lines, /\blta\b|leave\s*travel/i),
  };
}

export async function notifyPerson(
  prisma: PrismaService,
  companyId: string,
  employeeId: string,
  note: { kind: string; title: string; body: string; link: string; ref: string },
): Promise<void> {
  const user = await prisma.user.findFirst({ where: { companyId, employeeId }, select: { id: true } });
  if (!user) return;
  await prisma.notification.create({
    data: { companyId, userId: user.id, kind: note.kind, title: note.title.slice(0, 160), body: note.body.slice(0, 600), link: note.link, ref: note.ref },
  }).catch(() => undefined);
}

export function fullName(person: { firstName: string; lastName: string }): string {
  return `${person.firstName} ${person.lastName}`.trim();
}

export function ageOn(dateOfBirth: string, day: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth)) return 30;
  const [by, bm, bd] = dateOfBirth.split('-').map(Number);
  const [y, m, d] = day.split('-').map(Number);
  return y - by - (m < bm || (m === bm && d < bd) ? 1 : 0);
}

export function inr(rupees: number): string {
  return '₹' + Math.round(rupees).toLocaleString('en-IN');
}

/** A data URL upload: a PDF, JPG or PNG under the size limit. */
export function uploadOf(data: unknown, name: unknown, maxBytes: number): { bytes: Buffer; mime: string; ext: string; name: string } | null {
  const match = /^data:(application\/pdf|image\/jpeg|image\/png);base64,([A-Za-z0-9+/=\s]+)$/.exec(String(data || '').trim());
  if (!match) return null;
  const bytes = Buffer.from(match[2].replace(/\s/g, ''), 'base64');
  if (bytes.length < 32 || bytes.length > maxBytes) return null;
  const ext = match[1] === 'application/pdf' ? 'pdf' : match[1] === 'image/png' ? 'png' : 'jpg';
  const clean = String(name || 'file').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'file';
  return { bytes, mime: match[1], ext, name: clean.toLowerCase().endsWith('.' + ext) ? clean : `${clean}.${ext}` };
}
