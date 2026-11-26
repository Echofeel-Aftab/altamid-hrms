const KEY = 'altamid_hrms_desk_pack';

export type DeskPack = 'masonry' | 'classic';

export function deskPack(): DeskPack {
  if (typeof localStorage === 'undefined') return 'masonry';
  return localStorage.getItem(KEY) === 'classic' ? 'classic' : 'masonry';
}

export function applyDeskPack(mode: DeskPack): void {
  const html = document.documentElement;
  html.classList.toggle('desk-pack-masonry', mode === 'masonry');
  html.classList.toggle('desk-pack-classic', mode === 'classic');
}

export function setDeskPack(mode: DeskPack): void {
  if (typeof localStorage !== 'undefined') localStorage.setItem(KEY, mode);
  applyDeskPack(mode);
}
