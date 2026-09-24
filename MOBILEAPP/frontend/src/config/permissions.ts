// The mobile app's copy of the permission table.
//
// The server is the authority: every endpoint is checked against
// backend/app/Support/ApiPermissionMap.php, whatever this file says.
// This file lets the UI decide what to *draw* without waiting for a round
// trip: which tabs to list, which page to open, which buttons to render.
//
// The mobile app and the web portal share one backend and therefore one set of
// keys. The catalog half of this file (PAGES through ROLE_HOME) mirrors
// backend/app/Support/Permissions.php and frontend/src/config/permissions.ts;
// PermissionsParityTest reads it as text and fails when they drift, so change
// the backend file first. The second half is mobile-only: the app's section ids
// are not all the same strings as the keys (it says "lcp-list" where the web
// says "lcp"), and each role's landing screen on mobile is its own.

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
 * How each seeded role is written in Role Management's "Start from a system
 * role" picker, widest access first.
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
 * Role names as the login response carries them (lowercased role_name), mapped
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
  headtechnician: ROLE.HEAD_TECH,
};

// ─────────────────────────────────────────────────────────────────────────────
// Catalog: kept identical to backend/app/Support/Permissions.php
// ─────────────────────────────────────────────────────────────────────────────

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
    'job-order.approve', 'job-order.failed', 'job-order.tech-edit', 'job-order.admin-edit',
    'job-order.attachment',
  ],
  customer: [
    'customer.so-request', 'customer.details-edit', 'customer.attachment', 'customer.transact',
    'customer.prepaid-override',
  ],
  'transaction-list': [
    'transaction-list.batch-approve', 'transaction-list.approve',
    'transaction-list.revert-request', 'transaction-list.delete',
  ],
  'transactions-revert': ['transactions-revert.approve'],
  'prepaid-override': ['prepaid-override.approve'],
  'mass-rebate': ['mass-rebate.add'],
  'staggered-payment': ['staggered-payment.add'],
  discounts: ['discounts.add'],
  'soa-generation': ['soa-generation.manage'],
  'application-management': ['application-management.move-to-jo', 'application-management.quick-status'],
  'service-order': ['service-order.tech-edit', 'service-order.admin-edit'],
  'work-order': ['work-order.manage'],
  reports: ['reports.manage', 'reports.delete'],
  commission: ['commission.create'],
  'bonus-history': ['bonus-history.payout'],
  'agent-payout': ['agent-payout.approve'],
  'agent-invoices': ['agent-invoices.generate', 'agent-invoices.status', 'agent-invoices.payout'],
  'monthly-payables': [
    'monthly-payables.create', 'monthly-payables.edit', 'monthly-payables.delete',
    'monthly-payables.generate', 'monthly-payables.pay',
  ],
  expenses: ['expenses.create', 'expenses.edit', 'expenses.delete'],
  'expenses-category': ['expenses-category.create', 'expenses-category.edit', 'expenses-category.delete'],
  'promo-list': ['promo-list.create', 'promo-list.edit', 'promo-list.delete'],
  'plan-list': ['plan-list.create', 'plan-list.edit', 'plan-list.delete'],
  'location-list': ['location-list.create', 'location-list.edit', 'location-list.delete'],
  lcp: ['lcp.create', 'lcp.edit', 'lcp.delete'],
  nap: ['nap.create', 'nap.edit', 'nap.delete'],
  ports: ['ports.create', 'ports.edit', 'ports.delete'],
  'router-models': ['router-models.create', 'router-models.edit', 'router-models.delete'],
  'status-remarks-list': [
    'status-remarks-list.create', 'status-remarks-list.edit', 'status-remarks-list.delete',
  ],
  'usage-type': ['usage-type.create', 'usage-type.edit', 'usage-type.delete'],
  'vlan-config': ['vlan-config.create', 'vlan-config.edit', 'vlan-config.delete'],
  'payment-method': ['payment-method.create', 'payment-method.edit', 'payment-method.delete'],
  'work-category': ['work-category.create', 'work-category.edit', 'work-category.delete'],
  'radius-config': ['radius-config.create', 'radius-config.edit', 'radius-config.delete'],
  'smart-olt': ['smart-olt.create', 'smart-olt.edit', 'smart-olt.delete'],
  'sms-config': ['sms-config.create', 'sms-config.edit', 'sms-config.delete'],
  'sms-template': ['sms-template.create', 'sms-template.edit', 'sms-template.delete'],
  'email-templates': ['email-templates.create', 'email-templates.edit', 'email-templates.delete'],
  'pppoe-setup': ['pppoe-setup.create', 'pppoe-setup.edit', 'pppoe-setup.delete'],
  'concern-config': ['concern-config.create', 'concern-config.edit', 'concern-config.delete'],
  'billing-config': ['billing-config.create', 'billing-config.edit', 'billing-config.delete'],
  'user-management': ['user-management.create', 'user-management.edit', 'user-management.delete'],
  'tech-users': ['tech-users.create', 'tech-users.edit', 'tech-users.delete'],
  organization: ['organization.create', 'organization.edit', 'organization.delete'],
  roles: ['roles.create', 'roles.edit', 'roles.delete'],
  'group-management': ['group-management.create', 'group-management.edit', 'group-management.delete'],
};

/**
 * Pairs that cannot both be held: one opens the technician's Done form, the
 * other the administrator's.
 */
export const EXCLUSIVE_PAIRS: Array<[string, string]> = [
  ['job-order.tech-edit', 'job-order.admin-edit'],
  ['service-order.tech-edit', 'service-order.admin-edit'],
];

/** The standard verbs, in the order Role Management shows them. */
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
  'soa-generation': 'SOA Generation',
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
  'ports': 'Ports',
  'router-models': 'Router Models',
  'status-remarks-list': 'Status Remarks',
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
  'group-management': 'Affiliates',
  'disconnected-logs': 'Disconnected Logs',
  'reconnection-logs': 'Reconnection Logs',
  'sms-logs': 'SMS Logs',
  'sms-blast-logs': 'SMS Blast Logs',
  'email-logs': 'Email Logs',
  'data-logs': 'Data Logs',
  'expenses-log': 'Expenses Log',
  'smart-olt-logs': 'Smart OLT Logs',
  'radius-logs': 'Radius Logs',
  'system-logs': 'System Logs',
  'smartolt-tool': 'SmartOLT Tool',
  'mikrotik-radius-tool': 'Mikrotik Radius Tool',
  'xendit-reconcile-tool': 'Xendit Reconciliation',
  'billing-reconcile-tool': 'Billing Reconcile',
  'settings': 'Settings',
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
  'transaction-list.delete': 'Delete',
  'transactions-revert.approve': 'Approve',
  'prepaid-override.approve': 'Approve',
  'mass-rebate.add': 'Add Rebate',
  'staggered-payment.add': 'Add Staggered',
  'discounts.add': 'Add Discount',
  'soa-generation.manage': 'Generate',
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
};

/**
 * How a key is written on screen. A standard verb falls back to
 * CRUD_VERB_LABELS; an explicit PERMISSION_LABELS entry wins.
 */
export const labelFor = (key: string): string => {
  const explicit = PERMISSION_LABELS[key];
  if (explicit) return explicit;

  const verb = key.includes('.') ? key.slice(key.indexOf('.') + 1) : '';

  return CRUD_VERB_LABELS[verb] ?? key;
};

/**
 * The order and grouping Role Management presents the pages in. Any page not
 * named in a group is appended to "Other", so nothing is ungrantable.
 */
export const PERMISSION_GROUPS: Array<{ label: string; pages: string[] }> = [
  { label: 'Dashboards', pages: ['dashboard', 'agent-dashboard', 'live-monitor'] },
  { label: 'Billing', pages: ['customer', 'transaction-list', 'transactions-revert', 'prepaid-override', 'payment-portal', 'soa', 'invoice', 'overdue', 'so-charge', 'dc-notice', 'mass-rebate', 'staggered-payment', 'discounts', 'soa-generation'] },
  { label: 'Operations', pages: ['application-management', 'job-order', 'service-order', 'work-order', 'lcp-nap-location', 'sms-blast', 'reports'] },
  { label: 'Agent', pages: ['commission', 'bonus-history', 'team-agent', 'agent-management', 'agent-payout', 'agent-invoices'] },
  { label: 'Inventory', pages: ['inventory', 'inventory-category-list'] },
  { label: 'Expenses', pages: ['monthly-payables', 'expenses', 'expenses-category'] },
  { label: 'Configurations', pages: ['promo-list', 'plan-list', 'location-list', 'lcp', 'nap', 'ports', 'router-models', 'status-remarks-list', 'usage-type', 'vlan-config', 'payment-method', 'work-category', 'radius-config', 'smart-olt', 'sms-config', 'sms-template', 'email-templates', 'pppoe-setup', 'concern-config', 'billing-config'] },
  { label: 'Users', pages: ['user-management', 'tech-users', 'organization', 'roles', 'group-management'] },
  { label: 'Logs', pages: ['disconnected-logs', 'reconnection-logs', 'sms-logs', 'sms-blast-logs', 'email-logs', 'data-logs', 'expenses-log', 'smart-olt-logs', 'radius-logs', 'system-logs'] },
  { label: 'Tools', pages: ['smartolt-tool', 'mikrotik-radius-tool', 'xendit-reconcile-tool', 'billing-reconcile-tool'] },
  { label: 'Customer Portal', pages: ['customer-dashboard', 'customer-bills', 'customer-support', 'agent-application'] },
  { label: 'Settings', pages: ['settings'] },
];

/** The groups, with any unfiled page swept into a final "Other". */
export const permissionGroups = (): Array<{ label: string; pages: string[] }> => {
  const filed = new Set(PERMISSION_GROUPS.flatMap(group => group.pages));
  const unfiled = (PAGES as readonly string[]).filter(page => !filed.has(page));

  return unfiled.length > 0
    ? [...PERMISSION_GROUPS, { label: 'Other', pages: unfiled }]
    : PERMISSION_GROUPS;
};

/** What each seeded role holds. */
export const ROLE_PERMISSIONS: Record<number, string[]> = {
  [ROLE.SUPER_ADMIN]: [WILDCARD],

  [ROLE.ADMINISTRATOR]: [
    'dashboard', 'live-monitor', 'customer', 'customer.so-request', 'customer.details-edit',
    'customer.attachment', 'customer.transact', 'customer.prepaid-override', 'transaction-list',
    'transaction-list.batch-approve', 'transaction-list.approve',
    'transaction-list.revert-request', 'transactions-revert', 'prepaid-override', 'payment-portal',
    'soa', 'invoice', 'overdue', 'so-charge', 'dc-notice', 'mass-rebate', 'mass-rebate.add',
    'staggered-payment', 'staggered-payment.add', 'discounts', 'discounts.add', 'soa-generation',
    'soa-generation.manage', 'application-management', 'application-management.move-to-jo',
    'application-management.quick-status', 'job-order', 'job-order.approve', 'job-order.failed',
    'job-order.admin-edit', 'job-order.attachment', 'service-order', 'service-order.admin-edit',
    'work-order', 'work-order.manage', 'lcp-nap-location', 'sms-blast', 'reports',
    'reports.manage', 'commission', 'commission.create', 'bonus-history', 'bonus-history.payout',
    'agent-invoices', 'agent-invoices.generate', 'agent-invoices.status', 'agent-invoices.payout',
    'agent-payout', 'agent-payout.approve', 'agent-management', 'team-agent', 'inventory',
    'inventory-category-list', 'monthly-payables', 'monthly-payables.create',
    'monthly-payables.edit', 'monthly-payables.delete', 'monthly-payables.generate',
    'monthly-payables.pay', 'expenses', 'expenses.create', 'expenses.edit', 'expenses.delete',
    'expenses-category', 'expenses-category.create', 'expenses-category.edit',
    'expenses-category.delete', 'promo-list', 'promo-list.create', 'promo-list.edit',
    'promo-list.delete', 'plan-list', 'plan-list.create', 'plan-list.edit', 'plan-list.delete',
    'location-list', 'location-list.create', 'location-list.edit', 'location-list.delete', 'lcp',
    'lcp.create', 'lcp.edit', 'lcp.delete', 'nap', 'nap.create', 'nap.edit', 'nap.delete', 'ports',
    'ports.create', 'ports.edit', 'ports.delete', 'router-models', 'router-models.create',
    'router-models.edit', 'router-models.delete', 'status-remarks-list',
    'status-remarks-list.create', 'status-remarks-list.edit', 'status-remarks-list.delete',
    'usage-type', 'usage-type.create', 'usage-type.edit', 'usage-type.delete', 'payment-method',
    'payment-method.create', 'payment-method.edit', 'payment-method.delete', 'work-category',
    'work-category.create', 'work-category.edit', 'work-category.delete', 'radius-config',
    'radius-config.create', 'radius-config.edit', 'radius-config.delete', 'smart-olt',
    'smart-olt.create', 'smart-olt.edit', 'smart-olt.delete', 'sms-config', 'sms-config.create',
    'sms-config.edit', 'sms-config.delete', 'sms-template', 'sms-template.create',
    'sms-template.edit', 'sms-template.delete', 'email-templates', 'email-templates.create',
    'email-templates.edit', 'email-templates.delete', 'pppoe-setup', 'pppoe-setup.create',
    'pppoe-setup.edit', 'pppoe-setup.delete', 'concern-config', 'concern-config.create',
    'concern-config.edit', 'concern-config.delete', 'billing-config', 'billing-config.create',
    'billing-config.edit', 'billing-config.delete', 'user-management', 'user-management.create',
    'user-management.edit', 'user-management.delete', 'tech-users', 'tech-users.create',
    'tech-users.edit', 'tech-users.delete', 'organization', 'organization.create',
    'organization.edit', 'organization.delete', 'roles', 'roles.create', 'roles.edit',
    'roles.delete', 'group-management', 'group-management.create', 'group-management.edit',
    'group-management.delete', 'disconnected-logs', 'reconnection-logs', 'sms-logs',
    'sms-blast-logs', 'email-logs', 'data-logs', 'expenses-log', 'smart-olt-logs', 'radius-logs',
    'system-logs', 'smartolt-tool', 'mikrotik-radius-tool', 'xendit-reconcile-tool',
    'billing-reconcile-tool', 'settings',
  ],

  [ROLE.TECHNICIAN]: [
    'job-order', 'job-order.tech-edit', 'job-order.attachment', 'service-order',
    'service-order.tech-edit', 'work-order', 'lcp-nap-location',
  ],

  [ROLE.CUSTOMER]: [
    'customer-dashboard', 'customer-bills', 'customer-support',
  ],

  [ROLE.AGENT]: [
    'agent-dashboard', 'agent-application', 'job-order', 'work-order', 'bonus-history',
    'agent-invoices',
  ],

  [ROLE.INVENTORY_STAFF]: [
    'inventory', 'inventory-category-list',
  ],

  [ROLE.OSP]: [
    'work-order', 'work-order.manage', 'lcp-nap-location',
  ],

  [ROLE.HEAD_TECH]: [
    'application-management', 'application-management.move-to-jo',
    'application-management.quick-status', 'job-order', 'job-order.admin-edit',
    'job-order.attachment', 'service-order', 'service-order.admin-edit', 'work-order',
    'work-order.manage', 'lcp-nap-location', 'customer.so-request', 'customer.details-edit',
    'customer.attachment', 'customer.transact', 'customer.prepaid-override', 'location-list',
    'location-list.create', 'location-list.edit', 'location-list.delete', 'lcp', 'lcp.create',
    'lcp.edit', 'lcp.delete', 'nap', 'nap.create', 'nap.edit', 'nap.delete', 'smartolt-tool',
    'mikrotik-radius-tool',
  ],
};

/** Where each seeded role lands after signing in on the web (server's table). */
export const ROLE_HOME: Record<number, string> = {
  [ROLE.SUPER_ADMIN]: 'dashboard',
  [ROLE.ADMINISTRATOR]: 'dashboard',
  [ROLE.TECHNICIAN]: 'job-order',
  [ROLE.CUSTOMER]: 'customer-dashboard',
  [ROLE.AGENT]: 'agent-dashboard',
  [ROLE.INVENTORY_STAFF]: 'inventory',
  [ROLE.OSP]: 'work-order',
  [ROLE.HEAD_TECH]: 'application-management',
};

// ─────────────────────────────────────────────────────────────────────────────
// Mobile-only
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The screen each seeded role opens on in the mobile app, as mobile section ids.
 *
 * Deliberately not ROLE_HOME: this reproduces the landing ladder the app used
 * before the permission port, which differs from the web for SuperAdmin (the
 * app has always opened Application Management for role 7). Changing a seeded
 * role's first screen is a product decision, not a side effect of the port.
 */
export const MOBILE_ROLE_HOME: Record<number, string> = {
  [ROLE.ADMINISTRATOR]: 'dashboard',
  [ROLE.TECHNICIAN]: 'job-order',
  [ROLE.CUSTOMER]: 'customer-dashboard',
  [ROLE.AGENT]: 'agent-dashboard',
  [ROLE.INVENTORY_STAFF]: 'inventory',
  [ROLE.OSP]: 'work-order',
  [ROLE.SUPER_ADMIN]: 'applicationManagement',
  [ROLE.HEAD_TECH]: 'applicationManagement',
};

/**
 * What a section of the app requires to be opened.
 *
 * A section needs an entry here only when its id is not itself the key.
 * Everything else is checked against its own id.
 */
export const SECTION_PERMISSION_OVERRIDES: Record<string, string | string[]> = {
  // Which dashboard renders depends on the role, so any landing key opens it.
  dashboard: ['dashboard', 'agent-dashboard', 'customer-dashboard'],

  // ── Sections the mobile app names differently from the key ───────────────
  applicationManagement: 'application-management',
  applicationVisit: 'application-management',
  Application: 'agent-application',
  'lcp-list': 'lcp',
  'nap-list': 'nap',
  'usage-type-list': 'usage-type',
  'payment-method-list': 'payment-method',
  'work-category-list': 'work-category',
  'router-model-list': 'router-models',
  'smart-olt-config': 'smart-olt',
  // Renders the SmartOLT file log specifically (type="smartolt").
  'file-log-viewer': 'smart-olt-logs',
  'so-charges': 'so-charge',
  'disconnection-logs': 'disconnected-logs',
  organizations: 'organization',
  rebate: 'mass-rebate',
  // The billing list is the customer billing desk's view.
  billing: 'customer',
  // Renders <Logs />, which reads /logs.
  'activity-logs': 'system-logs',

  // The Pay Out/In screen. An administrator holds it as 'commission'; an agent
  // reads it as their own history under 'bonus-history', the key the web
  // gives them. Either opens it.
  commission: ['commission', 'bonus-history'],

  // ── Sections that exist only on mobile ───────────────────────────────────
  // An agent's own history and achievements, scoped server side to them.
  'agent-history': ['commission', 'bonus-history'],
  achievement: ['commission', 'bonus-history'],
  // Release notes and the in-app menu are open to anyone signed in.
  'release-notes': [],
  menu: [],
  // Local diagnostics screens.
  'database-setup': 'settings',
  'database-test': 'settings',
};

/** The key(s) a section requires. */
export const permissionForSection = (section: string): string | string[] =>
  SECTION_PERMISSION_OVERRIDES[section] ?? section;

/**
 * The reverse: which mobile section shows a given key. The server names a
 * landing page with the shared key ("application-management"); the app opens
 * its own section id ("applicationManagement"). Only keys whose screen has a
 * different id are listed; every other key is its own section id.
 */
const SECTION_FOR_KEY: Record<string, string> = {
  'application-management': 'applicationManagement',
  'agent-application': 'Application',
  lcp: 'lcp-list',
  nap: 'nap-list',
  'usage-type': 'usage-type-list',
  'payment-method': 'payment-method-list',
  'work-category': 'work-category-list',
  'router-models': 'router-model-list',
  'smart-olt': 'smart-olt-config',
  'smart-olt-logs': 'file-log-viewer',
  'so-charge': 'so-charges',
  'disconnected-logs': 'disconnection-logs',
  organization: 'organizations',
  'mass-rebate': 'rebate',
  'system-logs': 'activity-logs',
};

export const sectionForPermission = (permission: string): string =>
  SECTION_FOR_KEY[permission] ?? permission;

/**
 * The lists the app shell (Dashboard's providers) loads on sign-in for every
 * role, and the key(s) the API asks for to read each one: the GET requirement
 * of that endpoint in backend/app/Support/ApiPermissionMap.php (any one key is
 * enough). A list is warmed only for a user the API would serve it to; nobody
 * else has a screen that reads it. Keep in step with the map.
 *
 * The inventory categories are not here: any signed-in user may read them.
 */
export const SHELL_PREFETCH_KEYS: Record<'applications' | 'jobOrders' | 'serviceOrders' | 'inventory', string[]> = {
  // GET applications (agent-application plus the map's OVERLAY_READERS)
  applications: [
    'agent-application', 'job-order.tech-edit', 'job-order.admin-edit', 'job-order.approve',
    'job-order.failed', 'job-order.attachment', 'service-order', 'application-management',
    'lcp-nap-location',
  ],
  // GET job-orders
  jobOrders: ['job-order'],
  // GET service-orders. Not `customer-support`: no customer screen reads this
  // provider (Support only creates requests), and the list holds other
  // customers' names, addresses and PPPoE passwords.
  serviceOrders: ['service-order'],
  // GET inventory
  inventory: ['inventory', 'job-order', 'service-order', 'work-order'],
};

/** The shape this module reads out of AsyncStorage's authData. */
export interface AuthLike {
  role?: string | null;
  role_id?: number | string | null;
  permissions?: string[] | string | null;
  home?: string | null;
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
 * comma-separated list, so all three shapes are accepted, as on the server.
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
 * anything that is not one of the eight, so roles never chain.
 */
export const inheritedPermissions = (baseRoleId?: number | string | null): string[] => {
  const base = Number(baseRoleId);

  return isLockedRole(base) ? ROLE_PERMISSIONS[base] ?? [] : [];
};

/**
 * The keys a user effectively holds, resolved the way the server resolves them.
 *
 * A seeded role holds its ROLE_PERMISSIONS entry exactly as written, with no
 * implied parent pages: Head Technician holds the customer.* actions for the
 * customer pane opened from a job order, but not the Customer page. A custom
 * role uses the list the server resolved for it (at sign-in and from
 * /me/permissions), which already merges a hybrid's base role and applies the
 * legacy-role rules; the parent page of each of its own sub actions is added,
 * as on the server.
 */
export const permissionsFor = (auth?: AuthLike | null): string[] => {
  if (!auth) return [];

  const roleId = roleIdOf(auth);

  if (roleId === ROLE.SUPER_ADMIN) return [WILDCARD];

  if (isLockedRole(roleId)) return [...(ROLE_PERMISSIONS[roleId] ?? [])];

  // No list from the server at all: a session signed in before this app
  // version (or against a backend without it) whose /me/permissions has not
  // answered, or cannot. Such a custom role has always opened on the general
  // dashboard, so it keeps exactly that until the server says otherwise. An
  // empty list from the server is an answer and is not treated this way.
  if (auth.permissions === undefined || auth.permissions === null) return ['dashboard'];

  const keys = parsePermissions(auth.permissions);
  if (keys.includes(WILDCARD)) return [WILDCARD];

  const withParents = [...keys];
  keys.forEach(key => {
    if (key.includes('.')) {
      const parent = key.split('.')[0];
      if (!withParents.includes(parent)) withParents.push(parent);
    }
  });

  return Array.from(new Set(withParents));
};

/**
 * Does this set of keys satisfy the requirement? Several keys means any one is
 * enough; an empty requirement means "no permission needed".
 */
export const permissionsAllow = (held: string[], required?: string | string[] | null): boolean => {
  if (!required || (Array.isArray(required) && required.length === 0)) return true;
  if (held.includes(WILDCARD)) return true;

  return (Array.isArray(required) ? required : [required]).some(key => held.includes(key));
};

/**
 * The administrative groups of the Menu screen whose entries make an account an
 * administrator rather than a field user (see Menu.tsx).
 */
export const ADMIN_SURFACE_GROUPS = ['Billing', 'Configurations', 'Users', 'Logs', 'System'];

/**
 * Whether the Menu screen offers this account its administrative block.
 *
 * Seeded roles keep the rule the app has always used: the Administrator alone
 * (not SuperAdmin, not Head Technician). A custom role gets it when it holds
 * something in one of ADMIN_SURFACE_GROUPS; Menu.tsx decides that, since it
 * owns the list.
 */
export const lockedRoleHasAdminMenu = (roleId: number): boolean => roleId === ROLE.ADMINISTRATOR;

/**
 * Where to send this user when they sign in, or when the section they asked for
 * is not theirs. Returns a mobile section id.
 */
export const homeSectionFor = (auth?: AuthLike | null): string => {
  if (!auth) return 'dashboard';

  const roleId = roleIdOf(auth);

  // Seeded roles keep the screen they have always opened on.
  if (MOBILE_ROLE_HOME[roleId]) return MOBILE_ROLE_HOME[roleId];

  const held = permissionsFor(auth);
  const declared = auth.home;

  // A custom role: the page the server names (a hybrid's base role's landing
  // page), then the general dashboard it has always opened on, then the first
  // page it was granted. The menu is open to everyone, so nobody lands on a
  // screen that refuses them.
  // Every candidate is checked the way the section guard will check it, so a
  // stored key that is not a page of the catalog (an old or misspelt entry on
  // a legacy row) is never chosen and bounced to Access Denied.
  const opens = (key: string) =>
    (PAGES as readonly string[]).includes(key) &&
    permissionsAllow(held, permissionForSection(sectionForPermission(key)));

  if (declared && opens(declared)) return sectionForPermission(declared);
  if (permissionsAllow(held, 'dashboard')) return 'dashboard';

  const firstPage = held.find(key => !key.includes('.') && opens(key));
  return firstPage ? sectionForPermission(firstPage) : 'menu';
};
