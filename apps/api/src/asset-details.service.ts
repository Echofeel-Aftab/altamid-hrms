import { Injectable } from '@nestjs/common';
import { AccessService } from './access.service';
import { DetailField, KIND_DETAILS, detailsFor, visibleDetailFields } from './asset-details';
import { dataKey, maskSecret, openSecret, seal } from './crypto';
import { todayInIndia } from './dates';
import { bag, fail } from './http';
import { PrismaService } from './prisma.service';
import { SessionUser } from './session';

interface StoredDetails {
  fields: Record<string, string>;
  secrets: Record<string, string>;
}

@Injectable()
export class AssetDetailsService {
  private readonly key = dataKey();

  constructor(private readonly prisma: PrismaService, private readonly gates: AccessService) {}

  catalog() {
    return KIND_DETAILS;
  }

  /** Kind-specific details for every asset the person may see. */
  async list(session: SessionUser) {
    const manage = await this.gates.holds(session, 'assets');
    const rows = await this.prisma.asset.findMany({
      where: { companyId: session.companyId, ...(manage ? {} : { employeeId: session.employeeId || 'none' }) },
      select: { id: true, kind: true, detailsJson: true },
      take: 1000,
    });
    const items: Record<string, { fields: Record<string, string>; secrets: Record<string, string>; summary: string }> = {};
    for (const row of rows) items[row.id] = this.present(row.kind, this.parse(row.detailsJson));
    return { catalog: KIND_DETAILS, items };
  }

  async save(session: SessionUser, id: string, body: unknown) {
    await this.gates.gate(session, 'assets', 'You do not have access to company assets.');
    const asset = await this.prisma.asset.findFirst({ where: { id, companyId: session.companyId }, select: { id: true, kind: true, detailsJson: true } });
    if (!asset) fail(404, 'That asset was not found.');
    const input = bag(body);
    const sentFields = record(input.fields);
    const sentSecrets = record(input.secrets);
    const current = this.parse(asset.detailsJson);
    const kind = detailsFor(asset.kind);
    const fields: Record<string, string> = {};
    for (const field of kind.fields) {
      if (field.kind === 'secret') continue;
      fields[field.key] = this.clean(field, sentFields[field.key] ?? current.fields[field.key] ?? '');
    }
    const shown = new Set(visibleDetailFields(asset.kind, fields).map((field) => field.key));
    for (const key of Object.keys(fields)) if (!shown.has(key) || !fields[key]) delete fields[key];
    const secrets: Record<string, string> = {};
    for (const field of kind.fields) {
      if (field.kind !== 'secret' || !shown.has(field.key)) continue;
      const sent = String(sentSecrets[field.key] ?? '').trim();
      if (sent.length > 500) fail(400, `${field.label} is too long. Paste only the key.`);
      if (input.clear === field.key) continue;
      if (sent) secrets[field.key] = seal(sent, this.key);
      else if (current.secrets[field.key]) secrets[field.key] = current.secrets[field.key];
    }
    const next: StoredDetails = { fields, secrets };
    const changed = kind.fields
      .filter((field) => (field.kind === 'secret' ? (secrets[field.key] || '') !== (current.secrets[field.key] || '') : (fields[field.key] || '') !== (current.fields[field.key] || '')))
      .map((field) => field.label);
    if (changed.length) {
      await this.prisma.asset.update({ where: { id }, data: { detailsJson: JSON.stringify(next) } });
      await this.prisma.assetEvent.create({ data: { companyId: session.companyId, assetId: id, kind: 'updated', day: todayInIndia(), detail: ('Details changed: ' + changed.join(', ')).slice(0, 300), actorName: session.name } });
    }
    return this.present(asset.kind, next);
  }

  async reveal(session: SessionUser, id: string, field: string) {
    const asset = await this.prisma.asset.findFirst({ where: { id, companyId: session.companyId }, select: { id: true, tag: true, kind: true, employeeId: true, detailsJson: true } });
    if (!asset) fail(404, 'That asset was not found.');
    const manage = await this.gates.holds(session, 'assets');
    if (!manage && (!session.employeeId || asset.employeeId !== session.employeeId)) fail(403, 'Only asset managers and the person holding it can see this key.');
    const definition = detailsFor(asset.kind).fields.find((item) => item.key === field && item.kind === 'secret');
    if (!definition) fail(404, 'That field has nothing to reveal.');
    const sealed = this.parse(asset.detailsJson).secrets[field];
    if (!sealed) fail(404, `No ${definition.label.toLowerCase()} is saved.`);
    const value = openSecret(sealed, this.key);
    if (!value) fail(500, 'The saved key could not be read on this server. Enter it again and save.');
    await this.prisma.auditEvent.create({ data: { companyId: session.companyId, actorId: session.id, action: 'asset.secret.reveal', entity: 'asset', entityId: id, detail: `${asset.tag} ${definition.label}` } });
    return { value };
  }

  private clean(field: DetailField, raw: unknown): string {
    let value = String(raw ?? '').trim();
    if (!value) return '';
    if (field.upper) value = value.toUpperCase();
    if (value.length > (field.max || 120)) fail(400, `${field.label} can be at most ${field.max || 120} characters.`);
    if (field.kind === 'select' && !field.options?.some((option) => option.value === value)) fail(400, `Choose a ${field.label.toLowerCase()} from the list.`);
    if (field.kind === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail(400, `${field.label} must be a date.`);
    if (field.kind === 'number') {
      const number = Number(value.replace(/,/g, ''));
      if (!Number.isFinite(number) || number < (field.min ?? 0) || number > (field.maxValue ?? 1e9)) fail(400, `${field.label} must be a number from ${field.min ?? 0} to ${(field.maxValue ?? 1e9).toLocaleString('en-IN')}.`);
      value = String(number);
    }
    if (field.pattern && !new RegExp(field.pattern).test(value)) fail(400, field.patternMessage || `${field.label} is not in the expected format.`);
    return value;
  }

  private present(kind: string, stored: StoredDetails) {
    const secrets: Record<string, string> = {};
    for (const [name, sealed] of Object.entries(stored.secrets)) secrets[name] = maskSecret(openSecret(sealed, this.key)) || 'Saved';
    return { fields: stored.fields, secrets, summary: this.summary(kind, stored.fields) };
  }

  private summary(kind: string, fields: Record<string, string>): string {
    const pick = (...keys: string[]) => keys.map((key) => fields[key]).filter(Boolean);
    const named = (key: string, otherKey: string) => (fields[key] === 'Other' ? fields[otherKey] : fields[key]);
    if (kind === 'licence') {
      const parts = [named('product', 'productOther'), fields.seats ? `${fields.seats} seat${fields.seats === '1' ? '' : 's'}` : '', fields.renewsOn ? 'renews ' + fields.renewsOn : ''];
      return parts.filter(Boolean).join(' · ');
    }
    if (kind === 'laptop' || kind === 'desktop') return [named('cpu', 'cpuOther'), ...pick('ram', 'disk', 'os')].filter(Boolean).join(' · ');
    if (kind === 'phone') return pick('os', 'storage', 'number').join(' · ');
    if (kind === 'sim' || kind === 'dongle') return [named('operator', 'operatorOther'), ...pick('number', 'plan')].filter(Boolean).join(' · ');
    if (kind === 'vehicle') return pick('registration', 'fuel', 'insuranceUntil').map((value, index) => (index === 2 ? 'insured to ' + value : value)).join(' · ');
    const first = detailsFor(kind).fields.filter((field) => field.kind !== 'secret').slice(0, 3).map((field) => fields[field.key]).filter(Boolean);
    return first.join(' · ');
  }

  private parse(json: string): StoredDetails {
    try {
      const value = JSON.parse(json || '{}');
      return { fields: strings(value?.fields), secrets: strings(value?.secrets) };
    } catch {
      return { fields: {}, secrets: {} };
    }
  }
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function strings(value: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, item] of Object.entries(record(value))) if (typeof item === 'string' && /^[a-zA-Z][a-zA-Z0-9]{0,30}$/.test(name)) out[name] = item;
  return out;
}
