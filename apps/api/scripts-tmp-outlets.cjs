require('dotenv').config({ path: __dirname + '/.env', quiet: true });
const fs = require('fs');
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const secret = fs.readFileSync(__dirname + '/storage/jwt.key', 'utf8').trim();
const API = 'http://localhost:4300/v1';
const token = (id) => jwt.sign({ sub: id }, secret, { expiresIn: '10m', issuer: 'altamid-hrms', algorithm: 'HS256' });
async function call(user, path, { outlet, method = 'GET', body } = {}) {
  const headers = { authorization: 'Bearer ' + token(user.id), 'content-type': 'application/json' };
  if (outlet) headers['x-outlet'] = outlet;
  const res = await fetch(API + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}
const ok = (label, pass, extra = '') => console.log((pass ? 'PASS ' : 'FAIL ') + label + (extra ? '  ' + extra : ''));

(async () => {
  const owner = await prisma.user.findUnique({ where: { email: 'owner@northwind.test' } });
  const companyId = owner.companyId;
  const head = await prisma.outlet.findFirst({ where: { companyId }, orderBy: { createdAt: 'asc' } });
  let delhi = await prisma.outlet.findFirst({ where: { companyId, name: 'Delhi Office' } });
  if (!delhi) delhi = await prisma.outlet.create({ data: { companyId, name: 'Delhi Office', code: 'DEL', country: 'IN', state: 'Delhi' } });
  const us = await prisma.outlet.findFirst({ where: { companyId, name: 'US Office' } }) || await prisma.outlet.create({ data: { companyId, name: 'US Office', code: 'US', country: 'US', timezone: 'America/New_York', currency: 'USD' } });

  const people = await prisma.employee.findMany({ where: { companyId, status: 'active', outletId: head.id }, include: { user: true }, orderBy: { code: 'asc' } });
  const hrPerson = people.find((p) => p.user && p.user.role === 'hr' && p.user.id !== owner.id) || people.find((p) => p.user && p.user.id !== owner.id);
  const movers = [hrPerson, ...people.filter((p) => p.id !== hrPerson.id && p.id !== owner.employeeId).slice(0, 2)];
  await prisma.employee.updateMany({ where: { id: { in: movers.map((p) => p.id) } }, data: { outletId: delhi.id } });
  const hrUser = hrPerson.user;
  console.log('Delhi people', movers.map((p) => p.code), 'HR sign-in', hrUser.email, hrUser.role);

  const total = await prisma.employee.count({ where: { companyId } });
  const me = await call(owner, '/me');
  ok('master /me without header is "all"', me.status === 200 && me.json.outlets.current === null && me.json.outlets.list.length === 3, JSON.stringify(me.json?.outlets?.list?.map((o) => o.name)));
  const all = await call(owner, '/people', { outlet: 'all' });
  const inHead = await call(owner, '/people', { outlet: head.id });
  const inDelhi = await call(owner, '/people', { outlet: delhi.id });
  const count = (r) => (Array.isArray(r.json) ? r.json.length : r.json?.people?.length ?? r.json?.rows?.length);
  ok('master all sees every person', count(all) === total, `${count(all)} of ${total}`);
  ok('master in Delhi sees 3 (+ self)', count(inDelhi) === 3 || count(inDelhi) === 4, String(count(inDelhi)));
  ok('master in Head office sees the rest', count(inHead) === total - 3, String(count(inHead)));

  const hrMe = await call(hrUser, '/me', { outlet: head.id });
  ok('Delhi HR cannot pick Head office', hrMe.json?.outlets?.current === delhi.id && hrMe.json.outlets.list.length === 1, JSON.stringify(hrMe.json?.outlets));
  const hrPeople = await call(hrUser, '/people', { outlet: head.id });
  ok('Delhi HR sees only Delhi people', count(hrPeople) === 3, String(count(hrPeople)) + ' ' + hrPeople.status);
  const stranger = people.find((p) => !movers.includes(p) && p.id !== owner.employeeId);
  const peek = await call(hrUser, '/people/' + stranger.id);
  ok('Delhi HR cannot open a Head office person', peek.status === 404 || peek.status === 403, String(peek.status));

  const deptAll = await call(owner, '/departments', { outlet: 'all', method: 'POST', body: { name: 'Outlet test dept' } });
  ok('adding a department in "all" asks for an outlet', deptAll.status === 400, deptAll.status + ' ' + deptAll.json?.message);
  const deptDelhi = await call(owner, '/departments', { outlet: delhi.id, method: 'POST', body: { name: 'Outlet test dept' } });
  const made = await prisma.department.findFirst({ where: { companyId, name: 'Outlet test dept' } });
  ok('department added in Delhi is stamped Delhi', deptDelhi.status < 300 && made?.outletId === delhi.id, deptDelhi.status + ' ' + (deptDelhi.json?.message || ''));
  const deptHead = await call(owner, '/departments', { outlet: head.id, method: 'POST', body: { name: 'Outlet test dept' } });
  ok('the same name is allowed in another outlet', deptHead.status < 300, deptHead.status + ' ' + (deptHead.json?.message || ''));

  const month = new Date().toISOString().slice(0, 7);
  const payAll = await call(owner, '/payroll/month/' + month, { outlet: 'all' });
  ok('payroll in "all" asks for an outlet', payAll.status === 400, payAll.status + ' ' + payAll.json?.message);
  const payUs = await call(owner, '/payroll/month/' + month, { outlet: us.id });
  ok('payroll refused for the US outlet', payUs.status === 403, payUs.status + ' ' + payUs.json?.message);
  const payHead = await call(owner, '/payroll/month/' + month, { outlet: head.id });
  ok('payroll works in Head office', payHead.status === 200, String(payHead.status) + ' ' + (payHead.json?.message || ''));

  const add = await call(owner, '/outlets', { method: 'POST', body: { name: 'Bangalore Office', country: 'IN' } });
  ok('adding a 4th outlet is refused without subscriptions', add.status === 403, add.status + ' ' + add.json?.message);
  const list = await call(owner, '/outlets');
  ok('outlet list for master', list.status === 200 && list.json.outlets.length === 3, list.json?.outlets?.map((o) => `${o.name}:${o.people}`).join(', '));
  const hrList = await call(hrUser, '/outlets');
  ok('outlet settings refused for non-master', hrList.status === 403, String(hrList.status));
  const copy = await call(owner, `/outlets/${delhi.id}/copy`, { method: 'POST', body: { from: head.id, parts: ['leaveTypes', 'holidays'] } });
  ok('copy leave types and holidays', copy.status < 300, JSON.stringify(copy.json?.copied || copy.json?.message));
  const delhiTypes = await call(hrUser, '/leave/types');
  ok('Delhi HR sees copied leave types', Array.isArray(delhiTypes.json) ? delhiTypes.json.length > 0 : delhiTypes.status === 200, String(Array.isArray(delhiTypes.json) ? delhiTypes.json.length : JSON.stringify(delhiTypes.json).slice(0, 80)));

  if (process.argv[2] === 'restore') {
    await prisma.department.deleteMany({ where: { companyId, name: 'Outlet test dept' } });
    await prisma.leaveType.deleteMany({ where: { companyId, outletId: { in: [delhi.id, us.id] } } });
    await prisma.holiday.deleteMany({ where: { companyId, outletId: { in: [delhi.id, us.id] } } });
    await prisma.employee.updateMany({ where: { companyId, outletId: { in: [delhi.id, us.id] } }, data: { outletId: head.id } });
    await prisma.userOutlet.deleteMany({ where: { outletId: { in: [delhi.id, us.id] } } });
    await prisma.outlet.deleteMany({ where: { id: { in: [delhi.id, us.id] } } });
    await prisma.auditEvent.deleteMany({ where: { companyId, entity: 'outlet' } });
    console.log('restored');
  }
  await prisma.$disconnect();
})().catch(async (error) => { console.error(error); await prisma.$disconnect(); process.exit(1); });
