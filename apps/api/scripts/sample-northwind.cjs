/**
 * Idempotent sample data for Northwind Labs only.
 * Sign-ins use the password Northwind1. Echofeel is never touched.
 * Contact emails and phones are the CRM verification inboxes.
 * Run from apps/api: node scripts/sample-northwind.cjs
 */
require('dotenv').config();
const { createCipheriv, randomBytes } = require('crypto');
const { mkdirSync, readFileSync, writeFileSync } = require('fs');
const { join } = require('path');
const { PrismaClient } = require('@prisma/client');
const { hash } = require('bcryptjs');

const PASSWORD = 'Northwind1';
const prisma = new PrismaClient();

function seal(plain, key) {
  if (!plain) return '';
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url');
}

function dataKey() {
  const key = Buffer.from(readFileSync(join(process.cwd(), 'storage', 'data.key'), 'utf8').trim(), 'base64url');
  if (key.length !== 32) throw new Error('storage/data.key must be the API data key.');
  return key;
}

function at(day, time) {
  return new Date(`${day}T${time}:00+05:30`);
}

function handbookPdf() {
  const stream = 'BT /F1 16 Tf 72 720 Td (Northwind Labs handbook. Sample for testing.) Tj ET';
  const objects = [
    '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj',
    '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj',
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj',
    `4 0 obj<</Length ${stream.length}>>stream\n${stream}\nendstream endobj`,
    '5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj',
  ];
  let body = '%PDF-1.4\n';
  const offsets = [0];
  for (const object of objects) {
    offsets.push(body.length);
    body += object + '\n';
  }
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let index = 1; index <= objects.length; index += 1) {
    body += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`;
  }
  body += `trailer<</Size ${objects.length + 1}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(body);
}

async function main() {
  const company = await prisma.company.findUnique({ where: { slug: 'northwind-labs' } });
  if (!company) throw new Error('Northwind Labs was not found.');
  const owner = await prisma.user.findUnique({ where: { email: 'owner@northwind.test' } });
  if (!owner || owner.companyId !== company.id) throw new Error('The Northwind owner sign-in was not found.');
  const key = dataKey();
  const passwordHash = await hash(PASSWORD, 12);
  const companyId = company.id;

  const department = await named(prisma.department, companyId, [
    ['People', {}],
    ['Engineering', {}],
    ['Finance', {}],
    ['Sales', {}],
  ]);
  const designation = await named(prisma.designation, companyId, [
    ['HR manager', {}],
    ['Engineering manager', {}],
    ['Software engineer', {}],
    ['Payroll specialist', {}],
    ['Accountant', {}],
    ['Sales executive', {}],
    ['Intern', {}],
    ['Contractor', {}],
    ['HR executive', {}],
    ['HR coordinator', {}],
    ['Team lead', {}],
    ['Sales manager', {}],
    ['Finance manager', {}],
    ['QA engineer', {}],
    ['Director', {}],
  ]);
  const location = await named(prisma.location, companyId, [
    ['Kochi', { state: 'Kerala', city: 'Kochi' }],
    ['Bengaluru', { state: 'Karnataka', city: 'Bengaluru' }],
  ]);

  const people = [
    ['smtpemailforms@gmail.com', 'EMP003', 'Meera', 'Iyer', 'hr', 'employee', 'active', 'People', 'HR manager', 'Head office', null, '2024-04-01', '', 'PEOPLE', 'Female', '1990-11-15', 'HRMSX1003A', '501000000003'],
    ['smtpemailforms+divya@gmail.com', 'EMP013', 'Divya', 'Rao', 'hr', 'employee', 'active', 'People', 'HR executive', 'Head office', 'smtpemailforms@gmail.com', '2024-11-18', '', 'PEOPLE', 'Female', '1993-02-08', 'HRMSX1013A', '501000000013'],
    ['khanaftab05004+farhan@gmail.com', 'EMP014', 'Farhan', 'Qureshi', 'hr', 'employee', 'active', 'People', 'HR coordinator', 'Kochi', 'smtpemailforms@gmail.com', '2025-07-01', '', 'PEOPLE', 'Male', '1994-10-22', 'HRMSX1014A', '501000000014'],
    ['khanaftab05004@gmail.com', 'EMP004', 'Rohan', 'Desai', 'manager', 'employee', 'active', 'Engineering', 'Engineering manager', 'Bengaluru', null, '2023-11-13', '', 'ENG', 'Male', '1988-11-02', 'HRMSX1004A', '501000000004'],
    ['rehanmalik4511+nikhil@gmail.com', 'EMP015', 'Nikhil', 'Shah', 'manager', 'employee', 'active', 'Engineering', 'Team lead', 'Bengaluru', 'khanaftab05004@gmail.com', '2024-02-12', '', 'ENG', 'Male', '1991-04-17', 'HRMSX1015A', '501000000015'],
    ['khanaftab499@gmail.com', 'EMP005', 'Kavya', 'Nair', 'employee', 'employee', 'active', 'Engineering', 'Software engineer', 'Bengaluru', 'rehanmalik4511+nikhil@gmail.com', '2025-01-15', '', 'ENG', 'Female', '1996-11-13', 'HRMSX1005A', '501000000005'],
    ['rehanmalik4511@gmail.com', 'EMP006', 'Arjun', 'Patel', 'employee', 'employee', 'active', 'Engineering', 'Software engineer', 'Kochi', 'rehanmalik4511+nikhil@gmail.com', '2025-08-04', '', 'ENG', 'Male', '1995-11-12', 'HRMSX1006A', '501000000006'],
    ['obaidkhanyt@gmail.com', 'EMP010', 'Ishaan', 'Gupta', 'employee', 'intern', 'onboarding', 'Engineering', 'Intern', 'Bengaluru', 'rehanmalik4511+nikhil@gmail.com', '2026-11-02', '', 'ENG', 'Male', '2002-05-11', '', ''],
    ['khanaftab499+pooja@gmail.com', 'EMP016', 'Pooja', 'Reddy', 'employee', 'employee', 'active', 'Engineering', 'Software engineer', 'Bengaluru', 'rehanmalik4511+nikhil@gmail.com', '2025-03-10', '', 'ENG', 'Female', '1997-06-02', 'HRMSX1016A', '501000000016'],
    ['khanaftab499+aditya@gmail.com', 'EMP017', 'Aditya', 'Joshi', 'employee', 'employee', 'active', 'Engineering', 'QA engineer', 'Bengaluru', 'rehanmalik4511+nikhil@gmail.com', '2025-06-23', '', 'ENG', 'Male', '1996-12-14', 'HRMSX1017A', '501000000017'],
    ['aftabalamkhanofficial@gmail.com', 'EMP012', 'Suresh', 'Kumar', 'employee', 'employee', 'exited', 'Engineering', 'Software engineer', 'Bengaluru', 'rehanmalik4511+nikhil@gmail.com', '2022-03-01', '2026-08-31', 'ENG', 'Male', '1985-02-17', 'HRMSX1012A', '501000000012'],
    ['fitnessplusbody+sneha@gmail.com', 'EMP018', 'Sneha', 'Kapoor', 'manager', 'employee', 'active', 'Engineering', 'Team lead', 'Bengaluru', 'khanaftab05004@gmail.com', '2024-05-06', '', 'ENG', 'Female', '1992-08-19', 'HRMSX1018A', '501000000018'],
    ['rehanmalik4511+kabir@gmail.com', 'EMP019', 'Kabir', 'Singh', 'employee', 'employee', 'active', 'Engineering', 'Software engineer', 'Kochi', 'fitnessplusbody+sneha@gmail.com', '2025-09-15', '', 'ENG', 'Male', '1995-01-28', 'HRMSX1019A', '501000000019'],
    ['rehanmalik4511+myra@gmail.com', 'EMP020', 'Myra', 'Dsouza', 'employee', 'employee', 'active', 'Engineering', 'Software engineer', 'Bengaluru', 'fitnessplusbody+sneha@gmail.com', '2026-01-20', '', 'ENG', 'Female', '1998-04-04', 'HRMSX1020A', '501000000020'],
    ['obaidkhanyt+dev@gmail.com', 'EMP021', 'Devansh', 'Jain', 'employee', 'employee', 'onboarding', 'Engineering', 'Software engineer', 'Bengaluru', 'fitnessplusbody+sneha@gmail.com', '2026-11-06', '', 'ENG', 'Male', '2001-09-30', '', ''],
    ['obaidkhanyt+imran@gmail.com', 'EMP022', 'Imran', 'Khan', 'manager', 'employee', 'active', 'Sales', 'Sales manager', 'Kochi', null, '2023-09-04', '', 'SALES', 'Male', '1989-07-11', 'HRMSX1022A', '501000000022'],
    ['haymurcreations+tara@gmail.com', 'EMP023', 'Tara', 'Bose', 'manager', 'employee', 'active', 'Sales', 'Team lead', 'Kochi', 'obaidkhanyt+imran@gmail.com', '2024-08-19', '', 'SALES', 'Female', '1993-11-25', 'HRMSX1023A', '501000000023'],
    ['fitnessplusbody@gmail.com', 'EMP009', 'Ananya', 'Das', 'employee', 'employee', 'active', 'Sales', 'Sales executive', 'Kochi', 'haymurcreations+tara@gmail.com', '2026-02-16', '', 'SALES', 'Female', '1997-11-14', 'HRMSX1009A', '501000000009'],
    ['haymurcreations@gmail.com', 'EMP011', 'Priya', 'Menon', 'employee', 'contractor', 'active', 'Sales', 'Contractor', 'Kochi', 'haymurcreations+tara@gmail.com', '2026-10-06', '', 'SALES', 'Female', '1994-08-25', '', ''],
    ['fitnessplusbody+rohit@gmail.com', 'EMP024', 'Rohit', 'Malhotra', 'employee', 'employee', 'active', 'Sales', 'Sales executive', 'Bengaluru', 'haymurcreations+tara@gmail.com', '2026-11-09', '', 'SALES', 'Male', '1996-05-16', 'HRMSX1024A', '501000000024'],
    ['haymurcreations+kiara@gmail.com', 'EMP025', 'Kiara', 'Sen', 'employee', 'employee', 'active', 'Sales', 'Sales executive', 'Kochi', 'haymurcreations+tara@gmail.com', '2026-10-20', '', 'SALES', 'Female', '1999-02-02', 'HRMSX1025A', '501000000025'],
    ['altafhusainkhan35+leela@gmail.com', 'EMP026', 'Leela', 'Nambiar', 'manager', 'employee', 'active', 'Finance', 'Finance manager', 'Head office', null, '2023-01-16', '', 'FIN', 'Female', '1987-12-09', 'HRMSX1026A', '501000000026'],
    ['neha@altamidsolutions.com', 'EMP007', 'Neha', 'Shah', 'payroll', 'employee', 'active', 'Finance', 'Payroll specialist', 'Head office', 'altafhusainkhan35+leela@gmail.com', '2024-01-08', '', 'FIN', 'Female', '1991-11-11', 'HRMSX1007A', '501000000007'],
    ['altafhusainkhan35@gmail.com', 'EMP008', 'Vikram', 'Rao', 'accountant', 'employee', 'active', 'Finance', 'Accountant', 'Head office', 'altafhusainkhan35+leela@gmail.com', '2024-09-02', '', 'FIN', 'Male', '1987-07-19', 'HRMSX1008A', '501000000008'],
  ];

  const phones = {
    'smtpemailforms@gmail.com': '+91 97736 45783',
    'khanaftab05004@gmail.com': '+91 96640 45004',
    'khanaftab499@gmail.com': '+91 96640 45004',
    'rehanmalik4511@gmail.com': '+91 96640 45004',
    'neha@altamidsolutions.com': '+91 98100 33333',
    'altafhusainkhan35@gmail.com': '+91 97736 45783',
    'fitnessplusbody@gmail.com': '+91 97736 45783',
    'obaidkhanyt@gmail.com': '+91 84337 65662',
    'haymurcreations@gmail.com': '+91 96640 45004',
    'aftabalamkhanofficial@gmail.com': '+91 97736 45783',
  };
  const phoneFor = (email) => {
    if (phones[email]) return phones[email];
    const local = email.split('@')[0].split('+')[0];
    if (local.startsWith('obaid')) return '+91 84337 65662';
    if (local.startsWith('neha')) return '+91 98100 33333';
    if (local.startsWith('khanaftab') || local.startsWith('rehan') || local.startsWith('haymur')) return '+91 96640 45004';
    return '+91 97736 45783';
  };
  const headOffice = await prisma.location.findFirst({ where: { companyId, name: 'Head office' } });
  const ids = {};
  for (const row of people) {
    const [email, code, firstName, lastName, role, workerType, status, dept, title, loc, managerEmail, dateOfJoining, dateOfExit, costCentre, gender, dateOfBirth, pan, bank] = row;
    const managerId = managerEmail ? ids[managerEmail] : owner.employeeId;
    const existing = await prisma.employee.findFirst({ where: { companyId, code } });
    const data = {
      firstName,
      lastName,
      email,
      phone: phoneFor(email),
      workerType,
      status,
      departmentId: department[dept],
      designationId: designation[title],
      locationId: loc === 'Head office' ? headOffice.id : location[loc],
      managerId,
      costCentre,
      dateOfJoining,
      dateOfExit,
      gender,
      dateOfBirth,
      panEnc: seal(pan, key),
      bankEnc: seal(bank, key),
      ifscEnc: bank ? seal('TEST0000001', key) : '',
      bankName: bank ? 'Sample Bank' : '',
    };
    const employee = existing
      ? await prisma.employee.update({ where: { id: existing.id }, data })
      : await prisma.employee.create({ data: { companyId, code, ...data } });
    ids[email] = employee.id;
    const linked = await prisma.user.findFirst({ where: { employeeId: employee.id } });
    const byEmail = await prisma.user.findUnique({ where: { email } });
    const user = linked || byEmail;
    const userData = {
      email,
      companyId,
      name: `${firstName} ${lastName}`,
      role,
      active: status !== 'exited',
      employeeId: employee.id,
      passwordHash,
    };
    if (!user) await prisma.user.create({ data: userData });
    else if (user.companyId === companyId) await prisma.user.update({ where: { id: user.id }, data: userData });
  }

  const teamMember = await prisma.designation.findFirst({ where: { companyId, name: 'Team member' } });
  const asha = await prisma.employee.findFirst({ where: { companyId, code: 'EMP002' } });
  if (asha && teamMember) {
    await prisma.employee.update({
      where: { id: asha.id },
      data: { managerId: ids['smtpemailforms@gmail.com'], departmentId: department.People, designationId: teamMember.id, locationId: headOffice.id },
    });
  }
  if (owner.employeeId && designation.Director) {
    await prisma.employee.update({ where: { id: owner.employeeId }, data: { designationId: designation.Director } });
  }

  const types = Object.fromEntries((await prisma.leaveType.findMany({ where: { companyId } })).map((row) => [row.code, row.id]));
  const leaves = [
    ['khanaftab499@gmail.com', 'CL', '2026-11-04', '2026-11-04', 1, 'full', 'approved', 'Family visit.', ''],
    ['khanaftab499@gmail.com', 'SL', '2026-11-20', '2026-11-20', 1, 'full', 'pending', 'Fever.', ''],
    ['khanaftab05004@gmail.com', 'EL', '2026-10-14', '2026-10-16', 3, 'full', 'approved', 'Travel.', ''],
    ['rehanmalik4511@gmail.com', 'CL', '2026-11-06', '2026-11-06', 1, 'half', 'pending', 'Bank work in the afternoon.', ''],
    ['fitnessplusbody@gmail.com', 'SL', '2026-11-06', '2026-11-06', 1, 'half', 'approved', 'Clinic visit.', ''],
    ['neha@altamidsolutions.com', 'CL', '2026-11-02', '2026-11-02', 1, 'full', 'rejected', 'Personal work.', 'Please use a planned day.'],
    ['altafhusainkhan35@gmail.com', 'LWP', '2026-11-25', '2026-11-25', 1, 'full', 'pending', 'Personal errand.', ''],
    ['smtpemailforms@gmail.com', 'EL', '2026-12-01', '2026-12-03', 3, 'full', 'pending', 'Year-end travel.', ''],
    ['smtpemailforms+divya@gmail.com', 'CL', '2026-11-19', '2026-11-19', 1, 'full', 'pending', 'Family function.', ''],
    ['khanaftab05004+farhan@gmail.com', 'SL', '2026-11-05', '2026-11-05', 1, 'full', 'approved', 'Fever.', ''],
    ['rehanmalik4511+nikhil@gmail.com', 'EL', '2026-12-08', '2026-12-10', 3, 'full', 'pending', 'Travel after the release.', ''],
    ['fitnessplusbody+sneha@gmail.com', 'CL', '2026-11-27', '2026-11-27', 1, 'full', 'pending', 'Personal work.', ''],
    ['khanaftab499+pooja@gmail.com', 'CL', '2026-11-03', '2026-11-03', 1, 'full', 'approved', 'Home town visit.', ''],
    ['khanaftab499+aditya@gmail.com', 'SL', '2026-11-24', '2026-11-24', 1, 'full', 'pending', 'Dental appointment.', ''],
    ['rehanmalik4511+kabir@gmail.com', 'EL', '2026-10-20', '2026-10-21', 2, 'full', 'approved', 'Long weekend.', ''],
    ['rehanmalik4511+myra@gmail.com', 'CL', '2026-11-12', '2026-11-12', 1, 'half', 'pending', 'Bank work.', ''],
    ['obaidkhanyt+dev@gmail.com', 'CL', '2026-11-26', '2026-11-26', 1, 'full', 'pending', 'Joining formalities.', ''],
    ['obaidkhanyt+imran@gmail.com', 'EL', '2026-09-16', '2026-09-17', 2, 'full', 'approved', 'Client travel.', ''],
    ['haymurcreations+tara@gmail.com', 'CL', '2026-11-27', '2026-11-27', 1, 'full', 'pending', 'School function.', ''],
    ['fitnessplusbody+rohit@gmail.com', 'CL', '2026-12-04', '2026-12-04', 1, 'full', 'pending', 'Personal work.', ''],
    ['haymurcreations+kiara@gmail.com', 'SL', '2026-11-11', '2026-11-11', 1, 'full', 'approved', 'Clinic visit.', ''],
    ['altafhusainkhan35+leela@gmail.com', 'CL', '2026-12-11', '2026-12-11', 1, 'full', 'pending', 'Personal work.', ''],
    ['neha@altamidsolutions.com', 'EL', '2026-12-15', '2026-12-16', 2, 'full', 'pending', 'Year-end leave.', ''],
  ];
  for (const [email, code, startsOn, endsOn, days, portion, status, reason, reviewNote] of leaves) {
    const found = await prisma.leaveRequest.findFirst({ where: { employeeId: ids[email], leaveTypeId: types[code], startsOn } });
    const data = {
      endsOn, days, portion, reason, status, reviewNote,
      reviewerId: status === 'pending' ? '' : owner.id,
      decidedAt: status === 'pending' ? null : at('2026-11-07', '10:00'),
    };
    if (found) await prisma.leaveRequest.update({ where: { id: found.id }, data });
    else await prisma.leaveRequest.create({ data: { companyId, employeeId: ids[email], leaveTypeId: types[code], startsOn, ...data } });
  }

  const present = [
    ['khanaftab499@gmail.com', ['2026-11-02', '2026-11-05', '2026-11-06', '2026-11-10', '2026-11-11', '2026-11-12']],
    ['khanaftab05004@gmail.com', ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12']],
    ['rehanmalik4511@gmail.com', ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12']],
    ['smtpemailforms@gmail.com', ['2026-11-10', '2026-11-11', '2026-11-12']],
    ['fitnessplusbody@gmail.com', ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-10', '2026-11-11', '2026-11-12']],
    ['neha@altamidsolutions.com', ['2026-11-10', '2026-11-11', '2026-11-12']],
  ];
  for (const [email, days] of present) {
    for (const day of days) await pair(companyId, ids[email], day, 'web', '');
  }
  await onePunch(companyId, ids['khanaftab499@gmail.com'], '2026-11-09', 'in', 'web', '');
  await onePunch(companyId, ids['altafhusainkhan35@gmail.com'], '2026-11-11', 'in', 'web', '');
  for (const email of ['khanaftab499@gmail.com', 'khanaftab05004@gmail.com', 'rehanmalik4511@gmail.com', 'smtpemailforms@gmail.com', 'rehanmalik4511+nikhil@gmail.com', 'fitnessplusbody+sneha@gmail.com', 'obaidkhanyt+imran@gmail.com', 'haymurcreations+tara@gmail.com', 'altafhusainkhan35+leela@gmail.com', 'khanaftab499+pooja@gmail.com', 'rehanmalik4511+kabir@gmail.com']) {
    await onePunch(companyId, ids[email], '2026-11-13', 'in', 'web', '');
  }
  for (const email of ['rehanmalik4511+nikhil@gmail.com', 'fitnessplusbody+sneha@gmail.com', 'obaidkhanyt+imran@gmail.com', 'haymurcreations+tara@gmail.com', 'altafhusainkhan35+leela@gmail.com', 'khanaftab499+pooja@gmail.com', 'rehanmalik4511+kabir@gmail.com', 'smtpemailforms+divya@gmail.com']) {
    await pair(companyId, ids[email], '2026-11-10', 'web', '');
    await pair(companyId, ids[email], '2026-11-11', 'web', '');
    await pair(companyId, ids[email], '2026-11-12', 'web', '');
  }
  await pair(companyId, ids['fitnessplusbody@gmail.com'], '2026-10-29', 'regularization', 'Regularized');

  const times = [
    ['khanaftab499@gmail.com', 'wfh', '2026-11-03', 'approved', '09:30', '18:30', '', 'Home', 'Home with a delivery.'],
    ['khanaftab499@gmail.com', 'extratime', '2026-11-10', 'pending', '', '', '2', '', 'Release cut.'],
    ['rehanmalik4511@gmail.com', 'regularization', '2026-11-05', 'pending', '09:30', '18:30', '', '', 'Forgot to punch.'],
    ['khanaftab05004@gmail.com', 'onduty', '2026-11-21', 'pending', '', '', '', 'Client office, Bengaluru', 'Client workshop.'],
    ['fitnessplusbody@gmail.com', 'regularization', '2026-10-29', 'approved', '09:30', '18:30', '', '', 'Missed punch on a client day.'],
    ['haymurcreations@gmail.com', 'wfh', '2026-11-16', 'pending', '09:30', '18:30', '', 'Home', 'Working from Kochi.'],
    ['smtpemailforms+divya@gmail.com', 'wfh', '2026-11-30', 'pending', '09:30', '18:30', '', 'Home', 'Working from home.'],
    ['khanaftab05004+farhan@gmail.com', 'onduty', '2026-11-10', 'approved', '', '', '', 'Kochi office', 'Campus visit.'],
    ['rehanmalik4511+nikhil@gmail.com', 'regularization', '2026-11-09', 'pending', '09:30', '18:30', '', '', 'Forgot to punch.'],
    ['fitnessplusbody+sneha@gmail.com', 'extratime', '2026-11-12', 'pending', '', '', '1.5', '', 'Release support.'],
    ['khanaftab499+pooja@gmail.com', 'wfh', '2026-11-23', 'pending', '09:30', '18:30', '', 'Home', 'Home delivery day.'],
    ['khanaftab499+aditya@gmail.com', 'onduty', '2026-11-26', 'pending', '', '', '', 'Client office, Kochi', 'QA at the client site.'],
    ['rehanmalik4511+kabir@gmail.com', 'regularization', '2026-11-04', 'pending', '09:30', '18:30', '', '', 'Badge failed at the gate.'],
    ['rehanmalik4511+myra@gmail.com', 'extratime', '2026-11-10', 'approved', '', '', '2', '', 'Deploy window.'],
    ['obaidkhanyt+imran@gmail.com', 'onduty', '2026-12-02', 'pending', '', '', '', 'Client office, Kochi', 'Quarterly review.'],
    ['haymurcreations+tara@gmail.com', 'wfh', '2026-11-19', 'pending', '09:30', '18:30', '', 'Home', 'Calls from home.'],
    ['fitnessplusbody+rohit@gmail.com', 'regularization', '2026-11-05', 'pending', '09:30', '18:30', '', '', 'Missed the punch.'],
    ['haymurcreations+kiara@gmail.com', 'wfh', '2026-11-03', 'approved', '09:30', '18:30', '', 'Home', 'First week from home.'],
    ['altafhusainkhan35+leela@gmail.com', 'extratime', '2026-11-11', 'pending', '', '', '1', '', 'Month-end close.'],
    ['neha@altamidsolutions.com', 'onduty', '2026-11-27', 'pending', '', '', '', 'Bank, Fort', 'Salary file at the bank.'],
  ];
  for (const [email, kind, day, status, inTime, outTime, hours, place, reason] of times) {
    const found = await prisma.attendanceRequest.findFirst({ where: { employeeId: ids[email], kind, day } });
    const data = {
      status, inTime, outTime, hours, place, reason, endsOn: '',
      reviewerId: status === 'pending' ? '' : owner.id,
      reviewNote: '',
      decidedAt: status === 'pending' ? null : at('2026-11-07', '11:00'),
    };
    if (found) await prisma.attendanceRequest.update({ where: { id: found.id }, data });
    else await prisma.attendanceRequest.create({ data: { companyId, employeeId: ids[email], kind, day, ...data } });
  }

  for (const [day, name] of [
    ['2026-01-01', 'New year holiday'],
    ['2026-01-26', 'Republic Day'],
    ['2026-03-31', 'Financial year close'],
    ['2026-08-15', 'Independence Day'],
    ['2026-10-02', 'Gandhi Jayanti'],
    ['2026-12-25', 'Year-end holiday'],
  ]) {
    const found = await prisma.holiday.findFirst({ where: { companyId, day } });
    if (!found) await prisma.holiday.create({ data: { companyId, day, name } });
  }

  const notes = [
    ['November office note', 'Kochi and Bengaluru both work the 09:30 to 18:30 shift. Sunday is the weekly off.', true, 'all', '', ''],
    ['Engineering standup', 'Standup is at 10:00 on weekdays.', false, 'department', 'Engineering', ''],
    ['Bengaluru visitors', 'Visitors sign in at the ground-floor desk.', false, 'location', '', 'Bengaluru'],
  ];
  for (const [title, body, pinned, audience, dept, loc] of notes) {
    const found = await prisma.announcement.findFirst({ where: { companyId, title } });
    const data = {
      body, pinned, audience, authorId: owner.id, authorName: owner.name, expiresOn: '2026-12-31',
      departmentId: dept ? department[dept] : null,
      locationId: loc ? location[loc] : null,
    };
    if (found) await prisma.announcement.update({ where: { id: found.id }, data });
    else await prisma.announcement.create({ data: { companyId, title, ...data } });
  }

  await opening(companyId, {
    code: 'JOB002', title: 'Software engineer', department: 'Engineering', location: 'Bengaluru', workplace: 'hybrid',
    description: 'Build the product with the Bengaluru engineering team. This opening is open to employees and to referrals.',
    requirements: 'Two years of product work. A portfolio is useful.', internal: true, referral: true, status: 'open',
  });
  await opening(companyId, {
    code: 'JOB003', title: 'Office assistant', department: 'People', location: 'Kochi', workplace: 'office',
    description: 'This role is closed and kept so the hiring list can show a closed job.',
    requirements: '', internal: false, referral: false, status: 'closed',
  });
  await opening(companyId, {
    code: 'JOB004', title: 'Product designer', department: 'Engineering', location: 'Bengaluru', workplace: 'hybrid',
    description: 'This role is still a draft and is not on the career page.',
    requirements: '', internal: false, referral: false, status: 'draft',
  });

  const job = await prisma.opening.findFirst({ where: { companyId, code: 'JOB002' } });
  await application(companyId, job.id, { name: 'Kavya Nair', email: 'khanaftab499@gmail.com', source: 'internal', referrerId: ids['khanaftab499@gmail.com'], status: 'reviewing', jobTitle: job.title, jobCode: job.code, city: 'Bengaluru' });
  await application(companyId, job.id, { name: 'Dev Sharma', email: 'rahul@altamidsolutions.com', phone: '+91 98100 22222', source: 'referral', referrerId: ids['khanaftab05004@gmail.com'], status: 'new', jobTitle: job.title, jobCode: job.code, city: 'Pune', note: 'Rohan referred Dev from a previous team.' });
  await application(companyId, job.id, { name: 'Leela Thomas', email: 'support@altamidsolutions.com', phone: '+91 98100 44444', source: 'website', status: 'interview', jobTitle: job.title, jobCode: job.code, city: 'Kochi' });
  await application(companyId, job.id, { name: 'Nila Joseph', email: 'priya@altamidsolutions.com', phone: '+91 98100 11111', source: 'website', status: 'hired', jobTitle: job.title, jobCode: job.code, city: 'Bengaluru' });
  await application(companyId, job.id, { name: 'Old Candidate', email: 'admin@altamidsolutions.com', phone: '+91 97736 45783', source: 'website', status: 'rejected', jobTitle: job.title, jobCode: job.code, city: 'Mumbai', note: 'Role was not a match.' });

  const form = await prisma.jobForm.findFirst({ where: { companyId, slug: 'careers' } });
  if (form) {
    await application(companyId, null, { formId: form.id, name: 'Tara Iyer', email: 'info@altamidsolutions.com', phone: '+91 97736 45783', source: 'form', status: 'new', city: 'Chennai', jobTitle: '', jobCode: '' });
  }
  const draft = await prisma.jobForm.findFirst({ where: { slug: 'campus-drive' } });
  if (!draft) {
    await prisma.jobForm.create({
      data: {
        companyId, name: 'Campus drive', slug: 'campus-drive', title: 'Campus drive', status: 'draft',
        intro: 'A draft form. It is not on the website until it is published.',
        fieldsJson: JSON.stringify([
          { key: 'name', label: 'Full name', type: 'text', required: true, locked: true, options: [] },
          { key: 'email', label: 'Email', type: 'email', required: true, locked: true, options: [] },
        ]),
      },
    });
  }

  await help(companyId, 'How to punch in', 'Punch in from Home or Attendance. A day with an in and no out shows as a missed punch after the day ends.', true);
  await help(companyId, 'Draft: salary month notes', 'Payroll is not calculated in this build. This draft stays hidden from employees.', false);
  await handbook(companyId);
  await reader(companyId, 'Kochi gate', 'fingerprint', 'Kochi');
  await reader(companyId, 'Bengaluru turnstile', 'card', 'Bengaluru');
  await praise(companyId, ids);
  await dossier(companyId);
  await staffFile(companyId, { kind: 'doc:offer', title: 'Offer letter — Kavya Nair', audience: 'person', employeeId: ids['khanaftab499@gmail.com'], line: 'Sample offer letter for Kavya Nair. This file has no pay figures.' });
  await staffFile(companyId, { kind: 'doc:increment', title: 'Increment letter — Arjun Patel', audience: 'person', employeeId: ids['rehanmalik4511@gmail.com'], line: 'Sample increment letter for Arjun Patel. Pay figures stay with payroll and are not in this file.' });
  await staffFile(companyId, { kind: 'doc:appointment', title: 'Appointment letter — Meera Iyer', audience: 'person', employeeId: ids['smtpemailforms@gmail.com'], line: 'Sample appointment letter for Meera Iyer. This file has no pay figures.' });
  await staffFile(companyId, { kind: 'doc:holiday', title: 'Holiday list 2026', audience: 'all', line: 'Northwind holiday list for 2026. The dates also appear on the attendance calendar.' });
  await staffFile(companyId, { kind: 'doc:circular', title: 'Office circular — November', audience: 'all', line: 'November office circular for everyone at Northwind Labs.' });
  await staffFile(companyId, { kind: 'doc:policy', title: 'Engineering leave policy', audience: 'department', departmentId: department.Engineering, line: 'Leave policy shared with the Engineering department only.' });
  await staffFile(companyId, { kind: 'doc:circular', title: 'Bengaluru workplace note', audience: 'location', locationId: location.Bengaluru, line: 'Workplace note for people based in Bengaluru.' });
  await staffFile(companyId, { kind: 'doc:handbook', title: 'People team handbook', audience: 'department', departmentId: department.People, line: 'Handbook for the People department.' });
  await samplePay(companyId, ids['khanaftab499@gmail.com'], {
    basic: 480000, hra: 192000, special: 96000, employerPf: 57600,
    monthBasic: 40000, monthHra: 16000, monthSpecial: 8000, pf: 4800, tax: 200,
    draft: true,
  });
  await samplePay(companyId, ids['rehanmalik4511@gmail.com'], {
    basic: 420000, hra: 168000, special: 72000, employerPf: 50400,
    monthBasic: 35000, monthHra: 14000, monthSpecial: 6000, pf: 4200, tax: 200,
    draft: false,
  });
  await samplePay(companyId, ids['fitnessplusbody@gmail.com'], {
    basic: 300000, hra: 120000, special: 60000, employerPf: 36000,
    monthBasic: 25000, monthHra: 10000, monthSpecial: 5000, pf: 3000, tax: 200,
    draft: false,
  });

  const counts = {
    people: await prisma.employee.count({ where: { companyId } }),
    leave: await prisma.leaveRequest.count({ where: { companyId } }),
    punches: await prisma.punch.count({ where: { companyId } }),
    requests: await prisma.attendanceRequest.count({ where: { companyId } }),
    holidays: await prisma.holiday.count({ where: { companyId } }),
    jobs: await prisma.opening.count({ where: { companyId } }),
    applications: await prisma.jobApplication.count({ where: { companyId } }),
  };
  console.log(JSON.stringify(counts));
}

async function named(model, companyId, rows) {
  const map = {};
  for (const [name, extra] of rows) {
    const found = await model.findFirst({ where: { companyId, name } });
    const row = found || await model.create({ data: { companyId, name, ...extra } });
    map[name] = row.id;
  }
  return map;
}

async function onePunch(companyId, employeeId, day, kind, source, note) {
  const start = at(day, '00:00');
  const end = at(day, '23:59');
  const found = await prisma.punch.findFirst({ where: { employeeId, kind, punchedAt: { gte: start, lte: end } } });
  if (found) return;
  await prisma.punch.create({ data: { companyId, employeeId, kind, source, note, punchedAt: at(day, kind === 'in' ? '09:30' : '18:30') } });
}

async function pair(companyId, employeeId, day, source, note) {
  await onePunch(companyId, employeeId, day, 'in', source, note);
  await onePunch(companyId, employeeId, day, 'out', source, note);
}

async function opening(companyId, input) {
  const found = await prisma.opening.findFirst({ where: { companyId, code: input.code } });
  const data = { ...input, employment: 'full-time', seats: input.status === 'open' ? 2 : 1, salaryNote: '', portalsJson: '[]' };
  if (found) await prisma.opening.update({ where: { id: found.id }, data });
  else await prisma.opening.create({ data: { companyId, ...data } });
}

async function application(companyId, openingId, input) {
  const found = await prisma.jobApplication.findFirst({
    where: input.referrerId
      ? { companyId, source: input.source, jobCode: input.jobCode || '', referrerId: input.referrerId }
      : { companyId, source: input.source, jobCode: input.jobCode || '', name: input.name },
  });
  const data = { openingId, phone: '+91 96640 45004', resumeUrl: '', referrerId: '', note: '', answersJson: '{}', ...input };
  if (found) await prisma.jobApplication.update({ where: { id: found.id }, data });
  else await prisma.jobApplication.create({ data: { companyId, ...data } });
}

async function help(companyId, title, body, published) {
  const found = await prisma.libraryDoc.findFirst({ where: { companyId, kind: 'help', title } });
  if (found) await prisma.libraryDoc.update({ where: { id: found.id }, data: { body, published } });
  else await prisma.libraryDoc.create({ data: { companyId, kind: 'help', title, body, published, version: '1' } });
}

function rupeeLines(rows) {
  return JSON.stringify(rows.map(([side, name, rupees]) => ({ side, name, paise: Math.round(rupees * 100) })));
}

async function samplePay(companyId, employeeId, figures) {
  if (!employeeId) return;
  const structure = await prisma.payStructure.findFirst({ where: { companyId, employeeId, effectiveFrom: '2026-04-01' } });
  const structureLines = rupeeLines([
    ['earning', 'Basic', figures.basic],
    ['earning', 'House rent allowance', figures.hra],
    ['earning', 'Special allowance', figures.special],
    ['employer', 'Provident fund (employer)', figures.employerPf],
  ]);
  if (!structure) {
    await prisma.payStructure.create({
      data: { companyId, employeeId, effectiveFrom: '2026-04-01', published: true, linesJson: structureLines },
    });
  }
  const monthLines = rupeeLines([
    ['earning', 'Basic', figures.monthBasic],
    ['earning', 'House rent allowance', figures.monthHra],
    ['earning', 'Special allowance', figures.monthSpecial],
    ['deduction', 'Provident fund', figures.pf],
    ['deduction', 'Professional tax', figures.tax],
  ]);
  for (const month of ['2026-09', '2026-10']) {
    const found = await prisma.paySlip.findFirst({ where: { companyId, employeeId, month } });
    if (found) continue;
    await prisma.paySlip.create({
      data: {
        companyId, employeeId, month, published: true, linesJson: monthLines,
        note: 'Sample figures for testing. PF, ESI, and income tax are not calculated.',
      },
    });
  }
  if (figures.draft) {
    const found = await prisma.paySlip.findFirst({ where: { companyId, employeeId, month: '2026-11' } });
    if (!found) {
      await prisma.paySlip.create({
        data: { companyId, employeeId, month: '2026-11', published: false, linesJson: monthLines, note: 'Draft. The employee cannot see this until payroll publishes it.' },
      });
    }
  }
  const form = await prisma.taxForm.findFirst({ where: { companyId, employeeId, year: '2025-26' } });
  if (!form) {
    const row = await prisma.taxForm.create({
      data: { companyId, employeeId, year: '2025-26', fileName: 'form16.pdf', published: true },
    });
    const dir = join(process.cwd(), 'storage', 'pay', companyId);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, row.id + '.pdf'), letterPdf('Sample Form 16 for financial year 2025-26. This file is not a tax computation.'));
  }
}

async function staffFile(companyId, input) {
  const found = await prisma.libraryDoc.findFirst({ where: { companyId, kind: input.kind, title: input.title } });
  if (found) return;
  const row = await prisma.libraryDoc.create({
    data: {
      companyId,
      kind: input.kind,
      title: input.title,
      version: '1',
      fileName: 'document.pdf',
      published: true,
      body: '',
      audience: input.audience,
      employeeId: input.employeeId || '',
      departmentId: input.departmentId || '',
      locationId: input.locationId || '',
    },
  });
  const dir = join(process.cwd(), 'storage', 'library', companyId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, row.id + '.pdf'), letterPdf(input.line));
}

function letterPdf(line) {
  const stream = `BT /F1 14 Tf 72 720 Td (${line.replace(/[()\\\\]/g, '')}) Tj ET`;
  const objects = [
    '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj',
    '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj',
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj',
    `4 0 obj<</Length ${stream.length}>>stream\n${stream}\nendstream endobj`,
    '5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj',
  ];
  let body = '%PDF-1.4\n';
  const offsets = [0];
  for (const object of objects) {
    offsets.push(body.length);
    body += object + '\n';
  }
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let index = 1; index <= objects.length; index += 1) body += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`;
  body += `trailer<</Size ${objects.length + 1}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(body);
}

async function dossier(companyId) {
  const rows = {
    EMP005: { maritalStatus: 'Single', nationality: 'Indian', bloodGroup: 'O+', emergencyName: 'Sample contact', emergencyPhone: '+91 96640 45004', confirmedOn: '2025-07-15', address: 'Sample lane, Bengaluru' },
    EMP006: { maritalStatus: 'Single', nationality: 'Indian', bloodGroup: 'B+', emergencyName: 'Sample contact', emergencyPhone: '+91 97736 45783', confirmedOn: '2026-02-04', address: 'Sample lane, Kochi' },
    EMP003: { maritalStatus: 'Married', nationality: 'Indian', bloodGroup: 'A+', emergencyName: 'Sample contact', emergencyPhone: '+91 97736 45783', confirmedOn: '2024-10-01', address: 'Sample lane, Mumbai' },
    EMP004: { maritalStatus: 'Married', nationality: 'Indian', bloodGroup: 'O+', emergencyName: 'Sample contact', emergencyPhone: '+91 96640 45004', confirmedOn: '2024-05-13', address: 'Sample lane, Bengaluru' },
  };
  for (const [code, data] of Object.entries(rows)) {
    const person = await prisma.employee.findFirst({ where: { companyId, code } });
    if (!person || person.address) continue;
    await prisma.employee.update({ where: { id: person.id }, data });
  }
}

async function praise(companyId, ids) {
  const rows = [
    ['khanaftab499@gmail.com', 'rehanmalik4511+nikhil@gmail.com', 'star', 'Shipped the November fix.'],
    ['khanaftab05004@gmail.com', 'khanaftab499@gmail.com', 'team', 'Steady through the release.'],
    ['rehanmalik4511@gmail.com', 'khanaftab499@gmail.com', 'thanks', 'Covered the review at short notice.'],
    ['smtpemailforms@gmail.com', 'khanaftab05004@gmail.com', 'extra', 'Kept the Bengaluru plan on track.'],
    ['neha@altamidsolutions.com', 'altafhusainkhan35+leela@gmail.com', 'solver', 'Closed the month without a chase.'],
    ['fitnessplusbody@gmail.com', 'haymurcreations+tara@gmail.com', 'team', 'Brought the Kochi visit in calmly.'],
  ];
  for (const [fromEmail, toEmail, badge, note] of rows) {
    if (!ids[fromEmail] || !ids[toEmail]) continue;
    const found = await prisma.recognition.findFirst({ where: { companyId, note } });
    if (found) continue;
    await prisma.recognition.create({ data: { companyId, fromId: ids[fromEmail], toId: ids[toEmail], badge, note } });
  }
}

async function reader(companyId, name, kind, location) {
  const found = await prisma.attendanceDevice.findFirst({ where: { companyId, name } });
  if (found) return;
  const token = randomBytes(24).toString('base64url');
  await prisma.attendanceDevice.create({ data: { companyId, name, kind, location, token, active: true } });
}

async function handbook(companyId) {
  const title = 'Northwind employee handbook';
  const found = await prisma.libraryDoc.findFirst({ where: { companyId, kind: 'handbook', title } });
  if (found) return;
  const row = await prisma.libraryDoc.create({
    data: { companyId, kind: 'handbook', title, version: '1.0', fileName: 'handbook.pdf', published: true, body: '' },
  });
  const dir = join(process.cwd(), 'storage', 'library', companyId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, row.id + '.pdf'), handbookPdf());
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
}).finally(() => prisma.$disconnect());
