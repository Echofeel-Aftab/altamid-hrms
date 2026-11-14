import { createHmac, randomBytes } from 'crypto';
import { fail, optional } from './http';

export const INTEGRATION_KEYS = ['whatsapp', 'sms', 'biometric', 'bank', 'accounting', 'webhook', 'api'] as const;
export type IntegrationKey = (typeof INTEGRATION_KEYS)[number];

export interface FieldDef {
  key: string;
  label: string;
  kind: 'text' | 'secret' | 'url' | 'select';
  required?: boolean;
  placeholder?: string;
  hint?: string;
  pattern?: string;
  patternMessage?: string;
  options?: Array<{ value: string; label: string }>;
  value?: string;
  max?: number;
  upper?: boolean;
  showIf?: { field: string; equals: string[] };
}

export interface ProviderDef {
  id: string;
  label: string;
  region: string;
  check: 'live' | 'format';
  checkNote: string;
  setup: string[];
  fields: FieldDef[];
  prefix?: string;
}

export interface StoredConfig {
  fields: Record<string, string>;
  secrets: Record<string, string>;
}

export const MULTI_ACCOUNT_KEYS = ['whatsapp', 'sms', 'webhook'] as const;
export type MultiAccountIntegrationKey = (typeof MULTI_ACCOUNT_KEYS)[number];

export function isMultiAccountKey(key: IntegrationKey): boolean {
  return (MULTI_ACCOUNT_KEYS as readonly string[]).includes(key);
}

export interface StoredIntegrationAccount {
  id: string;
  label: string;
  provider: string;
  enabled: boolean;
  isDefault: boolean;
  purpose: string;
  configs: Record<string, StoredConfig>;
}

export interface StoredIntegration {
  enabled: boolean;
  provider: string;
  configs: Record<string, StoredConfig>;
  accounts?: StoredIntegrationAccount[];
  defaultAccountId?: string;
}

export interface TestContext {
  bank: { name: string; ifsc: string; hasAccount: boolean };
  readers: Array<{ name: string; active: boolean; lastSeenAt: Date | null }>;
}

type Values = Record<string, string>;

const E164 = '^\\+[1-9][0-9]{6,14}$';
const DLT_ENTITY = '^[0-9]{19}$';
const SENDER_IN = '^[A-Z]{6}$';
const HTTPS = '^https://[^\\s]+$';
const HTTP_ANY = '^https?://[^\\s]+$';

const dlt = (required = true): FieldDef => ({
  key: 'dltEntityId',
  label: 'DLT principal entity id',
  kind: 'text',
  required,
  placeholder: '1201159xxxxxxxxxxxx',
  pattern: DLT_ENTITY,
  patternMessage: 'The DLT principal entity id is the 19-digit number from your DLT portal (Jio, Airtel, Vodafone Idea or BSNL).',
  hint: 'TRAI requires every business SMS in India to carry it.',
});

const senderIn = (label = 'Sender id (header)'): FieldDef => ({
  key: 'senderId',
  label,
  kind: 'text',
  required: true,
  placeholder: 'ALTMID',
  pattern: SENDER_IN,
  patternMessage: 'An Indian SMS sender id is exactly 6 capital letters and must be approved on DLT.',
  upper: true,
  max: 6,
});

const e164 = (key: string, label: string, required = true): FieldDef => ({
  key,
  label,
  kind: 'text',
  required,
  placeholder: '+919876543210',
  pattern: E164,
  patternMessage: `${label} must be in international format with the country code, such as +919876543210.`,
});

const SMS: ProviderDef[] = [
  {
    id: 'msg91',
    label: 'MSG91',
    region: 'India',
    check: 'live',
    checkNote: 'Asks MSG91 to validate the auth key. Nothing is sent.',
    setup: ['In MSG91, open Authkey and copy the key.', 'Use the sender id and DLT entity id approved for your company.', 'Create a Flow for each message and note its id.'],
    fields: [
      { key: 'authKey', label: 'Auth key', kind: 'secret', required: true, pattern: '^[A-Za-z0-9]{20,40}$', patternMessage: 'An MSG91 auth key is 20 to 40 letters and digits.' },
      senderIn(),
      dlt(),
      { key: 'flowId', label: 'Flow (template) id', kind: 'text', placeholder: '64f0c2…', hint: 'Optional. The approved Flow used for alerts.', max: 40 },
    ],
  },
  {
    id: 'twilio',
    label: 'Twilio',
    region: 'Global',
    check: 'live',
    checkNote: 'Reads the Twilio account with the SID and token, and confirms it is active. Nothing is sent.',
    setup: ['Copy the Account SID and Auth Token from the Twilio Console home page.', 'Use a Twilio number, or a Messaging Service SID, as the sender.', 'For India, register the sender and templates on DLT through Twilio.'],
    fields: [
      { key: 'accountSid', label: 'Account SID', kind: 'text', required: true, placeholder: 'AC…', pattern: '^AC[0-9a-fA-F]{32}$', patternMessage: 'A Twilio Account SID starts with AC followed by 32 letters and digits.' },
      { key: 'authToken', label: 'Auth token', kind: 'secret', required: true, pattern: '^[0-9a-fA-F]{32}$', patternMessage: 'A Twilio auth token is 32 letters and digits.' },
      { key: 'senderType', label: 'Send from', kind: 'select', value: 'number', options: [{ value: 'number', label: 'A Twilio phone number' }, { value: 'service', label: 'A Messaging Service' }] },
      { ...e164('fromNumber', 'From number'), showIf: { field: 'senderType', equals: ['number'] } },
      { key: 'serviceSid', label: 'Messaging Service SID', kind: 'text', required: true, placeholder: 'MG…', pattern: '^MG[0-9a-fA-F]{32}$', patternMessage: 'A Messaging Service SID starts with MG followed by 32 letters and digits.', showIf: { field: 'senderType', equals: ['service'] } },
    ],
  },
  {
    id: 'fast2sms',
    label: 'Fast2SMS',
    region: 'India',
    check: 'live',
    checkNote: 'Reads the Fast2SMS wallet balance with the API key. Nothing is sent.',
    setup: ['In Fast2SMS, open Dev API and copy the authorization key.', 'For the DLT route, add the sender id and entity id.'],
    fields: [
      { key: 'apiKey', label: 'Authorization key', kind: 'secret', required: true, pattern: '^[A-Za-z0-9]{30,120}$', patternMessage: 'That does not look like a Fast2SMS authorization key.' },
      { key: 'route', label: 'Route', kind: 'select', value: 'dlt', options: [{ value: 'dlt', label: 'DLT (your own templates)' }, { value: 'q', label: 'Quick SMS' }] },
      { ...senderIn(), showIf: { field: 'route', equals: ['dlt'] } },
      { ...dlt(), showIf: { field: 'route', equals: ['dlt'] } },
    ],
  },
  {
    id: 'exotel',
    label: 'Exotel',
    region: 'India and Southeast Asia',
    check: 'live',
    checkNote: 'Reads the Exotel account with the API key and token. Nothing is sent.',
    setup: ['In Exotel, open API Settings and copy the Account SID, API key and API token.', 'Pick the region your account was opened in.'],
    fields: [
      { key: 'accountSid', label: 'Account SID', kind: 'text', required: true, pattern: '^[A-Za-z0-9_-]{3,60}$', patternMessage: 'The Exotel Account SID is letters, digits, dashes or underscores.' },
      { key: 'apiKey', label: 'API key', kind: 'text', required: true, max: 80 },
      { key: 'apiToken', label: 'API token', kind: 'secret', required: true },
      { key: 'subdomain', label: 'Region', kind: 'select', value: 'api.in.exotel.com', options: [{ value: 'api.in.exotel.com', label: 'Mumbai (api.in.exotel.com)' }, { value: 'api.exotel.com', label: 'Singapore (api.exotel.com)' }] },
      senderIn(),
      dlt(),
    ],
  },
  {
    id: 'kaleyra',
    label: 'Kaleyra',
    region: 'India and global',
    check: 'format',
    checkNote: 'Kaleyra has no read-only check, so only the format of the saved details is checked.',
    setup: ['In Kaleyra, open Developers → API keys and copy the SID and API key.'],
    fields: [
      { key: 'sid', label: 'SID', kind: 'text', required: true, pattern: '^[A-Za-z0-9]{10,40}$', patternMessage: 'The Kaleyra SID is 10 to 40 letters and digits.' },
      { key: 'apiKey', label: 'API key', kind: 'secret', required: true },
      senderIn(),
      dlt(),
    ],
  },
  {
    id: 'gupshup',
    label: 'Gupshup Enterprise SMS',
    region: 'India',
    check: 'format',
    checkNote: 'Gupshup SMS has no read-only check, so only the format of the saved details is checked.',
    setup: ['Use the enterprise user id and password Gupshup gave you.'],
    fields: [
      { key: 'userId', label: 'User id', kind: 'text', required: true, pattern: '^[0-9]{6,14}$', patternMessage: 'The Gupshup user id is 6 to 14 digits.' },
      { key: 'password', label: 'Password', kind: 'secret', required: true },
      senderIn('Mask (sender id)'),
      dlt(),
    ],
  },
  {
    id: 'vonage',
    label: 'Vonage (Nexmo)',
    region: 'Global',
    check: 'live',
    checkNote: 'Reads the Vonage account balance with the key and secret. Nothing is sent.',
    setup: ['Copy the API key and API secret from the Vonage API dashboard.'],
    fields: [
      { key: 'apiKey', label: 'API key', kind: 'text', required: true, pattern: '^[0-9a-fA-F]{8}$', patternMessage: 'A Vonage API key is 8 letters and digits.' },
      { key: 'apiSecret', label: 'API secret', kind: 'secret', required: true, pattern: '^[A-Za-z0-9]{16}$', patternMessage: 'A Vonage API secret is 16 letters and digits.' },
      { key: 'from', label: 'From (number or name)', kind: 'text', required: true, max: 15 },
    ],
  },
  {
    id: 'plivo',
    label: 'Plivo',
    region: 'Global',
    check: 'live',
    checkNote: 'Reads the Plivo account with the Auth ID and token. Nothing is sent.',
    setup: ['Copy the Auth ID and Auth Token from the Plivo console overview.'],
    fields: [
      { key: 'authId', label: 'Auth ID', kind: 'text', required: true, pattern: '^(MA|SA)[A-Z0-9]{18}$', patternMessage: 'A Plivo Auth ID starts with MA or SA followed by 18 capital letters and digits.', upper: true },
      { key: 'authToken', label: 'Auth token', kind: 'secret', required: true, pattern: '^[A-Za-z0-9]{40}$', patternMessage: 'A Plivo auth token is 40 letters and digits.' },
      e164('from', 'From number'),
    ],
  },
  {
    id: 'sns',
    label: 'Amazon SNS',
    region: 'Global',
    check: 'format',
    checkNote: 'Amazon needs signed requests, so only the format of the saved keys is checked here.',
    setup: ['Create an IAM user with only sns:Publish, and copy its access key.', 'For India, register the sender id and templates on DLT.'],
    fields: [
      { key: 'accessKeyId', label: 'Access key id', kind: 'text', required: true, pattern: '^(AKIA|ASIA)[A-Z0-9]{16}$', patternMessage: 'An AWS access key id starts with AKIA or ASIA followed by 16 capital letters and digits.', upper: true },
      { key: 'secretKey', label: 'Secret access key', kind: 'secret', required: true, pattern: '^[A-Za-z0-9/+=]{40}$', patternMessage: 'An AWS secret access key is 40 characters.' },
      { key: 'region', label: 'Region', kind: 'select', value: 'ap-south-1', options: [{ value: 'ap-south-1', label: 'Mumbai (ap-south-1)' }, { value: 'ap-southeast-1', label: 'Singapore (ap-southeast-1)' }, { value: 'us-east-1', label: 'N. Virginia (us-east-1)' }, { value: 'eu-west-1', label: 'Ireland (eu-west-1)' }] },
      { ...senderIn(), required: false },
      dlt(false),
    ],
  },
];

const WHATSAPP: ProviderDef[] = [
  {
    id: 'meta',
    label: 'Meta WhatsApp Cloud API',
    region: 'Global',
    check: 'live',
    checkNote: 'Reads the phone number from Meta with the token and shows its name and quality. Nothing is sent.',
    setup: ['In Meta Business Settings, create a system user and a permanent token with whatsapp_business_messaging.', 'Copy the Phone number ID and WhatsApp Business Account ID from WhatsApp Manager → API Setup.'],
    fields: [
      { key: 'phoneNumberId', label: 'Phone number ID', kind: 'text', required: true, pattern: '^[0-9]{10,20}$', patternMessage: 'The Phone number ID is 10 to 20 digits. It is not the phone number itself.' },
      { key: 'wabaId', label: 'WhatsApp Business Account ID', kind: 'text', pattern: '^[0-9]{10,20}$', patternMessage: 'The WhatsApp Business Account ID is 10 to 20 digits.', hint: 'Optional. Needed later to sync templates.' },
      { key: 'accessToken', label: 'Permanent access token', kind: 'secret', required: true, pattern: '^EA[A-Za-z0-9]{50,}$', patternMessage: 'A Meta access token starts with EA and is long. Copy the whole token.' },
    ],
  },
  {
    id: 'twilio',
    label: 'Twilio WhatsApp',
    region: 'Global',
    check: 'live',
    checkNote: 'Reads the Twilio account with the SID and token. Nothing is sent.',
    setup: ['Copy the Account SID and Auth Token from the Twilio Console.', 'Use the WhatsApp sender approved in Twilio.'],
    fields: [
      { key: 'accountSid', label: 'Account SID', kind: 'text', required: true, placeholder: 'AC…', pattern: '^AC[0-9a-fA-F]{32}$', patternMessage: 'A Twilio Account SID starts with AC followed by 32 letters and digits.' },
      { key: 'authToken', label: 'Auth token', kind: 'secret', required: true, pattern: '^[0-9a-fA-F]{32}$', patternMessage: 'A Twilio auth token is 32 letters and digits.' },
      e164('fromNumber', 'WhatsApp sender number'),
    ],
  },
  {
    id: 'gupshup',
    label: 'Gupshup',
    region: 'India',
    check: 'format',
    checkNote: 'Gupshup has no read-only check, so only the format of the saved details is checked.',
    setup: ['In the Gupshup dashboard, open your WhatsApp app and copy the app name and API key.'],
    fields: [
      { key: 'appName', label: 'App name', kind: 'text', required: true, max: 60 },
      { key: 'apiKey', label: 'API key', kind: 'secret', required: true, pattern: '^[A-Za-z0-9]{20,64}$', patternMessage: 'A Gupshup API key is 20 to 64 letters and digits.' },
      e164('source', 'Source number'),
    ],
  },
  {
    id: 'aisensy',
    label: 'AiSensy',
    region: 'India',
    check: 'format',
    checkNote: 'AiSensy has no read-only check, so only the format of the saved details is checked.',
    setup: ['In AiSensy, open Manage → API Key and copy it.', 'Create an API campaign for each alert and note its name.'],
    fields: [
      { key: 'apiKey', label: 'API key', kind: 'secret', required: true, pattern: '^[A-Za-z0-9._-]{20,}$', patternMessage: 'That does not look like an AiSensy API key.' },
      { key: 'campaign', label: 'API campaign name', kind: 'text', required: true, max: 80 },
    ],
  },
  {
    id: 'interakt',
    label: 'Interakt',
    region: 'India',
    check: 'format',
    checkNote: 'Interakt has no read-only check, so only the format of the saved key is checked.',
    setup: ['In Interakt, open Settings → Developer Setting and copy the Secret Key.'],
    fields: [{ key: 'apiKey', label: 'Secret key', kind: 'secret', required: true, pattern: '^[A-Za-z0-9=+/_-]{20,}$', patternMessage: 'That does not look like an Interakt secret key.' }],
  },
  {
    id: 'wati',
    label: 'WATI',
    region: 'Global',
    check: 'live',
    checkNote: 'Reads one contact from WATI with the token. Nothing is sent.',
    setup: ['In WATI, open API Docs and copy the API endpoint and access token.'],
    fields: [
      { key: 'endpoint', label: 'API endpoint', kind: 'url', required: true, placeholder: 'https://live-mt-server.wati.io/123456', pattern: '^https://[a-z0-9.-]*wati\\.io/[0-9]+/?$', patternMessage: 'The WATI endpoint looks like https://live-mt-server.wati.io/123456.' },
      { key: 'accessToken', label: 'Access token', kind: 'secret', required: true, hint: 'Paste it with or without the word Bearer.' },
    ],
  },
  {
    id: 'dialog360',
    label: '360dialog',
    region: 'Global',
    check: 'live',
    checkNote: 'Reads the webhook setting from 360dialog with the key. Nothing is sent.',
    setup: ['In the 360dialog hub, generate an API key for the number.'],
    fields: [{ key: 'apiKey', label: 'API key', kind: 'secret', required: true, pattern: '^[A-Za-z0-9_-]{20,}$', patternMessage: 'That does not look like a 360dialog API key.' }],
  },
  {
    id: 'msg91',
    label: 'MSG91 WhatsApp',
    region: 'India',
    check: 'live',
    checkNote: 'Checks the MSG91 auth key against the account. Nothing is sent.',
    setup: ['In MSG91, open Authkey and copy it.', 'Use the WhatsApp number integrated in MSG91.'],
    fields: [
      { key: 'authKey', label: 'Auth key', kind: 'secret', required: true, pattern: '^[A-Za-z0-9]{20,40}$', patternMessage: 'An MSG91 auth key is 20 to 40 letters and digits.' },
      e164('number', 'Integrated number'),
    ],
  },
];

const BIO_MODE: FieldDef = {
  key: 'mode',
  label: 'How punches reach Altamid',
  kind: 'select',
  value: 'push',
  options: [
    { value: 'push', label: 'Readers send each punch to Altamid (recommended)' },
    { value: 'server', label: 'Vendor attendance software on our server' },
  ],
};

const bioServer = (placeholder: string, userLabel = 'Username'): FieldDef[] => [
  { key: 'serverUrl', label: 'Software address', kind: 'url', required: true, placeholder, pattern: HTTP_ANY, patternMessage: 'The address must start with http:// or https://.', showIf: { field: 'mode', equals: ['server'] } },
  { key: 'username', label: userLabel, kind: 'text', max: 80, showIf: { field: 'mode', equals: ['server'] } },
  { key: 'password', label: 'Password or API key', kind: 'secret', showIf: { field: 'mode', equals: ['server'] } },
];

const bio = (id: string, label: string, placeholder: string, extra: string[] = []): ProviderDef => ({
  id,
  label,
  region: 'India and global',
  check: 'live',
  checkNote: 'Push mode lists the readers added under Attendance and when each last sent a punch. Server mode checks that this server can reach the address.',
  setup: [
    'Push mode: add each reader under Attendance → Readers and paste its address and token into the reader’s cloud or ADMS settings.',
    'Server mode: enter the address of the vendor software. This server must be able to reach it.',
    ...extra,
    'The reader keeps the fingerprint, face or card. Altamid stores only the punch time.',
  ],
  fields: [BIO_MODE, ...bioServer(placeholder)],
});

const BIOMETRIC: ProviderDef[] = [
  bio('essl', 'eSSL (eTimeTrackLite)', 'http://192.168.1.20:85'),
  bio('zkteco', 'ZKTeco (ZKBio, ADMS push)', 'http://192.168.1.20:8098'),
  bio('realtime', 'Realtime Biometrics', 'http://192.168.1.20'),
  bio('matrix', 'Matrix COSEC', 'https://cosec.example.com'),
  bio('mantra', 'Mantra', 'http://192.168.1.20'),
  bio('biomax', 'BioMax', 'http://192.168.1.20'),
  bio('hikvision', 'Hikvision', 'http://192.168.1.64', ['Hikvision readers use digest sign-in; use an operator account, not admin.']),
  {
    ...bio('suprema', 'Suprema BioStar 2', 'https://biostar.example.com'),
    checkNote: 'Push mode lists the readers added under Attendance. Server mode signs in to BioStar 2 with the login id and password.',
    fields: [BIO_MODE, ...bioServer('https://biostar.example.com', 'Login id')],
  },
  bio('other', 'Other reader', 'http://192.168.1.20'),
];

const bank = (id: string, label: string, prefix: string, codeLabel: string): ProviderDef => ({
  id,
  label,
  prefix,
  region: 'India',
  check: 'live',
  checkNote: 'Checks that the company account under General is saved and its IFSC belongs to this bank. No money moves.',
  setup: ['Save the company salary account and IFSC under General → Company bank.', `Get the ${codeLabel.toLowerCase()} from your bank’s corporate banking team.`, 'Upload the file in corporate net banking under bulk or salary payments.'],
  fields: [
    { key: 'clientCode', label: codeLabel, kind: 'text', max: 30, hint: 'Optional. Added to every row when your bank asks for it.' },
    {
      key: 'mode',
      label: 'Payment mode',
      kind: 'select',
      value: 'auto',
      options: [
        { value: 'auto', label: 'Automatic: same bank transfer, NEFT, or RTGS from ₹2 lakh' },
        { value: 'NEFT', label: 'NEFT for every row' },
        { value: 'IMPS', label: 'IMPS for every row (up to ₹5 lakh)' },
        { value: 'RTGS', label: 'RTGS for every row (₹2 lakh and above)' },
      ],
    },
    { key: 'narration', label: 'Narration', kind: 'text', value: 'Salary {month}', max: 30, hint: '{month} becomes the month, such as Nov 2026. Banks cut narration at 30 characters.' },
  ],
});

const BANK: ProviderDef[] = [
  bank('hdfc', 'HDFC Bank', 'HDFC', 'Client code (ENet)'),
  bank('icici', 'ICICI Bank', 'ICIC', 'Corporate id (CIB)'),
  bank('sbi', 'State Bank of India', 'SBIN', 'Corporate id (CINB / CMP)'),
  bank('axis', 'Axis Bank', 'UTIB', 'Corporate id'),
  bank('kotak', 'Kotak Mahindra Bank', 'KKBK', 'Client code (CMS)'),
  bank('yes', 'Yes Bank', 'YESB', 'Corporate id'),
  bank('idfc', 'IDFC FIRST Bank', 'IDFB', 'Corporate id'),
  bank('indusind', 'IndusInd Bank', 'INDB', 'Corporate id'),
  bank('rbl', 'RBL Bank', 'RATN', 'Corporate id'),
  bank('federal', 'Federal Bank', 'FDRL', 'Corporate id'),
  bank('bob', 'Bank of Baroda', 'BARB', 'Corporate id'),
  bank('pnb', 'Punjab National Bank', 'PUNB', 'Corporate id'),
  bank('canara', 'Canara Bank', 'CNRB', 'Corporate id'),
  bank('union', 'Union Bank of India', 'UBIN', 'Corporate id'),
  { ...bank('other', 'Another bank', '', 'Corporate or client code'), checkNote: 'Checks that the company account and IFSC under General are saved. No money moves.' },
];

const tallyFields: FieldDef[] = [
  { key: 'address', label: 'Tally server address', kind: 'url', required: true, value: 'http://localhost:9000', pattern: HTTP_ANY, patternMessage: 'The Tally address must start with http://, such as http://192.168.1.15:9000.', hint: 'The computer running Tally, with the port set in Tally (9000 by default).' },
  { key: 'company', label: 'Company name in Tally', kind: 'text', required: true, max: 120, hint: 'Exactly as it appears in Tally.' },
  { key: 'expenseLedger', label: 'Salary expense ledger', kind: 'text', value: 'Salaries', max: 80 },
  { key: 'payableLedger', label: 'Salary payable ledger', kind: 'text', value: 'Salary Payable', max: 80 },
];

const oauthFields = (idLabel: string, idPattern: string, idMessage: string): FieldDef[] => [
  { key: 'orgId', label: idLabel, kind: 'text', required: true, pattern: idPattern, patternMessage: idMessage },
  { key: 'clientId', label: 'Client id', kind: 'text', required: true, max: 120 },
  { key: 'clientSecret', label: 'Client secret', kind: 'secret', required: true },
  { key: 'refreshToken', label: 'Refresh token', kind: 'secret', required: true },
];

const ACCOUNTING: ProviderDef[] = [
  {
    id: 'tally',
    label: 'TallyPrime',
    region: 'India',
    check: 'live',
    checkNote: 'Calls the Tally server address and confirms TallyPrime answers. Nothing is posted.',
    setup: ['In TallyPrime, press F1 → Settings → Connectivity, set “TallyPrime acts as” to Server and note the port.', 'This HRMS server must be able to reach that computer on that port.'],
    fields: tallyFields,
  },
  {
    id: 'tally9',
    label: 'Tally.ERP 9',
    region: 'India',
    check: 'live',
    checkNote: 'Calls the Tally server address and confirms Tally.ERP 9 answers. Nothing is posted.',
    setup: ['In Tally.ERP 9, press F12 → Advanced Configuration, set “Tally.ERP 9 is acting as” to Server and note the port.'],
    fields: tallyFields,
  },
  {
    id: 'zoho',
    label: 'Zoho Books',
    region: 'India and global',
    check: 'live',
    checkNote: 'Gets a fresh token from Zoho and confirms the organisation id belongs to it. Nothing is posted.',
    setup: ['In the Zoho API console, create a Self Client and copy the client id and secret.', 'Generate a code with scope ZohoBooks.fullaccess.all and exchange it for a refresh token.', 'Pick the data centre where your Zoho account lives.'],
    fields: [
      { key: 'dc', label: 'Data centre', kind: 'select', value: 'in', options: [{ value: 'in', label: 'India (zoho.in)' }, { value: 'com', label: 'United States (zoho.com)' }, { value: 'eu', label: 'Europe (zoho.eu)' }, { value: 'com.au', label: 'Australia (zoho.com.au)' }, { value: 'jp', label: 'Japan (zoho.jp)' }, { value: 'ca', label: 'Canada (zohocloud.ca)' }, { value: 'sa', label: 'Saudi Arabia (zoho.sa)' }] },
      ...oauthFields('Organisation id', '^[0-9]{6,15}$', 'The Zoho Books organisation id is 6 to 15 digits, shown under Settings → Organisation Profile.'),
    ],
  },
  {
    id: 'quickbooks',
    label: 'QuickBooks Online',
    region: 'Global',
    check: 'format',
    checkNote: 'QuickBooks replaces the refresh token on every use, so it is not used for a test. Only the format of the saved details is checked.',
    setup: ['Create an app in the Intuit developer portal and connect your company.', 'Copy the Realm (company) id, client id, secret and refresh token.'],
    fields: [
      { key: 'environment', label: 'Environment', kind: 'select', value: 'production', options: [{ value: 'production', label: 'Production' }, { value: 'sandbox', label: 'Sandbox' }] },
      ...oauthFields('Realm (company) id', '^[0-9]{6,20}$', 'The QuickBooks Realm id is 6 to 20 digits.'),
    ],
  },
  {
    id: 'xero',
    label: 'Xero',
    region: 'Global',
    check: 'format',
    checkNote: 'Xero replaces the refresh token on every use, so it is not used for a test. Only the format of the saved details is checked.',
    setup: ['Create an app in the Xero developer portal and connect your organisation.', 'Copy the tenant id, client id, secret and refresh token.'],
    fields: oauthFields('Tenant id', '^[0-9a-fA-F-]{36}$', 'The Xero tenant id is a 36-character id such as 3f2b…-…'),
  },
  {
    id: 'busy',
    label: 'Busy Accounting',
    region: 'India',
    check: 'format',
    checkNote: 'Busy is used through a file import, so only the saved ledger names are checked.',
    setup: ['Note the company and ledger names exactly as they appear in Busy.'],
    fields: [
      { key: 'company', label: 'Company name in Busy', kind: 'text', required: true, max: 120 },
      { key: 'expenseLedger', label: 'Salary expense ledger', kind: 'text', value: 'Salaries', max: 80 },
      { key: 'payableLedger', label: 'Salary payable ledger', kind: 'text', value: 'Salary Payable', max: 80 },
    ],
  },
];

const hook = (id: string, label: string, pattern: string, patternMessage: string, placeholder: string, setup: string[]): ProviderDef => ({
  id,
  label,
  region: 'Global',
  check: 'live',
  checkNote: 'Posts one short test message to the channel and shows the reply.',
  setup,
  fields: [{ key: 'url', label: 'Webhook URL', kind: 'url', required: true, placeholder, pattern, patternMessage }],
});

const WEBHOOK: ProviderDef[] = [
  hook('slack', 'Slack', '^https://hooks\\.slack\\.com/(services|workflows|triggers)/[^\\s]+$', 'A Slack webhook starts with https://hooks.slack.com/services/.', 'https://hooks.slack.com/services/…', ['In Slack, add the Incoming Webhooks app to a channel, or create a workflow that starts from a webhook.', 'Copy the webhook URL.']),
  hook('teams', 'Microsoft Teams', '^https://[a-z0-9.-]+\\.(logic\\.azure\\.com|powerplatform\\.com|webhook\\.office\\.com)(:443)?/[^\\s]+$', 'A Teams webhook comes from the Workflows app (logic.azure.com or powerplatform.com) or an older connector (webhook.office.com).', 'https://….logic.azure.com/workflows/…', ['In Teams, open the channel → Workflows → “Post to a channel when a webhook request is received”.', 'Copy the URL the workflow gives you.']),
  hook('gchat', 'Google Chat', '^https://chat\\.googleapis\\.com/v1/spaces/[^\\s]+$', 'A Google Chat webhook starts with https://chat.googleapis.com/v1/spaces/.', 'https://chat.googleapis.com/v1/spaces/…', ['In Google Chat, open the space → Apps & integrations → Webhooks, add one and copy the URL.']),
  hook('discord', 'Discord', '^https://(discord|discordapp)\\.com/api/webhooks/[0-9]+/[^\\s]+$', 'A Discord webhook starts with https://discord.com/api/webhooks/.', 'https://discord.com/api/webhooks/…', ['In Discord, open the channel settings → Integrations → Webhooks, create one and copy the URL.']),
  {
    ...hook('generic', 'Any HTTPS endpoint', HTTPS, 'The address must start with https://.', 'https://example.com/hooks/hrms', ['Give an https address that accepts a JSON POST.', 'Add a signing secret to receive an X-Altamid-Signature header (sha256 HMAC of the body).']),
    fields: [
      { key: 'url', label: 'Endpoint URL', kind: 'url', required: true, placeholder: 'https://example.com/hooks/hrms', pattern: HTTPS, patternMessage: 'The address must start with https://.' },
      { key: 'secret', label: 'Signing secret', kind: 'secret', hint: 'Optional. Used to sign each request.', pattern: '^.{16,200}$', patternMessage: 'Use a signing secret of at least 16 characters.' },
    ],
  },
];

const API: ProviderDef[] = [
  { id: 'altamid', label: 'Altamid API key', region: 'Global', check: 'live', checkNote: 'Confirms a key exists for this company.', setup: ['Generate a key. It is shown once, so copy it straight away.', 'A new key replaces the previous one at once.'], fields: [] },
];

export const CATALOG: Record<IntegrationKey, ProviderDef[]> = {
  whatsapp: WHATSAPP,
  sms: SMS,
  biometric: BIOMETRIC,
  bank: BANK,
  accounting: ACCOUNTING,
  webhook: WEBHOOK,
  api: API,
};

const DEFAULT_PROVIDER: Record<IntegrationKey, string> = {
  whatsapp: 'meta',
  sms: 'msg91',
  biometric: 'essl',
  bank: 'other',
  accounting: 'tally',
  webhook: 'slack',
  api: 'altamid',
};

export function providerOf(key: IntegrationKey, id: string): ProviderDef {
  return CATALOG[key].find((item) => item.id === id) || CATALOG[key].find((item) => item.id === DEFAULT_PROVIDER[key])!;
}

export function blankIntegration(key: IntegrationKey): StoredIntegration {
  const base: StoredIntegration = { enabled: false, provider: DEFAULT_PROVIDER[key], configs: {} };
  if (isMultiAccountKey(key)) {
    base.accounts = [];
    base.defaultAccountId = '';
  }
  return base;
}

const LEGACY_ACCOUNT_ID = '0000000000000001';

function clipText(value: unknown, max: number, fallback = ''): string {
  const text = typeof value === 'string' ? value.trim() : String(value ?? '').trim();
  return (text || fallback).slice(0, max);
}

function copyConfigs(configs: Record<string, StoredConfig>): Record<string, StoredConfig> {
  const out: Record<string, StoredConfig> = {};
  for (const [id, config] of Object.entries(configs)) {
    out[id] = { fields: { ...config.fields }, secrets: { ...config.secrets } };
  }
  return out;
}

export function accountToRow(account: StoredIntegrationAccount): StoredIntegration {
  return { enabled: account.enabled, provider: account.provider, configs: copyConfigs(account.configs) };
}

function readAccountRow(key: IntegrationKey, raw: Record<string, unknown>): StoredIntegrationAccount {
  const providerId = String(raw.provider || '').toLowerCase();
  const known = CATALOG[key].some((item) => item.id === providerId);
  const provider = known ? providerId : DEFAULT_PROVIDER[key];
  const configs: Record<string, StoredConfig> = {};
  for (const [id, config] of Object.entries(record(raw.configs))) {
    if (!CATALOG[key].some((item) => item.id === id)) continue;
    const item = record(config);
    configs[id] = { fields: strings(item.fields, 300), secrets: strings(item.secrets, 1200) };
  }
  return {
    id: /^[a-f0-9]{16}$/.test(String(raw.id || '')) ? String(raw.id) : randomBytes(8).toString('hex'),
    label: clipText(raw.label, 60, providerOf(key, provider).label),
    provider,
    enabled: raw.enabled === true,
    isDefault: raw.isDefault === true,
    purpose: clipText(raw.purpose, 40),
    configs,
  };
}

/** Keeps flat enabled/provider/configs aligned with the default account for older code paths. */
export function syncLegacyFromAccounts(key: IntegrationKey, row: StoredIntegration): void {
  if (!isMultiAccountKey(key)) return;
  const picked = pickIntegrationAccount(key, row);
  if (picked) {
    row.enabled = picked.enabled;
    row.provider = picked.provider;
    row.configs = copyConfigs(picked.configs);
  } else {
    row.enabled = false;
    row.provider = DEFAULT_PROVIDER[key];
    row.configs = {};
  }
}

export function hydrateMultiAccounts(key: IntegrationKey, row: StoredIntegration): void {
  if (!isMultiAccountKey(key)) return;
  if (Array.isArray(row.accounts) && row.accounts.length) {
    row.accounts = row.accounts.map((item) => (item && item.id ? item : readAccountRow(key, item as unknown as Record<string, unknown>)));
    if (!row.accounts.some((item) => item.isDefault)) {
      const first = row.accounts.find((item) => item.enabled) || row.accounts[0];
      if (first) first.isDefault = true;
    }
    row.defaultAccountId = row.accounts.find((item) => item.isDefault)?.id || row.accounts[0]?.id || '';
    syncLegacyFromAccounts(key, row);
    return;
  }
  const hasLegacy = row.enabled || Object.keys(row.configs).length > 0;
  if (!hasLegacy) {
    row.accounts = [];
    row.defaultAccountId = '';
    return;
  }
  const label = providerOf(key, row.provider).label;
  row.accounts = [
    {
      id: LEGACY_ACCOUNT_ID,
      label,
      provider: row.provider,
      enabled: row.enabled,
      isDefault: true,
      purpose: '',
      configs: copyConfigs(row.configs),
    },
  ];
  row.defaultAccountId = LEGACY_ACCOUNT_ID;
}

export function pickIntegrationAccount(key: IntegrationKey, row: StoredIntegration, purpose?: string): StoredIntegrationAccount | null {
  if (!isMultiAccountKey(key)) return null;
  hydrateMultiAccounts(key, row);
  const accounts = row.accounts || [];
  const purposeKey = purpose ? purpose.trim().toLowerCase() : '';
  const ready = (item: StoredIntegrationAccount) => item.enabled && !missingFields(key, accountToRow(item)).length;
  if (purposeKey) {
    const match = accounts.find((item) => item.enabled && item.purpose.toLowerCase() === purposeKey && ready(item));
    if (match) return match;
  }
  const byId = row.defaultAccountId ? accounts.find((item) => item.id === row.defaultAccountId && ready(item)) : undefined;
  if (byId) return byId;
  return accounts.find((item) => item.isDefault && ready(item)) || accounts.find(ready) || accounts.find((item) => item.isDefault) || accounts[0] || null;
}

export function removeIntegrationAccount(key: IntegrationKey, row: StoredIntegration, id: string): void {
  if (!isMultiAccountKey(key)) fail(400, 'This integration does not use multiple accounts.');
  hydrateMultiAccounts(key, row);
  const current = row.accounts?.find((item) => item.id === id);
  if (!current) fail(404, 'That connection was not found.');
  row.accounts = (row.accounts || []).filter((item) => item.id !== id);
  if (row.defaultAccountId === id) {
    const next = row.accounts.find((item) => item.enabled) || row.accounts[0];
    row.defaultAccountId = next?.id || '';
    if (next) next.isDefault = true;
  }
  syncLegacyFromAccounts(key, row);
}

export function setDefaultIntegrationAccount(key: IntegrationKey, row: StoredIntegration, id: string): void {
  if (!isMultiAccountKey(key)) fail(400, 'This integration does not use multiple accounts.');
  hydrateMultiAccounts(key, row);
  if (!row.accounts?.some((item) => item.id === id)) fail(404, 'That connection was not found.');
  for (const item of row.accounts!) item.isDefault = item.id === id;
  row.defaultAccountId = id;
  syncLegacyFromAccounts(key, row);
}

export function upsertIntegrationAccount(
  key: IntegrationKey,
  row: StoredIntegration,
  input: Record<string, unknown>,
  sealValue: (plain: string) => string,
): string {
  if (!isMultiAccountKey(key)) fail(400, 'This integration does not use multiple accounts.');
  hydrateMultiAccounts(key, row);
  let id = optional(input.id, 32);
  if (!id) id = randomBytes(8).toString('hex');
  const existing = row.accounts?.find((item) => item.id === id);
  const slice = existing ? accountToRow(existing) : blankIntegration(key);
  saveIntegration(key, slice, input, sealValue);
  const label = clipText(input.label, 60, providerOf(key, slice.provider).label);
  const duplicate = row.accounts?.find((item) => item.id !== id && item.label.toLowerCase() === label.toLowerCase());
  if (duplicate) fail(400, 'Another connection is already called ' + duplicate.label + '. Use a different label.');
  const wantDefault = input.isDefault === true || (!existing && !(row.accounts || []).some((item) => item.isDefault));
  const account: StoredIntegrationAccount = {
    id,
    label,
    provider: slice.provider,
    enabled: slice.enabled,
    isDefault: wantDefault,
    purpose: clipText(input.purpose, 40),
    configs: copyConfigs(slice.configs),
  };
  if (account.isDefault) for (const item of row.accounts || []) item.isDefault = false;
  const next = (row.accounts || []).filter((item) => item.id !== id);
  next.push(account);
  row.accounts = next.sort((a, b) => a.label.localeCompare(b.label));
  row.defaultAccountId = account.isDefault ? id : row.defaultAccountId || (row.accounts.find((item) => item.isDefault)?.id ?? '');
  if (!row.accounts.some((item) => item.isDefault) && row.accounts[0]) {
    row.accounts[0].isDefault = true;
    row.defaultAccountId = row.accounts[0].id;
  }
  if (row.accounts.length > 12) fail(400, 'Twelve connections is the limit for this channel.');
  syncLegacyFromAccounts(key, row);
  return id;
}

function accountReady(key: IntegrationKey, account: StoredIntegrationAccount): boolean {
  return account.enabled && !missingFields(key, accountToRow(account)).length;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function strings(value: unknown, max: number): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, item] of Object.entries(record(value))) {
    if (/^[a-zA-Z][a-zA-Z0-9]{0,30}$/.test(name) && typeof item === 'string') out[name] = item.slice(0, max);
  }
  return out;
}

/** Reads a stored row, including the older flat shape (sender, endpoint, orgId, url, format, secretEnc). */
export function readIntegration(key: IntegrationKey, raw: unknown): StoredIntegration {
  const row = record(raw);
  const base = blankIntegration(key);
  if (!Object.keys(row).length) return base;
  base.enabled = row.enabled === true;
  const legacyProvider = key === 'bank' ? '' : String(row.provider || '').toLowerCase();
  const known = CATALOG[key].some((item) => item.id === legacyProvider);
  base.provider = known ? legacyProvider : base.provider;
  for (const [id, config] of Object.entries(record(row.configs))) {
    if (!CATALOG[key].some((item) => item.id === id)) continue;
    const item = record(config);
    base.configs[id] = { fields: strings(item.fields, 300), secrets: strings(item.secrets, 1200) };
  }
  if (!row.configs) {
    const config: StoredConfig = { fields: {}, secrets: {} };
    const provider = providerOf(key, base.provider);
    const first = (kind: FieldDef['kind'], names: string[]) => provider.fields.find((field) => field.kind === kind && (!names.length || names.includes(field.key)));
    const sender = String(row.sender || '');
    if (sender) {
      const target = first('text', ['senderId', 'phoneNumberId', 'fromNumber']);
      if (target) config.fields[target.key] = sender;
    }
    const orgId = String(row.orgId || '');
    if (orgId && provider.fields.some((field) => field.key === 'orgId')) config.fields.orgId = orgId;
    const endpoint = String(row.endpoint || '');
    if (endpoint && provider.fields.some((field) => field.key === 'serverUrl')) {
      config.fields.serverUrl = endpoint;
      config.fields.mode = 'server';
    }
    const url = String(row.url || '');
    if (url && key === 'webhook') config.fields.url = url;
    const secret = String(row.secretEnc || '');
    if (secret) {
      const target = key === 'api' ? { key: 'key' } : first('secret', []);
      if (target) config.secrets[target.key] = secret;
    }
    if (Object.keys(config.fields).length || Object.keys(config.secrets).length) base.configs[base.provider] = config;
  }
  if (isMultiAccountKey(key)) {
    const rawAccounts = row.accounts;
    if (Array.isArray(rawAccounts) && rawAccounts.length) {
      base.accounts = rawAccounts.filter((item) => item && typeof item === 'object').map((item) => readAccountRow(key, item as Record<string, unknown>));
      base.defaultAccountId = clipText(row.defaultAccountId, 32);
    }
    hydrateMultiAccounts(key, base);
  }
  return base;
}

export function visibleFields(provider: ProviderDef, values: Values): FieldDef[] {
  return provider.fields.filter((field) => !field.showIf || field.showIf.equals.includes(valueOf(provider, field.showIf.field, values)));
}

function valueOf(provider: ProviderDef, key: string, values: Values): string {
  const field = provider.fields.find((item) => item.key === key);
  return values[key] || field?.value || '';
}

function plainValues(provider: ProviderDef, config: StoredConfig | undefined): Values {
  const values: Values = {};
  for (const field of provider.fields) {
    if (field.kind === 'secret') continue;
    values[field.key] = config?.fields[field.key] ?? field.value ?? '';
  }
  return values;
}

/** Validates and stores one connection. The browser value is never trusted. */
export function saveIntegration(key: IntegrationKey, row: StoredIntegration, input: Record<string, unknown>, sealValue: (plain: string) => string): void {
  const providerId = String(input.provider || row.provider || DEFAULT_PROVIDER[key]);
  const provider = CATALOG[key].find((item) => item.id === providerId);
  if (!provider) fail(400, 'Choose a provider from the list.');
  const enabled = input.enabled === true;
  const sentFields = record(input.fields);
  const sentSecrets = record(input.secrets);
  const current = row.configs[provider.id] || { fields: {}, secrets: {} };
  const next: StoredConfig = { fields: {}, secrets: { ...current.secrets } };
  for (const field of provider.fields) {
    if (field.kind === 'secret') continue;
    let value = String(sentFields[field.key] ?? current.fields[field.key] ?? field.value ?? '').trim();
    if (field.upper) value = value.toUpperCase();
    if (field.kind === 'select' && value && !field.options?.some((option) => option.value === value)) fail(400, `Choose a ${field.label} from the list.`);
    if (value.length > (field.max || 300)) fail(400, `${field.label} can be at most ${field.max || 300} characters.`);
    next.fields[field.key] = value;
  }
  for (const field of provider.fields) {
    if (field.kind !== 'secret') continue;
    const sent = String(sentSecrets[field.key] ?? '').trim().replace(/^Bearer\s+/i, '');
    if (sent.length > 1000) fail(400, `${field.label} is too long. Copy only the key.`);
    if (sent) {
      if (field.pattern && !new RegExp(field.pattern).test(sent)) fail(400, field.patternMessage || `${field.label} is not in the expected format.`);
      next.secrets[field.key] = sealValue(sent);
    }
  }
  const shown = visibleFields(provider, next.fields);
  for (const field of shown) {
    if (field.kind === 'secret') {
      if (enabled && field.required && !next.secrets[field.key]) fail(400, `Add the ${field.label} for ${provider.label} before switching this connection on.`);
      continue;
    }
    const value = next.fields[field.key];
    if (!value) {
      if (enabled && field.required) fail(400, `Add the ${field.label} for ${provider.label} before switching this connection on.`);
      continue;
    }
    if (field.pattern && !new RegExp(field.pattern).test(value)) fail(400, field.patternMessage || `${field.label} is not in the expected format.`);
  }
  row.enabled = enabled;
  row.provider = provider.id;
  row.configs[provider.id] = next;
}

export function missingFields(key: IntegrationKey, row: StoredIntegration): string[] {
  const provider = providerOf(key, row.provider);
  const config = row.configs[provider.id];
  if (key === 'api') return config?.secrets.key ? [] : ['an API key'];
  const values = plainValues(provider, config);
  return visibleFields(provider, values)
    .filter((field) => field.required && !(field.kind === 'secret' ? config?.secrets[field.key] : values[field.key]))
    .map((field) => field.label);
}

export function integrationReady(key: IntegrationKey, row: StoredIntegration): boolean {
  if (isMultiAccountKey(key)) {
    hydrateMultiAccounts(key, row);
    return (row.accounts || []).some((item) => accountReady(key, item));
  }
  return row.enabled && !missingFields(key, row).length;
}

export function presentIntegration(key: IntegrationKey, row: StoredIntegration, mask: (sealed: string) => string) {
  const configs: Record<string, { fields: Values; secrets: Record<string, string> }> = {};
  for (const provider of CATALOG[key]) {
    const config = row.configs[provider.id];
    const secrets: Record<string, string> = {};
    for (const field of provider.fields) if (field.kind === 'secret' && config?.secrets[field.key]) secrets[field.key] = mask(config.secrets[field.key]);
    configs[provider.id] = { fields: plainValues(provider, config), secrets };
  }
  const provider = providerOf(key, row.provider);
  const apiKey = row.configs.altamid?.secrets.key;
  return {
    enabled: row.enabled,
    provider: provider.id,
    providerLabel: provider.label,
    configs,
    hasSecret: key === 'api' ? Boolean(apiKey) : Object.keys(configs[provider.id]?.secrets || {}).length > 0,
    secretMask: key === 'api' && apiKey ? mask(apiKey) : '',
    missing: missingFields(key, row),
  };
}

export function presentIntegrationAccounts(
  key: IntegrationKey,
  row: StoredIntegration,
  mask: (sealed: string) => string,
  tests: Partial<Record<string, { ok: boolean; message: string; at: string }>>,
) {
  hydrateMultiAccounts(key, row);
  return (row.accounts || []).map((account) => {
    const slice = accountToRow(account);
    const shown = presentIntegration(key, slice, mask);
    const ready = accountReady(key, account);
    return {
      id: account.id,
      label: account.label,
      provider: shown.provider,
      providerLabel: shown.providerLabel,
      enabled: account.enabled,
      isDefault: account.isDefault,
      purpose: account.purpose,
      configs: shown.configs,
      hasSecret: shown.hasSecret,
      secretMask: shown.secretMask,
      missing: shown.missing,
      status: ready ? 'on' : 'off',
      statusLabel: ready ? 'Ready' : account.enabled ? 'Details missing' : 'Off',
      lastTest: tests[`${key}:${account.id}`] || null,
    };
  });
}

export function bankOptions(row: StoredIntegration) {
  const provider = providerOf('bank', row.provider);
  const values = plainValues(provider, row.configs[provider.id]);
  return { bank: provider.label, prefix: provider.prefix || '', clientCode: values.clientCode || '', mode: values.mode || 'auto', narration: values.narration || 'Salary {month}' };
}

class TestFailure extends Error {}

const ok = (message: string) => ({ ok: true, message });
const no = (message: string): never => {
  throw new TestFailure(message);
};

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function isPrivate(host: string): boolean {
  const name = host.replace(/:\d+$/, '');
  return name === 'localhost' || /^127\./.test(name) || /^10\./.test(name) || /^192\.168\./.test(name) || /^172\.(1[6-9]|2\d|3[01])\./.test(name);
}

function networkMessage(error: unknown, url: string): string {
  const host = hostOf(url);
  const cause = (error as { cause?: { code?: string; message?: string } })?.cause;
  const code = cause?.code || (error as { code?: string })?.code || '';
  const name = (error as { name?: string })?.name || '';
  const local = /^(localhost|127\.)/.test(host);
  const lan = local ? ' localhost means this HRMS server itself. Use the network address of the computer running the software, such as http://192.168.1.15:9000.' : isPrivate(host) ? ' This is a private network address, so it only works if this HRMS server is on the same network.' : '';
  if (name === 'TimeoutError' || name === 'AbortError' || /TIMEDOUT|CONNECT_TIMEOUT/.test(code)) return `No reply from ${host} within 10 seconds.${lan || ' The service may be down or blocked by a firewall.'}`;
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return `${host} could not be found. Check the spelling of the address${isPrivate(host) ? '' : ', and that this server can reach the internet'}.`;
  if (code === 'ECONNREFUSED') return `${host} refused the connection. Check the port, and that the service is running and accepting connections.${lan}`;
  if (code === 'ECONNRESET') return `${host} closed the connection before replying. Check that the address uses the right http or https.`;
  if (code === 'EHOSTUNREACH' || code === 'ENETUNREACH') return `This server has no network route to ${host}.${lan}`;
  if (/CERT|SELF_SIGNED|UNABLE_TO_VERIFY|ERR_TLS/.test(code)) return `The security certificate of ${host} is not trusted (${code}). Use a valid certificate, or http:// on a private network.`;
  const detail = cause?.message || (error instanceof Error ? error.message : '');
  return `Could not reach ${host}${detail ? ': ' + detail : '.'}`;
}

async function call(url: string, init: RequestInit = {}): Promise<{ status: number; body: string; json: Record<string, unknown> | null }> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, redirect: 'manual', signal: AbortSignal.timeout(10000) });
  } catch (error) {
    no(networkMessage(error, url));
    throw error;
  }
  const body = (await response.text().catch(() => '')).slice(0, 4000);
  let json: Record<string, unknown> | null = null;
  try {
    const parsed = JSON.parse(body);
    json = parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    json = null;
  }
  return { status: response.status, body, json };
}

function snippet(body: string): string {
  const clean = body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return clean ? '“' + clean.slice(0, 160) + (clean.length > 160 ? '…' : '') + '”' : 'an empty reply';
}

function statusMessage(name: string, status: number, body: string): string {
  if (status === 401 || status === 403) return `${name} rejected the credentials (status ${status}). Copy them again from ${name}; check for spaces or a missing character.`;
  if (status === 404) return `${name} could not find that account or address (status 404). Check the ids.`;
  if (status === 429) return `${name} is limiting requests right now (status 429). Wait a minute and test again.`;
  if (status >= 500) return `${name} is having trouble (status ${status}). This is on ${name}’s side; try again later.`;
  if (status >= 300 && status < 400) return `${name} redirected the request (status ${status}). Check the address is the API address, not a login page.`;
  return `${name} replied with status ${status}: ${snippet(body)}.`;
}

const basic = (user: string, pass: string) => 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
const enc = encodeURIComponent;

async function twilioAccount(values: Values, label: string) {
  const sid = values.accountSid;
  const reply = await call(`https://api.twilio.com/2010-04-01/Accounts/${enc(sid)}.json`, { headers: { authorization: basic(sid, values.authToken) } });
  if (reply.status === 401) no('Twilio did not accept the Account SID and Auth Token. Copy both again from the Twilio Console home page.');
  if (reply.status === 404) no('Twilio has no account with that Account SID.');
  if (reply.status !== 200) no(statusMessage('Twilio', reply.status, reply.body));
  const status = String(reply.json?.status || '');
  if (status && status !== 'active') no(`The Twilio account is ${status}. Twilio will not send ${label} until it is active.`);
  return ok(`Twilio accepted the credentials for “${reply.json?.friendly_name || sid}”. The account is active.`);
}

async function msg91(values: Values) {
  const reply = await call(`https://control.msg91.com/api/validate.php?authkey=${enc(values.authKey)}`);
  const text = reply.body.trim();
  if (reply.status === 200 && /\bvalid\b/i.test(text) && !/invalid/i.test(text)) return ok('MSG91 confirmed the auth key is valid.');
  if (/^(201|207)$/.test(text) || /auth|invalid/i.test(text) || reply.status === 401) no('MSG91 did not accept the auth key. Copy it again from MSG91 → Authkey, and check the key is not limited to other IP addresses.');
  if (reply.status !== 200) no(statusMessage('MSG91', reply.status, reply.body));
  return no(`MSG91 replied ${snippet(reply.body)}, which does not confirm the key. Check it in MSG91 → Authkey.`);
}

const LIVE: Record<string, (values: Values, context: TestContext) => Promise<{ ok: boolean; message: string }>> = {
  'sms:msg91': msg91,
  'whatsapp:msg91': msg91,
  'sms:twilio': (values) => twilioAccount(values, 'SMS'),
  'whatsapp:twilio': (values) => twilioAccount(values, 'WhatsApp messages'),
  'sms:fast2sms': async (values) => {
    const reply = await call('https://www.fast2sms.com/dev/wallet', { headers: { authorization: values.apiKey } });
    if (reply.json?.return === true) return ok(`Fast2SMS accepted the key. Wallet balance: ₹${reply.json.wallet}.`);
    if (reply.json?.message) no(`Fast2SMS did not accept the key: ${reply.json.message}.`);
    return no(statusMessage('Fast2SMS', reply.status, reply.body));
  },
  'sms:exotel': async (values) => {
    const reply = await call(`https://${values.subdomain || 'api.in.exotel.com'}/v1/Accounts/${enc(values.accountSid)}.json`, { headers: { authorization: basic(values.apiKey, values.apiToken) } });
    if (reply.status === 200) return ok('Exotel accepted the API key and token for this account.');
    if (reply.status === 401 || reply.status === 403) no('Exotel did not accept the API key and token for that Account SID. Also check the region: Mumbai and Singapore accounts use different addresses.');
    return no(statusMessage('Exotel', reply.status, reply.body));
  },
  'sms:vonage': async (values) => {
    const reply = await call(`https://rest.nexmo.com/account/get-balance?api_key=${enc(values.apiKey)}&api_secret=${enc(values.apiSecret)}`);
    if (reply.status === 200 && reply.json?.value !== undefined) return ok(`Vonage accepted the key. Balance: €${Number(reply.json.value).toFixed(2)}.`);
    if (reply.status === 401) no('Vonage did not accept the API key and secret.');
    return no(statusMessage('Vonage', reply.status, reply.body));
  },
  'sms:plivo': async (values) => {
    const reply = await call(`https://api.plivo.com/v1/Account/${enc(values.authId)}/`, { headers: { authorization: basic(values.authId, values.authToken) } });
    if (reply.status === 200) return ok(`Plivo accepted the credentials for “${reply.json?.name || values.authId}”.`);
    if (reply.status === 401) no('Plivo did not accept the Auth ID and Auth Token.');
    return no(statusMessage('Plivo', reply.status, reply.body));
  },
  'whatsapp:meta': async (values) => {
    const reply = await call(`https://graph.facebook.com/v21.0/${enc(values.phoneNumberId)}?fields=display_phone_number,verified_name,quality_rating`, { headers: { authorization: `Bearer ${values.accessToken}` } });
    if (reply.status === 200) {
      const json = reply.json || {};
      return ok(`Meta accepted the token. Sender ${json.display_phone_number || values.phoneNumberId}${json.verified_name ? ' (' + json.verified_name + ')' : ''}${json.quality_rating ? ', quality ' + String(json.quality_rating).toLowerCase() : ''}.`);
    }
    const error = (reply.json?.error || {}) as { code?: number; error_subcode?: number; message?: string };
    if (error.code === 190) no('Meta says the access token is invalid or has expired. Create a permanent token for a system user in Meta Business Settings.');
    if (error.code === 100) no('Meta has no phone number with that Phone number ID that this token can see. Copy the ID from WhatsApp Manager → API Setup, and give the system user access to the WhatsApp account.');
    if (error.code === 10 || error.code === 200) no('The token is missing a permission. Give it whatsapp_business_messaging and whatsapp_business_management.');
    if (error.message) no(`Meta replied: ${error.message}`);
    return no(statusMessage('Meta', reply.status, reply.body));
  },
  'whatsapp:wati': async (values) => {
    const base = values.endpoint.replace(/\/+$/, '');
    const reply = await call(`${base}/api/v1/getContacts?pageSize=1&pageNumber=1`, { headers: { authorization: `Bearer ${values.accessToken}` } });
    if (reply.status === 200) return ok('WATI accepted the access token for this endpoint.');
    if (reply.status === 401 || reply.status === 403) no('WATI did not accept the access token. Copy it again from WATI → API Docs.');
    if (reply.status === 404) no('WATI did not recognise that endpoint. Copy the API endpoint, including the number at the end.');
    return no(statusMessage('WATI', reply.status, reply.body));
  },
  'whatsapp:dialog360': async (values) => {
    const reply = await call('https://waba-v2.360dialog.io/v1/configs/webhook', { headers: { 'D360-API-KEY': values.apiKey } });
    if (reply.status === 200) return ok('360dialog accepted the API key.');
    if (reply.status === 401 || reply.status === 403) no('360dialog did not accept the API key. Generate a new key in the 360dialog hub.');
    return no(statusMessage('360dialog', reply.status, reply.body));
  },
  'accounting:tally': (values) => tally(values, 'TallyPrime'),
  'accounting:tally9': (values) => tally(values, 'Tally.ERP 9'),
  'accounting:zoho': async (values) => {
    const dc = values.dc || 'in';
    const accounts = dc === 'ca' ? 'https://accounts.zohocloud.ca' : `https://accounts.zoho.${dc}`;
    const api = dc === 'ca' ? 'https://www.zohoapis.ca' : `https://www.zohoapis.${dc}`;
    const token = await call(`${accounts}/oauth/v2/token?${new URLSearchParams({ refresh_token: values.refreshToken, client_id: values.clientId, client_secret: values.clientSecret, grant_type: 'refresh_token' })}`, { method: 'POST' });
    const error = String(token.json?.error || '');
    const region = ({ in: 'India', com: 'United States', eu: 'Europe', 'com.au': 'Australia', jp: 'Japan', ca: 'Canada', sa: 'Saudi Arabia' } as Record<string, string>)[dc] || dc;
    if (error === 'invalid_client') no(`Zoho did not accept the client id and secret in the ${region} data centre. Check both, and that your Zoho account lives in this data centre.`);
    if (error === 'invalid_code') no('Zoho says the refresh token is invalid or was revoked. Generate a new one with scope ZohoBooks.fullaccess.all.');
    if (error) no(`Zoho refused the token request: ${error}.`);
    const access = String(token.json?.access_token || '');
    if (!access) no(statusMessage('Zoho', token.status, token.body));
    const orgs = await call(`${api}/books/v3/organizations`, { headers: { authorization: `Zoho-oauthtoken ${access}` } });
    if (orgs.status !== 200) no(orgs.json?.message ? `Zoho Books replied: ${orgs.json.message}` : statusMessage('Zoho Books', orgs.status, orgs.body));
    const list = (orgs.json?.organizations as Array<{ organization_id: string; name: string }> | undefined) || [];
    const match = list.find((item) => String(item.organization_id) === values.orgId);
    if (!match) no(`The token works, but organisation ${values.orgId} is not in this Zoho account. Found: ${list.map((item) => `${item.name} (${item.organization_id})`).join(', ') || 'none'}.`);
    return ok(`Connected to “${match!.name}” in Zoho Books.`);
  },
  'webhook:slack': (values) => post(values.url, 'Slack', { text: TEST_TEXT }),
  'webhook:teams': (values) => post(values.url, 'Microsoft Teams', { type: 'message', attachments: [{ contentType: 'application/vnd.microsoft.card.adaptive', content: { type: 'AdaptiveCard', version: '1.4', $schema: 'http://adaptivecards.io/schemas/adaptive-card.json', body: [{ type: 'TextBlock', text: TEST_TEXT, wrap: true }] } }] }),
  'webhook:gchat': (values) => post(values.url, 'Google Chat', { text: TEST_TEXT }),
  'webhook:discord': (values) => post(values.url, 'Discord', { content: TEST_TEXT }),
  'webhook:generic': (values) => post(values.url, 'The endpoint', { source: 'altamid-hrms', event: 'test', text: TEST_TEXT, at: new Date().toISOString() }, values.secret),
};

const TEST_TEXT = 'Altamid HRMS test: this channel is connected. No action needed.';

async function post(url: string, name: string, payload: unknown, secret = '') {
  const body = JSON.stringify(payload);
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (secret) headers['x-altamid-signature'] = 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
  const reply = await call(url, { method: 'POST', headers, body });
  if (reply.status >= 200 && reply.status < 300) return ok(`${name} accepted the test message. Check the channel for it.`);
  const text = reply.body.trim();
  const slack: Record<string, string> = {
    no_service: 'This Slack webhook was removed or the app was uninstalled. Create a new webhook.',
    no_team: 'The Slack workspace for this webhook no longer exists.',
    invalid_token: 'This Slack webhook is no longer valid. Create a new one.',
    channel_not_found: 'The Slack channel for this webhook was deleted.',
    channel_is_archived: 'The Slack channel for this webhook is archived.',
    action_prohibited: 'A Slack admin has blocked this webhook.',
    invalid_payload: 'Slack could not read the message.',
  };
  if (slack[text]) no(slack[text]);
  if (name === 'Discord' && reply.status === 404) no('Discord says this webhook does not exist. It was deleted, or the URL was not copied in full.');
  const message = String(((reply.json?.error as { message?: string }) || {}).message || reply.json?.message || '');
  if (message) no(`${name} refused the test (status ${reply.status}): ${message}`);
  return no(statusMessage(name, reply.status, reply.body));
}

async function tally(values: Values, label: string) {
  const reply = await call(values.address.replace(/\/+$/, '') + '/');
  if (/Server is Running/i.test(reply.body)) return ok(`${label} answered: ${snippet(reply.body)}. Make sure “${values.company}” is open in Tally when payroll is posted.`);
  return no(`Something answered at ${hostOf(values.address)}, but it is not Tally (status ${reply.status}). In Tally, turn on the server mode under Connectivity and use the same port.`);
}

async function biometric(provider: ProviderDef, values: Values, context: TestContext) {
  if ((values.mode || 'push') === 'push') {
    const readers = context.readers.filter((item) => item.active);
    if (!readers.length) no('No readers are added yet. Add each reader under Attendance → Readers, then paste its address and token into the reader.');
    const heard = readers.filter((item) => item.lastSeenAt);
    if (!heard.length) no(`${readers.length} reader(s) are added, but none has sent a punch yet. Check the reader’s cloud or ADMS address and token, and that it has internet.`);
    const latest = heard.reduce((a, b) => (a.lastSeenAt! > b.lastSeenAt! ? a : b));
    const when = latest.lastSeenAt!.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    const quiet = readers.length - heard.length;
    return ok(`${heard.length} of ${readers.length} reader(s) have sent punches. Last: ${latest.name}, ${when}.${quiet ? ` ${quiet} reader(s) have not sent anything yet.` : ''}`);
  }
  const base = values.serverUrl.replace(/\/+$/, '');
  if (provider.id === 'suprema') {
    const reply = await call(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ User: { login_id: values.username, password: values.password } }) });
    if (reply.status === 200) return ok('BioStar 2 accepted the login id and password.');
    if (reply.status === 401 || reply.status === 400) no('BioStar 2 did not accept the login id and password.');
    return no(statusMessage('BioStar 2', reply.status, reply.body));
  }
  const headers: Record<string, string> = values.username ? { authorization: basic(values.username, values.password || '') } : {};
  const reply = await call(base, { headers });
  if (reply.status >= 500) no(statusMessage(provider.label, reply.status, reply.body));
  return ok(`This server reached ${hostOf(base)} (status ${reply.status}). Altamid does not pull punches from vendor software yet, so use push mode for live punches.`);
}

function bankCheck(provider: ProviderDef, context: TestContext) {
  if (!context.bank.hasAccount || !context.bank.ifsc) no('Save the company salary account number and IFSC under General → Company bank first.');
  const prefix = context.bank.ifsc.slice(0, 4).toUpperCase();
  if (provider.prefix && prefix !== provider.prefix) no(`The company IFSC ${context.bank.ifsc} belongs to a different bank (${prefix}). ${provider.label} IFSCs start with ${provider.prefix}. Change the bank here or the IFSC under General.`);
  return ok(`The company account at ${context.bank.name || provider.label} (${context.bank.ifsc}) is saved. Salary files will mark same-bank rows as internal transfers.`);
}

export async function testIntegration(key: IntegrationKey, row: StoredIntegration, open: (sealed: string) => string, context: TestContext): Promise<{ ok: boolean; message: string }> {
  const provider = providerOf(key, row.provider);
  const config = row.configs[provider.id];
  try {
    if (key === 'api') return config?.secrets.key ? ok('This company’s API key is saved and ready to use.') : no('Generate a key first.');
    const missing = missingFields(key, row);
    if (missing.length) {
      const list = missing.length === 1
        ? missing[0]
        : missing.slice(0, -1).join(', ') + ' and ' + missing[missing.length - 1];
      no(`Add ${list} for ${provider.label}, then save and test.`);
    }
    const values: Values = plainValues(provider, config);
    for (const field of provider.fields) if (field.kind === 'secret') values[field.key] = config?.secrets[field.key] ? open(config.secrets[field.key]) : '';
    for (const field of provider.fields) if (field.kind === 'secret' && config?.secrets[field.key] && !values[field.key]) no(`The saved ${field.label} could not be read on this server. Enter it again and save.`);
    if (key === 'biometric') return await biometric(provider, values, context);
    if (key === 'bank') return bankCheck(provider, context);
    const live = LIVE[`${key}:${provider.id}`];
    if (live) return await live(values, context);
    return ok(`All required ${provider.label} details are saved and in the right format. ${provider.checkNote}`);
  } catch (error) {
    if (error instanceof TestFailure) return { ok: false, message: error.message };
    return { ok: false, message: 'The test stopped unexpectedly: ' + (error instanceof Error ? error.message.slice(0, 160) : 'unknown error') };
  }
}
