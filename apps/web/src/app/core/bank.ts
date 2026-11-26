/**
 * Bank name from the first four letters of an IFSC. A convenience only: the field stays editable and the
 * server still validates the IFSC itself. Unknown codes return an empty string, so nothing is guessed.
 */
const BANKS: Record<string, string> = {
  SBIN: 'State Bank of India', HDFC: 'HDFC Bank', ICIC: 'ICICI Bank', UTIB: 'Axis Bank', KKBK: 'Kotak Mahindra Bank',
  PUNB: 'Punjab National Bank', BARB: 'Bank of Baroda', CNRB: 'Canara Bank', UBIN: 'Union Bank of India', BKID: 'Bank of India',
  IDIB: 'Indian Bank', IOBA: 'Indian Overseas Bank', MAHB: 'Bank of Maharashtra', CBIN: 'Central Bank of India', UCBA: 'UCO Bank',
  PSIB: 'Punjab & Sind Bank', YESB: 'Yes Bank', INDB: 'IndusInd Bank', FDRL: 'Federal Bank', IDFB: 'IDFC First Bank',
  RATN: 'RBL Bank', KARB: 'Karnataka Bank', SIBL: 'South Indian Bank', CIUB: 'City Union Bank', TMBL: 'Tamilnad Mercantile Bank',
  KVBL: 'Karur Vysya Bank', DCBL: 'DCB Bank', JAKA: 'Jammu & Kashmir Bank', DLXB: 'Dhanlaxmi Bank', CSBK: 'CSB Bank',
  BDBL: 'Bandhan Bank', AUBL: 'AU Small Finance Bank', ESFB: 'Equitas Small Finance Bank', UJVN: 'Ujjivan Small Finance Bank',
  SURY: 'Suryoday Small Finance Bank', FINF: 'Fincare Small Finance Bank', JSFB: 'Jana Small Finance Bank',
  AIRP: 'Airtel Payments Bank', PYTM: 'Paytm Payments Bank', IPOS: 'India Post Payments Bank', FINO: 'Fino Payments Bank',
  SCBL: 'Standard Chartered Bank', HSBC: 'HSBC', CITI: 'Citibank', DBSS: 'DBS Bank India', DEUT: 'Deutsche Bank',
  NESF: 'North East Small Finance Bank', TJSB: 'TJSB Sahakari Bank', SRCB: 'Saraswat Co-operative Bank',
  COSB: 'Cosmos Co-operative Bank', ABHY: 'Abhyudaya Co-operative Bank', MSNU: 'Mehsana Urban Co-operative Bank',
  BACB: 'Bassein Catholic Co-operative Bank', NKGS: 'NKGSB Co-operative Bank', KCCB: 'Kalupur Commercial Co-operative Bank',
  APGB: 'Andhra Pragathi Grameena Bank', PUNJ: 'Punjab National Bank', ALLA: 'Indian Bank (formerly Allahabad Bank)',
  ANDB: 'Union Bank of India (formerly Andhra Bank)', CORP: 'Union Bank of India (formerly Corporation Bank)',
  SYNB: 'Canara Bank (formerly Syndicate Bank)', ORBC: 'Punjab National Bank (formerly Oriental Bank of Commerce)',
  UTBI: 'Punjab National Bank (formerly United Bank of India)', VIJB: 'Bank of Baroda (formerly Vijaya Bank)',
  DENA: 'Bank of Baroda (formerly Dena Bank)',
};

/** Uppercases and keeps only letters and digits, at most 11 characters, as typed into an IFSC box. */
export function cleanIfsc(value: string): string {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 11);
}

export function bankFromIfsc(value: string): string {
  const code = cleanIfsc(value);
  return code.length >= 4 ? BANKS[code.slice(0, 4)] || '' : '';
}
