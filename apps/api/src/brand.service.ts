import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { Injectable } from '@nestjs/common';
import { Company } from '@prisma/client';
import { bag, fail, optional } from './http';
import { AccessService } from './access.service';
import { PrismaService } from './prisma.service';
import { SessionUser } from './session';

export const BRAND_KEYS = [
  'primary', 'primary_hover', 'accent', 'accent_hover', 'heading', 'link', 'link_hover',
  'btn_primary', 'btn_primary_hover', 'btn_primary_text', 'btn_accent', 'btn_accent_hover', 'btn_accent_text',
  'bg', 'card', 'text', 'muted', 'border', 'sidebar_bg', 'sidebar_text', 'topbar_bg',
  'dark_bg', 'dark_card', 'dark_text', 'dark_muted', 'dark_border', 'dark_heading', 'dark_link', 'dark_link_hover',
  'dark_accent', 'dark_sidebar_bg', 'dark_sidebar_text',
  'dark_btn_primary', 'dark_btn_primary_hover', 'dark_btn_primary_text',
  'dark_btn_accent', 'dark_btn_accent_hover', 'dark_btn_accent_text',
] as const;

const DEFAULTS: Record<string, string> = {
  primary: '#103860', primary_hover: '#185880', accent: '#e8c85c', accent_hover: '#f3d76e',
  heading: '#103860', link: '#185880', link_hover: '#103860',
  btn_primary: '#103860', btn_primary_hover: '#185880', btn_primary_text: '#ffffff',
  btn_accent: '#e8c85c', btn_accent_hover: '#f3d76e', btn_accent_text: '#1a1408',
  bg: '#f3f6fa', card: '#ffffff', text: '#101828', muted: '#2f4054', border: '#c5d0dc',
  sidebar_bg: '#eef3f8', sidebar_text: '#081c30', topbar_bg: '#ffffff',
  dark_bg: '#12171d', dark_card: '#1b222b', dark_text: '#eef3f8', dark_muted: '#c5d0da', dark_border: '#2a3440',
  dark_heading: '#ffffff', dark_link: '#f3d76e', dark_link_hover: '#ffffff', dark_accent: '#f3d76e',
  dark_sidebar_bg: '#103860', dark_sidebar_text: '#f0f5fa',
  dark_btn_primary: '#103860', dark_btn_primary_hover: '#185880', dark_btn_primary_text: '#ffffff',
  dark_btn_accent: '#e8c85c', dark_btn_accent_hover: '#f3d76e', dark_btn_accent_text: '#1a1408',
};

const PRESETS = new Set(['altamid', 'forest', 'royal', 'slate', 'crimson', 'custom']);

interface StoredBrand {
  preset: string;
  name: string;
  tagline: string;
  title: string;
  website: string;
  colors: Record<string, string>;
  icon: string;
  logo: string;
}

export interface BrandView {
  preset: string;
  name: string;
  tagline: string;
  title: string;
  website: string;
  colors: Record<string, string>;
  hasIcon: boolean;
  hasLogo: boolean;
}

@Injectable()
export class BrandService {
  constructor(private readonly prisma: PrismaService, private readonly gates: AccessService) {}

  async forSession(session: SessionUser): Promise<BrandView> {
    return this.view(await this.company(session.companyId));
  }

  view(company: Company): BrandView {
    const stored = parse(company.brandJson);
    const colors = { ...DEFAULTS, ...stored.colors };
    return {
      preset: stored.preset,
      name: stored.name,
      tagline: stored.tagline,
      title: stored.title,
      website: stored.website,
      colors,
      hasIcon: stored.icon !== '',
      hasLogo: stored.logo !== '',
    };
  }

  async save(session: SessionUser, body: unknown): Promise<BrandView> {
    await this.guard(session);
    const company = await this.company(session.companyId);
    const stored = parse(company.brandJson);
    const input = bag(body);
    if (input.reset === true) {
      stored.preset = 'altamid';
      stored.colors = {};
    } else {
      const preset = String(input.preset || 'custom').toLowerCase();
      stored.preset = PRESETS.has(preset) ? preset : 'custom';
      if (input.name !== undefined) stored.name = optional(input.name, 40);
      if (input.tagline !== undefined) stored.tagline = optional(input.tagline, 40);
      if (input.title !== undefined) stored.title = optional(input.title, 80);
      if (input.website !== undefined) stored.website = websiteOf(input.website);
      if (input.colors && typeof input.colors === 'object') {
        stored.colors = cleanColors(input.colors as Record<string, unknown>);
      }
    }
    await this.prisma.company.update({ where: { id: company.id }, data: { brandJson: JSON.stringify(stored) } });
    return this.view({ ...company, brandJson: JSON.stringify(stored) });
  }

  async saveImage(session: SessionUser, kind: 'icon' | 'logo', body: unknown): Promise<BrandView> {
    await this.guard(session);
    const company = await this.company(session.companyId);
    const stored = parse(company.brandJson);
    const input = bag(body);
    const parsed = decodeImage(String(input.data || ''));
    const dir = join(process.cwd(), 'storage', 'brand', company.id);
    mkdirSync(dir, { recursive: true });
    const filename = kind + '.' + parsed.ext;
    writeFileSync(join(dir, filename), parsed.bytes);
    stored[kind] = filename;
    const json = JSON.stringify(stored);
    await this.prisma.company.update({ where: { id: company.id }, data: { brandJson: json } });
    return this.view({ ...company, brandJson: json });
  }

  async image(companyId: string, kind: 'icon' | 'logo'): Promise<{ type: string; bytes: Buffer } | null> {
    const company = await this.prisma.company.findUnique({ where: { id: companyId } });
    if (!company) return null;
    const stored = parse(company.brandJson);
    const filename = stored[kind];
    if (!filename) return null;
    try {
      const bytes = readFileSync(join(process.cwd(), 'storage', 'brand', company.id, filename));
      const ext = filename.split('.').pop() || 'png';
      const type = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : 'image/png';
      return { type, bytes };
    } catch {
      return null;
    }
  }

  private async guard(session: SessionUser): Promise<void> {
    await this.gates.gate(session, 'settings.brand', 'You do not have access to change branding.');
  }

  private async company(id: string): Promise<Company> {
    const company = await this.prisma.company.findUnique({ where: { id } });
    if (!company) fail(404, 'That company was not found.');
    return company;
  }
}

function parse(raw: string): StoredBrand {
  const empty: StoredBrand = { preset: 'altamid', name: '', tagline: '', title: '', website: '', colors: {}, icon: '', logo: '' };
  if (!raw) return empty;
  try {
    const data = JSON.parse(raw) as Partial<StoredBrand>;
    return {
      preset: PRESETS.has(String(data.preset || '')) ? String(data.preset) : 'altamid',
      name: clip(data.name, 40),
      tagline: clip(data.tagline, 40),
      title: clip(data.title, 80),
      website: clip(data.website, 190),
      colors: cleanColors((data.colors || {}) as Record<string, unknown>),
      icon: clip(data.icon, 40),
      logo: clip(data.logo, 40),
    };
  } catch {
    return empty;
  }
}

function cleanColors(input: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of BRAND_KEYS) {
    const hex = sanitize(String(input[key] || ''));
    if (hex) out[key] = hex;
  }
  return out;
}

function sanitize(value: string): string | null {
  const raw = value.trim();
  if (/^#[0-9a-fA-F]{3}$/.test(raw)) return ('#' + raw[1] + raw[1] + raw[2] + raw[2] + raw[3] + raw[3]).toLowerCase();
  if (/^#[0-9a-fA-F]{6}$/.test(raw)) return raw.toLowerCase();
  return null;
}

function websiteOf(value: unknown): string {
  const site = optional(value, 190);
  if (site && !/^https?:\/\//i.test(site)) fail(422, 'Brand website needs a full URL, starting with https://.');
  return site;
}

function clip(value: unknown, max: number): string {
  return String(value || '').trim().slice(0, max);
}

function decodeImage(data: string): { ext: string; bytes: Buffer } {
  const match = /^data:image\/(png|jpeg|jpg|webp);base64,([a-z0-9+/=\s]+)$/i.exec(data.trim());
  if (!match) fail(422, 'Use a PNG, JPG, or WebP image.');
  const bytes = Buffer.from(match[2].replace(/\s/g, ''), 'base64');
  if (bytes.length < 32 || bytes.length > 1_500_000) fail(422, 'That image must be under 1.5 MB.');
  const kind = match[1].toLowerCase();
  return { ext: kind === 'jpeg' || kind === 'jpg' ? 'jpg' : kind === 'webp' ? 'webp' : 'png', bytes };
}
