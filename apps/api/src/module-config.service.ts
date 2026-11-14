import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/** Small per-company settings for one module, kept apart from the main settings so each module owns its own shape. */
@Injectable()
export class ModuleConfigService {
  constructor(private readonly prisma: PrismaService) {}

  async read<T extends object>(companyId: string, key: string, fallback: T): Promise<T> {
    const row = await this.prisma.moduleConfig.findUnique({ where: { companyId_key: { companyId, key } } });
    if (!row) return fallback;
    try {
      const parsed = JSON.parse(row.json) as Partial<T>;
      return parsed && typeof parsed === 'object' ? { ...fallback, ...parsed } : fallback;
    } catch {
      return fallback;
    }
  }

  async write<T extends object>(companyId: string, key: string, value: T): Promise<T> {
    const json = JSON.stringify(value);
    await this.prisma.moduleConfig.upsert({
      where: { companyId_key: { companyId, key } },
      create: { companyId, key, json },
      update: { json },
    });
    return value;
  }
}
