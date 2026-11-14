export interface BadgeLook { icon: string; tone: string; line: string }

export const BADGE_LOOKS: Record<string, BadgeLook> = {
  thanks: { icon: 'bi-heart-fill', tone: 'rose', line: 'For help that made a difference' },
  star: { icon: 'bi-star-fill', tone: 'gold', line: 'For standout work' },
  team: { icon: 'bi-people-fill', tone: 'sky', line: 'For lifting the whole team' },
  solver: { icon: 'bi-lightbulb-fill', tone: 'amber', line: 'For cracking a hard one' },
  extra: { icon: 'bi-rocket-takeoff-fill', tone: 'mint', line: 'For going beyond the ask' },
};

export function badgeLook(key: string): BadgeLook {
  return BADGE_LOOKS[key] || { icon: 'bi-award-fill', tone: 'gold', line: '' };
}
