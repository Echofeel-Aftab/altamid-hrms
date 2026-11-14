export interface FlexComponent {
  key: string;
  label: string;
  hint: string;
  /** Yearly limit in rupees. */
  cap: number;
  /** Tax free under the old regime when bills are given. */
  taxFree: boolean;
}

export interface FlexConfig {
  open: boolean;
  /** Words that find the flexible line in a person's CTC, such as "special allowance". */
  pool: string;
  note: string;
  components: FlexComponent[];
}

export const FLEX_DEFAULT: FlexConfig = {
  open: false,
  pool: 'flexi, flexible, special allowance',
  note: '',
  components: [
    { key: 'fuel', label: 'Car fuel and maintenance', hint: 'Own car used for work, with fuel bills', cap: 32_400, taxFree: true },
    { key: 'phone', label: 'Phone and internet', hint: 'Mobile and broadband bills', cap: 24_000, taxFree: true },
    { key: 'meal', label: 'Meal card', hint: 'Prepaid meal wallet', cap: 26_400, taxFree: true },
    { key: 'books', label: 'Books and periodicals', hint: 'Newspapers, journals and books', cap: 12_000, taxFree: true },
    { key: 'lta', label: 'Leave travel', hint: 'Travel tickets within India, two journeys in four years', cap: 60_000, taxFree: true },
    { key: 'uniform', label: 'Uniform', hint: 'Work clothing and its upkeep', cap: 12_000, taxFree: true },
    { key: 'gift', label: 'Gift vouchers', hint: 'Up to ₹5,000 a year is tax free', cap: 5_000, taxFree: true },
  ],
};

export function poolMatcher(config: FlexConfig): (name: string) => boolean {
  const words = config.pool.split(',').map((word) => word.trim().toLowerCase()).filter(Boolean);
  return (name: string) => words.some((word) => name.toLowerCase().includes(word));
}
