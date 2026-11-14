const THEME_KEY = 'altamid_hrms_theme';

export function isDarkTheme(): boolean {
  return localStorage.getItem(THEME_KEY) === 'dark';
}

export function applyTheme(dark: boolean): void {
  document.documentElement.classList.toggle('theme-dark', dark);
}

export function setDarkTheme(dark: boolean): void {
  localStorage.setItem(THEME_KEY, dark ? 'dark' : 'light');
  applyTheme(dark);
}
