import { Injectable } from '@nestjs/common';
import { AccessService } from './access.service';
import { bag, fail, optional } from './http';
import { BlockSetting, BlockSize, HOME_BLOCKS, HOME_ORDER, HomeBlock, HomeColumns, LAYOUT_KINDS, LayoutKind, arrangementOf, blockSettings, columnsOf, defaultSize, sizesOf } from './home-blocks';
import { PrismaService } from './prisma.service';
import { SessionUser } from './session';

const LEGACY_HOME_KEYS = ['punch', 'calendar', 'leave', 'announcements', 'joiners'];
const KIND_LABEL: Record<LayoutKind, string> = { company: 'Everyone', role: 'Role', department: 'Department', person: 'Person' };

interface Layer { kind: LayoutKind; id: string; name: string; settings: Record<string, BlockSetting> }

export interface ResolvedBlock {
  key: string;
  label: string;
  group: string;
  icon: string;
  visible: boolean;
  available: boolean;
  hiddenByMe: boolean;
  /** False for the header search, which is shown or hidden but never moved. */
  board: boolean;
  size: BlockSize;
  sizes: BlockSize[];
}

@Injectable()
export class HomeLayoutService {
  constructor(private readonly prisma: PrismaService, private readonly gates: AccessService) {}

  /** The blocks this sign-in sees on Home, after layouts, Access, and their own choice. */
  async resolve(session: SessionUser): Promise<ResolvedBlock[]> {
    await this.ensure(session.companyId);
    const person = session.employeeId
      ? await this.prisma.employee.findFirst({ where: { id: session.employeeId, companyId: session.companyId }, select: { id: true, departmentId: true } })
      : null;
    const rows = await this.prisma.homeLayout.findMany({ where: { companyId: session.companyId } });
    const find = (kind: string, id: string) => blockSettings(rows.find((row) => row.subjectKind === kind && row.subjectId === id)?.blocksJson || '{}');
    const chain = [
      person ? find('person', person.id) : {},
      person?.departmentId ? find('department', person.departmentId) : {},
      find('role', session.role),
      find('company', ''),
    ];
    const mineRaw = rows.find((row) => row.subjectKind === 'user' && row.subjectId === session.id)?.blocksJson || '{}';
    const mine = blockSettings(mineRaw);
    const arrangement = arrangementOf(mineRaw);
    const allowed = await this.permitted(session, person?.id || '');
    const place = (key: string) => {
      const own = arrangement.order.indexOf(key);
      const base = HOME_ORDER.indexOf(key);
      return own >= 0 ? own : arrangement.order.length + (base >= 0 ? base : HOME_ORDER.length);
    };
    return HOME_BLOCKS.map((block) => {
      const setting = chain.find((layer) => layer[block.key])?.[block.key] || 'on';
      const available = setting === 'on' && allowed(block);
      const hiddenByMe = mine[block.key] === 'off';
      return {
        key: block.key,
        label: block.label,
        group: block.group,
        icon: block.icon,
        available,
        hiddenByMe,
        visible: available && !hiddenByMe,
        board: HOME_ORDER.includes(block.key),
        size: arrangement.size[block.key] || defaultSize(block.key),
        sizes: sizesOf(block.key),
      };
    }).sort((left, right) => place(left.key) - place(right.key));
  }

  /**
   * A person arranges their own Home: the column count, the order of boxes, each box's width, and the blocks they hide.
   * They cannot show a block the company turned off. Sending nothing puts their Home back to the company layout.
   */
  async saveMine(session: SessionUser, body: unknown) {
    const input = bag(body);
    const known = new Set(HOME_BLOCKS.map((block) => block.key));
    const hidden = Array.isArray(input.hidden) ? input.hidden.map(String).filter((key) => known.has(key)) : [];
    if (Array.isArray(input.order) && input.order.length > 100) fail(400, 'That layout has too many boxes.');
    const order = Array.isArray(input.order) ? [...new Set(input.order.map(String))].filter((key) => HOME_ORDER.includes(key)) : [];
    const sizes: Record<string, BlockSize> = {};
    if (input.sizes && typeof input.sizes === 'object' && !Array.isArray(input.sizes)) {
      for (const [key, value] of Object.entries(input.sizes as Record<string, unknown>)) {
        if (!HOME_ORDER.includes(key)) continue;
        if (!(sizesOf(key) as string[]).includes(String(value))) fail(400, 'Choose a width this box supports.');
        if (value !== defaultSize(key)) sizes[key] = value as BlockSize;
      }
    }
    let columns: HomeColumns = 4;
    if (input.columns !== undefined && input.columns !== null && input.columns !== '') {
      const picked = Number(input.columns);
      if (picked !== 1 && picked !== 2 && picked !== 3 && picked !== 4) fail(400, 'Choose 1, 2, 3, or 4 columns.');
      columns = picked as HomeColumns;
    }
    const saved: Record<string, unknown> = {};
    for (const key of hidden) saved[key] = 'off';
    if (order.length) saved._order = order;
    if (Object.keys(sizes).length) saved._size = sizes;
    if (columns !== 4) saved._columns = columns;
    if (!Object.keys(saved).length) {
      await this.prisma.homeLayout.deleteMany({ where: { companyId: session.companyId, subjectKind: 'user', subjectId: session.id } });
    } else {
      const blocksJson = JSON.stringify(saved);
      await this.prisma.homeLayout.upsert({
        where: { companyId_subjectKind_subjectId: { companyId: session.companyId, subjectKind: 'user', subjectId: session.id } },
        create: { companyId: session.companyId, subjectKind: 'user', subjectId: session.id, blocksJson, updatedBy: session.id },
        update: { blocksJson, updatedBy: session.id },
      });
    }
    return this.resolve(session);
  }

  /** The column count this person saved for their Home. 4 is the original board. */
  async columns(session: SessionUser): Promise<HomeColumns> {
    const row = await this.prisma.homeLayout.findFirst({
      where: { companyId: session.companyId, subjectKind: 'user', subjectId: session.id },
      select: { blocksJson: true },
    });
    return columnsOf(row?.blocksJson || '{}');
  }

  async editor(session: SessionUser, kindRaw: string, idRaw: string) {
    await this.gateEditor(session);
    await this.ensure(session.companyId);
    const kind = this.kindOf(kindRaw || 'company');
    const id = kind === 'company' ? '' : optional(idRaw, 40);
    const [ladder, departments, people, rows] = await Promise.all([
      this.gates.ensureLadder(session.companyId),
      this.prisma.department.findMany({ where: { companyId: session.companyId }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
      this.prisma.employee.findMany({
        where: { companyId: session.companyId, status: { in: ['active', 'onboarding'] } },
        orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
        select: { id: true, code: true, firstName: true, lastName: true, departmentId: true, user: { select: { id: true, role: true } } },
        take: 1000,
      }),
      this.prisma.homeLayout.findMany({ where: { companyId: session.companyId, subjectKind: { in: [...LAYOUT_KINDS] } } }),
    ]);
    const roles = ladder.map((role) => ({ id: role.key, name: role.name }));
    const nameOf = (layerKind: string, layerId: string): string => {
      if (layerKind === 'company') return 'Everyone';
      if (layerKind === 'role') return roles.find((role) => role.id === layerId)?.name || layerId;
      if (layerKind === 'department') return departments.find((row) => row.id === layerId)?.name || 'Removed department';
      const person = people.find((row) => row.id === layerId);
      return person ? `${person.firstName} ${person.lastName}`.trim() + ' · ' + person.code : 'Former employee';
    };
    const layerOf = (layerKind: LayoutKind, layerId: string): Layer => ({
      kind: layerKind,
      id: layerId,
      name: nameOf(layerKind, layerId),
      settings: blockSettings(rows.find((row) => row.subjectKind === layerKind && row.subjectId === layerId)?.blocksJson || '{}'),
    });
    let subject = { kind, id, name: nameOf(kind, id) };
    let below: Layer[] = [];
    let allowed: ((block: HomeBlock) => boolean) | null = null;
    if (kind === 'role') {
      if (!roles.some((role) => role.id === id)) fail(400, 'Choose a role from the ladder.');
      below = [layerOf('company', '')];
    } else if (kind === 'department') {
      if (!departments.some((row) => row.id === id)) fail(400, 'Choose a department.');
      below = [layerOf('company', '')];
    } else if (kind === 'person') {
      const person = people.find((row) => row.id === id);
      if (!person) fail(400, 'Choose a person who is active or onboarding.');
      const role = person.user?.role || 'employee';
      below = [
        ...(person.departmentId ? [layerOf('department', person.departmentId)] : []),
        layerOf('role', role),
        layerOf('company', ''),
      ];
      subject = { kind, id, name: nameOf(kind, id) };
      allowed = await this.permitted({ id: person.user?.id || '', companyId: session.companyId, role, name: '', email: '', employeeId: person.id }, person.id);
    }
    const own = kind === 'company' ? layerOf('company', '') : layerOf(kind, id);
    const blocks = HOME_BLOCKS.map((block) => {
      const from = below.find((layer) => layer.settings[block.key]);
      const inherited = from?.settings[block.key] || 'on';
      const effective = own.settings[block.key] || inherited;
      return {
        key: block.key,
        label: block.label,
        hint: block.hint,
        group: block.group,
        icon: block.icon,
        needs: block.needs === 'employee' ? 'A linked person record' : block.needsLabel || '',
        own: own.settings[block.key] || '',
        inherited,
        from: from ? (from.kind === 'company' ? 'Everyone' : 'The ' + from.name + ' ' + KIND_LABEL[from.kind].toLowerCase()) : 'Built-in',
        effective,
        permitted: allowed ? allowed(block) : null,
      };
    });
    const saved = rows
      .map((row) => ({ kind: row.subjectKind as LayoutKind, id: row.subjectId, name: nameOf(row.subjectKind, row.subjectId), changes: Object.keys(blockSettings(row.blocksJson)).length, updatedAt: row.updatedAt.toISOString() }))
      .filter((row) => row.changes > 0)
      .sort((left, right) => LAYOUT_KINDS.indexOf(left.kind) - LAYOUT_KINDS.indexOf(right.kind) || left.name.localeCompare(right.name));
    return {
      subject,
      blocks,
      saved,
      roles,
      departments,
      people: people.map((row) => ({ id: row.id, name: `${row.firstName} ${row.lastName}`.trim(), code: row.code })),
    };
  }

  async save(session: SessionUser, body: unknown) {
    await this.gateEditor(session);
    const input = bag(body);
    const kind = this.kindOf(String(input.kind || ''));
    const id = kind === 'company' ? '' : optional(input.id, 40);
    if (kind !== 'company' && !id) fail(400, 'Choose who this layout is for.');
    if (kind === 'department' && !(await this.prisma.department.findFirst({ where: { id, companyId: session.companyId } }))) fail(400, 'Choose a department.');
    if (kind === 'person' && !(await this.prisma.employee.findFirst({ where: { id, companyId: session.companyId } }))) fail(400, 'Choose a person.');
    if (kind === 'role' && !(await this.gates.ensureLadder(session.companyId)).some((role) => role.key === id)) fail(400, 'Choose a role from the ladder.');
    const raw = input.blocks && typeof input.blocks === 'object' && !Array.isArray(input.blocks) ? input.blocks as Record<string, unknown> : {};
    const settings: Record<string, BlockSetting> = {};
    for (const block of HOME_BLOCKS) {
      const value = raw[block.key];
      if (value === 'on' || value === 'off') settings[block.key] = value;
    }
    await this.write(session, kind, id, settings);
    await this.prisma.auditEvent.create({
      data: { companyId: session.companyId, actorId: session.id, action: 'home.layout', entity: 'home', entityId: kind + ':' + id, detail: Object.keys(settings).length ? Object.entries(settings).map(([key, value]) => key + ' ' + value).join(', ').slice(0, 500) : 'Reset to inherit' },
    });
    return this.editor(session, kind, id);
  }

  private async write(session: SessionUser, kind: string, id: string, settings: Record<string, BlockSetting>) {
    const where = { companyId_subjectKind_subjectId: { companyId: session.companyId, subjectKind: kind, subjectId: id } };
    if (!Object.keys(settings).length && kind !== 'company') {
      await this.prisma.homeLayout.deleteMany({ where: { companyId: session.companyId, subjectKind: kind, subjectId: id } });
      return;
    }
    const blocksJson = JSON.stringify(settings);
    await this.prisma.homeLayout.upsert({ where, create: { companyId: session.companyId, subjectKind: kind, subjectId: id, blocksJson, updatedBy: session.id }, update: { blocksJson, updatedBy: session.id } });
  }

  /** Whether a sign-in may see each block's data at all, from Access and their own record. */
  private async permitted(session: SessionUser, employeeId: string): Promise<(block: HomeBlock) => boolean> {
    const features = [...new Set(HOME_BLOCKS.map((block) => block.needs).filter((need): need is string => !!need && need !== 'employee' && need !== 'team'))];
    const held = new Map<string, boolean>();
    for (const feature of features) held.set(feature, await this.gates.holds(session, feature));
    let leads = false;
    if (employeeId) {
      const [reports, teams] = await Promise.all([
        this.prisma.employee.count({ where: { companyId: session.companyId, managerId: employeeId, status: { in: ['active', 'onboarding'] } } }),
        this.prisma.team.count({ where: { companyId: session.companyId, leadId: employeeId } }),
      ]);
      leads = reports + teams > 0;
    }
    return (block) => {
      if (!block.needs) return true;
      if (block.needs === 'employee') return !!employeeId;
      if (block.needs === 'team') return leads;
      return held.get(block.needs) === true;
    };
  }

  private async gateEditor(session: SessionUser) {
    if (!(await this.gates.holds(session, 'settings')) && !(await this.gates.holds(session, 'library'))) {
      fail(403, 'Only people who manage Settings or the Library can change Home layouts.');
    }
  }

  private kindOf(value: string): LayoutKind {
    if (!(LAYOUT_KINDS as readonly string[]).includes(value)) fail(400, 'Choose everyone, a role, a department, or a person.');
    return value as LayoutKind;
  }

  /** Brings the old one-audience-per-block choice into layouts once, so nothing changes for existing companies. */
  private async ensure(companyId: string) {
    const base = await this.prisma.homeLayout.findUnique({ where: { companyId_subjectKind_subjectId: { companyId, subjectKind: 'company', subjectId: '' } } });
    if (base) return;
    const legacy = await this.prisma.homeWidget.findMany({ where: { companyId, key: { in: LEGACY_HOME_KEYS }, audience: { not: 'all' } } });
    const company: Record<string, BlockSetting> = {};
    const roles: Record<string, Record<string, BlockSetting>> = {};
    for (const row of legacy) {
      company[row.key] = 'off';
      const open = row.audience === 'hr' ? ['owner', 'hr'] : row.audience === 'managers' ? ['owner', 'hr', 'manager'] : [];
      for (const role of open) roles[role] = { ...(roles[role] || {}), [row.key]: 'on' };
    }
    try {
      await this.prisma.homeLayout.create({ data: { companyId, subjectKind: 'company', subjectId: '', blocksJson: JSON.stringify(company) } });
    } catch {
      return;
    }
    for (const [role, settings] of Object.entries(roles)) {
      await this.prisma.homeLayout.upsert({
        where: { companyId_subjectKind_subjectId: { companyId, subjectKind: 'role', subjectId: role } },
        create: { companyId, subjectKind: 'role', subjectId: role, blocksJson: JSON.stringify(settings) },
        update: {},
      });
    }
    if (legacy.length) await this.prisma.homeWidget.updateMany({ where: { companyId, key: { in: LEGACY_HOME_KEYS } }, data: { audience: 'all' } });
  }
}
