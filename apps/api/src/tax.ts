/**
 * Indian income tax on salary, for an estimate. Rules as in the Finance Act 2025 (FY 2025-26 onwards).
 * All amounts are whole rupees.
 */

export interface TaxItem {
  key: string;
  section: string;
  label: string;
  hint: string;
  /** Shared limit, so 80C items count against one ₹1.5 lakh cap. */
  group?: string;
  cap?: number;
  /** Adds to income instead of reducing it. */
  income?: boolean;
  /** Tax already paid, used only for the monthly deduction. */
  paid?: boolean;
  /** Also allowed in the new regime. */
  both?: boolean;
  proof: boolean;
}

export const TAX_ITEMS: TaxItem[] = [
  { key: 'c_ppf', section: '80C', group: '80C', label: 'Public Provident Fund (PPF)', hint: 'Deposits made this year', proof: true },
  { key: 'c_elss', section: '80C', group: '80C', label: 'ELSS tax-saving mutual funds', hint: 'Statement or SIP confirmation', proof: true },
  { key: 'c_lic', section: '80C', group: '80C', label: 'Life insurance premium', hint: 'Premium receipt for you, your spouse or children', proof: true },
  { key: 'c_nsc', section: '80C', group: '80C', label: 'National Savings Certificate (NSC)', hint: 'Certificate copy', proof: true },
  { key: 'c_fd', section: '80C', group: '80C', label: '5-year tax saver fixed deposit', hint: 'Bank receipt', proof: true },
  { key: 'c_tuition', section: '80C', group: '80C', label: 'Children’s tuition fees', hint: 'Up to two children, tuition part only', proof: true },
  { key: 'c_principal', section: '80C', group: '80C', label: 'Home loan principal repaid', hint: 'Lender’s yearly certificate', proof: true },
  { key: 'c_ssy', section: '80C', group: '80C', label: 'Sukanya Samriddhi account', hint: 'Passbook or receipt', proof: true },
  { key: 'c_pf', section: '80C', group: '80C', label: 'Your PF contribution', hint: 'Employee share of PF and VPF from your slips', proof: false },
  { key: 'c_other', section: '80C', group: '80C', label: 'Other 80C', hint: 'Stamp duty on a home, ULIP and similar', proof: true },
  { key: 'nps_own', section: '80CCD(1B)', cap: 50_000, label: 'NPS, your own extra contribution', hint: 'Over and above 80C, up to ₹50,000', proof: true },
  { key: 'd_self', section: '80D', label: 'Health insurance: you, spouse and children', hint: 'Up to ₹25,000, or ₹50,000 if you are 60 or older. Check-ups up to ₹5,000 count here.', proof: true },
  { key: 'd_parents', section: '80D', label: 'Health insurance: parents', hint: 'Up to ₹25,000, or ₹50,000 if a parent is 60 or older', proof: true },
  { key: 'home_interest', section: '24(b)', cap: 200_000, label: 'Home loan interest, self-occupied', hint: 'Up to ₹2 lakh', proof: true },
  { key: 'edu_interest', section: '80E', label: 'Education loan interest', hint: 'No upper limit', proof: true },
  { key: 'donation', section: '80G', label: 'Donations, eligible amount', hint: 'Enter the amount the receipt allows: 50% or 100%', proof: true },
  { key: 'savings_interest', section: '80TTA', label: 'Savings account interest', hint: 'Up to ₹10,000, or ₹50,000 of all bank interest if you are 60 or older', proof: false },
  { key: 'disability', section: '80U / 80DD', cap: 125_000, label: 'Disability deduction', hint: '₹75,000, or ₹1.25 lakh for severe disability', proof: true },
  { key: 'prof_tax', section: '16(iii)', cap: 2_500, label: 'Professional tax', hint: 'Deducted from your salary by the state', proof: false },
  { key: 'lta', section: '10(5)', label: 'Leave travel claimed', hint: 'Travel tickets, within the LTA in your CTC', proof: true },
  { key: 'other_income', section: 'Income', income: true, both: true, label: 'Other income', hint: 'Interest, rent received, and similar', proof: false },
  { key: 'prev_income', section: 'Income', income: true, both: true, label: 'Salary from an earlier employer this year', hint: 'From their Form 12B or the last slip', proof: true },
  { key: 'prev_tds', section: 'Paid', paid: true, both: true, label: 'Tax already cut by an earlier employer', hint: 'TDS shown on their Form 12B', proof: true },
];

export interface TaxInput {
  gross: number;
  basic: number;
  hra: number;
  lta: number;
  age: number;
  values: Record<string, number>;
  rentAnnual: number;
  metro: boolean;
  parentsSenior: boolean;
  /** Flexible pay that is tax free under the old regime, with bills. */
  flexExempt: number;
}

export interface TaxLine { label: string; amount: number; note?: string }

export interface RegimeResult {
  regime: 'old' | 'new';
  income: number;
  exemptions: TaxLine[];
  standard: number;
  deductions: TaxLine[];
  taxable: number;
  slabTax: number;
  rebate: number;
  surcharge: number;
  cess: number;
  total: number;
  slabs: Array<{ from: number; to: number | null; rate: number; tax: number }>;
}

const NEW_SLABS: Array<[number, number]> = [[400_000, 0], [800_000, 5], [1_200_000, 10], [1_600_000, 15], [2_000_000, 20], [2_400_000, 25], [Infinity, 30]];

function oldSlabs(age: number): Array<[number, number]> {
  const floor = age >= 80 ? 500_000 : age >= 60 ? 300_000 : 250_000;
  return [[floor, 0], [500_000, 5], [1_000_000, 20], [Infinity, 30]].filter(([upto], index, all) => index === 0 || upto > all[0][0]) as Array<[number, number]>;
}

function slabTax(taxable: number, slabs: Array<[number, number]>) {
  let lower = 0;
  let tax = 0;
  const rows: RegimeResult['slabs'] = [];
  for (const [upper, rate] of slabs) {
    const part = Math.max(0, Math.min(taxable, upper) - lower);
    const owed = Math.round(part * rate / 100);
    rows.push({ from: lower, to: Number.isFinite(upper) ? upper : null, rate, tax: owed });
    tax += owed;
    lower = upper;
    if (taxable <= upper) break;
  }
  return { tax, rows };
}

/** Surcharge with marginal relief: tax plus surcharge never rises by more than the income above each step. */
function surchargeOf(taxable: number, tax: number, regime: 'old' | 'new', slabs: Array<[number, number]>): number {
  const steps: Array<[number, number]> = regime === 'new'
    ? [[5_000_000, 10], [10_000_000, 15], [20_000_000, 25]]
    : [[5_000_000, 10], [10_000_000, 15], [20_000_000, 25], [50_000_000, 37]];
  let rate = 0;
  let step = 0;
  for (const [limit, value] of steps) if (taxable > limit) { rate = value; step = limit; }
  if (!rate) return 0;
  const surcharge = Math.round(tax * rate / 100);
  const below = steps.filter(([limit]) => limit < step).pop();
  const atStep = slabTax(step, slabs).tax;
  const atStepTotal = atStep + Math.round(atStep * (below ? below[1] : 0) / 100);
  const relief = Math.max(0, tax + surcharge - (atStepTotal + (taxable - step)));
  return Math.max(0, surcharge - relief);
}

const clamp = (value: number) => Math.max(0, Math.round(Number.isFinite(value) ? value : 0));

export function computeTax(raw: TaxInput, regime: 'old' | 'new'): RegimeResult {
  const values = raw.values || {};
  const read = (key: string) => clamp(values[key] || 0);
  const extraIncome = TAX_ITEMS.filter((item) => item.income).reduce((sum, item) => sum + read(item.key), 0);
  const gross = clamp(raw.gross) + extraIncome;
  const exemptions: TaxLine[] = [];
  const deductions: TaxLine[] = [];
  let income = gross;

  if (regime === 'old') {
    const basic = clamp(raw.basic);
    const hra = clamp(raw.hra);
    const rent = clamp(raw.rentAnnual);
    if (hra && rent) {
      const exempt = clamp(Math.min(hra, rent - basic * 0.1, basic * (raw.metro ? 0.5 : 0.4)));
      if (exempt) exemptions.push({ label: 'House rent allowance (HRA)', amount: exempt, note: `Least of HRA, rent less 10% of basic, and ${raw.metro ? '50' : '40'}% of basic` });
    }
    const lta = Math.min(read('lta'), clamp(raw.lta) || read('lta'));
    if (lta) exemptions.push({ label: 'Leave travel', amount: lta });
    if (raw.flexExempt) exemptions.push({ label: 'Choice pay with bills', amount: clamp(raw.flexExempt) });
  }
  income -= exemptions.reduce((sum, line) => sum + line.amount, 0);
  const standard = Math.min(regime === 'new' ? 75_000 : 50_000, Math.max(0, income));
  income -= standard;

  if (regime === 'old') {
    const senior = raw.age >= 60;
    const c = Math.min(150_000, TAX_ITEMS.filter((item) => item.group === '80C').reduce((sum, item) => sum + read(item.key), 0));
    if (c) deductions.push({ label: '80C investments', amount: c, note: 'Up to ₹1.5 lakh' });
    const add = (key: string, label: string, cap: number) => {
      const amount = Math.min(cap, read(key));
      if (amount) deductions.push({ label, amount });
    };
    add('nps_own', 'NPS, 80CCD(1B)', 50_000);
    add('d_self', 'Health insurance, 80D', senior ? 50_000 : 25_000);
    add('d_parents', 'Parents’ health insurance, 80D', raw.parentsSenior ? 50_000 : 25_000);
    add('home_interest', 'Home loan interest, 24(b)', 200_000);
    add('edu_interest', 'Education loan interest, 80E', Infinity);
    add('donation', 'Donations, 80G', Infinity);
    add('savings_interest', senior ? 'Bank interest, 80TTB' : 'Savings interest, 80TTA', senior ? 50_000 : 10_000);
    add('disability', 'Disability, 80U / 80DD', 125_000);
    add('prof_tax', 'Professional tax', 2_500);
  }
  const deducted = Math.min(Math.max(0, income), deductions.reduce((sum, line) => sum + line.amount, 0));
  const taxable = clamp(Math.floor(Math.max(0, income - deducted) / 10) * 10);

  const slabs = regime === 'new' ? NEW_SLABS : oldSlabs(raw.age);
  const base = slabTax(taxable, slabs);
  let rebate = 0;
  if (regime === 'new') {
    if (taxable <= 1_200_000) rebate = Math.min(base.tax, 60_000);
    else rebate = Math.max(0, base.tax - (taxable - 1_200_000));
  } else if (taxable <= 500_000) {
    rebate = Math.min(base.tax, 12_500);
  }
  const afterRebate = Math.max(0, base.tax - rebate);
  const surcharge = surchargeOf(taxable, afterRebate, regime, slabs);
  const cess = Math.round((afterRebate + surcharge) * 0.04);
  return {
    regime,
    income: gross,
    exemptions,
    standard,
    deductions,
    taxable,
    slabTax: base.tax,
    rebate,
    surcharge,
    cess,
    total: afterRebate + surcharge + cess,
    slabs: base.rows,
  };
}

/** The financial year a day falls in, such as 2026-27. */
export function financialYear(day: string): string {
  const [year, month] = day.split('-').map(Number);
  const start = month >= 4 ? year : year - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

export function yearRange(fy: string): { start: string; end: string; months: string[] } {
  const first = Number(fy.slice(0, 4));
  const months: string[] = [];
  for (let index = 0; index < 12; index++) {
    const month = ((3 + index) % 12) + 1;
    const year = month >= 4 ? first : first + 1;
    months.push(`${year}-${String(month).padStart(2, '0')}`);
  }
  return { start: `${first}-04-01`, end: `${first + 1}-03-31`, months };
}

export function isYear(value: string): boolean {
  if (!/^\d{4}-\d{2}$/.test(value)) return false;
  return Number(value.slice(5)) === (Number(value.slice(0, 4)) + 1) % 100;
}
