import { Injectable } from '@nestjs/common';
import { shiftDay, todayInIndia } from './dates';
import { PrismaService } from './prisma.service';
import { plainOf } from './rich';
import { SettingsService } from './settings.service';

export interface Person {
  name: string;
  email: string;
  phone: string;
}

export interface Cooling {
  until: string;
  reason: string;
  kind: 'rejected' | 'exited';
}

export interface Segment {
  t: string;
  hit: boolean;
}

type Opening = { title: string; description: string; requirements: string; location: string; workplace: string };
type Applicant = { city: string; resumeText: string; answersJson: string };
type Prior = { id: string; name: string; email: string; phone: string; status: string; jobTitle: string; jobCode: string; createdAt: Date; decidedAt: Date | null; coolingUntil: string };
type Staff = { id: string; code: string; firstName: string; lastName: string; email: string; personalEmail: string; phone: string; status: string; dateOfJoining: string; dateOfExit: string };

const STOP = new Set(
  ('a an and are as at be by can for from has have in is it its of on or our should that the their this to was we will with you your ' +
    'able ability etc e.g i.e must plus good strong excellent great work working team teams role job candidate candidates experience experienced ' +
    'year years yrs yr knowledge skills skill understanding familiarity familiar using use based including include also well such other least ' +
    'preferred required requirement requirements nice have any all more who what how per day days time new help helps responsible responsibilities')
    .split(' '),
);
const ANSWER_SKIP = new Set(['name', 'email', 'phone', 'resume', 'city', 'role', 'job', 'position']);

export function emailKey(value: string): string {
  return String(value || '').trim().toLowerCase();
}

export function phoneKey(value: string): string {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length >= 8 ? digits.slice(-10) : '';
}

export function sharedPhones(rows: Array<{ phone: string; owner: string }>): Set<string> {
  const owners = new Map<string, Set<string>>();
  for (const row of rows) {
    const key = phoneKey(row.phone);
    if (!key) continue;
    const set = owners.get(key) || new Set<string>();
    set.add(row.owner);
    owners.set(key, set);
  }
  return new Set([...owners].filter(([, set]) => set.size >= 3).map(([key]) => key));
}

export function nameKey(value: string): string {
  return String(value || '').toLowerCase().replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function tokens(text: string): string[] {
  const found = String(text || '').toLowerCase().match(/[a-z0-9][a-z0-9+#./-]*/g) || [];
  return found.map((word) => word.replace(/[./-]+$/, '')).filter((word) => word.length >= 2 && !STOP.has(word) && !/^\d+$/.test(word));
}

function stem(word: string): string {
  if (word.length > 4 && word.endsWith('ies')) return word.slice(0, -3) + 'y';
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

function years(text: string): number {
  let best = 0;
  for (const match of String(text || '').toLowerCase().matchAll(/(\d{1,2}(?:\.\d)?)\s*\+?\s*(?:-|to)?\s*(?:\d{1,2}\s*)?(?:years?|yrs?)/g)) {
    best = Math.max(best, Number(match[1]));
  }
  return best;
}

function points(html: string): string[] {
  return plainOf(html)
    .split(/\n|•/)
    .map((line) => line.replace(/^[\s\-*\d.)]+/, '').trim())
    .filter((line) => line.length >= 3 && tokens(line).length)
    .slice(0, 20);
}

@Injectable()
export class ApplicantService {
  constructor(private readonly prisma: PrismaService, private readonly settings: SettingsService) {}

  async event(companyId: string, applicationId: string, kind: string, detail: string, by = ''): Promise<void> {
    await this.prisma.applicationEvent.create({ data: { companyId, applicationId, kind, detail: detail.slice(0, 400), by: by.slice(0, 120) } });
  }

  async matches(companyId: string, person: Person, excludeId = '') {
    const email = emailKey(person.email);
    const phone = phoneKey(person.phone);
    const name = nameKey(person.name);
    const [apps, staff] = await Promise.all([
      this.prisma.jobApplication.findMany({
        where: { companyId, id: excludeId ? { not: excludeId } : undefined },
        select: { id: true, name: true, email: true, phone: true, status: true, jobTitle: true, jobCode: true, createdAt: true, decidedAt: true, coolingUntil: true },
        orderBy: { createdAt: 'desc' },
        take: 5000,
      }),
      this.prisma.employee.findMany({
        where: { companyId },
        select: { id: true, code: true, firstName: true, lastName: true, email: true, personalEmail: true, phone: true, status: true, dateOfJoining: true, dateOfExit: true },
      }),
    ]);
    const shared = sharedPhones([
      ...apps.map((row) => ({ phone: row.phone, owner: 'a:' + emailKey(row.email) })),
      ...staff.map((row) => ({ phone: row.phone, owner: 'e:' + row.id })),
    ]);
    const on = (row: { name: string; email: string; phone: string; personalEmail?: string }) => {
      const hits: string[] = [];
      if (email && (emailKey(row.email) === email || (row.personalEmail && emailKey(row.personalEmail) === email))) hits.push('email');
      if (phone && !shared.has(phone) && phoneKey(row.phone) === phone) hits.push('phone');
      if (name.length >= 5 && nameKey(row.name) === name) hits.push('name');
      return hits;
    };
    const applications = (apps as Prior[])
      .map((row) => ({ row, on: on(row) }))
      .filter((item) => item.on.length);
    const employees = (staff as Staff[])
      .map((row) => ({ row, on: on({ name: row.firstName + ' ' + row.lastName, email: row.email, phone: row.phone, personalEmail: row.personalEmail }) }))
      .filter((item) => item.on.length);
    return { applications, employees };
  }

  async cooling(companyId: string, person: Person, excludeId = ''): Promise<Cooling | null> {
    const rules = await this.settings.hiringRules(companyId);
    if (!rules.rejectDays && !rules.exitDays) return null;
    const found = await this.matches(companyId, person, excludeId);
    const today = todayInIndia();
    let best: Cooling | null = null;
    const consider = (until: string, reason: string, kind: Cooling['kind']) => {
      if (until > today && (!best || until > best.until)) best = { until, reason, kind };
    };
    if (rules.rejectDays) {
      for (const item of found.applications) {
        if (!item.on.some((key) => key !== 'name') || item.row.status !== 'rejected') continue;
        const day = todayInIndia(item.row.decidedAt || item.row.createdAt);
        consider(shiftDay(day, rules.rejectDays), 'Not taken forward for ' + (item.row.jobTitle || 'an earlier application') + ' on ' + prettyDay(day), 'rejected');
      }
    }
    if (rules.exitDays) {
      for (const item of found.employees) {
        if (!item.on.some((key) => key !== 'name') || item.row.status !== 'exited' || !/^\d{4}-\d{2}-\d{2}$/.test(item.row.dateOfExit)) continue;
        consider(shiftDay(item.row.dateOfExit, rules.exitDays), 'Left the company (' + item.row.code + ') on ' + prettyDay(item.row.dateOfExit), 'exited');
      }
    }
    return best;
  }

  async rules(companyId: string) {
    return this.settings.hiringRules(companyId);
  }

  async saveRules(companyId: string, input: Record<string, unknown>): Promise<void> {
    await this.settings.saveHiringRules(companyId, input);
  }

  async tell(companyId: string, applicationId: string, person: Person, job: string, cooling: Cooling): Promise<string> {
    const rules = await this.settings.hiringRules(companyId);
    const date = prettyDay(cooling.until);
    const message = rules.message.replace(/\{\{\s*date\s*\}\}/gi, date).replace(/\{\{\s*job\s*\}\}/gi, job || 'this job').replace(/\{\{\s*name\s*\}\}/gi, person.name.split(' ')[0] || person.name);
    const mail = await this.settings.sendTemplate(companyId, 'cooling', [person.email], { name: person.name.split(' ')[0] || person.name, job: job || 'this job', date });
    const told = [rules.tellApplicant ? 'shown the reply on the form' : '', mail.emailed ? 'emailed' : ''].filter(Boolean).join(' and ');
    await this.event(companyId, applicationId, 'cooling', 'Received inside the gap until ' + date + '. ' + cooling.reason + '.' + (told ? ' Applicant ' + told + '.' : ' Applicant was not told.'));
    return rules.tellApplicant ? message : '';
  }

  score(opening: Opening | null, application: Applicant, message: string) {
    if (!opening) return { score: null as number | null, reason: 'This application is not tied to a job, so there is no description to compare with.', components: [], points: [], matched: [], missing: [], terms: [] as string[] };
    const answers = answerText(application.answersJson);
    const pool = [application.resumeText, message, answers].filter(Boolean).join('\n');
    const have = new Set(tokens(pool).map(stem));
    const lines = points(opening.requirements).length ? points(opening.requirements) : points(opening.description);
    const titleTerms = [...new Set(tokens(opening.title))];
    if (have.size < 5) {
      return { score: null, reason: 'Not enough to compare yet. Paste the resume text, or ask the applicant for a cover note.', components: [], points: lines.map((text) => ({ text, status: 'unknown', hits: [] as string[], miss: tokens(text) })), matched: [], missing: [], terms: [] };
    }
    const rows = lines.map((text) => {
      const terms = [...new Set(tokens(text))];
      const hits = terms.filter((term) => have.has(stem(term)));
      const ratio = terms.length ? hits.length / terms.length : 0;
      return { text, status: ratio >= 0.6 ? 'met' : hits.length ? 'partly' : 'missing', hits, miss: terms.filter((term) => !hits.includes(term)), ratio };
    });
    const components: Array<{ key: string; label: string; weight: number; value: number; note: string }> = [];
    const titleHits = titleTerms.filter((term) => have.has(stem(term)));
    if (rows.length) {
      const value = rows.reduce((sum, row) => sum + row.ratio, 0) / rows.length;
      components.push({ key: 'points', label: 'Job description points', weight: 60, value, note: rows.filter((row) => row.status === 'met').length + ' of ' + rows.length + ' points met' });
    }
    if (titleTerms.length) {
      components.push({ key: 'title', label: 'Job title words', weight: 10, value: titleHits.length / titleTerms.length, note: titleHits.length ? 'Mentions ' + titleHits.join(', ') : 'Job title words not mentioned' });
    }
    const need = years(plainOf(opening.requirements) + '\n' + plainOf(opening.description));
    const got = years(pool);
    if (need) {
      components.push({ key: 'years', label: 'Experience', weight: 15, value: got ? Math.min(1, got / need) : 0, note: got ? got + ' years mentioned, the job asks for ' + need : 'The job asks for ' + need + ' years; none mentioned' });
    }
    if (opening.workplace !== 'remote' && opening.location.trim()) {
      const city = application.city.trim().toLowerCase();
      const place = opening.location.trim().toLowerCase();
      const same = Boolean(city) && (place.includes(city) || city.includes(place));
      components.push({ key: 'city', label: 'Location', weight: 15, value: same ? 1 : 0, note: city ? (same ? 'Lives in ' + application.city : 'Lives in ' + application.city + ', the job is in ' + opening.location) : 'City not given' });
    }
    const weight = components.reduce((sum, row) => sum + row.weight, 0);
    const score = weight ? Math.round((100 * components.reduce((sum, row) => sum + row.weight * row.value, 0)) / weight) : null;
    const all = [...new Set(rows.flatMap((row) => [...row.hits, ...row.miss]).concat(titleTerms))];
    const matched = all.filter((term) => have.has(stem(term)));
    return {
      score,
      reason: '',
      components: components.map((row) => ({ ...row, value: Math.round(row.value * 100) })),
      points: rows.map(({ ratio: _ratio, ...row }) => row),
      matched,
      missing: all.filter((term) => !matched.includes(term)).slice(0, 30),
      terms: matched,
    };
  }
}

export function answerText(raw: string): string {
  try {
    const parsed = JSON.parse(raw || '{}') as Record<string, unknown>;
    return Object.entries(parsed)
      .filter(([key, value]) => !ANSWER_SKIP.has(key) && typeof value === 'string')
      .map(([, value]) => String(value))
      .join('\n');
  } catch {
    return '';
  }
}

export function highlight(text: string, terms: string[], max = 12000): Segment[] {
  const body = String(text || '').slice(0, max);
  if (!body) return [];
  const wanted = new Set(terms.map(stem));
  const out: Segment[] = [];
  let last = 0;
  for (const match of body.matchAll(/[A-Za-z0-9][A-Za-z0-9+#./-]*/g)) {
    const word = match[0].replace(/[./-]+$/, '');
    if (!wanted.has(stem(word.toLowerCase()))) continue;
    const start = match.index ?? 0;
    if (start > last) out.push({ t: body.slice(last, start), hit: false });
    out.push({ t: word, hit: true });
    last = start + word.length;
  }
  if (last < body.length) out.push({ t: body.slice(last), hit: false });
  return out;
}

export function prettyDay(day: string): string {
  const date = new Date(day + 'T12:00:00+05:30');
  if (Number.isNaN(date.getTime())) return day;
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }).format(date);
}
