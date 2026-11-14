require('dotenv').config({ path: __dirname + '/.env', quiet: true });
const fs = require('fs');
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const secret = fs.readFileSync(__dirname + '/storage/jwt.key', 'utf8').trim();
const source = fs.readFileSync(__dirname + '/src/hrms.controller.ts', 'utf8');
const routes = [...source.matchAll(/@Get\('([^':]+)'\)/g)].map((m) => m[1]).filter((r) => !/file|export|csv|download|photo|icon|logo/.test(r));
const month = new Date().toISOString().slice(0, 7);
routes.push('payroll/month/' + month);
(async () => {
  const owner = await prisma.user.findUnique({ where: { email: 'owner@northwind.test' } });
  const delhi = await prisma.outlet.findFirst({ where: { companyId: owner.companyId, name: 'Delhi Office' } });
  const hr = await prisma.user.findUnique({ where: { email: 'smtpemailforms@gmail.com' } });
  const runs = [[owner, 'all'], [owner, delhi.id], [hr, '']];
  for (const [user, outlet] of runs) {
    const token = jwt.sign({ sub: user.id }, secret, { expiresIn: '10m', issuer: 'altamid-hrms', algorithm: 'HS256' });
    const bad = [];
    for (const route of routes) {
      const res = await fetch('http://localhost:4300/v1/' + route, { headers: { authorization: 'Bearer ' + token, ...(outlet ? { 'x-outlet': outlet } : {}) } });
      if (res.status >= 500) bad.push(route + ' ' + res.status + ' ' + (await res.text()).slice(0, 160));
    }
    console.log(user.email, outlet || '(none)', routes.length, 'routes,', bad.length, 'server errors');
    bad.forEach((line) => console.log('  ' + line));
  }
  await prisma.$disconnect();
})();
