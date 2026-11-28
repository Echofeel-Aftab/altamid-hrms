import { createHash, randomBytes } from 'crypto';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { compare, hash } from 'bcryptjs';
import { sign, verify } from 'jsonwebtoken';
import { dataKey, loadSecret, openSecret, seal } from './crypto';
import { bag, fail, passwordOf } from './http';
import { setScope } from './outlet-context';
import { OutletService } from './outlet.service';
import { PrismaService } from './prisma.service';
import { SessionUser } from './session';
import { SettingsService } from './settings.service';
import { base32Decode, generateTotpSecret, otpauthUri, randomBackupCodes, verifyTotp } from './totp';
import { TtlCache } from './ttl-cache';

const WINDOW = new Map<string, number[]>();
const IDLE = '2h';
const MFA_TICKET = '5m';
const PENDING = new Map<string, { secret: Buffer; at: number }>();

type UserRow = {
  id: string; companyId: string; email: string; name: string; role: string; active: boolean; master: boolean;
  employeeId: string | null; passwordHash: string; failedCount: number; lockedUntil: Date | null;
  totpEnabled?: boolean; totpSecretEnc?: string; totpBackupJson?: string; sessionHash?: string;
  otpHash?: string; otpExpiresAt?: Date | null; otpChannel?: string; otpAttempts?: number;
};

@Injectable()
export class AuthService implements OnModuleInit {
  private readonly log = new Logger('Auth');
  private readonly secret = loadSecret('jwt.key');
  private readonly key = dataKey();
  private dummy = '';
  private readonly userCache = new TtlCache<UserRow>(20_000);

  constructor(private readonly prisma: PrismaService, private readonly settings: SettingsService, private readonly outlets: OutletService) {}

  onModuleInit(): void {
    // Fire-and-forget so Nest can listen before Neon is warm.
    void this.ensureColumns().catch((error: unknown) => this.log.warn(`Auth columns: ${error instanceof Error ? error.message : error}`));
  }

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

  sign(user: { id: string }, sid?: string): string {
    const sessionId = sid || randomBytes(16).toString('base64url');
    return sign({ sub: user.id, sid: sessionId }, this.secret, { expiresIn: IDLE, issuer: 'altamid-hrms', algorithm: 'HS256' });
  }

  async sessionFromHeader(header?: string, outletHeader = ''): Promise<SessionUser> {
    const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!token) fail(401, 'Sign in to continue.');
    let userId = '';
    let sid = '';
    try {
      const payload = verify(token, this.secret, { issuer: 'altamid-hrms', algorithms: ['HS256'] }) as { sub?: string; sid?: string; typ?: string };
      if (payload.typ === 'mfa') fail(401, 'Sign in to continue.');
      userId = payload.sub || '';
      sid = payload.sid || '';
    } catch {
      fail(401, 'Sign in to continue.');
    }
    let user = this.userCache.get(userId);
    if (!user) {
      const row = await this.prisma.user.findUnique({ where: { id: userId } });
      if (!row) fail(401, 'Sign in to continue.');
      user = row as UserRow;
      this.userCache.set(userId, user);
    }
    if (!user.active) fail(401, 'Sign in to continue.');
    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) fail(401, 'This sign-in is paused. Try again in a few minutes.');
    if (user.sessionHash && sid && this.digest(sid) !== user.sessionHash) fail(401, 'Sign in to continue.');
    const access = await this.outlets.access(user as Parameters<OutletService['access']>[0], String(outletHeader || '').trim().slice(0, 40));
    setScope(access.scope);
    return { ...this.toSession(user), role: access.role, outletId: access.scope.current, outletIds: access.outletIds, master: access.master, outletCountry: access.country };
  }

  /** Extends the idle window while the person is still using the app. */
  async touch(session: SessionUser, header?: string): Promise<{ token: string }> {
    const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : '';
    let sid = '';
    try {
      const payload = verify(token, this.secret, { issuer: 'altamid-hrms', algorithms: ['HS256'] }) as { sid?: string };
      sid = payload.sid || '';
    } catch {
      fail(401, 'Sign in to continue.');
    }
    const user = await this.prisma.user.findUnique({ where: { id: session.id } });
    if (!user || !user.active) fail(401, 'Sign in to continue.');
    if (user.sessionHash && sid && this.digest(sid) !== user.sessionHash) fail(401, 'Sign in to continue.');
    const nextSid = sid || randomBytes(16).toString('base64url');
    if (!user.sessionHash || !sid) {
      await this.prisma.user.update({ where: { id: user.id }, data: { sessionHash: this.digest(nextSid) } });
      this.userCache.delete(user.id);
    }
    return { token: this.sign(user, nextSid) };
  }

  async logout(session: SessionUser): Promise<{ ok: true }> {
    await this.prisma.user.update({ where: { id: session.id }, data: { sessionHash: '' } });
    this.userCache.delete(session.id);
    return { ok: true };
  }

  async login(email: string, password: string, ip: string): Promise<Record<string, unknown>> {
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
    this.userCache.delete(user.id);
    await this.prisma.auditEvent.create({
      data: { companyId: user.companyId, actorId: user.id, action: 'login.ok', entity: 'user', entityId: user.id },
    });
    if (user.totpEnabled && user.totpSecretEnc) {
      return { mfaRequired: true, ticket: this.mfaTicket(user.id), name: user.name };
    }
    return this.issue(user);
  }

  async verifyMfa(ticket: string, code: string, ip: string): Promise<Record<string, unknown>> {
    this.pace('mfa:' + ip, 20, 15 * 60 * 1000);
    const userId = this.readMfaTicket(ticket);
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.active || !user.totpEnabled) fail(401, 'That code is not valid. Try again.');
    const secret = this.openTotp(user.totpSecretEnc);
    const cleaned = String(code || '').replace(/\s+/g, '');
    let ok = secret && verifyTotp(secret, cleaned);
    if (!ok) ok = await this.useBackup(user, cleaned);
    if (!ok) {
      await this.miss(user.id, user.companyId, user.failedCount);
      fail(401, 'That code is not valid. Try again.');
    }
    await this.prisma.user.update({ where: { id: user.id }, data: { failedCount: 0, lockedUntil: null } });
    this.userCache.delete(user.id);
    await this.prisma.auditEvent.create({
      data: { companyId: user.companyId, actorId: user.id, action: 'login.mfa', entity: 'user', entityId: user.id },
    });
    return this.issue(user);
  }

  async mfaStatus(session: SessionUser) {
    const user = await this.prisma.user.findUnique({ where: { id: session.id } });
    if (!user) fail(404, 'Sign in to continue.');
    const backups = this.readBackups(user.totpBackupJson);
    return { enabled: !!user.totpEnabled, backupsLeft: backups.length };
  }

  async mfaSetup(session: SessionUser) {
    const user = await this.prisma.user.findUnique({ where: { id: session.id } });
    if (!user) fail(404, 'Sign in to continue.');
    if (user.totpEnabled) fail(400, 'Authenticator is already on. Turn it off before setting it up again.');
    const { secret, base32 } = generateTotpSecret();
    PENDING.set(user.id, { secret, at: Date.now() });
    const issuer = 'Altamid HRMS';
    return {
      secret: base32,
      otpauth: otpauthUri(issuer, user.email, base32),
      hint: 'Open Google Authenticator, add an account, and scan the QR or type the key.',
    };
  }

  async mfaEnable(session: SessionUser, body: unknown) {
    const code = String(bag(body).code || '').replace(/\s+/g, '');
    const pending = PENDING.get(session.id);
    if (!pending || Date.now() - pending.at > 10 * 60 * 1000) fail(400, 'Set up Authenticator again. That key expired.');
    if (!verifyTotp(pending.secret, code)) fail(400, 'That code is not valid. Wait for a new one and try again.');
    const backups = randomBackupCodes(8);
    const hashed = await Promise.all(backups.map(async (item) => this.digest(item)));
    await this.prisma.user.update({
      where: { id: session.id },
      data: {
        totpEnabled: true,
        totpSecretEnc: seal(pending.secret.toString('base64url'), this.key),
        totpBackupJson: JSON.stringify(hashed),
      },
    });
    PENDING.delete(session.id);
    this.userCache.delete(session.id);
    await this.prisma.auditEvent.create({
      data: { companyId: session.companyId, actorId: session.id, action: 'mfa.enable', entity: 'user', entityId: session.id },
    });
    return { enabled: true, backups, message: 'Authenticator is on. Store these backup codes somewhere safe. Each works once.' };
  }

  async mfaDisable(session: SessionUser, body: unknown) {
    const input = bag(body);
    const password = String(input.password || '');
    const code = String(input.code || '').replace(/\s+/g, '');
    const user = await this.prisma.user.findUnique({ where: { id: session.id } });
    if (!user || !user.totpEnabled) fail(400, 'Authenticator is not on.');
    if (!(await compare(password, user.passwordHash))) fail(400, 'The password does not match.');
    const secret = this.openTotp(user.totpSecretEnc);
    const ok = (secret && verifyTotp(secret, code)) || (await this.useBackup(user, code));
    if (!ok) fail(400, 'That Authenticator or backup code is not valid.');
    await this.prisma.user.update({
      where: { id: user.id },
      data: { totpEnabled: false, totpSecretEnc: '', totpBackupJson: '[]' },
    });
    this.userCache.delete(user.id);
    await this.prisma.auditEvent.create({
      data: { companyId: user.companyId, actorId: user.id, action: 'mfa.disable', entity: 'user', entityId: user.id },
    });
    return { enabled: false, message: 'Authenticator is off for this sign-in.' };
  }

  /** Starts email or SMS one-time login. Always returns the same message when identity is unknown. */
  async otpStart(channel: string, identity: string, ip: string): Promise<{ message: string; sent?: boolean }> {
    this.pace('otp-start:' + ip, 8, 15 * 60 * 1000);
    const mode = channel === 'sms' ? 'sms' : 'email';
    const message = 'If that account exists, a one-time code is on its way. It works for 10 minutes.';
    const user = mode === 'email'
      ? await this.prisma.user.findUnique({ where: { email: identity.trim().toLowerCase() } })
      : await this.userByPhone(identity);
    if (!user || !user.active) return { message };
    this.pace('otp-start:' + user.id, 5, 60 * 60 * 1000);
    if (mode === 'sms') {
      const ready = await this.smsReady(user.companyId);
      if (!ready) fail(400, 'SMS sign-in is not set up for this company yet. Use email or password.');
    }
    const code = String(randomBytes(3).readUIntBE(0, 3) % 1_000_000).padStart(6, '0');
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        otpHash: this.digest(code),
        otpExpiresAt: new Date(Date.now() + 10 * 60 * 1000),
        otpChannel: mode,
        otpAttempts: 0,
      },
    });
    this.userCache.delete(user.id);
    if (mode === 'email') {
      await this.settings.sendSystemMail(
        user.companyId,
        user.email,
        'Your sign-in code',
        [`Hello ${user.name.split(' ')[0] || 'there'},`, `Your one-time sign-in code is ${code}. It works for 10 minutes. If you did not ask for this, you can ignore the email.`],
      ).catch(() => ({ emailed: false, note: 'failed' }));
    } else {
      await this.sendSms(user.companyId, identity, `Altamid HRMS code: ${code}. Valid 10 minutes.`);
    }
    await this.prisma.auditEvent.create({
      data: { companyId: user.companyId, actorId: user.id, action: 'login.otp.send', entity: 'user', entityId: user.id, detail: mode },
    });
    return { message, sent: true };
  }

  async otpVerify(channel: string, identity: string, code: string, ip: string): Promise<Record<string, unknown>> {
    this.pace('otp-verify:' + ip, 20, 15 * 60 * 1000);
    const mode = channel === 'sms' ? 'sms' : 'email';
    const user = mode === 'email'
      ? await this.prisma.user.findUnique({ where: { email: identity.trim().toLowerCase() } })
      : await this.userByPhone(identity);
    if (!user || !user.active) fail(401, 'That code is not valid. Try again.');
    if (!user.otpHash || !user.otpExpiresAt || user.otpExpiresAt.getTime() < Date.now()) fail(401, 'That code has expired. Ask for a new one.');
    if ((user.otpAttempts || 0) >= 5) fail(401, 'Too many tries. Ask for a new code.');
    if (this.digest(String(code || '').replace(/\s+/g, '')) !== user.otpHash) {
      await this.prisma.user.update({ where: { id: user.id }, data: { otpAttempts: (user.otpAttempts || 0) + 1 } });
      fail(401, 'That code is not valid. Try again.');
    }
    await this.prisma.user.update({
      where: { id: user.id },
      data: { otpHash: '', otpExpiresAt: null, otpChannel: '', otpAttempts: 0, failedCount: 0, lockedUntil: null },
    });
    this.userCache.delete(user.id);
    await this.prisma.auditEvent.create({
      data: { companyId: user.companyId, actorId: user.id, action: 'login.otp.ok', entity: 'user', entityId: user.id, detail: mode },
    });
    if (user.totpEnabled && user.totpSecretEnc) {
      return { mfaRequired: true, ticket: this.mfaTicket(user.id), name: user.name };
    }
    return this.issue(user);
  }

  async changePassword(session: SessionUser, current: string, next: string): Promise<{ message: string }> {
    const user = await this.prisma.user.findUnique({ where: { id: session.id } });
    if (!user || !(await compare(current, user.passwordHash))) fail(400, 'The current password does not match.');
    const nextPassword = passwordOf(next);
    if (await compare(nextPassword, user.passwordHash)) fail(400, 'Choose a password that is different from the current one.');
    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await this.hashPassword(nextPassword), failedCount: 0, lockedUntil: null, sessionHash: '' },
    });
    this.userCache.delete(user.id);
    await this.prisma.auditEvent.create({
      data: { companyId: user.companyId, actorId: user.id, action: 'password.change', entity: 'user', entityId: user.id },
    });
    return { message: 'Password updated. Sign in again on other devices.' };
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
    await this.prisma.user.update({ where: { id: user.id }, data: { passwordHash: await this.hashPassword(next), failedCount: 0, lockedUntil: null, sessionHash: '' } });
    this.userCache.delete(user.id);
    await this.prisma.passwordReset.update({ where: { id: row.id }, data: { usedAt: new Date() } });
    await this.prisma.auditEvent.create({ data: { companyId: user.companyId, actorId: user.id, action: 'password.reset', entity: 'user', entityId: user.id } });
    return { message: 'Your password is set. Sign in with it now.' };
  }

  private async issue(user: { id: string; companyId: string; role: string; name: string; email: string; employeeId: string | null }) {
    const sid = randomBytes(16).toString('base64url');
    await this.prisma.user.update({ where: { id: user.id }, data: { sessionHash: this.digest(sid) } });
    this.userCache.delete(user.id);
    const session = this.toSession(user);
    return { token: this.sign(session, sid), role: session.role, name: session.name };
  }

  private mfaTicket(userId: string): string {
    return sign({ sub: userId, typ: 'mfa' }, this.secret, { expiresIn: MFA_TICKET, issuer: 'altamid-hrms', algorithm: 'HS256' });
  }

  private readMfaTicket(ticket: string): string {
    try {
      const payload = verify(String(ticket || ''), this.secret, { issuer: 'altamid-hrms', algorithms: ['HS256'] }) as { sub?: string; typ?: string };
      if (payload.typ !== 'mfa' || !payload.sub) fail(401, 'That sign-in step expired. Sign in again.');
      return payload.sub;
    } catch {
      fail(401, 'That sign-in step expired. Sign in again.');
    }
  }

  private openTotp(enc: string | undefined): Buffer | null {
    if (!enc) return null;
    const raw = openSecret(enc, this.key);
    if (!raw) return null;
    try {
      return Buffer.from(raw, 'base64url');
    } catch {
      try {
        return base32Decode(raw);
      } catch {
        return null;
      }
    }
  }

  private readBackups(json: string | undefined): string[] {
    try {
      const parsed = JSON.parse(json || '[]') as unknown;
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  }

  private async useBackup(user: UserRow, code: string): Promise<boolean> {
    const list = this.readBackups(user.totpBackupJson);
    if (!list.length || !/^\d{8}$/.test(code)) return false;
    const dig = this.digest(code);
    const at = list.indexOf(dig);
    if (at < 0) return false;
    const next = [...list.slice(0, at), ...list.slice(at + 1)];
    await this.prisma.user.update({ where: { id: user.id }, data: { totpBackupJson: JSON.stringify(next) } });
    this.userCache.delete(user.id);
    return true;
  }

  private async userByPhone(phone: string): Promise<UserRow | null> {
    const digits = String(phone || '').replace(/\D+/g, '');
    if (digits.length < 8) return null;
    const people = await this.prisma.employee.findMany({
      where: { status: { in: ['active', 'onboarding'] }, phone: { not: '' } },
      select: { id: true, phone: true, companyId: true },
      take: 5000,
    });
    const match = people.find((row) => row.phone.replace(/\D+/g, '').endsWith(digits) || digits.endsWith(row.phone.replace(/\D+/g, '')));
    if (!match) return null;
    return this.prisma.user.findFirst({ where: { employeeId: match.id, companyId: match.companyId } }) as Promise<UserRow | null>;
  }

  private async smsReady(companyId: string): Promise<boolean> {
    try {
      const row = await this.settings.pickIntegration(companyId, 'sms');
      if (!row) return false;
      // Outbound SMS send is wired only when Settings exposes sendSms (providers are credentials-tested today).
      return typeof (this.settings as { sendSms?: unknown }).sendSms === 'function';
    } catch {
      return false;
    }
  }

  private async sendSms(companyId: string, to: string, body: string): Promise<void> {
    const send = (this.settings as { sendSms?: (companyId: string, to: string, body: string) => Promise<unknown> }).sendSms;
    if (typeof send !== 'function') fail(400, 'SMS sign-in is not live yet for this company. Use email or password.');
    await send.call(this.settings, companyId, to, body);
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

  private async ensureColumns(): Promise<void> {
    const stmts = [
      `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "totpEnabled" BOOLEAN NOT NULL DEFAULT false`,
      `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "totpSecretEnc" TEXT NOT NULL DEFAULT ''`,
      `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "totpBackupJson" TEXT NOT NULL DEFAULT '[]'`,
      `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "sessionHash" TEXT NOT NULL DEFAULT ''`,
      `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "otpHash" TEXT NOT NULL DEFAULT ''`,
      `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "otpExpiresAt" TIMESTAMP(3)`,
      `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "otpChannel" TEXT NOT NULL DEFAULT ''`,
      `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "otpAttempts" INTEGER NOT NULL DEFAULT 0`,
    ];
    for (const sql of stmts) {
      await this.prisma.$executeRawUnsafe(sql);
    }
  }
}
