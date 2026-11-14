import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AccessService } from './access.service';
import { todayInIndia } from './dates';
import { bag, fail, optional, optionalDay, text } from './http';
import { PrismaService } from './prisma.service';
import { SessionUser } from './session';

export const ASSET_KINDS = [
  { key: 'laptop', label: 'Laptop', icon: 'bi-laptop', group: 'Computers' },
  { key: 'desktop', label: 'Desktop', icon: 'bi-pc-display', group: 'Computers' },
  { key: 'monitor', label: 'Monitor', icon: 'bi-display', group: 'Computers' },
  { key: 'tablet', label: 'Tablet', icon: 'bi-tablet', group: 'Computers' },
  { key: 'peripheral', label: 'Keyboard and mouse', icon: 'bi-keyboard', group: 'Accessories' },
  { key: 'headset', label: 'Headset', icon: 'bi-headset', group: 'Accessories' },
  { key: 'dock', label: 'Docking station or charger', icon: 'bi-usb-symbol', group: 'Accessories' },
  { key: 'storage', label: 'External drive', icon: 'bi-device-hdd', group: 'Accessories' },
  { key: 'printer', label: 'Printer or scanner', icon: 'bi-printer', group: 'Accessories' },
  { key: 'phone', label: 'Mobile phone', icon: 'bi-phone', group: 'Phones and network' },
  { key: 'sim', label: 'SIM card', icon: 'bi-sim', group: 'Phones and network' },
  { key: 'dongle', label: 'Data card or hotspot', icon: 'bi-router', group: 'Phones and network' },
  { key: 'card', label: 'ID card', icon: 'bi-person-badge', group: 'Access' },
  { key: 'access', label: 'Access card', icon: 'bi-credit-card-2-front', group: 'Access' },
  { key: 'keys', label: 'Keys', icon: 'bi-key', group: 'Access' },
  { key: 'vehicle', label: 'Vehicle', icon: 'bi-car-front', group: 'Travel' },
  { key: 'fuel', label: 'Fuel or travel card', icon: 'bi-fuel-pump', group: 'Travel' },
  { key: 'furniture', label: 'Furniture', icon: 'bi-lamp', group: 'Workplace' },
  { key: 'tools', label: 'Tools and equipment', icon: 'bi-tools', group: 'Workplace' },
  { key: 'uniform', label: 'Uniform or safety gear', icon: 'bi-cone-striped', group: 'Workplace' },
  { key: 'licence', label: 'Software licence', icon: 'bi-key-fill', group: 'Software' },
  { key: 'other', label: 'Other', icon: 'bi-box-seam', group: 'Other' },
] as const;
const CONDITIONS = ['new', 'good', 'fair', 'damaged'];
const STATUSES = ['stock', 'repair', 'retired', 'lost'];

type AssetRow = Prisma.AssetGetPayload<{ include: { employee: true } }>;

@Injectable()
export class AssetService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gates: AccessService,
  ) {}

  async list(session: SessionUser) {
    const manage = await this.gates.holds(session, 'assets');
    const [rows, locations] = await Promise.all([
      this.prisma.asset.findMany({
        where: { companyId: session.companyId, ...(manage ? {} : { employeeId: session.employeeId || 'none' }) },
        include: { employee: true },
        orderBy: { tag: 'asc' },
        take: 1000,
      }),
      this.prisma.location.findMany({ where: { companyId: session.companyId }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    ]);
    const places = new Map(locations.map((row) => [row.id, row.name]));
    const items = rows.map((row) => this.view(row, places, manage));
    const today = todayInIndia();
    const soon = this.addDays(today, 30);
    return {
      manage,
      kinds: ASSET_KINDS,
      locations,
      stats: manage ? {
        total: rows.length,
        issued: rows.filter((row) => row.employeeId).length,
        stock: rows.filter((row) => !row.employeeId && row.status === 'stock').length,
        repair: rows.filter((row) => row.status === 'repair').length,
        value: this.rupees(rows.filter((row) => row.status !== 'retired' && row.status !== 'lost').reduce((sum, row) => sum + row.costPaise, 0)),
        warranty: rows.filter((row) => row.warrantyUntil && row.warrantyUntil >= today && row.warrantyUntil <= soon && row.status !== 'retired').length,
      } : null,
      items,
    };
  }

  async create(session: SessionUser, body: unknown) {
    await this.manage(session);
    const data = this.read(bag(body), true);
    await this.assertSerial(session.companyId, String(data.serialNo || ''));
    await this.assertLocation(session.companyId, String(data.locationId || ''));
    try {
      const row = await this.prisma.asset.create({ data: { companyId: session.companyId, ...data } as Prisma.AssetUncheckedCreateInput, include: { employee: true } });
      await this.event(session, row.id, 'added', String(data.purchasedOn || todayInIndia()), 'Added to stock');
      return { id: row.id };
    } catch (error) {
      this.duplicate(error);
    }
  }

  async update(session: SessionUser, id: string, body: unknown) {
    await this.manage(session);
    const current = await this.owned(session.companyId, id);
    const data = this.read(bag(body), false);
    if (data.serialNo !== undefined && data.serialNo !== current.serialNo) await this.assertSerial(session.companyId, String(data.serialNo), id);
    if (data.locationId) await this.assertLocation(session.companyId, String(data.locationId));
    try {
      await this.prisma.asset.update({ where: { id }, data: data as Prisma.AssetUncheckedUpdateInput });
    } catch (error) {
      this.duplicate(error);
    }
    const changed = Object.keys(data).filter((key) => (data as Record<string, unknown>)[key] !== (current as Record<string, unknown>)[key]);
    if (changed.length) await this.event(session, id, 'updated', todayInIndia(), 'Details changed: ' + changed.map((key) => FIELD_LABELS[key] || key).join(', '));
    return { ok: true };
  }

  async assign(session: SessionUser, id: string, body: unknown) {
    await this.manage(session);
    const asset = await this.owned(session.companyId, id);
    if (asset.employeeId) fail(400, 'Take this asset back before you issue it again.');
    if (asset.status !== 'stock') fail(400, `This asset is ${STATUS_LABEL[asset.status] || asset.status}. Put it back in stock before you issue it.`);
    const input = bag(body);
    const code = text(input.code, 'Employee code', 20).toUpperCase();
    const person = await this.prisma.employee.findFirst({ where: { companyId: session.companyId, code: { equals: code, mode: 'insensitive' } } });
    if (!person || person.status === 'exited') fail(404, 'No current employee has that code.');
    const day = optionalDay(input.day) || todayInIndia();
    const condition = input.condition ? this.choice(input.condition, CONDITIONS, 'Condition') : asset.condition;
    const note = optional(input.note, 200);
    await this.prisma.asset.update({ where: { id }, data: { employeeId: person.id, issuedOn: day, returnedOn: '', condition } });
    await this.event(session, id, 'issued', day, `Issued to ${person.firstName} ${person.lastName} (${person.code}) · ${condition}${note ? ' · ' + note : ''}`);
    return { ok: true };
  }

  async giveBack(session: SessionUser, id: string, body: unknown) {
    await this.manage(session);
    const asset = await this.owned(session.companyId, id);
    if (!asset.employeeId || !asset.employee) fail(400, 'This asset is already in stock.');
    const input = bag(body);
    const day = optionalDay(input.day) || todayInIndia();
    if (asset.issuedOn && day < asset.issuedOn) fail(400, 'The return date cannot be before it was issued.');
    const condition = input.condition ? this.choice(input.condition, CONDITIONS, 'Condition') : asset.condition;
    const note = optional(input.note, 200);
    const status = condition === 'damaged' ? 'repair' : 'stock';
    await this.prisma.asset.update({ where: { id }, data: { employeeId: null, returnedOn: day, condition, status } });
    const who = `${asset.employee.firstName} ${asset.employee.lastName}`.trim();
    await this.event(session, id, 'returned', day, `Returned by ${who} · ${condition}${status === 'repair' ? ' · sent for repair' : ''}${note ? ' · ' + note : ''}`);
    return { ok: true };
  }

  async setStatus(session: SessionUser, id: string, body: unknown) {
    await this.manage(session);
    const asset = await this.owned(session.companyId, id);
    const input = bag(body);
    const status = this.choice(input.status, STATUSES, 'Status');
    const note = optional(input.note, 200);
    if (asset.employeeId && status !== 'lost') fail(400, 'Take the asset back first. Only "lost" can be marked while it is issued.');
    if (status === asset.status && !asset.employeeId) fail(400, 'It already has that status.');
    const data: Prisma.AssetUncheckedUpdateInput = { status };
    let detail = 'Marked ' + STATUS_LABEL[status];
    if (asset.employeeId && asset.employee) {
      data.employeeId = null;
      data.returnedOn = todayInIndia();
      detail += ` while with ${asset.employee.firstName} ${asset.employee.lastName}`.trimEnd();
    }
    if (status === 'stock' && asset.condition === 'damaged') data.condition = 'good';
    await this.prisma.asset.update({ where: { id }, data });
    await this.event(session, id, status, todayInIndia(), detail + (note ? ' · ' + note : ''));
    return { ok: true };
  }

  async remove(session: SessionUser, id: string) {
    await this.manage(session);
    const asset = await this.owned(session.companyId, id);
    if (asset.employeeId) fail(400, 'Take the asset back before you remove it.');
    const history = await this.prisma.assetEvent.count({ where: { assetId: id, kind: 'issued' } });
    if (history) fail(400, 'This asset has been issued before, so it stays on record. Mark it retired instead.');
    await this.prisma.asset.delete({ where: { id } });
    return { ok: true };
  }

  async history(session: SessionUser, id: string) {
    const manage = await this.gates.holds(session, 'assets');
    const asset = await this.owned(session.companyId, id);
    if (!manage && asset.employeeId !== session.employeeId) fail(403, 'You can see only assets issued to you.');
    const rows = await this.prisma.assetEvent.findMany({ where: { assetId: id }, orderBy: { createdAt: 'desc' }, take: 100 });
    return rows.map((row) => ({ id: row.id, kind: row.kind, day: row.day, detail: row.detail, by: row.actorName }));
  }

  private view(row: AssetRow, places: Map<string, string>, manage: boolean) {
    const kind = ASSET_KINDS.find((item) => item.key === row.kind);
    const status = row.employeeId ? 'issued' : row.status;
    return {
      id: row.id,
      name: row.name,
      tag: row.tag,
      kind: row.kind,
      kindLabel: kind?.label || 'Other',
      icon: kind?.icon || 'bi-box-seam',
      brand: row.brand,
      model: row.model,
      serialNo: row.serialNo,
      specs: row.specs,
      condition: row.condition,
      status,
      statusLabel: STATUS_LABEL[status] || status,
      issuedOn: row.employeeId ? row.issuedOn : '',
      returnedOn: row.returnedOn,
      holder: row.employee ? `${row.employee.firstName} ${row.employee.lastName}`.trim() : '',
      code: row.employee?.code || '',
      inStock: !row.employee,
      locationId: row.locationId,
      location: places.get(row.locationId) || '',
      purchasedOn: row.purchasedOn,
      warrantyUntil: row.warrantyUntil,
      warrantyState: this.warrantyState(row.warrantyUntil),
      cost: manage && row.costPaise ? this.rupees(row.costPaise) : '',
      costRupees: manage && row.costPaise ? (row.costPaise / 100).toFixed(2) : '',
      vendor: manage ? row.vendor : '',
      invoiceNo: manage ? row.invoiceNo : '',
      note: row.note,
    };
  }

  private read(input: Record<string, unknown>, creating: boolean) {
    const data: Record<string, string | number> = {};
    const take = (key: string, read: (value: unknown) => string | number) => {
      if (creating || input[key] !== undefined) data[key] = read(input[key]);
    };
    take('name', (value) => text(value, 'Asset name', 80));
    take('tag', (value) => text(value, 'Asset tag', 40).toUpperCase());
    take('kind', (value) => {
      const key = String(value || 'other');
      if (!ASSET_KINDS.some((item) => item.key === key)) fail(400, 'Choose a kind from the list.');
      return key;
    });
    take('brand', (value) => optional(value, 60));
    take('model', (value) => optional(value, 80));
    take('serialNo', (value) => optional(value, 80).toUpperCase());
    take('specs', (value) => optional(value, 240));
    take('condition', (value) => this.choice(value || 'good', CONDITIONS, 'Condition'));
    take('purchasedOn', optionalDay);
    take('warrantyUntil', optionalDay);
    take('costPaise', (value) => this.paiseOf(value));
    take('vendor', (value) => optional(value, 80));
    take('invoiceNo', (value) => optional(value, 60));
    take('locationId', (value) => optional(value, 40));
    take('note', (value) => optional(value, 400));
    if (data.purchasedOn && data.warrantyUntil && String(data.warrantyUntil) < String(data.purchasedOn)) fail(400, 'Warranty cannot end before the purchase date.');
    if (data.purchasedOn && String(data.purchasedOn) > todayInIndia()) fail(400, 'The purchase date cannot be in the future.');
    return data;
  }

  private paiseOf(value: unknown): number {
    const raw = String(value ?? '').trim().replace(/[,₹\s]/g, '');
    if (!raw) return 0;
    if (!/^\d+(\.\d{1,2})?$/.test(raw)) fail(400, 'Enter the cost in rupees, with at most two decimal places.');
    const paise = Math.round(Number(raw) * 100);
    if (paise > 1_000_000_000_00) fail(400, 'That cost is too large.');
    return paise;
  }

  private rupees(paise: number): string {
    const whole = Math.floor(paise / 100).toLocaleString('en-IN');
    const fraction = paise % 100;
    return '₹' + whole + (fraction ? '.' + String(fraction).padStart(2, '0') : '');
  }

  private warrantyState(until: string): string {
    if (!until) return '';
    const today = todayInIndia();
    if (until < today) return 'expired';
    return until <= this.addDays(today, 30) ? 'soon' : 'valid';
  }

  private addDays(day: string, days: number): string {
    const date = new Date(day + 'T00:00:00Z');
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  }

  private choice(value: unknown, allowed: string[], label: string): string {
    const cleaned = String(value ?? '').trim();
    if (!allowed.includes(cleaned)) fail(400, `${label} is not one of the choices.`);
    return cleaned;
  }

  private async assertSerial(companyId: string, serialNo: string, selfId = '') {
    if (!serialNo) return;
    const clash = await this.prisma.asset.findFirst({ where: { companyId, serialNo, id: { not: selfId || undefined } }, select: { tag: true } });
    if (clash) fail(409, `That serial number is already on asset ${clash.tag}.`);
  }

  private async assertLocation(companyId: string, locationId: string) {
    if (locationId && !(await this.prisma.location.findFirst({ where: { id: locationId, companyId } }))) fail(400, 'Choose a location from this company.');
  }

  private duplicate(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') fail(409, 'That asset tag is already used.');
    throw error;
  }

  private async owned(companyId: string, id: string): Promise<AssetRow> {
    const row = await this.prisma.asset.findFirst({ where: { id, companyId }, include: { employee: true } });
    if (!row) fail(404, 'That asset was not found.');
    return row;
  }

  private async manage(session: SessionUser) {
    await this.gates.gate(session, 'assets', 'You do not have access to company assets.');
  }

  private async event(session: SessionUser, assetId: string, kind: string, day: string, detail: string) {
    await this.prisma.assetEvent.create({ data: { companyId: session.companyId, assetId, kind, day, detail: detail.slice(0, 300), actorName: session.name } });
  }
}

const STATUS_LABEL: Record<string, string> = { stock: 'In stock', issued: 'Issued', repair: 'In repair', retired: 'Retired', lost: 'Lost' };
const FIELD_LABELS: Record<string, string> = {
  name: 'name', tag: 'tag', kind: 'kind', brand: 'brand', model: 'model', serialNo: 'serial number', specs: 'specs', condition: 'condition',
  purchasedOn: 'purchase date', warrantyUntil: 'warranty', costPaise: 'cost', vendor: 'vendor', invoiceNo: 'invoice', locationId: 'location', note: 'note',
};
