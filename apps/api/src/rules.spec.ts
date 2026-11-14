import { generateKeyPairSync, sign } from 'crypto';
import { maskSecret, openSecret, seal } from './crypto';
import { countedDays, inclusiveDays, nextEmployeeCode, rangesOverlap, weekdayOf } from './dates';
import { readInbound } from './hiring.service';
import { canonicalJson } from './lease/canonical';
import { decideAccess, LeaseV1 } from './lease/policy';
import { rawPublicKey, verifyLeaseSignature } from './lease/verify';

describe('HRMS rules', () => {
  it('skips weekly offs and holidays when counting leave', () => {
    expect(weekdayOf('2026-11-01')).toBe(0);
    expect(countedDays('2026-11-01', '2026-11-03', [0], new Set(['2026-11-02']))).toBe(1);
    expect(inclusiveDays('2026-01-01', '2026-01-03')).toBe(3);
  });

  it('counts every calendar day in a leave range', () => {
    expect(inclusiveDays('2026-01-01', '2026-01-03')).toBe(3);
    expect(rangesOverlap('2026-01-01', '2026-01-03', '2026-01-03', '2026-01-04')).toBe(true);
    expect(rangesOverlap('2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04')).toBe(false);
  });

  it('reads a job-portal application', () => {
    expect(readInbound({ job: 'JOB001', name: 'Asha Menon', email: 'asha@example.com', phone: '9876543210' })).toMatchObject({
      job: 'JOB001', name: 'Asha Menon', email: 'asha@example.com',
    });
    expect(readInbound({
      job: { jobId: 'JOB004' },
      applicant: { fullName: 'Asha Menon', email: 'asha@example.com', phoneNumber: '9876543210', city: 'Kochi' },
    })).toMatchObject({ job: 'JOB004', city: 'Kochi' });
    expect(() => readInbound({ job: 'JOB001', name: 'Asha', email: 'asha@example.com', resume: { file: { data: 'abc' } } })).toThrow(/https link/);
  });

  it('issues the next employee code', () => {
    expect(nextEmployeeCode(['EMP001', 'EMP009', 'TEMP'])).toBe('EMP010');
    expect(nextEmployeeCode(['EMP2026001'], { prefix: 'EMP', padding: 3, includeYear: true, year: 2026 })).toBe('EMP2026002');
  });

  it('seals and masks pay secrets', () => {
    const key = Buffer.alloc(32, 7);
    expect(openSecret(seal('ABCDE1234F', key), key)).toBe('ABCDE1234F');
    expect(openSecret('', key)).toBe('');
    expect(maskSecret('ABCDE1234F')).toBe('••••234F');
  });

  it('restricts a lease that is not usable', () => {
    const decision = decideAccess({
      now: 1_700_000_000,
      transportFailed: false,
      fresh: { v: 1, usable: false, verdict: 'revoked' } as LeaseV1,
      stored: null,
    });
    expect(decision.access).toBe('restrict');
    expect(decision.reason).toBe('revoked');
  });

  it('verifies an Ed25519 lease the way Altamid Control signs it', () => {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const lease = { v: 1, usable: true, verdict: 'active' };
    const signature = sign(null, Buffer.from(canonicalJson(lease), 'utf8'), privateKey).toString('base64url');
    expect(verifyLeaseSignature(lease, signature, rawPublicKey(publicKey))).toBe(true);
    expect(verifyLeaseSignature(lease, signature, rawPublicKey(generateKeyPairSync('ed25519').publicKey))).toBe(false);
  });
});
