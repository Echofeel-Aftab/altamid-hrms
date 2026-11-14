# Altamid HRMS & Payroll

A separate product from the website, the CRM, and Altamid Control. The browser talks to this API. The API is the only piece that checks in with Control, using product code `hrms-payroll`.

## What works in this release

Essentials, which is the promise already on the public product page:

- Company workspace, sign-in, and roles
- People, departments, designations, locations, and manager
- Web punch in and punch out
- Leave types, balances, requests, and approvals
- Announcements
- Encrypted PAN, bank account, and IFSC
- Altamid Control check-in. A restricted lease pauses new people and keeps existing records readable

Payroll calculation is intentionally not in this release. The Payroll screen shows the month path and a payslip layout. It does not invent PF, ESI, tax, or net pay.

## Run it locally

1. Start Docker, then from this folder run `npm run db`. Postgres listens on port 5433.
2. In `apps/api`, run `npx prisma db push` once, then `npm run start:dev`. The API listens on port 4300.
3. In `apps/web`, run `npm start`. Open `http://localhost:4400`.

The first page can create a company. You are the owner and employee `EMP001`.

`apps/api/.env` holds the local database URL. `apps/api/storage` holds the data key and the sign-in secret. Do not commit either, and do not delete the data key after real people exist.
