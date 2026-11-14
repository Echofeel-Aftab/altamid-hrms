export function todayInIndia(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(now);
}

export function kolkataDayRange(day: string): { start: Date; end: Date } {
  return {
    start: new Date(day + 'T00:00:00+05:30'),
    end: new Date(day + 'T23:59:59.999+05:30'),
  };
}

export function weekdayOf(day: string): number {
  return new Date(day + 'T12:00:00+05:30').getUTCDay();
}

export function eachDay(startsOn: string, endsOn: string): string[] {
  const days: string[] = [];
  let cursor = startsOn;
  while (cursor <= endsOn && days.length <= 366) {
    days.push(cursor);
    cursor = shiftDay(cursor, 1);
  }
  return days;
}

export function shiftDay(day: string, by: number): string {
  const date = new Date(day + 'T12:00:00+05:30');
  date.setUTCDate(date.getUTCDate() + by);
  return date.toISOString().slice(0, 10);
}

export function countedDays(startsOn: string, endsOn: string, weekOff: number[], holidays: Set<string>): number {
  return eachDay(startsOn, endsOn).filter((day) => !weekOff.includes(weekdayOf(day)) && !holidays.has(day)).length;
}

export function inclusiveDays(startsOn: string, endsOn: string): number {
  const start = Date.parse(startsOn + 'T00:00:00Z');
  const end = Date.parse(endsOn + 'T00:00:00Z');
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    throw new Error('Choose an end date on or after the start date.');
  }
  const days = Math.round((end - start) / 86400000) + 1;
  if (days > 366) throw new Error('A single request can cover at most 366 days.');
  return days;
}

export function rangesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}

export function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return base || 'company';
}

export function nextEmployeeCode(
  existing: string[],
  options?: { prefix?: string; padding?: number; includeYear?: boolean; year?: number },
): string {
  const prefix = options?.prefix || 'EMP';
  const padding = options?.padding ?? 3;
  const head = options?.includeYear ? `${prefix}${options.year ?? new Date().getFullYear()}` : prefix;
  const pattern = new RegExp('^' + head.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(\\d+)$');
  let max = 0;
  for (const code of existing) {
    const match = pattern.exec(code);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return head + String(max + 1).padStart(padding, '0');
}
