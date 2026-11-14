/**
 * Blocks that can appear on Home. A layout only decides whether a block is shown; the data in a
 * desk block is still limited by Access, so turning a block on never shows data the person may not see.
 */
export interface HomeBlock {
  key: string;
  label: string;
  hint: string;
  group: 'My day' | 'My team' | 'Company desks' | 'Community';
  icon: string;
  /** `employee`: needs a linked person. `team`: needs direct reports or a team to lead. Otherwise an Access feature key. */
  needs?: string;
  needsLabel?: string;
}

export const HOME_BLOCKS: HomeBlock[] = [
  { key: 'punch', label: 'Check in and out', hint: 'The clock with today’s hours', group: 'My day', icon: 'bi-fingerprint', needs: 'employee' },
  { key: 'month-tally', label: 'Present and absent', hint: 'Days present and absent so far this month', group: 'My day', icon: 'bi-calendar-check', needs: 'employee' },
  { key: 'calendar', label: 'My month', hint: 'Present, absent, leave, and holidays this month', group: 'My day', icon: 'bi-calendar3', needs: 'employee' },
  { key: 'leave', label: 'Leave left', hint: 'Balance for each leave type', group: 'My day', icon: 'bi-calendar2-week', needs: 'employee' },
  { key: 'my-requests', label: 'My requests', hint: 'Leave, attendance, and detail changes waiting or just decided', group: 'My day', icon: 'bi-send', needs: 'employee' },
  { key: 'my-pay', label: 'Latest payslip', hint: 'The last published slip and its net pay', group: 'My day', icon: 'bi-wallet2', needs: 'employee' },
  { key: 'my-assets', label: 'My assets', hint: 'Laptops, phones, cards, and licences issued to me', group: 'My day', icon: 'bi-laptop', needs: 'employee' },
  { key: 'shortcuts', label: 'Shortcuts', hint: 'Quick links for the areas this person uses', group: 'My day', icon: 'bi-lightning-charge' },
  { key: 'team-today', label: 'My team today', hint: 'Who in my team is in, out, or on leave', group: 'My team', icon: 'bi-people', needs: 'team', needsLabel: 'Direct reports or a team to lead' },
  { key: 'approvals', label: 'Waiting on me', hint: 'Leave and attendance requests to decide', group: 'My team', icon: 'bi-hourglass-split', needs: 'approvals', needsLabel: 'Approvals' },
  { key: 'company-today', label: 'Company today', hint: 'Headcount, who is in, on leave, and not checked in', group: 'Company desks', icon: 'bi-buildings', needs: 'people', needsLabel: 'Directory' },
  { key: 'people-watch', label: 'People to watch', hint: 'Probation ending, exits, onboarding, and detail changes', group: 'Company desks', icon: 'bi-person-lines-fill', needs: 'people.edit', needsLabel: 'Edit people' },
  { key: 'payroll-desk', label: 'Payroll this month', hint: 'Draft, published, and locked slips, missing CTC and bank details', group: 'Company desks', icon: 'bi-cash-stack', needs: 'pay', needsLabel: 'Payroll desk' },
  { key: 'hiring-desk', label: 'Hiring', hint: 'Open jobs and applications this week', group: 'Company desks', icon: 'bi-briefcase', needs: 'hiring', needsLabel: 'Hiring desk' },
  { key: 'assets-desk', label: 'Assets desk', hint: 'Stock, repairs, warranties, and licence renewals', group: 'Company desks', icon: 'bi-pc-display', needs: 'assets', needsLabel: 'Assets' },
  { key: 'announcements', label: 'Announcements', hint: 'Latest company news', group: 'Community', icon: 'bi-megaphone' },
  { key: 'celebrations', label: 'Birthdays and anniversaries', hint: 'Send a wish in one click', group: 'Community', icon: 'bi-gift' },
  { key: 'joiners', label: 'New joiners', hint: 'People who joined this month or last', group: 'Community', icon: 'bi-person-plus' },
  { key: 'holidays', label: 'Upcoming holidays', hint: 'The next company holidays', group: 'Community', icon: 'bi-balloon' },
  { key: 'jobs', label: 'Jobs and referrals', hint: 'Open jobs people can apply for or refer to', group: 'Community', icon: 'bi-door-open' },
  { key: 'directory', label: 'Find a colleague', hint: 'Search box at the top of Home', group: 'Community', icon: 'bi-search' },
];

export type BlockSize = 's' | 'm' | 'l';
/** How many equal columns the Home board uses. 4 is the original layout. */
export type HomeColumns = 1 | 2 | 3 | 4;

const TILES = ['approvals', 'month-tally', 'my-pay'];

/** Where each block sits on Home until a person moves it. `directory` is the search box in the header, not a box. */
export const HOME_ORDER = [
  'punch', 'approvals', 'month-tally', 'my-pay',
  'company-today', 'team-today', 'payroll-desk', 'hiring-desk', 'people-watch', 'assets-desk',
  'calendar', 'leave', 'my-requests', 'shortcuts', 'my-assets', 'holidays',
  'celebrations', 'joiners', 'jobs', 'announcements',
];

export function sizesOf(key: string): BlockSize[] {
  return TILES.includes(key) ? ['s', 'm'] : ['m', 'l'];
}

export function defaultSize(key: string): BlockSize {
  if (TILES.includes(key)) return 's';
  return key === 'announcements' ? 'l' : 'm';
}

export function columnsOf(raw: string): HomeColumns {
  try {
    const value = Number((JSON.parse(raw || '{}') as { _columns?: unknown })._columns);
    return value === 1 || value === 2 || value === 3 || value === 4 ? value : 4;
  } catch {
    return 4;
  }
}

/** A person's own order and box sizes, saved beside their hidden blocks. */
export function arrangementOf(raw: string): { order: string[]; size: Record<string, BlockSize> } {
  try {
    const parsed = JSON.parse(raw || '{}') as { _order?: unknown; _size?: unknown };
    const order = Array.isArray(parsed._order) ? [...new Set(parsed._order.map(String).filter((key) => HOME_ORDER.includes(key)))] : [];
    const size: Record<string, BlockSize> = {};
    if (parsed._size && typeof parsed._size === 'object' && !Array.isArray(parsed._size)) {
      for (const [key, value] of Object.entries(parsed._size as Record<string, unknown>)) {
        if (HOME_ORDER.includes(key) && (sizesOf(key) as string[]).includes(String(value))) size[key] = value as BlockSize;
      }
    }
    return { order, size };
  } catch {
    return { order: [], size: {} };
  }
}

export const LAYOUT_KINDS = ['company', 'role', 'department', 'person'] as const;
export type LayoutKind = (typeof LAYOUT_KINDS)[number];
export type BlockSetting = 'on' | 'off';

export function blockSettings(raw: string): Record<string, BlockSetting> {
  try {
    const parsed = JSON.parse(raw || '{}') as Record<string, unknown>;
    const out: Record<string, BlockSetting> = {};
    for (const block of HOME_BLOCKS) {
      const value = parsed?.[block.key];
      if (value === 'on' || value === 'off') out[block.key] = value;
    }
    return out;
  } catch {
    return {};
  }
}
