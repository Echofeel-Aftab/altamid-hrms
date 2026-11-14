import { PrismaService } from './prisma.service';

/**
 * Marks a person as exited and turns off their sign-in. Owners are never closed automatically,
 * so a company can never lose its last owner through an automatic exit.
 */
export async function closeEmployment(
  prisma: PrismaService,
  companyId: string,
  employeeId: string,
  lastDay: string,
  actorId: string,
): Promise<{ closed: boolean; reason: string }> {
  const person = await prisma.employee.findFirst({ where: { id: employeeId, companyId }, include: { user: true } });
  if (!person) return { closed: false, reason: 'That person was not found.' };
  if (person.status === 'exited') return { closed: false, reason: 'Already exited.' };
  if (person.user?.role === 'owner') return { closed: false, reason: 'Owners are closed by hand in People.' };
  await prisma.employee.update({ where: { id: employeeId }, data: { status: 'exited', dateOfExit: lastDay } });
  if (person.user?.active) await prisma.user.update({ where: { id: person.user.id }, data: { active: false } });
  await prisma.auditEvent.create({
    data: { companyId, actorId, action: 'employee.exit', entity: 'employee', entityId: employeeId, detail: 'Last day ' + lastDay },
  });
  return { closed: true, reason: '' };
}
