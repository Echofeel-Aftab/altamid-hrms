import { BrandService } from './brand.service';
import type { LetterLook } from './letter-pdf';
import { PrismaService } from './prisma.service';

export async function letterLook(prisma: PrismaService, brand: BrandService, companyId: string): Promise<LetterLook> {
  const company = await prisma.company.findUnique({ where: { id: companyId } });
  const view = company ? brand.view(company) : null;
  const logo = await brand.image(companyId, 'logo').catch(() => null);
  return {
    company: view?.name || company?.name || 'Company',
    legalName: company?.legalName || '',
    address: [company?.city, company?.state].filter(Boolean).join(', '),
    primary: view?.colors?.['primary'] || '#103860',
    accent: view?.colors?.['accent'] || '#e8c85c',
    logo: logo && (logo.type === 'image/png' || logo.type === 'image/jpeg') ? logo.bytes : null,
  };
}

export function longDate(day: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return day;
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}
