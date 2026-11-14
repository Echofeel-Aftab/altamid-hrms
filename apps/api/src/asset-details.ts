export interface DetailOption {
  value: string;
  label: string;
  group?: string;
  brand?: string;
}

export interface DetailField {
  key: string;
  label: string;
  kind: 'text' | 'select' | 'date' | 'number' | 'secret';
  options?: DetailOption[];
  placeholder?: string;
  hint?: string;
  pattern?: string;
  patternMessage?: string;
  upper?: boolean;
  max?: number;
  min?: number;
  maxValue?: number;
  wide?: boolean;
  showIf?: { field: string; equals?: string[]; notEquals?: string[] };
}

export interface KindDetails {
  title: string;
  lead: string;
  brands: string[];
  fields: DetailField[];
}

const opts = (...labels: string[]): DetailOption[] => labels.map((label) => ({ value: label, label }));
const other = (key: string, label: string, parent: string): DetailField => ({ key, label, kind: 'text', max: 80, showIf: { field: parent, equals: ['Other'] } });
const yesNo = (key: string, label: string): DetailField => ({ key, label, kind: 'select', options: opts('Yes', 'No') });
const IMEI = { pattern: '^[0-9]{15}$', patternMessage: 'An IMEI is 15 digits. Dial *#06# on the phone to see it.' };
const MOBILE = { pattern: '^(\\+91)?[6-9][0-9]{9}$', patternMessage: 'Enter a 10-digit Indian mobile number, such as 9876543210.' };
const OPERATORS = opts('Jio', 'Airtel', 'Vi (Vodafone Idea)', 'BSNL', 'MTNL', 'Other');

const S = (group: string, brand: string, ...names: string[]): DetailOption[] => names.map((name) => ({ value: name, label: name, group, brand }));

export const SOFTWARE: DetailOption[] = [
  ...S('Office and email', 'Microsoft', 'Microsoft 365 Business Basic', 'Microsoft 365 Business Standard', 'Microsoft 365 Business Premium', 'Microsoft 365 Apps for business', 'Microsoft 365 E3', 'Microsoft 365 E5', 'Office LTSC 2024', 'Office Home and Business 2021', 'Exchange Online'),
  ...S('Office and email', 'Google', 'Google Workspace Business Starter', 'Google Workspace Business Standard', 'Google Workspace Business Plus', 'Google Workspace Enterprise'),
  ...S('Office and email', 'Zoho', 'Zoho Workplace', 'Zoho Mail'),
  ...S('Meetings and chat', 'Zoom', 'Zoom Workplace Pro', 'Zoom Workplace Business'),
  ...S('Meetings and chat', 'Salesforce', 'Slack Pro', 'Slack Business+'),
  ...S('Meetings and chat', 'Microsoft', 'Microsoft Teams Essentials', 'Microsoft Teams Premium'),
  ...S('Meetings and chat', 'Cisco', 'Webex Meetings'),
  ...S('Meetings and chat', 'Google', 'Google Meet (Workspace)'),
  ...S('Design and creative', 'Adobe', 'Adobe Creative Cloud All Apps', 'Adobe Photoshop', 'Adobe Illustrator', 'Adobe InDesign', 'Adobe Premiere Pro', 'Adobe After Effects', 'Adobe Lightroom', 'Adobe Acrobat Pro', 'Adobe Acrobat Standard'),
  ...S('Design and creative', 'Canva', 'Canva Pro', 'Canva Teams'),
  ...S('Design and creative', 'Figma', 'Figma Professional', 'Figma Organization'),
  ...S('Design and creative', 'Corel', 'CorelDRAW Graphics Suite'),
  ...S('Design and creative', 'Sketch', 'Sketch'),
  ...S('Engineering and CAD', 'Autodesk', 'AutoCAD', 'AutoCAD LT', 'Revit', 'Fusion', '3ds Max', 'Maya', 'Inventor', 'Civil 3D'),
  ...S('Engineering and CAD', 'Dassault Systèmes', 'SOLIDWORKS', 'CATIA'),
  ...S('Engineering and CAD', 'Trimble', 'SketchUp Pro'),
  ...S('Engineering and CAD', 'Bentley', 'STAAD.Pro', 'MicroStation'),
  ...S('Engineering and CAD', 'MathWorks', 'MATLAB'),
  ...S('Engineering and CAD', 'Ansys', 'Ansys Mechanical'),
  ...S('Development', 'GitHub', 'GitHub Team', 'GitHub Enterprise', 'GitHub Copilot Business'),
  ...S('Development', 'GitLab', 'GitLab Premium', 'GitLab Ultimate'),
  ...S('Development', 'JetBrains', 'JetBrains All Products Pack', 'IntelliJ IDEA Ultimate', 'PyCharm Professional', 'WebStorm', 'PhpStorm', 'Rider'),
  ...S('Development', 'Microsoft', 'Visual Studio Professional', 'Visual Studio Enterprise', 'Azure DevOps'),
  ...S('Development', 'Atlassian', 'Jira Software', 'Confluence', 'Bitbucket'),
  ...S('Development', 'Postman', 'Postman Professional'),
  ...S('Development', 'Docker', 'Docker Business'),
  ...S('Development', 'Anysphere', 'Cursor Business'),
  ...S('Project and work management', 'Asana', 'Asana'),
  ...S('Project and work management', 'monday.com', 'monday.com Work Management'),
  ...S('Project and work management', 'ClickUp', 'ClickUp'),
  ...S('Project and work management', 'Notion', 'Notion'),
  ...S('Project and work management', 'Atlassian', 'Trello'),
  ...S('Project and work management', 'Smartsheet', 'Smartsheet'),
  ...S('Project and work management', 'Microsoft', 'Microsoft Project', 'Microsoft Visio'),
  ...S('Project and work management', 'Zoho', 'Zoho Projects'),
  ...S('Accounting and ERP', 'Tally Solutions', 'TallyPrime Silver', 'TallyPrime Gold'),
  ...S('Accounting and ERP', 'Zoho', 'Zoho Books'),
  ...S('Accounting and ERP', 'Intuit', 'QuickBooks Online'),
  ...S('Accounting and ERP', 'Busy Infotech', 'Busy Accounting'),
  ...S('Accounting and ERP', 'Marg', 'Marg ERP 9+'),
  ...S('Accounting and ERP', 'SAP', 'SAP Business One', 'SAP S/4HANA'),
  ...S('Accounting and ERP', 'Oracle', 'Oracle NetSuite'),
  ...S('Accounting and ERP', 'Microsoft', 'Dynamics 365 Business Central'),
  ...S('Accounting and ERP', 'Odoo', 'Odoo'),
  ...S('CRM, sales and support', 'Salesforce', 'Salesforce Sales Cloud', 'Salesforce Service Cloud'),
  ...S('CRM, sales and support', 'HubSpot', 'HubSpot Sales Hub', 'HubSpot Marketing Hub'),
  ...S('CRM, sales and support', 'Zoho', 'Zoho CRM', 'Zoho Desk'),
  ...S('CRM, sales and support', 'Freshworks', 'Freshsales', 'Freshdesk'),
  ...S('CRM, sales and support', 'Zendesk', 'Zendesk Suite'),
  ...S('CRM, sales and support', 'LeadSquared', 'LeadSquared'),
  ...S('CRM, sales and support', 'Altamid Solutions', 'Altamid CRM'),
  ...S('Security and antivirus', 'Quick Heal', 'Quick Heal Total Security', 'Seqrite Endpoint Security'),
  ...S('Security and antivirus', 'Microsoft', 'Microsoft Defender for Business'),
  ...S('Security and antivirus', 'Kaspersky', 'Kaspersky Endpoint Security'),
  ...S('Security and antivirus', 'Bitdefender', 'Bitdefender GravityZone'),
  ...S('Security and antivirus', 'Gen Digital', 'Norton 360'),
  ...S('Security and antivirus', 'McAfee', 'McAfee Total Protection'),
  ...S('Security and antivirus', 'Sophos', 'Sophos Intercept X'),
  ...S('Security and antivirus', 'CrowdStrike', 'CrowdStrike Falcon'),
  ...S('Security and antivirus', 'ESET', 'ESET PROTECT'),
  ...S('Passwords and remote access', '1Password', '1Password Business'),
  ...S('Passwords and remote access', 'Bitwarden', 'Bitwarden Teams', 'Bitwarden Enterprise'),
  ...S('Passwords and remote access', 'LastPass', 'LastPass Business'),
  ...S('Passwords and remote access', 'TeamViewer', 'TeamViewer Business'),
  ...S('Passwords and remote access', 'AnyDesk', 'AnyDesk Standard'),
  ...S('Operating systems and servers', 'Microsoft', 'Windows 11 Pro', 'Windows 11 Enterprise', 'Windows Server 2022', 'Windows Server 2025', 'SQL Server'),
  ...S('Operating systems and servers', 'Red Hat', 'Red Hat Enterprise Linux'),
  ...S('Operating systems and servers', 'Broadcom', 'VMware vSphere'),
  ...S('Storage and files', 'Dropbox', 'Dropbox Business'),
  ...S('Storage and files', 'Box', 'Box Business'),
  ...S('Storage and files', 'Microsoft', 'OneDrive for Business'),
  ...S('AI and writing', 'OpenAI', 'ChatGPT Team', 'ChatGPT Enterprise'),
  ...S('AI and writing', 'Microsoft', 'Microsoft 365 Copilot'),
  ...S('AI and writing', 'Google', 'Gemini for Google Workspace'),
  ...S('AI and writing', 'Anthropic', 'Claude Team'),
  ...S('AI and writing', 'Grammarly', 'Grammarly Business'),
  ...S('E-signature and PDF', 'Docusign', 'Docusign eSignature'),
  ...S('E-signature and PDF', 'Adobe', 'Adobe Acrobat Sign'),
  ...S('E-signature and PDF', 'Zoho', 'Zoho Sign'),
  ...S('E-signature and PDF', 'Nitro', 'Nitro PDF Pro'),
  { value: 'Other', label: 'Other (type the name)', group: 'Other' },
];

const COMPUTER_CPU = opts('Intel Core i3', 'Intel Core i5', 'Intel Core i7', 'Intel Core i9', 'Intel Core Ultra 5', 'Intel Core Ultra 7', 'Intel Core Ultra 9', 'Intel Celeron or Pentium', 'Intel Xeon', 'AMD Ryzen 3', 'AMD Ryzen 5', 'AMD Ryzen 7', 'AMD Ryzen 9', 'Apple M1', 'Apple M2', 'Apple M3', 'Apple M4', 'Apple M-series Pro or Max', 'Snapdragon X', 'Other');
const RAM = opts('4 GB', '8 GB', '12 GB', '16 GB', '24 GB', '32 GB', '64 GB', '128 GB');
const DISK = opts('128 GB SSD', '256 GB SSD', '512 GB SSD', '1 TB SSD', '2 TB SSD', '500 GB HDD', '1 TB HDD', 'SSD + HDD');
const OS = opts('Windows 11 Pro', 'Windows 11 Home', 'Windows 10 Pro', 'macOS', 'Ubuntu', 'Other Linux', 'ChromeOS', 'No operating system');

const computer = (laptop: boolean): DetailField[] => [
  { key: 'cpu', label: 'Processor', kind: 'select', options: COMPUTER_CPU },
  other('cpuOther', 'Processor name', 'cpu'),
  { key: 'ram', label: 'Memory (RAM)', kind: 'select', options: RAM },
  { key: 'disk', label: 'Storage', kind: 'select', options: DISK },
  { key: 'os', label: 'Operating system', kind: 'select', options: OS },
  ...(laptop
    ? [
        { key: 'screen', label: 'Screen size', kind: 'select', options: opts('11 to 12 inch', '13 inch', '14 inch', '15.6 inch', '16 inch', '17 inch') } as DetailField,
        yesNo('charger', 'Charger included'),
      ]
    : [{ key: 'formFactor', label: 'Form factor', kind: 'select', options: opts('Tower', 'Small form factor', 'Mini PC', 'All-in-one', 'Workstation') } as DetailField]),
  { key: 'encryption', label: 'Disk encryption', kind: 'select', options: opts('BitLocker on', 'FileVault on', 'Not encrypted', 'Not checked') },
  { key: 'hostname', label: 'Computer name', kind: 'text', max: 40, placeholder: 'NW-LAP-042' },
  { key: 'mac', label: 'Wi-Fi MAC address', kind: 'text', placeholder: 'A4:5E:60:12:34:56', pattern: '^([0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}$', patternMessage: 'A MAC address is six pairs of letters or digits, such as A4:5E:60:12:34:56.', upper: true },
];

export const KIND_DETAILS: Record<string, KindDetails> = {
  laptop: { title: 'Laptop details', lead: 'Configuration, so the right machine goes to the right person.', brands: ['Dell', 'HP', 'Lenovo', 'Apple', 'Asus', 'Acer', 'Microsoft Surface', 'MSI', 'Samsung', 'LG'], fields: computer(true) },
  desktop: { title: 'Desktop details', lead: 'Configuration of the machine.', brands: ['Dell', 'HP', 'Lenovo', 'Apple', 'Asus', 'Acer', 'Assembled'], fields: computer(false) },
  monitor: {
    title: 'Monitor details',
    lead: 'Size and connections.',
    brands: ['Dell', 'LG', 'Samsung', 'BenQ', 'HP', 'Lenovo', 'Acer', 'ViewSonic', 'Asus', 'Apple'],
    fields: [
      { key: 'size', label: 'Screen size', kind: 'select', options: opts('19 to 20 inch', '21.5 to 22 inch', '24 inch', '27 inch', '32 inch', '34 inch ultrawide', '49 inch ultrawide') },
      { key: 'resolution', label: 'Resolution', kind: 'select', options: opts('HD (1366×768)', 'Full HD (1920×1080)', 'QHD (2560×1440)', '4K (3840×2160)', '5K or more') },
      { key: 'ports', label: 'Connections', kind: 'select', options: opts('HDMI', 'HDMI and DisplayPort', 'USB-C with power', 'VGA') },
      yesNo('stand', 'Height-adjustable stand'),
    ],
  },
  tablet: {
    title: 'Tablet details',
    lead: 'Model, storage and connectivity.',
    brands: ['Apple', 'Samsung', 'Lenovo', 'Microsoft Surface', 'Xiaomi', 'OnePlus'],
    fields: [
      { key: 'os', label: 'Operating system', kind: 'select', options: opts('iPadOS', 'Android', 'Windows') },
      { key: 'storage', label: 'Storage', kind: 'select', options: opts('64 GB', '128 GB', '256 GB', '512 GB', '1 TB') },
      { key: 'network', label: 'Connectivity', kind: 'select', options: opts('Wi-Fi only', 'Wi-Fi and cellular') },
      { key: 'imei', label: 'IMEI', kind: 'text', ...IMEI, showIf: { field: 'network', equals: ['Wi-Fi and cellular'] } },
      yesNo('mdm', 'Enrolled in device management (MDM)'),
    ],
  },
  peripheral: {
    title: 'Keyboard and mouse details',
    lead: 'What it is and how it connects.',
    brands: ['Logitech', 'Dell', 'HP', 'Microsoft', 'Apple', 'Lenovo', 'Zebronics', 'Razer'],
    fields: [
      { key: 'type', label: 'Item', kind: 'select', options: opts('Keyboard', 'Mouse', 'Keyboard and mouse set', 'Trackpad', 'Webcam', 'Speaker') },
      { key: 'connection', label: 'Connection', kind: 'select', options: opts('Wired USB', 'Wireless receiver', 'Bluetooth') },
    ],
  },
  headset: {
    title: 'Headset details',
    lead: 'Type and features.',
    brands: ['Jabra', 'Poly (Plantronics)', 'Logitech', 'Sennheiser', 'Sony', 'boAt', 'JBL', 'Apple'],
    fields: [
      { key: 'connection', label: 'Connection', kind: 'select', options: opts('Wired USB', 'Wired 3.5 mm', 'Wireless USB dongle', 'Bluetooth') },
      { key: 'style', label: 'Style', kind: 'select', options: opts('Over the ear', 'On the ear', 'In-ear earbuds', 'Mono (one ear)') },
      yesNo('anc', 'Noise cancelling'),
      yesNo('certified', 'Certified for Teams or Zoom'),
    ],
  },
  dock: {
    title: 'Dock or charger details',
    lead: 'Type and power.',
    brands: ['Dell', 'HP', 'Lenovo', 'Apple', 'Anker', 'Belkin', 'Portronics', 'Ambrane'],
    fields: [
      { key: 'type', label: 'Item', kind: 'select', options: opts('Docking station', 'USB-C hub or adapter', 'Laptop charger', 'Phone charger', 'Power bank', 'Cable') },
      { key: 'watts', label: 'Power (watts)', kind: 'number', min: 0, maxValue: 500 },
    ],
  },
  storage: {
    title: 'External drive details',
    lead: 'Type, size and whether it is encrypted.',
    brands: ['SanDisk', 'Seagate', 'WD', 'Samsung', 'Crucial', 'Kingston', 'HP', 'Lexar'],
    fields: [
      { key: 'type', label: 'Type', kind: 'select', options: opts('Portable HDD', 'Portable SSD', 'Pen drive', 'Memory card', 'NAS') },
      { key: 'capacity', label: 'Capacity', kind: 'select', options: opts('32 GB', '64 GB', '128 GB', '256 GB', '512 GB', '1 TB', '2 TB', '4 TB', 'More than 4 TB') },
      { key: 'encrypted', label: 'Encrypted', kind: 'select', options: opts('Yes, hardware', 'Yes, BitLocker or FileVault', 'No') },
    ],
  },
  printer: {
    title: 'Printer or scanner details',
    lead: 'Type, colour and network.',
    brands: ['HP', 'Canon', 'Epson', 'Brother', 'Ricoh', 'Kyocera', 'Xerox', 'Zebra', 'TVS'],
    fields: [
      { key: 'type', label: 'Type', kind: 'select', options: opts('Laser printer', 'Ink tank printer', 'Inkjet printer', 'Multifunction (print, scan, copy)', 'Scanner', 'Label or barcode printer', 'Dot matrix') },
      { key: 'colour', label: 'Colour', kind: 'select', options: opts('Black and white', 'Colour') },
      { key: 'connection', label: 'Connection', kind: 'select', options: opts('USB', 'Wi-Fi', 'Network cable', 'USB and Wi-Fi') },
      { key: 'ip', label: 'IP address', kind: 'text', placeholder: '192.168.1.40', pattern: '^((25[0-5]|2[0-4]\\d|1?\\d?\\d)\\.){3}(25[0-5]|2[0-4]\\d|1?\\d?\\d)$', patternMessage: 'Enter an IP address such as 192.168.1.40.', showIf: { field: 'connection', notEquals: ['USB', ''] } },
      { key: 'cartridge', label: 'Toner or cartridge model', kind: 'text', max: 40 },
    ],
  },
  phone: {
    title: 'Mobile phone details',
    lead: 'Identity numbers and the number it uses.',
    brands: ['Apple', 'Samsung', 'OnePlus', 'Xiaomi', 'Vivo', 'Oppo', 'Realme', 'Motorola', 'Google', 'Nokia'],
    fields: [
      { key: 'os', label: 'Operating system', kind: 'select', options: opts('Android', 'iOS', 'Feature phone') },
      { key: 'storage', label: 'Storage', kind: 'select', options: opts('32 GB', '64 GB', '128 GB', '256 GB', '512 GB') },
      { key: 'imei', label: 'IMEI 1', kind: 'text', ...IMEI },
      { key: 'imei2', label: 'IMEI 2', kind: 'text', ...IMEI, hint: 'Dual-SIM phones have two.' },
      { key: 'number', label: 'Company number on it', kind: 'text', ...MOBILE },
      yesNo('mdm', 'Enrolled in device management (MDM)'),
    ],
  },
  sim: {
    title: 'SIM card details',
    lead: 'Number, operator and plan.',
    brands: [],
    fields: [
      { key: 'operator', label: 'Operator', kind: 'select', options: OPERATORS },
      other('operatorOther', 'Operator name', 'operator'),
      { key: 'number', label: 'Mobile number', kind: 'text', ...MOBILE },
      { key: 'simType', label: 'SIM type', kind: 'select', options: opts('Physical SIM', 'eSIM') },
      { key: 'plan', label: 'Plan', kind: 'select', options: opts('Postpaid corporate', 'Postpaid', 'Prepaid') },
      { key: 'rental', label: 'Monthly rental (₹)', kind: 'number', min: 0, maxValue: 100000 },
      { key: 'data', label: 'Data allowance', kind: 'text', max: 40, placeholder: '2 GB a day, 50 GB a month' },
      yesNo('roaming', 'International roaming'),
    ],
  },
  dongle: {
    title: 'Data card or hotspot details',
    lead: 'Device type, number and plan.',
    brands: ['Jio', 'Airtel', 'TP-Link', 'Huawei', 'ZTE', 'D-Link'],
    fields: [
      { key: 'type', label: 'Type', kind: 'select', options: opts('Pocket hotspot (JioFi, Airtel)', 'USB data card', '4G or 5G router', 'Broadband router') },
      { key: 'operator', label: 'Operator', kind: 'select', options: OPERATORS },
      other('operatorOther', 'Operator name', 'operator'),
      { key: 'number', label: 'Connection number', kind: 'text', max: 20 },
      { key: 'plan', label: 'Plan', kind: 'text', max: 60, placeholder: '₹599 a month, 100 GB' },
    ],
  },
  card: {
    title: 'ID card details',
    lead: 'Card number and validity.',
    brands: [],
    fields: [
      { key: 'number', label: 'Card number', kind: 'text', max: 30 },
      { key: 'issuedFor', label: 'Issued to', kind: 'select', options: opts('Employee', 'Contractor', 'Intern', 'Visitor', 'Vendor staff') },
      { key: 'validUntil', label: 'Valid until', kind: 'date' },
      yesNo('lanyard', 'Lanyard and holder given'),
    ],
  },
  access: {
    title: 'Access card details',
    lead: 'Technology, number and where it opens.',
    brands: ['HID', 'Matrix', 'eSSL', 'ZKTeco', 'Honeywell', 'Bosch'],
    fields: [
      { key: 'tech', label: 'Card type', kind: 'select', options: opts('Proximity (125 kHz)', 'Smart card (MIFARE / NFC)', 'HID iCLASS', 'Magnetic stripe', 'Mobile credential') },
      { key: 'number', label: 'Card number', kind: 'text', max: 30 },
      { key: 'zones', label: 'Opens', kind: 'text', max: 120, wide: true, placeholder: 'Main door, 3rd floor, server room' },
      { key: 'validUntil', label: 'Valid until', kind: 'date' },
    ],
  },
  keys: {
    title: 'Key details',
    lead: 'What it opens and how many copies exist.',
    brands: ['Godrej', 'Yale', 'Dorset', 'Europa', 'Link'],
    fields: [
      { key: 'opens', label: 'Opens', kind: 'select', options: opts('Office main door', 'Cabin or room', 'Cupboard or drawer', 'Locker', 'Filing cabinet', 'Vehicle', 'Other') },
      other('opensOther', 'What it opens', 'opens'),
      { key: 'number', label: 'Key number', kind: 'text', max: 20 },
      { key: 'copies', label: 'Copies held by the company', kind: 'number', min: 0, maxValue: 50 },
    ],
  },
  vehicle: {
    title: 'Vehicle details',
    lead: 'Registration, insurance and compliance dates.',
    brands: ['Maruti Suzuki', 'Hyundai', 'Tata', 'Mahindra', 'Toyota', 'Honda', 'Kia', 'Hero', 'Bajaj', 'TVS', 'Royal Enfield', 'Ather', 'Ola Electric'],
    fields: [
      { key: 'type', label: 'Vehicle type', kind: 'select', options: opts('Car', 'Two-wheeler', 'Electric scooter', 'Van', 'Pickup or truck', 'Bus', 'Three-wheeler') },
      { key: 'fuel', label: 'Fuel', kind: 'select', options: opts('Petrol', 'Diesel', 'CNG', 'Electric', 'Hybrid', 'LPG') },
      { key: 'registration', label: 'Registration number', kind: 'text', upper: true, placeholder: 'MH12AB1234', pattern: '^([A-Z]{2}[ -]?[0-9]{1,2}[ -]?[A-Z]{0,3}[ -]?[0-9]{4}|[0-9]{2}[ -]?BH[ -]?[0-9]{4}[ -]?[A-Z]{1,2})$', patternMessage: 'Use the number plate format, such as MH12AB1234 or 22BH1234AA.' },
      { key: 'insurer', label: 'Insurer', kind: 'select', options: opts('ICICI Lombard', 'HDFC ERGO', 'Bajaj Allianz', 'Tata AIG', 'New India Assurance', 'United India', 'Oriental Insurance', 'National Insurance', 'SBI General', 'Reliance General', 'Digit', 'Acko', 'Other') },
      other('insurerOther', 'Insurer name', 'insurer'),
      { key: 'policy', label: 'Insurance policy number', kind: 'text', max: 40 },
      { key: 'insuranceUntil', label: 'Insurance valid until', kind: 'date' },
      { key: 'pucUntil', label: 'PUC valid until', kind: 'date', showIf: { field: 'fuel', notEquals: ['Electric'] } },
      { key: 'fitnessUntil', label: 'Fitness or permit valid until', kind: 'date', hint: 'For commercial vehicles.' },
      { key: 'fastag', label: 'FASTag id', kind: 'text', max: 30, showIf: { field: 'type', notEquals: ['Two-wheeler', 'Electric scooter'] } },
      { key: 'odometer', label: 'Odometer when issued (km)', kind: 'number', min: 0, maxValue: 2000000 },
    ],
  },
  fuel: {
    title: 'Fuel or travel card details',
    lead: 'Provider, limit and the vehicle it is for.',
    brands: [],
    fields: [
      { key: 'provider', label: 'Card', kind: 'select', options: opts('IndianOil XTRAPOWER', 'BPCL SmartFleet', 'HPCL DriveTrack Plus', 'Shell Fleet', 'FASTag wallet', 'Forex travel card', 'Corporate credit card', 'Other') },
      other('providerOther', 'Card name', 'provider'),
      { key: 'last4', label: 'Last 4 digits', kind: 'text', pattern: '^[0-9]{4}$', patternMessage: 'Enter only the last 4 digits of the card.', hint: 'Never store the full card number.' },
      { key: 'limit', label: 'Monthly limit (₹)', kind: 'number', min: 0, maxValue: 10000000 },
      { key: 'vehicle', label: 'For vehicle', kind: 'text', upper: true, max: 15, placeholder: 'MH12AB1234' },
      { key: 'validUntil', label: 'Valid until', kind: 'date' },
    ],
  },
  furniture: {
    title: 'Furniture details',
    lead: 'What it is and what it is made of.',
    brands: ['Godrej Interio', 'Featherlite', 'Durian', 'Nilkamal', 'IKEA', 'Wipro Furniture', 'Green Soul'],
    fields: [
      { key: 'type', label: 'Item', kind: 'select', options: opts('Desk', 'Chair', 'Ergonomic chair', 'Filing cabinet', 'Storage cupboard', 'Meeting table', 'Sofa', 'Whiteboard', 'Other') },
      other('typeOther', 'Item name', 'type'),
      { key: 'material', label: 'Material', kind: 'select', options: opts('Wood', 'Engineered wood', 'Metal', 'Plastic', 'Glass', 'Mesh and fabric', 'Leather or leatherette') },
      { key: 'colour', label: 'Colour', kind: 'text', max: 30 },
    ],
  },
  tools: {
    title: 'Tool or equipment details',
    lead: 'Type, power and calibration.',
    brands: ['Bosch', 'Makita', 'Stanley', 'Black+Decker', 'Fluke', 'Taparia', 'DeWalt'],
    fields: [
      { key: 'type', label: 'Type', kind: 'select', options: opts('Power tool', 'Hand tool kit', 'Measuring instrument', 'Testing equipment', 'Projector', 'Camera', 'Medical equipment', 'Other') },
      other('typeOther', 'Equipment name', 'type'),
      { key: 'power', label: 'Power', kind: 'select', options: opts('Mains', 'Battery', 'Manual') },
      { key: 'calibrationDue', label: 'Next calibration or service', kind: 'date' },
    ],
  },
  uniform: {
    title: 'Uniform or safety gear details',
    lead: 'Item, size and quantity.',
    brands: ['Karam', 'Udyogi', 'Allen Cooper', 'Bata Industrials', 'Acme'],
    fields: [
      { key: 'item', label: 'Item', kind: 'select', options: opts('Shirt', 'T-shirt', 'Trousers', 'Jacket', 'Apron', 'Safety shoes', 'Helmet', 'Gloves', 'Reflective vest', 'Safety goggles', 'Ear protection', 'Mask', 'Other') },
      other('itemOther', 'Item name', 'item'),
      { key: 'size', label: 'Size', kind: 'select', options: opts('XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL', 'Free size', 'UK 5', 'UK 6', 'UK 7', 'UK 8', 'UK 9', 'UK 10', 'UK 11', 'UK 12') },
      { key: 'quantity', label: 'Quantity', kind: 'number', min: 1, maxValue: 100 },
      { key: 'standard', label: 'Safety standard', kind: 'text', max: 40, placeholder: 'IS 15298, EN 397', showIf: { field: 'item', equals: ['Safety shoes', 'Helmet', 'Gloves', 'Reflective vest', 'Safety goggles', 'Ear protection'] } },
    ],
  },
  licence: {
    title: 'Software and licence details',
    lead: 'Which software, how it is licensed, and when it renews.',
    brands: [],
    fields: [
      { key: 'product', label: 'Software', kind: 'select', options: SOFTWARE, wide: true },
      { key: 'productOther', label: 'Software name', kind: 'text', max: 80, showIf: { field: 'product', equals: ['Other'] } },
      { key: 'publisherOther', label: 'Publisher', kind: 'text', max: 60, showIf: { field: 'product', equals: ['Other'] } },
      { key: 'licenceType', label: 'Licence type', kind: 'select', options: opts('Subscription per user', 'Subscription per device', 'Concurrent or floating', 'Perpetual', 'Volume or enterprise agreement', 'OEM (came with the device)', 'Free or open source') },
      { key: 'billing', label: 'Billing', kind: 'select', options: opts('Monthly', 'Yearly', 'Every 3 years', 'One-time'), showIf: { field: 'licenceType', notEquals: ['Free or open source', 'OEM (came with the device)'] } },
      { key: 'seats', label: 'Seats or users', kind: 'number', min: 1, maxValue: 100000, hint: 'How many people or devices this licence covers.' },
      { key: 'renewsOn', label: 'Renews or expires on', kind: 'date', showIf: { field: 'licenceType', notEquals: ['Perpetual', 'Free or open source', 'OEM (came with the device)'] } },
      { key: 'autoRenew', label: 'Auto-renew', kind: 'select', options: opts('Yes', 'No'), showIf: { field: 'licenceType', notEquals: ['Perpetual', 'Free or open source', 'OEM (came with the device)'] } },
      { key: 'account', label: 'Admin or licence account', kind: 'text', max: 120, placeholder: 'it@company.com' },
      { key: 'contract', label: 'Subscription or contract id', kind: 'text', max: 60 },
      { key: 'licenceKey', label: 'Licence key', kind: 'secret', wide: true, hint: 'Stored encrypted. Only asset managers and the holder can reveal it.' },
    ],
  },
  other: { title: 'More details', lead: 'Anything else worth recording.', brands: [], fields: [] },
};

export function detailsFor(kind: string): KindDetails {
  return KIND_DETAILS[kind] || KIND_DETAILS.other;
}

export function visibleDetailFields(kind: string, values: Record<string, string>): DetailField[] {
  return detailsFor(kind).fields.filter((field) => {
    if (!field.showIf) return true;
    const value = values[field.showIf.field] || '';
    if (field.showIf.equals) return field.showIf.equals.includes(value);
    if (field.showIf.notEquals) return !field.showIf.notEquals.includes(value);
    return true;
  });
}
