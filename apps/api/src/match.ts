const STOP = new Set(`a an and are as at be been being but by can could did do does for from had has have he her his how i if in into is it its may me more most must my no not of on or our out over own per she should so such than that the their them then there these they this those to too under up us very was we were what when where which who will with would you your
able ability across also any around based basic both day each eg etc every few get good great help ie including inc join just like looking make new one other others plus preferred proven related required requirement requirements responsible role skill skills strong team teams use using well within work working year years yr yrs month months experience experienced knowledge understanding candidate candidates job position company apply applying`.split(/\s+/));

const SHORT_KEEP = new Set(['c', 'r', 'go', 'ai', 'ml', 'ui', 'ux', 'qa', 'hr', 'pr', 'bi', 'ca', 'cs', 'it', 'pf', 'gst', 'tds', 'sql', 'aws', 'gcp', 'php', 'seo', 'crm', 'erp', 'sap']);

export interface MatchPoint {
  text: string;
  state: 'met' | 'partly' | 'missing';
  found: string[];
  missing: string[];
}

export interface MatchSignal {
  label: string;
  value: string;
  tone: 'ok' | 'warn' | 'bad' | 'info';
}

export interface MatchResult {
  score: number | null;
  reason: string;
  words: number;
  points: MatchPoint[];
  keywords: { word: string; found: boolean }[];
  signals: MatchSignal[];
  stems: string[];
}

export interface MatchJob {
  title: string;
  description: string;
  requirements: string;
  location: string;
  workplace: string;
}

export interface Segment {
  text: string;
  hit: boolean;
}

const MIN_WORDS = 25;

export function stemOf(word: string): string {
  let value = word.toLowerCase().replace(/^[.]+|[.]+$/g, '');
  if (value.length > 5 && value.endsWith('ies')) value = value.slice(0, -3) + 'y';
  else if (value.length > 4 && value.endsWith('es') && /(ches|shes|xes|sses)$/.test(value)) value = value.slice(0, -2);
  else if (value.length > 3 && value.endsWith('s') && !value.endsWith('ss') && !value.endsWith('us')) value = value.slice(0, -1);
  return value;
}

export function wordsOf(text: string): string[] {
  return String(text || '').toLowerCase().match(/[a-z0-9][a-z0-9+#.]*/g)?.map((word) => word.replace(/\.+$/, '')) || [];
}

function keyStems(text: string): string[] {
  const seen = new Set<string>();
  for (const word of wordsOf(text)) {
    if (STOP.has(word) || /^\d+$/.test(word)) continue;
    if (word.length < 3 && !SHORT_KEEP.has(word)) continue;
    const stem = stemOf(word);
    if (stem && !STOP.has(stem)) seen.add(stem);
  }
  return [...seen];
}

function pointsOf(job: MatchJob): string[] {
  const lines = (source: string) => source.split(/\n|(?<=[.;])\s+(?=[A-Z])/)
    .map((line) => line.replace(/^\s*(?:[•\-*–·]|\d+[.)])\s*/, '').trim())
    .filter((line) => line.length > 2 && keyStems(line).length > 0);
  const fromRequirements = lines(job.requirements);
  const picked = fromRequirements.length ? fromRequirements : lines(job.description);
  return [...new Set(picked)].slice(0, 20);
}

function yearsAsked(text: string): number | null {
  const found = /(\d{1,2})\s*\+?\s*(?:(?:-|to)\s*\d{1,2}\s*)?(?:years?|yrs?)/i.exec(text);
  return found ? Number(found[1]) : null;
}

function yearsStated(text: string): number | null {
  let best: number | null = null;
  for (const found of text.matchAll(/(\d{1,2}(?:\.\d)?)\s*\+?\s*(?:years?|yrs?)/gi)) {
    const value = Number(found[1]);
    if (value <= 45 && (best === null || value > best)) best = value;
  }
  return best;
}

/** Compares what the applicant gave us with the job text. Word overlap only; it never reads the resume link. */
export function matchJob(job: MatchJob | null, candidate: string, city = ''): MatchResult {
  const words = wordsOf(candidate).length;
  const have = new Set(wordsOf(candidate).map(stemOf));
  const empty: MatchResult = { score: null, reason: '', words, points: [], keywords: [], signals: [], stems: [] };
  if (!job) return { ...empty, reason: 'This came through the general form, so there is no job description to compare with.' };

  const points: MatchPoint[] = pointsOf(job).map((text) => {
    const stems = keyStems(text);
    const found = stems.filter((stem) => have.has(stem));
    const missing = stems.filter((stem) => !have.has(stem));
    const needed = Math.max(1, Math.ceil(stems.length * 0.6));
    return { text, state: found.length >= needed ? 'met' : found.length ? 'partly' : 'missing', found, missing };
  });

  const weight = new Map<string, number>();
  const add = (text: string, by: number) => { for (const stem of keyStems(text)) weight.set(stem, (weight.get(stem) || 0) + by); };
  add(job.title, 3);
  add(job.requirements, 2);
  add(job.description, 1);
  const keywords = [...weight].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 16).map(([word]) => ({ word, found: have.has(word) }));

  const signals: MatchSignal[] = [];
  const asked = yearsAsked(job.requirements + '\n' + job.description);
  const stated = yearsStated(candidate);
  if (asked !== null) {
    if (stated === null) signals.push({ label: 'Experience', value: `Job asks ${asked}+ years · not stated`, tone: 'info' });
    else signals.push({ label: 'Experience', value: `Job asks ${asked}+ years · mentions ${stated}`, tone: stated >= asked ? 'ok' : 'warn' });
  }
  if (job.workplace === 'remote') signals.push({ label: 'Location', value: 'Remote job', tone: 'ok' });
  else if (job.location && city) {
    const same = keyStems(city).some((stem) => keyStems(job.location).includes(stem));
    signals.push({ label: 'Location', value: `Lives in ${city} · job in ${job.location}`, tone: same ? 'ok' : 'warn' });
  } else if (job.location) signals.push({ label: 'Location', value: `Job in ${job.location} · city not given`, tone: 'info' });

  const stems = [...new Set([...points.flatMap((point) => point.found), ...keywords.filter((item) => item.found).map((item) => item.word)])];
  if (words < MIN_WORDS) {
    return { score: null, reason: `Only ${words} words to compare. Paste the resume text to get a score.`, words, points, keywords, signals, stems };
  }
  const keywordShare = keywords.length ? keywords.filter((item) => item.found).length / keywords.length : 0;
  const pointShare = points.length ? points.reduce((sum, point) => sum + (point.state === 'met' ? 1 : point.state === 'partly' ? 0.5 : 0), 0) / points.length : keywordShare;
  const score = Math.round(100 * (0.7 * pointShare + 0.3 * keywordShare));
  return { score, reason: '', words, points, keywords, signals, stems };
}

export function segmentsOf(text: string, stems: string[]): Segment[] {
  const wanted = new Set(stems);
  const out: Segment[] = [];
  for (const part of String(text || '').split(/([A-Za-z0-9][A-Za-z0-9+#.]*)/)) {
    if (!part) continue;
    const hit = /^[A-Za-z0-9]/.test(part) && wanted.has(stemOf(part.replace(/\.+$/, '')));
    const last = out[out.length - 1];
    if (last && last.hit === hit && !hit) last.text += part;
    else out.push({ text: part, hit });
  }
  return out;
}

export function phoneKey(value: string): string {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length >= 8 ? digits.slice(-10) : '';
}

export function nameKey(value: string): string {
  return String(value || '').toLowerCase().replace(/\b(mr|mrs|ms|miss|dr|shri|smt)\b\.?/g, ' ').replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function emailKey(value: string): string {
  return String(value || '').trim().toLowerCase();
}

export function sameOn(a: { name: string; email: string; phone: string }, b: { name: string; email: string; phone: string }): string[] {
  const on: string[] = [];
  if (emailKey(a.email) && emailKey(a.email) === emailKey(b.email)) on.push('email');
  if (phoneKey(a.phone) && phoneKey(a.phone) === phoneKey(b.phone)) on.push('mobile');
  const name = nameKey(a.name);
  if (name.includes(' ') && name === nameKey(b.name)) on.push('name');
  return on;
}
