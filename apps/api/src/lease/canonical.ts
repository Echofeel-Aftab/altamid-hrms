/**
 * Canonical JSON for Altamid Control lease signatures.
 *
 * Every product, in every language, must produce these exact bytes before it
 * verifies a signature. Rules for contract version 1:
 * - UTF-8
 * - object keys sorted by UTF-16 code unit (the same order as ASCII byte order
 *   for the ASCII keys this contract uses)
 * - no whitespace
 * - strings encoded like JSON.stringify (no escaped solidus, unicode left as
 *   characters, control characters escaped)
 * - integers only, no floats
 * - arrays keep their order
 */
export function canonicalJson(value: unknown): string {
  return encode(value);
}

function encode(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) {
      throw new Error('Canonical JSON allows only safe integers.');
    }
    return String(value);
  }
  if (typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map((item) => encode(item)).join(',') + ']';
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return (
      '{' +
      keys
        .map((key) => {
          if (record[key] === undefined) {
            throw new Error('Canonical JSON does not allow undefined.');
          }
          return JSON.stringify(key) + ':' + encode(record[key]);
        })
        .join(',') +
      '}'
    );
  }
  throw new Error('Canonical JSON received a value it cannot encode.');
}
