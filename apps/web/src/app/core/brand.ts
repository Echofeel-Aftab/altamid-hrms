export const BRAND_DEFAULTS: Record<string, string> = {
  primary: '#103860', primary_hover: '#185880', accent: '#e8c85c', accent_hover: '#f3d76e',
  heading: '#103860', link: '#185880', link_hover: '#103860',
  btn_primary: '#103860', btn_primary_hover: '#185880', btn_primary_text: '#ffffff',
  btn_accent: '#e8c85c', btn_accent_hover: '#f3d76e', btn_accent_text: '#1a1408',
  bg: '#f5f7fb', card: '#ffffff', text: '#0f1b2d', muted: '#5a6a7e', border: '#e3e8ef',
  sidebar_bg: '#eef3f8', sidebar_text: '#081c30', topbar_bg: '#ffffff',
  dark_bg: '#0f141a', dark_card: '#171e27', dark_text: '#e9eef4', dark_muted: '#9fb0c2', dark_border: '#253041',
  dark_heading: '#ffffff', dark_link: '#f3d76e', dark_link_hover: '#ffffff', dark_accent: '#f3d76e',
  dark_sidebar_bg: '#103860', dark_sidebar_text: '#f0f5fa',
  dark_btn_primary: '#103860', dark_btn_primary_hover: '#185880', dark_btn_primary_text: '#ffffff',
  dark_btn_accent: '#e8c85c', dark_btn_accent_hover: '#f3d76e', dark_btn_accent_text: '#1a1408',
};

export const BRAND_GROUPS: Array<{ id: string; title: string; blurb: string; advanced: boolean; keys: string[] }> = [
  { id: 'brand', title: 'Brand colours', blurb: 'Primary and accent drive headings, links, the sidebar and the navy and gold look.', advanced: false, keys: ['primary', 'primary_hover', 'accent', 'accent_hover', 'heading', 'link', 'link_hover'] },
  { id: 'buttons', title: 'Buttons', blurb: 'Primary and accent buttons, including hover and the label colour.', advanced: true, keys: ['btn_primary', 'btn_primary_hover', 'btn_primary_text', 'btn_accent', 'btn_accent_hover', 'btn_accent_text'] },
  { id: 'surfaces', title: 'Page surfaces (light mode)', blurb: 'Backgrounds, body text and borders on the workspace.', advanced: true, keys: ['bg', 'card', 'text', 'muted', 'border', 'sidebar_bg', 'sidebar_text', 'topbar_bg'] },
  { id: 'dark', title: 'Dark mode', blurb: 'Colours when someone chooses dark theme. Keep light text on dark panels.', advanced: true, keys: ['dark_bg', 'dark_card', 'dark_text', 'dark_muted', 'dark_border', 'dark_heading', 'dark_link', 'dark_link_hover', 'dark_accent', 'dark_sidebar_bg', 'dark_sidebar_text', 'dark_btn_primary', 'dark_btn_primary_hover', 'dark_btn_primary_text', 'dark_btn_accent', 'dark_btn_accent_hover', 'dark_btn_accent_text'] },
];

export const BRAND_LABELS: Record<string, [string, string]> = {
  primary: ['Primary', 'Headings, sidebar icons, navy chrome'],
  primary_hover: ['Primary hover', 'Links and navy button hover'],
  accent: ['Accent', 'Gold buttons and highlights'],
  accent_hover: ['Accent hover', 'Gold button hover'],
  heading: ['Heading', 'Page titles in light mode'],
  link: ['Link', 'Text links'],
  link_hover: ['Link hover', 'Text links on hover'],
  btn_primary: ['Primary button', 'Navy buttons'],
  btn_primary_hover: ['Primary button hover', ''],
  btn_primary_text: ['Primary button text', 'Usually white'],
  btn_accent: ['Accent button', 'Gold buttons'],
  btn_accent_hover: ['Accent button hover', ''],
  btn_accent_text: ['Accent button text', 'Usually near-black'],
  bg: ['Page background', ''],
  card: ['Cards and panels', ''],
  text: ['Body text', ''],
  muted: ['Muted text', 'Hints and secondary copy'],
  border: ['Borders', ''],
  sidebar_bg: ['Sidebar', ''],
  sidebar_text: ['Sidebar text', ''],
  topbar_bg: ['Top bar', ''],
  dark_bg: ['Page background', ''],
  dark_card: ['Cards and panels', ''],
  dark_text: ['Body text', ''],
  dark_muted: ['Muted text', ''],
  dark_border: ['Borders', ''],
  dark_heading: ['Heading', 'Page titles in dark mode'],
  dark_link: ['Link', ''],
  dark_link_hover: ['Link hover', ''],
  dark_accent: ['Accent', 'Highlights in dark mode'],
  dark_sidebar_bg: ['Sidebar', ''],
  dark_sidebar_text: ['Sidebar text', ''],
  dark_btn_primary: ['Primary button', ''],
  dark_btn_primary_hover: ['Primary button hover', ''],
  dark_btn_primary_text: ['Primary button text', ''],
  dark_btn_accent: ['Accent button', ''],
  dark_btn_accent_hover: ['Accent button hover', ''],
  dark_btn_accent_text: ['Accent button text', ''],
};

export function brandPresets(): Array<{ id: string; label: string; colors: Record<string, string> }> {
  return [
    { id: 'altamid', label: 'Altamid', colors: { ...BRAND_DEFAULTS } },
    { id: 'forest', label: 'Forest', colors: derive('#1b4332', '#95d5b2') },
    { id: 'royal', label: 'Royal', colors: derive('#3d2463', '#e8c85c') },
    { id: 'slate', label: 'Slate', colors: derive('#334155', '#2dd4bf') },
    { id: 'crimson', label: 'Crimson', colors: derive('#7f1d1d', '#f4c430') },
  ];
}

const SURFACE_KEYS = [
  'bg', 'card', 'text', 'muted', 'border', 'sidebar_bg', 'sidebar_text', 'topbar_bg',
  'dark_bg', 'dark_card', 'dark_text', 'dark_muted', 'dark_border', 'dark_heading', 'dark_sidebar_text',
];

export const CONTRAST_AGAINST: Record<string, string> = {
  heading: 'bg', link: 'card', text: 'bg', muted: 'bg', sidebar_text: 'sidebar_bg',
  btn_primary_text: 'btn_primary', btn_accent_text: 'btn_accent',
  dark_heading: 'dark_bg', dark_text: 'dark_bg', dark_muted: 'dark_bg', dark_link: 'dark_card',
  dark_sidebar_text: 'dark_sidebar_bg',
  dark_btn_primary_text: 'dark_btn_primary', dark_btn_accent_text: 'dark_btn_accent',
};

export function contrastRatio(a: string, b: string): number {
  const lighter = Math.max(luminance(a), luminance(b));
  const darker = Math.min(luminance(a), luminance(b));
  return (lighter + 0.05) / (darker + 0.05);
}

export function applyDriver(colors: Record<string, string>, key: string, hex: string): Record<string, string> {
  const next = { ...colors, [key]: hex };
  if (key === 'primary' || key === 'accent') {
    const derived = derive(next['primary'], next['accent']);
    for (const keep of SURFACE_KEYS) derived[keep] = next[keep] || derived[keep];
    return derived;
  }
  if (key === 'btn_primary' || key === 'btn_accent' || key === 'dark_btn_primary' || key === 'dark_btn_accent') {
    next[key + '_hover'] = lighten(hex, key.includes('accent') ? 0.14 : 0.18);
    next[key + '_text'] = contrastText(hex);
  }
  return next;
}

export function derive(primary: string, accent: string): Record<string, string> {
  const base: Record<string, string> = { ...BRAND_DEFAULTS };
  const ph = lighten(primary, 0.18);
  const ah = lighten(accent, 0.14);
  const heading = luminance(primary) < 0.45 ? primary : '#1a1408';
  const darkLink = luminance(ah) > 0.45 ? ah : lighten(accent, 0.62);
  const set: Record<string, string> = {
    primary, primary_hover: ph, accent, accent_hover: ah, heading,
    link: luminance(ph) < 0.45 ? ph : heading, link_hover: heading,
    btn_primary: primary, btn_primary_hover: ph, btn_primary_text: contrastText(primary),
    btn_accent: accent, btn_accent_hover: ah, btn_accent_text: contrastText(accent),
    dark_link: darkLink, dark_link_hover: '#ffffff', dark_accent: darkLink, dark_sidebar_bg: primary,
    dark_btn_primary: primary, dark_btn_primary_hover: ph, dark_btn_primary_text: contrastText(primary),
    dark_btn_accent: accent, dark_btn_accent_hover: ah, dark_btn_accent_text: contrastText(accent),
  };
  return { ...base, ...set };
}

const LEGACY_SURFACES: Record<string, string> = {
  bg: '#f3f6fa', text: '#101828', muted: '#2f4054', border: '#c5d0dc',
  dark_bg: '#12171d', dark_card: '#1b222b', dark_text: '#eef3f8', dark_muted: '#c5d0da', dark_border: '#2a3440',
  /* Pre–Phase A defaults also treated as unset so tenants pick up the quiet palette. */
};

export function applyBrand(colors: Record<string, string> | undefined): void {
  const saved = { ...(colors || {}) };
  for (const [key, old] of Object.entries(LEGACY_SURFACES)) {
    if ((saved[key] || '').toLowerCase() === old) delete saved[key];
  }
  const c = { ...BRAND_DEFAULTS, ...saved };
  const x = (key: string) => c[key];
  const primary = x('primary');
  const accent = x('accent');
  const stock = sameAsDefaults(c);
  const navy950 = stock ? '#081c30' : darken(primary, 0.32);
  const navy900 = stock ? '#0a2744' : darken(primary, 0.18);
  const navy600 = stock ? '#2078a8' : lighten(primary, 0.28);
  const gold700 = stock ? '#c9a22e' : darken(accent, 0.22);
  const gold600 = stock ? '#d8b445' : darken(accent, 0.12);
  const gold300 = stock ? '#fae48c' : lighten(accent, 0.22);
  const primaryText = x('btn_primary_text');
  const accentText = x('btn_accent_text');
  const css = `
    :root {
      --navy-950: ${navy950}; --navy-900: ${navy900}; --navy-800: ${primary}; --navy-700: ${x('primary_hover')}; --navy-600: ${navy600};
      --gold-700: ${gold700}; --gold-600: ${gold600}; --gold-500: ${accent}; --gold-400: ${x('accent_hover')}; --gold-300: ${gold300};
      --bg: ${x('bg')}; --card: ${x('card')}; --text: ${x('text')}; --muted: ${x('muted')}; --border: ${x('border')}; --heading: ${x('heading')};
      --border-strong: ${mix(x('border'), x('muted'), 0.35)};
      --shadow: 0 1px 2px rgba(16, 24, 40, 0.05);
      --shadow-lg: 0 6px 16px -8px ${hexAlpha(primary, 0.2)};
    }
    html.theme-dark {
      --bg: ${x('dark_bg')}; --card: ${x('dark_card')}; --text: ${x('dark_text')}; --muted: ${x('dark_muted')}; --border: ${x('dark_border')}; --heading: ${x('dark_heading')};
      --border-strong: ${lighten(x('dark_border'), 0.12)};
      --gold-400: ${x('dark_accent')}; --gold-500: ${x('dark_btn_accent')}; --gold-600: ${darken(x('dark_btn_accent'), 0.1)};
      --shadow: 0 1px 2px rgba(0, 0, 0, 0.35);
      --shadow-lg: 0 10px 28px -12px rgba(0, 0, 0, 0.55);
    }
    .sidebar {
      --sb-bg: linear-gradient(180deg, ${lighten(x('sidebar_bg'), 0.45)} 0%, ${x('sidebar_bg')} 100%);
      --sb-text: ${x('sidebar_text')}; --sb-link: ${x('sidebar_text')}; --sb-icon: ${primary};
      --sb-hover: ${hexAlpha(primary, 0.1)}; --sb-active: ${hexAlpha(accent, 0.28)};
      --sb-border: ${hexAlpha(primary, 0.12)}; --sb-label: ${x('muted')};
    }
    html.theme-dark .sidebar {
      --sb-bg: linear-gradient(180deg, ${darken(x('dark_sidebar_bg'), 0.28)} 0%, ${x('dark_sidebar_bg')} 100%);
      --sb-text: ${x('dark_sidebar_text')}; --sb-link: ${x('dark_sidebar_text')}; --sb-icon: ${x('dark_accent')};
      --sb-hover: ${hexAlpha(x('dark_accent'), 0.16)}; --sb-active: ${hexAlpha(x('dark_accent'), 0.26)};
      --sb-border: ${hexAlpha(x('dark_accent'), 0.22)}; --sb-label: ${x('dark_muted')};
    }
    .topbar { background: ${x('topbar_bg')}; }
    html.theme-dark .topbar { background: ${x('dark_card')}; }
    .btn, .btn-primary { background: ${x('btn_primary')}; border-color: ${x('btn_primary')}; color: ${primaryText}; }
    .btn:hover, .btn-primary:hover { background: ${x('btn_primary_hover')}; border-color: ${x('btn_primary_hover')}; color: ${primaryText}; }
    .btn-ghost, .btn-secondary { background: ${x('card')}; color: ${x('heading')}; border-color: ${x('border')}; }
    .btn-ghost:hover, .btn-secondary:hover { background: ${hexAlpha(primary, 0.08)}; color: ${x('heading')}; border-color: ${primary}; }
    .btn-gold { background: ${x('btn_accent')}; border-color: ${darken(x('btn_accent'), 0.1)}; color: ${accentText}; }
    .btn-gold:hover { background: ${x('btn_accent_hover')}; color: ${accentText}; }
    html.theme-dark .btn, html.theme-dark .btn-primary { background: ${x('dark_btn_primary')}; border-color: ${x('dark_btn_primary')}; color: ${x('dark_btn_primary_text')}; }
    html.theme-dark .btn:hover, html.theme-dark .btn-primary:hover { background: ${x('dark_btn_primary_hover')}; border-color: ${x('dark_btn_primary_hover')}; color: ${x('dark_btn_primary_text')}; }
    html.theme-dark .btn-ghost, html.theme-dark .btn-secondary { background: ${x('dark_card')}; color: ${x('dark_text')}; border-color: ${x('dark_border')}; }
    html.theme-dark .btn-ghost:hover, html.theme-dark .btn-secondary:hover { background: ${x('dark_btn_accent')}; color: ${x('dark_btn_accent_text')}; border-color: ${x('dark_btn_accent')}; }
    html.theme-dark .btn-gold { background: ${x('dark_btn_accent')}; border-color: ${darken(x('dark_btn_accent'), 0.1)}; color: ${x('dark_btn_accent_text')}; }
    a { color: ${x('link')}; }
    a:hover { color: ${x('link_hover')}; }
    html.theme-dark a { color: ${x('dark_link')}; }
    html.theme-dark a:hover { color: ${x('dark_link_hover')}; }
    h1, .page-head h1, .settings-card-head h2 { color: ${x('heading')}; }
    html.theme-dark h1, html.theme-dark .page-head h1, html.theme-dark .settings-card-head h2 { color: ${x('dark_heading')}; }
    .settings-tab.is-active, .settings-tab.is-active:hover { background: ${x('btn_primary')}; color: ${primaryText}; }
    .settings-tab.is-active strong, .settings-tab.is-active small,
    .settings-tab.is-active:hover strong, .settings-tab.is-active:hover small { color: ${primaryText}; }
    .settings-tab.is-active > i:first-child { color: ${accent}; }
    html.theme-dark .settings-tab.is-active, html.theme-dark .settings-tab.is-active:hover { background: ${x('dark_btn_accent')}; color: ${x('dark_btn_accent_text')}; }
    html.theme-dark .settings-tab.is-active strong, html.theme-dark .settings-tab.is-active small,
    html.theme-dark .settings-tab.is-active:hover strong, html.theme-dark .settings-tab.is-active:hover small,
    html.theme-dark .settings-tab.is-active > i:first-child { color: ${x('dark_btn_accent_text')}; }
  `;
  let node = document.getElementById('hrms-brand');
  if (!node) {
    node = document.createElement('style');
    node.id = 'hrms-brand';
    document.head.appendChild(node);
  }
  node.textContent = css;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', primary);
}

export function readDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Could not read that image.'));
    reader.readAsDataURL(file);
  });
}

function sameAsDefaults(colors: Record<string, string>): boolean {
  return Object.keys(BRAND_DEFAULTS).every((key) => (colors[key] || '').toLowerCase() === BRAND_DEFAULTS[key].toLowerCase());
}

function rgb(hex: string): [number, number, number] {
  const clean = expand(hex);
  return [parseInt(clean.slice(1, 3), 16), parseInt(clean.slice(3, 5), 16), parseInt(clean.slice(5, 7), 16)];
}

function expand(hex: string): string {
  const value = (hex || '').trim();
  if (/^#[0-9a-fA-F]{3}$/.test(value)) return ('#' + value[1] + value[1] + value[2] + value[2] + value[3] + value[3]).toLowerCase();
  return /^#[0-9a-fA-F]{6}$/.test(value) ? value.toLowerCase() : '#103860';
}

function toHex(r: number, g: number, b: number): string {
  const part = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return '#' + part(r) + part(g) + part(b);
}

function mix(a: string, b: string, t: number): string {
  const A = rgb(a);
  const B = rgb(b);
  const amount = Math.max(0, Math.min(1, t));
  return toHex(A[0] + (B[0] - A[0]) * amount, A[1] + (B[1] - A[1]) * amount, A[2] + (B[2] - A[2]) * amount);
}

function lighten(hex: string, t: number): string { return mix(hex, '#ffffff', t); }
function darken(hex: string, t: number): string { return mix(hex, '#000000', t); }

function luminance(hex: string): number {
  const lin = rgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

function contrastText(hex: string): string {
  const white = contrastRatio(hex, '#ffffff');
  const ink = contrastRatio(hex, '#1a1408');
  return white >= ink ? '#ffffff' : '#1a1408';
}

function hexAlpha(hex: string, alpha: number): string {
  const [r, g, b] = rgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
