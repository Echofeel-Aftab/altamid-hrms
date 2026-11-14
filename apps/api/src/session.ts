export interface SessionUser {
  id: string;
  companyId: string;
  role: string;
  name: string;
  email: string;
  employeeId: string | null;
  /** The outlet this request works in, or null when a master views every outlet. */
  outletId?: string | null;
  /** Every outlet this sign-in may open. */
  outletIds?: string[];
  /** Sees and manages every outlet. */
  master?: boolean;
  /** Country code of the current outlet. Payroll runs only for India. */
  outletCountry?: string;
}
