import { createHash, randomBytes } from 'crypto';
import { Injectable } from '@nestjs/common';
import { compare, hash } from 'bcryptjs';
import { sign, verify } from 'jsonwebtoken';
import { loadSecret } from './crypto';
import { fail, passwordOf } from './http';
import { setScope } from './outlet-context';
import { OutletService } from './outlet.service';
import { PrismaService } from './prisma.service';
import { SessionUser } from './session';
import { SettingsService } from './settings.service';
import { TtlCache } from './ttl-cache';

const WINDOW = new Map<string, number[]>();

@Injectable()
export class AuthService {
  private readonly secret = loadSecret('jwt.key');
  private dummy = '';
  private readonly userCache = new TtlCache<{
    id: string; companyId: string; email: string; name: string; role: string; active: boolean; master: boolean;
    employeeId: string | null; passwordHash: string; failedCount: number; lockedUntil: Date | null;
  }>(20_000);

  constructor(private readonly prisma: PrismaService, private readonly settings: SettingsService, private readonly outlets: OutletService) {}

  hashPassword(password: string): Promise<string> {
    return hash(password, 12);
  }

  pace(key: string, limit: number, windowMs: number): void {
    const now = Date.now();
    const hits = (WINDOW.get(key) || []).filter((at) => now - at < windowMs);
    if (hits.length >= limit) fail(429, 'Too many attempts. Wait a few minutes and try again.');
    hits.push(now);
    WINDOW.set(key, hits);
  }

  sign(user: { id: string }): string {
    return sign({ sub: user.id }, this.secret, { expiresIn: '12h', issuer: 'altamid-hrms', algorithm: 'HS256' });
  }

  async sessionFromHeader(header?: string, outletHeader = ''): Promise<SessionUser> {
    const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!token) fail(401, 'Sign in to continue.');
    let userId = '';
    try {
      const payload = verify(token, this.secret, { issuer: 'altamid-hrms', algorithms: ['HS256'] }) as { sub?: string };
      userId = payload.sub || '';
    } catch {
      fail(401, 'Sign in to continue.');
    }
    let user = this.userCache.get(userId);
    if (!user) {
      const row = await this.prisma.user.findUnique({ where: { id: userId } });
      if (!row) fail(401, 'Sign in to continue.');
      user = row;
      this.userCache.set(userId, row);
    }
    if (!user.active) fail(401, 'Sign in to continue.');
    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) fail(401, 'This sign-in is paused. Try again in a few minutes.');
    const access = await this.outlets.access(user as Parameters<OutletService['access']>[0], String(outletHeader || '').trim().slice(0, 40));
    setScope(access.scope);
    return { ...this.toSession(user), role: access.role, outletId: access.scope.current, outletIds: access.outletIds, master: access.master, outletCountry: access.country };
  }

  async login(email: string, password: string, ip: string): Promise<{ token: string; role: string; name: string }> {
    this.pace('login:' + ip, 10, 15 * 60 * 1000);
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (user?.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      fail(401, 'This sign-in is paused. Try again in a few minutes.');
    }
    const matches = await compare(password, user?.passwordHash || (await this.filler()));
    if (!user || !user.active || !matches) {
      if (user?.active) await this.miss(user.id, user.companyId, user.failedCount);
      fail(401, 'That email or password does not match.');
    }
    await this.prisma.user.update({ where: { id: user.id }, data: { failedCount: 0, lockedUntil: null } });
    this.userCache.set(user.id, { ...user, failedCount: 0, lockedUntil: null });
    await this.prisma.auditEvent.create({
      data: { companyId: user.companyId, actorId: user.id, action: 'login.ok', entity: 'user', entityId: user.id },
    });
    const session = this.toSession(user);
    return { token: this.sign(session), role: session.role, name: session.name };
  }

  async changePassword(session: SessionUser, current: string, next: string): Promise<{ message: string }> {
    const user = await this.prisma.user.findUnique({ where: { id: session.id } });
    if (!user || !(await compare(current, user.passwordHash))) fail(400, 'The current password does not match.');
    const nextPassword = passwordOf(next);
    if (await compare(nextPassword, user.passwordHash)) fail(400, 'Choose a password that is different from the current one.');
    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await this.hashPassword(nextPassword), failedCount: 0, lockedUntil: null },
    });
    this.userCache.delete(user.id);
    await this.prisma.auditEvent.create({
      data: { companyId: user.companyId, actorId: user.id, action: 'password.change', entity: 'user', entityId: user.id },
    });
    return { message: 'Password updated.' };
  }

  /** Always answers the same way, so the form never reveals which emails have a sign-in. */
  async forgot(email: string, ip: string): Promise<{ message: string }> {
    this.pace('forgot:' + ip, 5, 15 * 60 * 1000);
    this.pace('forgot:' + email, 3, 60 * 60 * 1000);
    const message = 'If that email has a sign-in, a link to set a new password is on its way. It works for 30 minutes. If nothing arrives, ask HR to set a new password for you.';
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || !user.active) return { message };
    const token = randomBytes(32).toString('base64url');
    await this.prisma.passwordReset.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: new Date() } });
    await this.prisma.passwordReset.create({ data: { userId: user.id, tokenHash: this.digest(token), expiresAt: new Date(Date.now() + 30 * 60 * 1000) } });
    const origin = (process.env.WEB_ORIGIN || 'http://localhost:4400').replace(/\/$/, '');
    const sent = await this.settings.sendSystemMail(
      user.companyId,
      user.email,
      'Set a new password',
      [`Hello ${user.name.split(' ')[0] || 'there'},`, 'Someone asked to set a new password for your HRMS sign-in. If it was you, use the button below within 30 minutes. If it was not you, you can ignore this email and your password stays the same.'],
      { label: 'Set a new password', url: `${origin}/reset?token=${token}` },
    ).catch(() => ({ emailed: false, note: 'failed' }));
    await this.prisma.auditEvent.create({
      data: { companyId: user.companyId, actorId: user.id, action: 'password.reset.request', entity: 'user', entityId: user.id, detail: sent.emailed ? 'emailed' : 'not emailed' },
    });
    return { message };
  }

  async reset(token: string, password: string, ip: string): Promise<{ message: string }> {
    this.pace('reset:' + ip, 10, 15 * 60 * 1000);
    const cleaned = String(token || '').trim();
    if (!/^[A-Za-z0-9_-]{40,60}$/.test(cleaned)) fail(400, 'That link is not valid. Ask for a new one.');
    const row = await this.prisma.passwordReset.findUnique({ where: { tokenHash: this.digest(cleaned) } });
    if (!row || row.usedAt || row.expiresAt.getTime() < Date.now()) fail(400, 'That link has expired or was already used. Ask for a new one.');
    const user = await this.prisma.user.findUnique({ where: { id: row.userId } });
    if (!user || !user.active) fail(400, 'That link has expired or was already used. Ask for a new one.');
    const next = passwordOf(password);
    await this.prisma.user.update({ where: { id: user.id }, data: { passwordHash: await this.hashPassword(next), failedCount: 0, lockedUntil: null } });
    this.userCache.delete(user.id);
    await this.prisma.passwordReset.update({ where: { id: row.id }, data: { usedAt: new Date() } });
    await this.prisma.auditEvent.create({ data: { companyId: user.companyId, actorId: user.id, action: 'password.reset', entity: 'user', entityId: user.id } });
    return { message: 'Your password is set. Sign in with it now.' };
  }

  private digest(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private async miss(userId: string, companyId: string, failedCount: number): Promise<void> {
    const count = failedCount + 1;
    const lockedUntil = count >= 5 ? new Date(Date.now() + 15 * 60 * 1000) : null;
    await this.prisma.user.update({ where: { id: userId }, data: { failedCount: lockedUntil ? 0 : count, lockedUntil } });
    this.userCache.delete(userId);
    await this.prisma.auditEvent.create({
      data: { companyId, actorId: userId, action: lockedUntil ? 'login.locked' : 'login.fail', entity: 'user', entityId: userId, detail: String(count) },
    });
  }

  private async filler(): Promise<string> {
    if (!this.dummy) this.dummy = await hash('not-a-real-password', 12);
    return this.dummy;
  }

  private toSession(user: { id: string; companyId: string; role: string; name: string; email: string; employeeId: string | null }): SessionUser {
    return {
      id: user.id,
      companyId: user.companyId,
      role: user.role,
      name: user.name,
      email: user.email,
      employeeId: user.employeeId,
    };
  }
}
