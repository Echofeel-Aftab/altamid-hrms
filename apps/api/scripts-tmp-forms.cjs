require('dotenv').config({ path: __dirname + '/.env', quiet: true });
const fs = require('fs');
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const secret = fs.readFileSync(__dirname + '/storage/jwt.key', 'utf8').trim();
const API = 'http://localhost:4300/v1';
const token = (id) => jwt.sign({ sub: id }, secret, { expiresIn: '10m', issuer: 'altamid-hrms', algorithm: 'HS256' });
async function call(user, path, { outlet, method = 'GET', body, raw } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (user) headers.authorization = 'Bearer ' + token(user.id);
  if (outlet) headers['x-outlet'] = outlet;
  const res = await fetch(API + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  if (raw) return { status: res.status, type: res.headers.get('content-type'), size: (await res.arrayBuffer()).byteLength };
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}
const ok = (label, pass, extra = '') => console.log((pass ? 'PASS ' : 'FAIL ') + label + (extra ? '  ' + extra : ''));
const pdf = 'data:application/pdf;base64,' + Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF').toString('base64');
const fake = 'data:application/pdf;base64,' + Buffer.from('MZ not a pdf at all').toString('base64');

(async () => {
  const owner = await prisma.user.findUnique({ where: { email: 'owner@northwind.test' } });
  const head = await prisma.outlet.findFirst({ where: { companyId: owner.companyId }, orderBy: { createdAt: 'asc' } });
  const o = { outlet: head.id };
  const list = await call(owner, '/forms', o);
  ok('list returns forms and templates', list.status === 200 && Array.isArray(list.json.forms) && list.json.templates.length === 5, list.json?.templates?.map((t) => t.key).join(','));

  const made = await call(owner, '/forms', { ...o, method: 'POST', body: { name: 'Test walk-in ' + Date.now().toString(36), template: 'walkin' } });
  ok('create from walk-in template', made.status === 201 || made.status === 200, made.json?.slug + ' ' + made.json?.fields?.length + ' fields');
  const form = made.json;
  const fields = form.fields.concat([
    { key: 'cv', label: 'Resume', type: 'file', accept: ['pdf'], maxFiles: 2, required: true, map: 'resume' },
    { key: 'why', label: 'Why us?', type: 'question', answerMode: 'radio', options: ['Growth', 'Pay'], allowOther: true, required: true },
  ]);
  const saved = await call(owner, '/forms/' + form.id, { ...o, method: 'PATCH', body: { fields, status: 'published', slug: form.slug, settings: { redirectUrl: '', notify: 'hr@northwind.test', showLogo: true, aside: { custom: true, title: 'Join Northwind', steps: [] } } } });
  ok('save + publish with file field', saved.status === 200 && saved.json.status === 'published', saved.json?.message || '');
  const dupMap = await call(owner, '/forms/' + form.id, { ...o, method: 'PATCH', body: { fields: fields.concat([{ key: 'cv2', label: 'Another', type: 'file', map: 'resume' }]) } });
  ok('two fields mapped to resume refused', dupMap.status === 400, dupMap.json?.message);

  const view = await call(null, '/apply/' + form.slug);
  ok('public view', view.status === 200 && view.json.fields.length === fields.length && view.json.aside.title === 'Join Northwind', 'logo=' + view.json?.logo);
  const role = view.json.fields.find((f) => f.key === 'role');
  const job = role.options[0] || 'Typed job';

  const base = { name: 'Form Tester', email: 'form.tester@example.com', phone: '+91 98765 43210', role: job, fresher: 'No', lastcompany: 'Acme', referred: false, consent: true, why: '__other__' };
  const missingOther = await call(null, '/apply/' + form.slug, { method: 'POST', body: { answers: base, files: { cv: [{ name: 'cv.pdf', data: pdf }] } } });
  ok('Other without text refused', missingOther.status === 400, missingOther.json?.message);
  const badFile = await call(null, '/apply/' + form.slug, { method: 'POST', body: { answers: base, other: { why: 'Culture' }, files: { cv: [{ name: 'cv.pdf', data: fake }] } } });
  ok('fake PDF refused', badFile.status === 400, badFile.json?.message);
  const noFile = await call(null, '/apply/' + form.slug, { method: 'POST', body: { answers: base, other: { why: 'Culture' } } });
  ok('required file enforced', noFile.status === 400, noFile.json?.message);
  const big = 'data:application/pdf;base64,' + Buffer.concat([Buffer.from('%PDF-'), Buffer.alloc(3 * 1024 * 1024)]).toString('base64');
  const sent = await call(null, '/apply/' + form.slug, { method: 'POST', body: {
    answers: base, other: { why: 'Culture' }, files: { cv: [{ name: 'my cv.pdf', data: pdf }, { name: 'big.pdf', data: big }] },
    tracking: { utm_source: 'linkedin', utm_campaign: 'oct-drive', gclid: 'abc123', embed: 'form', landing_page: 'https://northwind.test/careers', bad: '<x>' },
  } });
  ok('submit with 2 files (one 3 MB) and tracking', sent.status === 201 || sent.status === 200, JSON.stringify(sent.json));

  const app = await prisma.jobApplication.findFirst({ where: { formId: form.id }, orderBy: { createdAt: 'desc' } });
  ok('application saved', !!app && app.email === 'form.tester@example.com' && app.source === 'linkedin', app && `${app.jobTitle} | ${app.answersJson}`);
  ok('lastcompany kept, referrer hidden', app && JSON.parse(app.answersJson).lastcompany === 'Acme' && !('referrer' in JSON.parse(app.answersJson)));
  const detail = await call(owner, '/hiring/applications/' + app.id, o);
  ok('detail has files and tracking', detail.status === 200 && detail.json.files.length === 2 && detail.json.tracking.length >= 3, JSON.stringify(detail.json?.tracking));
  const file = await call(owner, '/hiring/applications/' + app.id + '/files/' + detail.json.files[0].id, { ...o, raw: true });
  ok('file download', file.status === 200 && file.type.includes('pdf') && file.size > 10, file.type + ' ' + file.size);
  const anon = await call(null, '/hiring/applications/' + app.id + '/files/' + detail.json.files[0].id, { raw: true });
  ok('file needs sign-in', anon.status === 401);
  const subs = await call(owner, '/forms/' + form.id + '/submissions', o);
  ok('submissions list', subs.status === 200 && subs.json.rows[0].files === 2, subs.json?.rows?.[0]?.source);

  const trap = await call(null, '/apply/' + form.slug, { method: 'POST', body: { answers: base, website: 'spam.example' } });
  ok('honeypot silently accepted', trap.status < 300 && (await prisma.jobApplication.count({ where: { formId: form.id } })) === 1);

  const copy = await call(owner, '/forms/' + form.id + '/duplicate', { ...o, method: 'POST' });
  ok('duplicate', (copy.status === 201 || copy.status === 200) && copy.json.status === 'draft' && copy.json.fields.length === fields.length, copy.json?.slug);
  const draftView = await call(null, '/apply/' + copy.json.slug);
  ok('draft not public', draftView.status === 404);
  const del = await call(owner, '/forms/' + copy.json.id + '/delete', { ...o, method: 'POST' });
  ok('empty copy deleted', del.status < 300 && del.json.archived === false);
  const arch = await call(owner, '/forms/' + form.id + '/delete', { ...o, method: 'POST' });
  ok('form with application archived', arch.status < 300 && arch.json.archived === true, arch.json?.message);

  if (process.argv[2] === 'clean') {
    const dir = __dirname + '/storage/applications/' + owner.companyId + '/' + app.id;
    fs.rmSync(dir, { recursive: true, force: true });
    await prisma.applicationEvent?.deleteMany?.({ where: { applicationId: app.id } }).catch(() => {});
    await prisma.jobApplication.deleteMany({ where: { formId: form.id } });
    await prisma.auditEvent.deleteMany({ where: { entityId: { in: [form.id, copy.json.id] } } });
    await prisma.jobForm.delete({ where: { id: form.id } });
    console.log('cleaned');
  } else console.log('kept form', form.slug);
  await prisma.$disconnect();
})().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
