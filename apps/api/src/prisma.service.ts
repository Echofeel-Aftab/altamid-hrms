import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { fail } from './http';
import { OUTLET_MODELS, OWNED_BY, PARENTS, SHARED_MODELS, currentScope } from './outlet-context';

const FILTERED = new Set([
  'findUnique', 'findUniqueOrThrow', 'findFirst', 'findFirstOrThrow', 'findMany', 'count', 'aggregate', 'groupBy',
  'update', 'updateMany', 'updateManyAndReturn', 'delete', 'deleteMany', 'upsert',
]);

type Row = Record<string, unknown>;

/** Every query on an outlet table only sees the outlets the signed-in person is working in. */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super();
    const base = this as unknown as Record<string, { findUnique(args: unknown): Promise<{ outletId: string | null } | null> }>;
    const heads = new Map<string, string>();

    const headOutlet = async (companyId: string): Promise<string | null> => {
      if (heads.has(companyId)) return heads.get(companyId) || null;
      const head = await this.outlet.findFirst({ where: { companyId, status: 'active' }, orderBy: { createdAt: 'asc' }, select: { id: true } });
      if (head) heads.set(companyId, head.id);
      return head?.id || null;
    };

    const outletFor = async (model: string, data: Row): Promise<string | null | undefined> => {
      if (data.outletId !== undefined) return data.outletId as string | null;
      for (const [field, parent] of PARENTS) {
        const link = data[parent] as { connect?: { id?: string } } | undefined;
        const id = typeof data[field] === 'string' ? (data[field] as string) : link?.connect?.id;
        if (!id) continue;
        const row = await base[parent].findUnique({ where: { id }, select: { outletId: true } });
        if (row?.outletId) return row.outletId;
      }
      const scope = currentScope();
      if (scope?.current) return scope.current;
      if (SHARED_MODELS.has(model)) return null;
      if (scope) fail(400, 'Choose an outlet at the top of the screen before adding this.');
      const company = data.company as { connect?: { id?: string } } | undefined;
      const companyId = typeof data.companyId === 'string' ? data.companyId : company?.connect?.id;
      return companyId ? headOutlet(companyId) : undefined;
    };

    const stamp = async (model: string, data: unknown): Promise<unknown> => {
      if (!data || typeof data !== 'object') return data;
      const outletId = await outletFor(model, data as Row);
      return outletId === undefined ? data : { ...(data as Row), outletId };
    };

    const filtered = (model: string, where: unknown): unknown => {
      const scope = currentScope();
      if (!scope) return where;
      const allowed: Row[] = [{ outletId: { in: scope.visible } }];
      if (SHARED_MODELS.has(model)) allowed.push({ outletId: null });
      if (scope.self && OWNED_BY[model]) allowed.push({ [OWNED_BY[model]]: scope.self });
      const rule = allowed.length > 1 ? { OR: allowed } : allowed[0];
      const current = (where || {}) as Row;
      const and = current.AND ? (Array.isArray(current.AND) ? current.AND : [current.AND]) : [];
      return { ...current, AND: [...and, rule] };
    };

    const extended = this.$extends({
      query: {
        $allModels: {
          async $allOperations({ model, operation, args, query }) {
            if (!model || !OUTLET_MODELS.has(model)) return query(args);
            const next = { ...(args as Row) };
            if (FILTERED.has(operation)) next.where = filtered(model, next.where);
            if (operation === 'create') next.data = await stamp(model, next.data);
            if (operation === 'upsert') next.create = await stamp(model, next.create);
            if (operation === 'createMany' || operation === 'createManyAndReturn') {
              next.data = Array.isArray(next.data) ? await Promise.all(next.data.map((item) => stamp(model, item))) : await stamp(model, next.data);
            }
            return query(next as typeof args);
          },
        },
      },
    });
    return extended as unknown as PrismaService;
  }

  private keepAlive: ReturnType<typeof setInterval> | null = null;

  async onModuleInit(): Promise<void> {
    await this.$connect();
    // Neon can suspend idle compute; a light ping keeps page loads from waiting on a cold start.
    this.keepAlive = setInterval(() => {
      this.$queryRaw`SELECT 1`.catch(() => undefined);
    }, 4 * 60 * 1000);
    if (typeof this.keepAlive.unref === 'function') this.keepAlive.unref();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.keepAlive) clearInterval(this.keepAlive);
    await this.$disconnect();
  }
}
