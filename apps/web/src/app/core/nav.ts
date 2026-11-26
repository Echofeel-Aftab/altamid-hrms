export interface NavItem {
  path: string;
  label: string;
  icon: string;
  exact?: boolean;
  /** An access key from the API, or "owner" for pages only the owner sees. */
  feature?: string;
}

export interface NavGroup {
  label: string;
  roles?: string[];
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    label: 'My day',
    items: [
      { path: '/', label: 'Home', icon: 'bi bi-house', exact: true },
      { path: '/attendance', label: 'Attendance', icon: 'bi bi-clock' },
      { path: '/exceptions', label: 'Exceptions', icon: 'bi bi-exclamation-circle', feature: 'exceptions' },
      { path: '/leave', label: 'Leave', icon: 'bi bi-calendar2-week' },
      { path: '/requests', label: 'Requests', icon: 'bi bi-inbox' },
      { path: '/profile', label: 'My profile', icon: 'bi bi-person' },
    ],
  },
  {
    label: 'Workplace',
    items: [
      { path: '/news', label: 'Announcements', icon: 'bi bi-megaphone' },
      { path: '/reporting', label: 'My manager & reports', icon: 'bi bi-person-lines-fill' },
      { path: '/recognition', label: 'Recognition', icon: 'bi bi-award' },
      { path: '/jobs', label: 'Open roles', icon: 'bi bi-search', feature: 'jobs' },
      { path: '/library', label: 'Library', icon: 'bi bi-journal-text', feature: 'library' },
      { path: '/separation', label: 'Separation', icon: 'bi bi-box-arrow-right' },
    ],
  },
  {
    label: 'My pay',
    items: [
      { path: '/pay', label: 'My pay', icon: 'bi bi-wallet', feature: 'pay' },
      { path: '/tax', label: 'Tax and investments', icon: 'bi bi-receipt', feature: 'pay.tax' },
      { path: '/choice-pay', label: 'Choice pay', icon: 'bi bi-sliders2', feature: 'pay.flex' },
      { path: '/rewards', label: 'Total rewards', icon: 'bi bi-gift', feature: 'pay.rewards' },
    ],
  },
  {
    label: 'Talent',
    items: [
      { path: '/growth', label: 'My Growth', icon: 'bi bi-mortarboard', feature: 'performance' },
      { path: '/performance', label: 'Performance', icon: 'bi bi-graph-up-arrow', feature: 'performance' },
      { path: '/surveys', label: 'Surveys', icon: 'bi bi-clipboard2-pulse', feature: 'surveys' },
    ],
  },
  {
    label: 'My team',
    items: [
      { path: '/team', label: 'My team', icon: 'bi bi-diagram-2', feature: 'approvals' },
      { path: '/approvals', label: 'Approvals', icon: 'bi bi-check2-square', feature: 'approvals' },
    ],
  },
  {
    label: 'Company',
    items: [
      { path: '/people', label: 'People', icon: 'bi bi-people', feature: 'people' },
      { path: '/assets', label: 'Assets', icon: 'bi bi-laptop' },
      { path: '/hiring', label: 'Hiring', icon: 'bi bi-briefcase', feature: 'hiring' },
      { path: '/vendors', label: 'Vendors', icon: 'bi bi-building', feature: 'hiring' },
      { path: '/organisation', label: 'Organisation', icon: 'bi bi-diagram-3', feature: 'people' },
      { path: '/succession', label: 'Succession', icon: 'bi bi-diagram-3-fill', feature: 'succession' },
      { path: '/payroll', label: 'Payroll', icon: 'bi bi-wallet2', feature: 'pay' },
      { path: '/reports', label: 'Reports', icon: 'bi bi-bar-chart-line', feature: 'reports' },
      { path: '/system', label: 'System map', icon: 'bi bi-bounding-box-circles', feature: 'owner' },
      { path: '/settings', label: 'Settings', icon: 'bi bi-gear', feature: 'settings' },
    ],
  },
];
