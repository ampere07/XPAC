// The client's copy of the permission table.
//
// The server is the authority: every endpoint is checked against
// backend/app/Support/ApiPermissionMap.php whatever this file says. This file
// lets the UI decide what to *draw* without waiting on a round trip: which menu
// entries to list, which page to open, which buttons to render.
//
// It mirrors backend/app/Support/Permissions.php. Change the backend file first.
// PermissionsParityTest reads this file as text: keep every key in single
// quotes, keep comments on their own lines, and do not nest arrays inside the
// PAGES, ACTIONS or ROLE_PERMISSIONS literals.

/** Held by SuperAdmin alone. Matches any key, including ones added later. */
export const WILDCARD = '*';

/** The seeded roles. Anything above 8 is a custom role with its own list. */
export const ROLE = {
  ADMINISTRATOR: 1,
  TECHNICIAN: 2,
  CUSTOMER: 3,
  AGENT: 4,
  INVENTORY_STAFF: 5,
  OSP: 6,
  SUPER_ADMIN: 7,
  HEAD_TECH: 8,
} as const;

export const LOCKED_ROLE_IDS: number[] = Object.values(ROLE);

/**
 * How each seeded role is written in Role Management's "Start From a System
 * Role" picker, widest access first.
 */
export const BASE_ROLE_OPTIONS: Array<{ id: number; label: string }> = [
  { id: ROLE.SUPER_ADMIN, label: 'SuperAdmin' },
  { id: ROLE.ADMINISTRATOR, label: 'Administrator' },
  { id: ROLE.HEAD_TECH, label: 'Head Technician' },
  { id: ROLE.TECHNICIAN, label: 'Technician' },
  { id: ROLE.OSP, label: 'OSP' },
  { id: ROLE.INVENTORY_STAFF, label: 'Inventory Staff' },
  { id: ROLE.AGENT, label: 'Agent' },
  { id: ROLE.CUSTOMER, label: 'Customer' },
];

/** The seeded role's name, or '' when the id names no seeded role. */
export const baseRoleLabel = (roleId?: number | string | null): string =>
  BASE_ROLE_OPTIONS.find(option => option.id === Number(roleId))?.label ?? '';

/**
 * Role names as the login endpoint sends them (lowercased role_name), mapped
 * onto their ids. Every lookup tries the id first and falls back to the name.
 */
const ROLE_NAME_TO_ID: Record<string, number> = {
  administrator: ROLE.ADMINISTRATOR,
  admin: ROLE.ADMINISTRATOR,
  technician: ROLE.TECHNICIAN,
  customer: ROLE.CUSTOMER,
  agent: ROLE.AGENT,
  inventorystaff: ROLE.INVENTORY_STAFF,
  osp: ROLE.OSP,
  superadmin: ROLE.SUPER_ADMIN,
  headtech: ROLE.HEAD_TECH,
};

/** Every page key, in the order the Role modal lists them. */
export const PAGES = [
  'dashboard',
  'agent-dashboard',
  'customer-dashboard',
  'customer-bills',
  'customer-support',
  'agent-application',
  'live-monitor',
  'customer',
  'transaction-list',
  'transactions-revert',
  'prepaid-override',
  'payment-portal',
  'soa',
  'invoice',
  'overdue',
  'so-charge',
  'dc-notice',
  'mass-rebate',
  'staggered-payment',
  'discounts',
  'soa-generation',
  'application-management',
  'job-order',
  'service-order',
  'work-order',
  'lcp-nap-location',
  'sms-blast',
  'reports',
  'commission',
  'bonus-history',
  'agent-invoices',
  'agent-payout',
  'agent-management',
  'team-agent',
  'inventory',
  'inventory-category-list',
  'monthly-payables',
  'expenses',
  'expenses-category',
  'promo-list',
  'plan-list',
  'location-list',
  'lcp',
  'nap',
  'ports',
  'router-models',
  'status-remarks-list',
  'usage-type',
  'vlan-config',
  'payment-method',
  'work-category',
  'radius-config',
  'smart-olt',
  'sms-config',
  'sms-template',
  'email-templates',
  'pppoe-setup',
  'concern-config',
  'billing-config',
  'user-management',
  'tech-users',
  'organization',
  'roles',
  'group-management',
  'disconnected-logs',
  'reconnection-logs',
  'sms-logs',
  'sms-blast-logs',
  'email-logs',
  'data-logs',
  'expenses-log',
  'smart-olt-logs',
  'radius-logs',
  'system-logs',
  'smartolt-tool',
  'mikrotik-radius-tool',
  'xendit-reconcile-tool',
  'billing-reconcile-tool',
  'settings',
] as const;

/** The button-level keys, grouped by the page that owns them. */
export const ACTIONS: Record<string, string[]> = {
  'job-order': [
    'job-order.approve',
    'job-order.failed',
    'job-order.tech-edit',
    'job-order.admin-edit',
    'job-order.attachment',
  ],
  customer: [
    'customer.so-request',
    'customer.details-edit',
    'customer.attachment',
    'customer.transact',
    'customer.prepaid-override',
  ],
  'transaction-list': [
    'transaction-list.batch-approve',
    'transaction-list.approve',
    'transaction-list.revert-request',
    'transaction-list.delete',
  ],
  'transactions-revert': [
    'transactions-revert.approve',
  ],
  'prepaid-override': [
    'prepaid-override.approve',
  ],
  'mass-rebate': [
    'mass-rebate.add',
  ],
  'staggered-payment': [
    'staggered-payment.add',
  ],
  discounts: [
    'discounts.add',
  ],
  'soa-generation': [
    'soa-generation.manage',
  ],
  'application-management': [
    'application-management.move-to-jo',
    'application-management.quick-status',
  ],
  'service-order': [
    'service-order.tech-edit',
    'service-order.admin-edit',
  ],
  'work-order': [
    'work-order.manage',
  ],
  reports: [
    'reports.manage',
    'reports.delete',
  ],
  commission: [
    'commission.create',
  ],
  'bonus-history': [
    'bonus-history.payout',
  ],
  'agent-payout': [
    'agent-payout.approve',
  ],
  'agent-invoices': [
    'agent-invoices.generate',
    'agent-invoices.status',
    'agent-invoices.payout',
  ],
  'monthly-payables': [
    'monthly-payables.create',
    'monthly-payables.edit',
    'monthly-payables.delete',
    'monthly-payables.generate',
    'monthly-payables.pay',
  ],
  expenses: [
    'expenses.create',
    'expenses.edit',
    'expenses.delete',
  ],
  'expenses-category': [
    'expenses-category.create',
    'expenses-category.edit',
    'expenses-category.delete',
  ],
  'promo-list': [
    'promo-list.create',
    'promo-list.edit',
    'promo-list.delete',
  ],
  'plan-list': [
    'plan-list.create',
    'plan-list.edit',
    'plan-list.delete',
  ],
  'location-list': [
    'location-list.create',
    'location-list.edit',
    'location-list.delete',
  ],
  lcp: [
    'lcp.create',
    'lcp.edit',
    'lcp.delete',
  ],
  nap: [
    'nap.create',
    'nap.edit',
    'nap.delete',
  ],
  ports: [
    'ports.create',
    'ports.edit',
    'ports.delete',
  ],
  'router-models': [
    'router-models.create',
    'router-models.edit',
    'router-models.delete',
  ],
  'status-remarks-list': [
    'status-remarks-list.create',
    'status-remarks-list.edit',
    'status-remarks-list.delete',
  ],
  'usage-type': [
    'usage-type.create',
    'usage-type.edit',
    'usage-type.delete',
  ],
  'vlan-config': [
    'vlan-config.create',
    'vlan-config.edit',
    'vlan-config.delete',
  ],
  'payment-method': [
    'payment-method.create',
    'payment-method.edit',
    'payment-method.delete',
  ],
  'work-category': [
    'work-category.create',
    'work-category.edit',
    'work-category.delete',
  ],
  'radius-config': [
    'radius-config.create',
    'radius-config.edit',
    'radius-config.delete',
  ],
  'smart-olt': [
    'smart-olt.create',
    'smart-olt.edit',
    'smart-olt.delete',
  ],
  'sms-config': [
    'sms-config.create',
    'sms-config.edit',
    'sms-config.delete',
  ],
  'sms-template': [
    'sms-template.create',
    'sms-template.edit',
    'sms-template.delete',
  ],
  'email-templates': [
    'email-templates.create',
    'email-templates.edit',
    'email-templates.delete',
  ],
  'pppoe-setup': [
    'pppoe-setup.create',
    'pppoe-setup.edit',
    'pppoe-setup.delete',
  ],
  'concern-config': [
    'concern-config.create',
    'concern-config.edit',
    'concern-config.delete',
  ],
  'billing-config': [
    'billing-config.create',
    'billing-config.edit',
    'billing-config.delete',
  ],
  'user-management': [
    'user-management.create',
    'user-management.edit',
    'user-management.delete',
  ],
  'tech-users': [
    'tech-users.create',
    'tech-users.edit',
    'tech-users.delete',
  ],
  organization: [
    'organization.create',
    'organization.edit',
    'organization.delete',
  ],
  roles: [
    'roles.create',
    'roles.edit',
    'roles.delete',
  ],
  'group-management': [
    'group-management.create',
    'group-management.edit',
    'group-management.delete',
  ],
};

/**
 * The standard verbs, in the order the Role modal shows them. A page whose
 * controls are the ordinary Add / Edit / Delete declares exactly these.
 */
export const CRUD_VERBS = ['create', 'edit', 'delete'] as const;

/** How each standard verb is written on a checkbox. */
const CRUD_VERB_LABELS: Record<string, string> = {
  create: 'Add',
  edit: 'Edit',
  delete: 'Delete',
};

/** Every valid key. */
export const ALL_PERMISSIONS: string[] = [
  ...PAGES,
  ...Object.values(ACTIONS).flat(),
];

/** ALL_PERMISSIONS as a set, for filtering a stored list down to real keys. */
const KNOWN_KEYS = new Set<string>(ALL_PERMISSIONS);

/**
 * The generation of the permission model Role Management stamps on a role it
 * saves. Mirrors Permissions::CURRENT_VERSION. A custom role below it
 * (permissions_version null or 0) was saved before per-action keys existed.
 */
export const CURRENT_VERSION = 1;

/**
 * Pages whose buttons every holder of the page saw before per-action keys
 * existed. Mirrors Permissions::LEGACY_GRANT_ALL_PAGES: a custom role saved
 * before then holds every action of each of these pages it holds. Every other
 * page's stored sub-keys are read as they are.
 */
export const LEGACY_GRANT_ALL_PAGES: string[] = [
  'promo-list', 'plan-list', 'location-list', 'lcp', 'nap', 'ports',
  'router-models', 'status-remarks-list', 'usage-type', 'vlan-config',
  'payment-method', 'work-category', 'radius-config', 'smart-olt',
  'sms-config', 'sms-template', 'email-templates', 'pppoe-setup',
  'concern-config', 'billing-config',
  'user-management', 'tech-users', 'organization', 'roles', 'group-management',
  'commission',
  'monthly-payables', 'expenses', 'expenses-category',
  'work-order',
  'soa-generation',
];

/**
 * Keys that no longer exist, and the keys that took their place. Mirrors
 * Permissions::RETIRED_ACTIONS: still read, never offered.
 */
export const RETIRED_ACTIONS: Record<string, string[]> = {
  'ports.manage': ['ports.create', 'ports.edit', 'ports.delete'],
  'router-models.manage': ['router-models.create', 'router-models.edit', 'router-models.delete'],
  'status-remarks-list.manage': ['status-remarks-list.create', 'status-remarks-list.edit', 'status-remarks-list.delete'],
};

const unique = (keys: string[]): string[] => Array.from(new Set(keys));

/** Replace each retired key with the keys that took its place. */
export const expandRetired = (keys: string[]): string[] =>
  keys.flatMap(key => RETIRED_ACTIONS[key] ?? [key]);

/** Add the parent page of every "page.verb" key present. */
export const withImpliedPages = (keys: string[]): string[] => {
  const result = [...keys];

  keys.forEach(key => {
    const dot = key.indexOf('.');
    if (dot > 0 && !result.includes(key.slice(0, dot))) result.push(key.slice(0, dot));
  });

  return unique(result);
};

/**
 * A custom role's own stored keys, read the way the server reads them
 * (Permissions::roleKeys): a legacy row's grandfathered actions appended after
 * the stored keys (so the first key, where the role lands, stays first),
 * retired keys replaced, and the page of each sub action added.
 */
export const resolveOwnKeys = (stored: string[], legacy: boolean): string[] => {
  const withLegacy = legacy
    ? [...stored, ...stored.filter(key => LEGACY_GRANT_ALL_PAGES.includes(key)).flatMap(key => ACTIONS[key] ?? [])]
    : stored;

  return withImpliedPages(expandRetired(unique(withLegacy)));
};

/** How each key is written in Role Management. */
export const PERMISSION_LABELS: Record<string, string> = {
  'dashboard': 'Dashboard',
  'agent-dashboard': 'Agent Dashboard',
  'customer-dashboard': 'Customer Dashboard',
  'customer-bills': 'Bills',
  'customer-support': 'Support',
  'agent-application': 'Agent Application',
  'live-monitor': 'Monitoring',
  'customer': 'Customer',
  'transaction-list': 'Transaction List',
  'transactions-revert': 'Revert Requests',
  'prepaid-override': 'Prepaid Override',
  'payment-portal': 'Payment Portal',
  'soa': 'Statements',
  'invoice': 'Invoice',
  'overdue': 'Overdue',
  'so-charge': 'SO Charge',
  'dc-notice': 'DC Notice',
  'mass-rebate': 'Rebates',
  'staggered-payment': 'Staggered',
  'discounts': 'Discounts',
  'application-management': 'Application',
  'job-order': 'Job Order',
  'service-order': 'Service Order',
  'work-order': 'Work Order',
  'lcp-nap-location': 'LCP/NAP Location',
  'sms-blast': 'SMS Blast',
  'reports': 'Reports',
  'commission': 'Pay Out/In',
  'bonus-history': 'Bonus History',
  'agent-invoices': 'Agent Invoices',
  'agent-payout': 'Agent Payout',
  'agent-management': 'Agent Management',
  'team-agent': 'Team Agents',
  'inventory': 'Inventory',
  'inventory-category-list': 'Inventory Category List',
  'monthly-payables': 'Monthly Payables',
  'expenses': 'Expenses',
  'expenses-category': 'Expenses Category',
  'promo-list': 'Promo',
  'plan-list': 'Plan',
  'location-list': 'Location',
  'lcp': 'LCP',
  'nap': 'NAP',
  'usage-type': 'Usage Type',
  'vlan-config': 'VLAN Config',
  'payment-method': 'Payment Method',
  'work-category': 'Work Category',
  'radius-config': 'Radius Config',
  'smart-olt': 'SmartOLT Config',
  'sms-config': 'SMS Config',
  'sms-template': 'SMS Template',
  'email-templates': 'Email Templates',
  'pppoe-setup': 'PPPoE Setup',
  'concern-config': 'Concern Config',
  'billing-config': 'Billing Configurations',
  'user-management': 'Users Management',
  'tech-users': 'Tech Users',
  'organization': 'Organization',
  'roles': 'Roles Management',
  'disconnected-logs': 'Disconnected Logs',
  'reconnection-logs': 'Reconnection Logs',
  'sms-logs': 'SMS Logs',
  'email-logs': 'Email Logs',
  'data-logs': 'Data Logs',
  'smart-olt-logs': 'Smart OLT Logs',
  'radius-logs': 'Radius Logs',
  'system-logs': 'System Logs',
  'smartolt-tool': 'SmartOLT Tool',
  'mikrotik-radius-tool': 'Mikrotik Radius Tool',
  'xendit-reconcile-tool': 'Xendit Reconciliation',
  'billing-reconcile-tool': 'Billing Reconcile',
  'settings': 'Settings',
  'soa-generation': 'SOA Generation',
  'ports': 'Ports',
  'router-models': 'Router Models',
  'status-remarks-list': 'Status Remarks',
  'group-management': 'Affiliates',
  'sms-blast-logs': 'SMS Blast Logs',
  'expenses-log': 'Expenses Log',

  // Sub actions, labelled as the button reads.
  'job-order.approve': 'Approve',
  'job-order.failed': 'Failed',
  'job-order.tech-edit': 'Tech Edit',
  'job-order.admin-edit': 'Admin Edit',
  'job-order.attachment': 'Attachment',
  'customer.so-request': 'SO Request',
  'customer.details-edit': 'Details Edit',
  'customer.attachment': 'Attachment',
  'customer.transact': 'Transact',
  'customer.prepaid-override': 'Prepaid Override',
  'transaction-list.batch-approve': 'Batch Approve',
  'transaction-list.approve': 'Approve',
  'transaction-list.revert-request': 'Revert Request',
  'prepaid-override.approve': 'Approve',
  'mass-rebate.add': 'Add Rebate',
  'staggered-payment.add': 'Add Staggered',
  'discounts.add': 'Add Discount',
  'application-management.move-to-jo': 'Move to JO',
  'application-management.quick-status': 'Quick Status',
  'service-order.tech-edit': 'Tech Edit',
  'service-order.admin-edit': 'Admin Edit',
  'work-order.manage': 'Add / Delete',
  'reports.manage': 'Manage',
  'reports.delete': 'Delete',
  'commission.create': 'Add',
  'bonus-history.payout': 'Payout',
  'agent-payout.approve': 'Approve',
  'agent-invoices.generate': 'Generate',
  'agent-invoices.status': 'Set Status',
  'agent-invoices.payout': 'Pay Out',
  'monthly-payables.generate': 'Generate Month',
  'monthly-payables.pay': 'Pay',
  'transaction-list.delete': 'Delete',
  'transactions-revert.approve': 'Approve',
  'soa-generation.manage': 'Generate',
};

/**
 * How a key is written on screen. A standard verb is answered from
 * CRUD_VERB_LABELS; an explicit PERMISSION_LABELS entry wins.
 */
export const labelFor = (key: string): string => {
  const explicit = PERMISSION_LABELS[key];
  if (explicit) return explicit;

  const verb = key.includes('.') ? key.slice(key.indexOf('.') + 1) : '';

  return CRUD_VERB_LABELS[verb] ?? key;
};

/**
 * The order and grouping Role Management presents the pages in, following the
 * sidebar. Any page not named in a group is appended to "Other".
 */
export const PERMISSION_GROUPS: Array<{ label: string; pages: string[] }> = [
  { label: 'Dashboards', pages: ['dashboard', 'agent-dashboard', 'live-monitor'] },
  {
    label: 'Billing',
    pages: [
      'customer', 'transaction-list', 'transactions-revert', 'prepaid-override',
      'payment-portal', 'soa', 'invoice', 'overdue', 'so-charge', 'dc-notice',
      'mass-rebate', 'staggered-payment', 'discounts', 'soa-generation',
    ],
  },
  {
    label: 'Operations',
    pages: [
      'application-management', 'job-order', 'service-order',
      'work-order', 'lcp-nap-location', 'sms-blast', 'reports',
    ],
  },
  {
    label: 'Agent',
    pages: ['commission', 'bonus-history', 'team-agent', 'agent-management', 'agent-payout', 'agent-invoices'],
  },
  { label: 'Inventory', pages: ['inventory', 'inventory-category-list'] },
  { label: 'Expenses', pages: ['monthly-payables', 'expenses', 'expenses-category'] },
  {
    label: 'Configurations',
    pages: [
      'promo-list', 'plan-list', 'location-list', 'lcp', 'nap', 'ports',
      'router-models', 'status-remarks-list', 'usage-type',
      'vlan-config', 'payment-method', 'work-category', 'radius-config',
      'smart-olt', 'sms-config', 'sms-template', 'email-templates',
      'pppoe-setup', 'concern-config', 'billing-config',
    ],
  },
  { label: 'Users', pages: ['user-management', 'tech-users', 'organization', 'roles', 'group-management'] },
  {
    label: 'Logs',
    pages: [
      'disconnected-logs', 'reconnection-logs', 'sms-logs', 'sms-blast-logs',
      'email-logs', 'data-logs', 'expenses-log', 'smart-olt-logs',
      'radius-logs', 'system-logs',
    ],
  },
  {
    label: 'Tools',
    pages: [
      'smartolt-tool', 'mikrotik-radius-tool',
      'xendit-reconcile-tool', 'billing-reconcile-tool',
    ],
  },
  { label: 'Customer Portal', pages: ['customer-dashboard', 'customer-bills', 'customer-support', 'agent-application'] },
  { label: 'Settings', pages: ['settings'] },
];

/** The groups, with any unfiled page swept into a final "Other". */
export const permissionGroups = (): Array<{ label: string; pages: string[] }> => {
  const filed = new Set(PERMISSION_GROUPS.flatMap(group => group.pages));
  const unfiled = PAGES.filter(page => !filed.has(page));

  return unfiled.length > 0
    ? [...PERMISSION_GROUPS, { label: 'Other', pages: unfiled as unknown as string[] }]
    : PERMISSION_GROUPS;
};

/**
 * What each seeded role holds: a copy of Permissions::ROLE_PERMISSIONS, which
 * is the union of what the web app and the mobile app gave each role before
 * permission keys existed. The web app narrows a few rows back to what it drew
 * itself; see WEB_WITHHELD below.
 */
export const ROLE_PERMISSIONS: Record<number, string[]> = {
  [ROLE.SUPER_ADMIN]: [WILDCARD],
  [ROLE.ADMINISTRATOR]: [
    'dashboard',
    'live-monitor',
    'customer',
    'customer.so-request',
    'customer.details-edit',
    'customer.attachment',
    'customer.transact',
    'customer.prepaid-override',
    'transaction-list',
    'transaction-list.batch-approve',
    'transaction-list.approve',
    'transaction-list.revert-request',
    'transactions-revert',
    'prepaid-override',
    'payment-portal',
    'soa',
    'invoice',
    'overdue',
    'so-charge',
    'dc-notice',
    'mass-rebate',
    'mass-rebate.add',
    'staggered-payment',
    'staggered-payment.add',
    'discounts',
    'discounts.add',
    'soa-generation',
    'soa-generation.manage',
    'application-management',
    'application-management.move-to-jo',
    'application-management.quick-status',
    'job-order',
    'job-order.approve',
    'job-order.failed',
    'job-order.admin-edit',
    'job-order.attachment',
    'service-order',
    'service-order.admin-edit',
    'work-order',
    'work-order.manage',
    'lcp-nap-location',
    'sms-blast',
    'reports',
    'reports.manage',
    'commission',
    'commission.create',
    'bonus-history',
    'bonus-history.payout',
    'agent-invoices',
    'agent-invoices.generate',
    'agent-invoices.status',
    'agent-invoices.payout',
    'agent-payout',
    'agent-payout.approve',
    'agent-management',
    'team-agent',
    'inventory',
    'inventory-category-list',
    'monthly-payables',
    'monthly-payables.create',
    'monthly-payables.edit',
    'monthly-payables.delete',
    'monthly-payables.generate',
    'monthly-payables.pay',
    'expenses',
    'expenses.create',
    'expenses.edit',
    'expenses.delete',
    'expenses-category',
    'expenses-category.create',
    'expenses-category.edit',
    'expenses-category.delete',
    'promo-list',
    'promo-list.create',
    'promo-list.edit',
    'promo-list.delete',
    'plan-list',
    'plan-list.create',
    'plan-list.edit',
    'plan-list.delete',
    'location-list',
    'location-list.create',
    'location-list.edit',
    'location-list.delete',
    'lcp',
    'lcp.create',
    'lcp.edit',
    'lcp.delete',
    'nap',
    'nap.create',
    'nap.edit',
    'nap.delete',
    'ports',
    'ports.create',
    'ports.edit',
    'ports.delete',
    'router-models',
    'router-models.create',
    'router-models.edit',
    'router-models.delete',
    'status-remarks-list',
    'status-remarks-list.create',
    'status-remarks-list.edit',
    'status-remarks-list.delete',
    'usage-type',
    'usage-type.create',
    'usage-type.edit',
    'usage-type.delete',
    'payment-method',
    'payment-method.create',
    'payment-method.edit',
    'payment-method.delete',
    'work-category',
    'work-category.create',
    'work-category.edit',
    'work-category.delete',
    'radius-config',
    'radius-config.create',
    'radius-config.edit',
    'radius-config.delete',
    'smart-olt',
    'smart-olt.create',
    'smart-olt.edit',
    'smart-olt.delete',
    'sms-config',
    'sms-config.create',
    'sms-config.edit',
    'sms-config.delete',
    'sms-template',
    'sms-template.create',
    'sms-template.edit',
    'sms-template.delete',
    'email-templates',
    'email-templates.create',
    'email-templates.edit',
    'email-templates.delete',
    'pppoe-setup',
    'pppoe-setup.create',
    'pppoe-setup.edit',
    'pppoe-setup.delete',
    'concern-config',
    'concern-config.create',
    'concern-config.edit',
    'concern-config.delete',
    'billing-config',
    'billing-config.create',
    'billing-config.edit',
    'billing-config.delete',
    'user-management',
    'user-management.create',
    'user-management.edit',
    'user-management.delete',
    'tech-users',
    'tech-users.create',
    'tech-users.edit',
    'tech-users.delete',
    'organization',
    'organization.create',
    'organization.edit',
    'organization.delete',
    'roles',
    'roles.create',
    'roles.edit',
    'roles.delete',
    'group-management',
    'group-management.create',
    'group-management.edit',
    'group-management.delete',
    'disconnected-logs',
    'reconnection-logs',
    'sms-logs',
    'sms-blast-logs',
    'email-logs',
    'data-logs',
    'expenses-log',
    'smart-olt-logs',
    'radius-logs',
    'system-logs',
    'smartolt-tool',
    'mikrotik-radius-tool',
    'xendit-reconcile-tool',
    'billing-reconcile-tool',
    'settings',
  ],
  [ROLE.TECHNICIAN]: [
    'job-order',
    'job-order.tech-edit',
    'job-order.attachment',
    'service-order',
    'service-order.tech-edit',
    'work-order',
    'lcp-nap-location',
  ],
  [ROLE.CUSTOMER]: [
    'customer-dashboard',
    'customer-bills',
    'customer-support',
  ],
  [ROLE.AGENT]: [
    'agent-dashboard',
    'agent-application',
    'job-order',
    'work-order',
    'bonus-history',
    'agent-invoices',
  ],
  [ROLE.INVENTORY_STAFF]: [
    'inventory',
    'inventory-category-list',
  ],
  [ROLE.OSP]: [
    'work-order',
    'work-order.manage',
    'lcp-nap-location',
  ],
  [ROLE.HEAD_TECH]: [
    'application-management',
    'application-management.move-to-jo',
    'application-management.quick-status',
    'job-order',
    'job-order.admin-edit',
    'job-order.attachment',
    'service-order',
    'service-order.admin-edit',
    'work-order',
    'work-order.manage',
    'lcp-nap-location',
    'customer.so-request',
    'customer.details-edit',
    'customer.attachment',
    'customer.transact',
    'customer.prepaid-override',
    'location-list',
    'location-list.create',
    'location-list.edit',
    'location-list.delete',
    'lcp',
    'lcp.create',
    'lcp.edit',
    'lcp.delete',
    'nap',
    'nap.create',
    'nap.edit',
    'nap.delete',
    'smartolt-tool',
    'mikrotik-radius-tool',
  ],
};

/**
 * Keys a seeded role holds in the shared table that the web app does not act
 * on for that role.
 *
 * ROLE_PERMISSIONS is shared with the mobile app and the server, and for a few
 * roles it is the union of what the two clients showed. Where the mobile app
 * showed a role something the web app never did, the web keeps its own
 * presentation: the key stays in the table (so the server allows what the
 * mobile app does), and the web answers "no" for it. Withholding a page also
 * withholds every action on it.
 *
 * Only seeded roles are affected. A custom role, including a hybrid built on
 * one of these, uses exactly the list the server resolved for it.
 *
 * Keyed by role id as a number literal (not ROLE.X) so the parity test, which
 * reads the first `[ROLE.X]: [` in this file, only ever reads ROLE_PERMISSIONS.
 */
export const WEB_WITHHELD: Record<number, string[]> = {
  // Administrator: the mobile Menu opens Configurations, Users, Logs, Settings
  // and Reports for role 1; the web sidebar never listed them for role 1 (they
  // are SuperAdmin entries there, and the web renders Reports for SuperAdmin
  // alone).
  1: [
    'staggered-payment', 'soa-generation', 'reports', 'settings',
    'promo-list', 'plan-list', 'location-list', 'lcp', 'nap', 'ports',
    'router-models', 'status-remarks-list', 'usage-type', 'vlan-config',
    'payment-method', 'work-category', 'radius-config', 'smart-olt',
    'sms-config', 'sms-template', 'email-templates', 'pppoe-setup',
    'concern-config', 'billing-config',
    'user-management', 'tech-users', 'organization', 'roles', 'group-management',
    'sms-blast-logs', 'expenses-log', 'smart-olt-logs', 'radius-logs', 'system-logs',
  ],
  // Technician: mobile lists Work Order and runs the technician Done form,
  // attachments and Service Order edit by role; the web showed none of them.
  2: [
    'work-order',
    'job-order.tech-edit', 'job-order.attachment',
    'service-order.tech-edit',
  ],
  // Head Technician: mobile shows the admin Done form, attachments, Service
  // Order edit and the Application Move to JO / status buttons; the web did not.
  8: [
    'application-management.move-to-jo', 'application-management.quick-status',
    'job-order.admin-edit', 'job-order.attachment',
    'service-order.admin-edit',
  ],
};

/**
 * Sections a seeded role opens on the web without holding their key, and which
 * no menu entry offers it: the header bell's shortcuts.
 *
 * The bell's "Needs attention" counts (GET notifications/nav-badges: pending
 * applications, job orders awaiting billing, open service and work orders,
 * pending transactions) and its feed (GET notifications/consolidated: pending
 * applications, finished job orders and service orders) are sent to every
 * signed-in role, and before the permission table each shortcut opened its page
 * for whoever clicked it. Those pages worked for these roles — as a list, with
 * each page's own buttons following the role — so the shortcuts keep opening
 * them. They are not menu entries, never a landing page, and grant no action on
 * the page. Revert requests are left out: that feed is SuperAdmin's alone.
 *
 * Only seeded roles are listed. A custom role opens exactly what it holds.
 * Keyed by role id as a number literal, like WEB_WITHHELD.
 */
export const WEB_REACHABLE: Record<number, string[]> = {
  2: ['application-management', 'work-order', 'transaction-list'],
  4: ['application-management', 'service-order', 'transaction-list'],
  5: ['application-management', 'job-order', 'service-order', 'work-order', 'transaction-list'],
  6: ['application-management', 'job-order', 'service-order', 'transaction-list'],
  8: ['transaction-list'],
};

/**
 * The bell's queues, which a custom role saved before the permission table
 * could open from its shortcuts whatever pages it held. Kept for such a role
 * (AuthLike.permissions_legacy, or a session whose list is still the raw stored
 * row) until the role is saved from the Roles screen. Like WEB_REACHABLE these
 * are not menu entries, never a landing page, and grant no action on the page.
 */
export const LEGACY_CUSTOM_REACHABLE: string[] = [
  'application-management', 'job-order', 'service-order', 'work-order', 'transaction-list',
];

/** A seeded role's keys as the web app uses them: the table less WEB_WITHHELD. */
const webKeysForSeededRole = (roleId: number): string[] => {
  const withheld = WEB_WITHHELD[roleId] ?? [];
  const pages = withheld.filter(key => !key.includes('.'));

  return (ROLE_PERMISSIONS[roleId] ?? []).filter(key =>
    !withheld.includes(key) && !pages.includes(key.split('.')[0])
  );
};

/** Where each seeded role lands after signing in. */
export const ROLE_HOME: Record<number, string> = {
  [ROLE.SUPER_ADMIN]: 'dashboard',
  [ROLE.ADMINISTRATOR]: 'dashboard',
  [ROLE.TECHNICIAN]: 'job-order',
  [ROLE.CUSTOMER]: 'customer-dashboard',
  // The 'dashboard' section renders the agent's own dashboard for an agent.
  [ROLE.AGENT]: 'dashboard',
  [ROLE.INVENTORY_STAFF]: 'inventory',
  [ROLE.OSP]: 'work-order',
  [ROLE.HEAD_TECH]: 'application-management',
};

/**
 * What a section of the app requires to be opened, when that is not simply its
 * own id.
 */
export const SECTION_PERMISSION_OVERRIDES: Record<string, string | string[]> = {
  // Which dashboard renders depends on the role, so any landing key opens it.
  dashboard: ['dashboard', 'agent-dashboard', 'customer-dashboard'],
};

/** The key(s) a section requires. */
export const permissionForSection = (section: string): string | string[] =>
  SECTION_PERMISSION_OVERRIDES[section] ?? section;

/**
 * Is this a section Dashboard renders? Every page key is (see its switch);
 * a sub action ("job-order.approve") or an unknown key is not.
 */
export const isSection = (key?: string | null): key is string =>
  !!key && (PAGES as readonly string[]).includes(key);

/** The shape this module reads out of localStorage's authData. */
export interface AuthLike {
  id?: number | string | null;
  role?: string | null;
  role_id?: number | string | null;
  permissions?: string[] | string | null;
  home?: string | null;
  /**
   * True when `permissions` is the list the server resolved (a sign-in against
   * a backend that sends `home`, or GET /me/permissions). Anything else — a
   * session signed in before this version, or against a backend that predates
   * it — holds the custom role's raw stored row, which is resolved here the
   * way the server would.
   */
  permissions_resolved?: boolean | null;
  /**
   * True for a custom role saved before the permission table existed (the
   * server's Permissions::isLegacyUser). Such a role could open every queue the
   * bell links to, whatever it held; see LEGACY_CUSTOM_REACHABLE.
   */
  permissions_legacy?: boolean | null;
}

/** Resolve a role id from whichever of id/name the caller has. */
export const roleIdOf = (auth?: AuthLike | null): number => {
  if (!auth) return 0;

  const fromId = Number(auth.role_id);
  if (Number.isFinite(fromId) && fromId > 0) return fromId;

  const name = (auth.role || '').toLowerCase().replace(/[\s_-]+/g, '');
  return ROLE_NAME_TO_ID[name] ?? 0;
};

export const isLockedRole = (roleId: number): boolean => LOCKED_ROLE_IDS.includes(roleId);

/**
 * Parse the permissions field. Older rows hold a JSON string or a
 * comma-separated list, so all three shapes are accepted.
 */
export const parsePermissions = (raw: unknown): string[] => {
  if (Array.isArray(raw)) {
    return raw.map(String).filter(Boolean);
  }

  if (typeof raw === 'string' && raw.trim() !== '') {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
    } catch {
      // Not JSON: fall through to the comma-separated reading.
    }
    return raw.split(',').map(p => p.trim()).filter(Boolean);
  }

  return [];
};

/**
 * The keys a seeded role holds, which is what a hybrid role inherits. Empty for
 * anything that is not one of the eight.
 */
export const inheritedPermissions = (baseRoleId?: number | string | null): string[] => {
  const base = Number(baseRoleId);

  return isLockedRole(base) ? ROLE_PERMISSIONS[base] ?? [] : [];
};

/**
 * The keys a user effectively holds.
 *
 * A seeded role is answered from the table above. A custom role uses the list
 * the server resolved for it (login / GET /me/permissions), which already has a
 * hybrid's base keys and a legacy row's grandfathered actions merged in, so it
 * is not recomputed from the raw role row — unless the list IS the raw row
 * (see AuthLike.permissions_resolved).
 */
export const permissionsFor = (auth?: AuthLike | null): string[] => {
  if (!auth) return [];

  const roleId = roleIdOf(auth);

  if (roleId === ROLE.SUPER_ADMIN) return [WILDCARD];

  // A seeded role holds exactly its table row (less what the web withholds).
  // Its sub actions do not imply their page: the Head Technician holds the
  // customer actions for the customer panel inside a job order without holding
  // the Customer page.
  if (isLockedRole(roleId)) return webKeysForSeededRole(roleId);

  const keys = parsePermissions(auth.permissions);
  if (keys.includes(WILDCARD)) return [WILDCARD];

  // A custom role: the list exactly as the server resolved it. The server has
  // already added the page implied by each of the role's own sub actions and
  // merged a hybrid's base keys as written (no implied pages for those), so
  // nothing is added here.
  if (auth.permissions_resolved === true) return unique(keys);

  // The raw stored row: a session signed in before this version, or against a
  // backend without the permission table. Such a row was saved before
  // per-action keys existed, and on the pages whose buttons it always had
  // (LEGACY_GRANT_ALL_PAGES) it names only the page. Read strictly it would
  // lose those buttons until the server answers, or for good if the backend
  // has no /me/permissions yet, so it is read the way the server reads it.
  return resolveOwnKeys(keys, true);
};

/**
 * Does this set of keys satisfy the requirement? Several keys means any one is
 * enough; an empty requirement means no permission is needed.
 */
export const permissionsAllow = (held: string[], required?: string | string[] | null): boolean => {
  if (!required || (Array.isArray(required) && required.length === 0)) return true;
  if (held.includes(WILDCARD)) return true;

  return (Array.isArray(required) ? required : [required]).some(key => held.includes(key));
};

/**
 * Can this user open the section? The check Dashboard's section guard and the
 * header bell's shortcuts make: the key the section requires, or for a seeded
 * role one of its WEB_REACHABLE shortcuts.
 */
export const canOpenSection = (auth: AuthLike | null | undefined, section: string): boolean => {
  if (!auth) return false;
  if (permissionsAllow(permissionsFor(auth), permissionForSection(section))) return true;

  const roleId = roleIdOf(auth);
  if (isLockedRole(roleId)) return (WEB_REACHABLE[roleId] ?? []).includes(section);

  // A legacy custom role keeps the bell's queues it could always open. A list
  // the server has not resolved is the raw row of a role signed in before this
  // version, which is legacy by definition.
  const legacy = auth.permissions_legacy === true ||
    (auth.permissions_resolved !== true && !(auth.permissions === undefined || auth.permissions === null));
  if (legacy && LEGACY_CUSTOM_REACHABLE.includes(section)) return true;

  // A custom role whose list has not reached this client at all (older
  // sessions stored none) has always opened on the general dashboard while its
  // list was fetched, so it keeps exactly that until the server answers. It is
  // not a key: the menu stays empty, as it always did. An empty list is an
  // answer and gets nothing.
  return (auth.permissions === undefined || auth.permissions === null) && section === 'dashboard';
};

/**
 * Where to send this user when they sign in, or when the section they asked for
 * is not theirs. Always a section Dashboard renders and its guard opens, never
 * a sub action, an unknown key, or a server `home` the guard would refuse.
 */
export const homeSectionFor = (auth?: AuthLike | null): string => {
  if (!auth) return 'dashboard';

  const roleId = roleIdOf(auth);

  if (ROLE_HOME[roleId]) return ROLE_HOME[roleId];

  // A custom role: the page the server named (a hybrid's base role's landing),
  // then the first page it holds, in its stored order.
  const held = permissionsFor(auth);
  const opens = (section?: string | null): section is string =>
    isSection(section) && permissionsAllow(held, permissionForSection(section));

  if (opens(auth.home)) return auth.home;

  return held.find(opens) ?? 'dashboard';
};

/**
 * The ticks Role Management opens a custom role with: the keys it holds of its
 * own (a hybrid's inherited half is shown separately), limited to keys the
 * catalog offers, so a save never sends back a key the server refuses.
 *
 * The server's `effective_permissions` is used when present. Without it (a
 * backend that predates it) the stored column is resolved here: a row saved
 * before per-action keys existed opens with the buttons it has always had, so
 * editing only its name does not silently take them away.
 */
export const roleModalSeed = (role: {
  permissions?: unknown;
  effective_permissions?: unknown;
  permissions_version?: unknown;
}): string[] => {
  const own = Array.isArray(role.effective_permissions)
    ? withImpliedPages(expandRetired(role.effective_permissions.map(String)))
    : resolveOwnKeys(
      parsePermissions(role.permissions),
      !(Number(role.permissions_version) >= CURRENT_VERSION)
    );

  return own.filter(key => KNOWN_KEYS.has(key));
};

/** Keep only keys the catalog offers. */
export const knownKeysOnly = (keys: string[]): string[] => keys.filter(key => KNOWN_KEYS.has(key));

/** What GET /me/permissions answers. */
export interface PermissionRefresh {
  role_id?: number | string | null;
  role?: string | null;
  permissions: string[];
  home?: string | null;
  permissions_legacy?: boolean | null;
}

const hasNoList = (auth?: AuthLike | null): boolean =>
  auth?.permissions === undefined || auth?.permissions === null;

/** Would these two accounts be shown the same app? */
export const sameAccess = (a?: AuthLike | null, b?: AuthLike | null): boolean =>
  Number(a?.role_id) === Number(b?.role_id) &&
  String(a?.role ?? '') === String(b?.role ?? '') &&
  (a?.home ?? null) === (b?.home ?? null) &&
  (a?.permissions_resolved === true) === (b?.permissions_resolved === true) &&
  (a?.permissions_legacy === true) === (b?.permissions_legacy === true) &&
  hasNoList(a) === hasNoList(b) &&
  JSON.stringify(parsePermissions(a?.permissions)) === JSON.stringify(parsePermissions(b?.permissions));

/**
 * The stored account with `patch` applied, or null when nothing may or need be
 * written: nobody is signed in any more (a sign-out cleared authData while the
 * request was in flight), a different account is (another tab signed someone
 * else in), or the patch changes nothing the app draws.
 */
export const mergeAuth = <T extends AuthLike>(
  current: T | null | undefined,
  signedInAs: unknown,
  patch: Partial<AuthLike>
): T | null => {
  if (!current || String(current.id) !== String(signedInAs)) return null;

  const updated = { ...current, ...patch } as T;

  return sameAccess(current, updated) ? null : updated;
};

/**
 * The fields a GET /me/permissions answer replaces. The role itself is taken
 * too: the user may have been moved to another role since signing in, and a
 * seeded role is answered from the table by role_id, so a stale id would keep
 * the old role's pages. The stored id is kept when it names the same role, so
 * a stored "2" does not become 2.
 */
export const refreshPatch = (current: AuthLike, fresh: PermissionRefresh): Partial<AuthLike> => {
  const freshRoleId = Number(fresh.role_id);

  return {
    ...(Number.isFinite(freshRoleId) && freshRoleId > 0 && freshRoleId !== Number(current.role_id)
      ? { role_id: freshRoleId }
      : {}),
    ...(typeof fresh.role === 'string' && fresh.role.trim() !== '' ? { role: fresh.role } : {}),
    permissions: fresh.permissions,
    home: fresh.home ?? null,
    permissions_resolved: true,
    permissions_legacy: fresh.permissions_legacy === true,
  };
};
