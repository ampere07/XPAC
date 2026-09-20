// The client's copy of the permission table.
//
// The server is the authority — every endpoint is checked against
// backend/app/Support/ApiPermissionMap.php whatever this file says. This
// exists so the UI can decide what to *draw* without waiting on a round trip:
// which menu entries to list, which page to open, which buttons to render.
//
// Kept deliberately in step with backend/app/Support/Permissions.php. The
// backend file is the one to change first; this mirrors it.

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
 * How each seeded role is written in Role Management's "Base role" picker.
 *
 * Mirrors Role::LOCKED_ROLE_NAMES. Named here rather than read from the roles
 * list the API returns so the picker reads the same on a deployment whose
 * seeded rows were renamed, and always in one order — widest access first,
 * which is the order somebody choosing a starting point thinks in.
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
 * Role names as they come back from the API (lowercased role_name), mapped onto
 * their ids.
 *
 * Both are carried in authData and either can be missing or stale, so every
 * lookup tries the id first and falls back to the name.
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
  'payment-portal',
  'soa',
  'invoice',
  'overdue',
  'so-charge',
  'dc-notice',
  'mass-rebate',
  'staggered-payment',
  'discounts',

  'application-management',
  'job-order',
  'service-order',
  'work-order',
  'lcp-nap-location',
  'sms-blast',
  'reports',
  'support',

  'bonus-history',
  'agent-invoices',
  'agent-payout',
  'agent-management',
  'team-agent',

  'inventory',
  'inventory-category-list',

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
  'radius-queue',
  'system-logs',
  'modem-router-logs',

  // Tools. Each reconciles what the system believes against what a downstream
  // actually holds, and can write the difference back. They had sidebar entries
  // and role grants but were missing from this list, so the Role modal could
  // never offer them to a custom role.
  'smartolt-tool',
  'mikrotik-radius-tool',
  'xendit-reconcile-tool',
  'billing-reconcile-tool',

  'soa-generation',
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
    // Recording a pre-installation visit. Kept apart from the edit keys because
    // it is what lets a referral start earning quota progress before the
    // install is finished — a scheduling decision, not an edit to the record.
    'job-order.pre-install',
  ],
  customer: [
    'customer.so-request',
    'customer.details-edit',
    'customer.attachment',
    'customer.transact',
  ],
  'transaction-list': [
    'transaction-list.batch-approve',
    'transaction-list.approve',
    'transaction-list.revert-request',
  ],
  'mass-rebate': ['mass-rebate.add'],
  'staggered-payment': ['staggered-payment.add'],
  discounts: ['discounts.add'],
  'application-management': [
    'application-management.move-to-jo',
    'application-management.quick-status',
  ],
  'service-order': ['service-order.tech-edit', 'service-order.admin-edit'],
  // Raising, reassigning or deleting a work order, as opposed to working
  // the ones already assigned to you. An agent has the page but not this.
  'work-order': ['work-order.manage'],
  // Scheduling and issuing reports, kept apart from deleting one: a report is a
  // scheduled job other people rely on receiving.
  reports: ['reports.manage', 'reports.delete'],
  // Raising a payout, incentive or bonus, and signing one off.
  'bonus-history': ['bonus-history.payout'],
  'agent-payout': ['agent-payout.approve'],
  // Issuing the weekly referral invoices, and marking one settled. An agent
  // reads their own; none of these is theirs. `payout` raises the payout that
  // settles an invoice — the money side, so it is granted separately from
  // merely setting a status by hand.
  'agent-invoices': ['agent-invoices.generate', 'agent-invoices.status', 'agent-invoices.payout'],
  'soa-generation': ['soa-generation.manage'],

  // ── Configurations ─────────────────────────────────────────────────────────
  // Every page in this group is a list with Add, Edit and Delete controls, and
  // until now holding the page granted all three. They follow the standard
  // verbs in CRUD_VERBS below.
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

  // ── Users ──────────────────────────────────────────────────────────────────
  'user-management': ['user-management.create', 'user-management.edit', 'user-management.delete'],
  'tech-users': ['tech-users.create', 'tech-users.edit', 'tech-users.delete'],
  organization: ['organization.create', 'organization.edit', 'organization.delete'],
  roles: ['roles.create', 'roles.edit', 'roles.delete'],
  'group-management': [
    'group-management.create', 'group-management.edit', 'group-management.delete',
  ],
};

/**
 * The standard verbs, in the order the Role modal shows them.
 *
 * A page whose controls are the ordinary "Add / Edit / Delete" three declares
 * exactly these, named `<page>.<verb>`. Anything a page does that is not one of
 * the three keeps its own descriptive verb — a permission that reads
 * `job-order.approve` says what it grants and `job-order.action3` does not.
 *
 * Kept in step with Permissions::CRUD_VERBS on the server.
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

/**
 * How each key is written in Role Management.
 *
 * The Role modal renders from this rather than from a list of its own, so a
 * page added to PAGES above becomes grantable without a second edit — which is
 * how pages added since the modal was written (Reports, the Agent pages, Data
 * Logs, Monitoring) came to be ungrantable to a custom role.
 */
export const PERMISSION_LABELS: Record<string, string> = {
  'dashboard': 'Dashboard',
  'agent-dashboard': 'Agent Dashboard',
  'customer-dashboard': 'Customer Portal',
  'customer-bills': 'Customer Bills',
  'customer-support': 'Customer Support',
  'agent-application': 'Agent Application Form',
  'live-monitor': 'Monitoring',
  'customer': 'Customer',
  'transaction-list': 'Transaction List',
  'transactions-revert': 'Revert Requests',
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
  'support': 'Support',
  'bonus-history': 'Bonus History',
  'agent-invoices': 'Agent Invoices',
  'agent-payout': 'Agent Payout',
  'agent-management': 'Agent Management',
  'team-agent': 'Team Agents',
  'inventory': 'Inventory',
  'inventory-category-list': 'Inventory Category List',
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
  'group-management': 'Group Management',
  'disconnected-logs': 'Disconnected Logs',
  'reconnection-logs': 'Reconnection Logs',
  'sms-logs': 'SMS Logs',
  'sms-blast-logs': 'SMS Blast Logs',
  'email-logs': 'Email Logs',
  'data-logs': 'Data Logs',
  'expenses-log': 'Expenses Log',
  'smart-olt-logs': 'Smart OLT Logs',
  'radius-logs': 'Radius Logs',
  'radius-queue': 'Radius Queue',
  'system-logs': 'System Logs',
  'modem-router-logs': 'Modem/Router Logs',
  'smartolt-tool': 'SmartOLT Tool',
  'mikrotik-radius-tool': 'Mikrotik Radius Tool',
  'xendit-reconcile-tool': 'Xendit Reconciliation',
  'billing-reconcile-tool': 'Billing Reconcile',
  'soa-generation': 'SOA Generation',
  'settings': 'Settings',

  // Sub actions, labelled as the button reads.
  'job-order.approve': 'Approve',
  'job-order.failed': 'Failed',
  'job-order.tech-edit': 'Tech Edit',
  'job-order.admin-edit': 'Admin Edit',
  'job-order.attachment': 'Attachment',
  'job-order.pre-install': 'Pre Installed',
  'customer.so-request': 'SO Request',
  'customer.details-edit': 'Details Edit',
  'customer.attachment': 'Attachment',
  'customer.transact': 'Transact',
  'transaction-list.batch-approve': 'Batch Approve',
  'transaction-list.approve': 'Approve',
  'transaction-list.revert-request': 'Revert Request',
  'mass-rebate.add': 'Add Rebate',
  'staggered-payment.add': 'Add Staggered',
  'discounts.add': 'Add Discount',
  'application-management.move-to-jo': 'Move to JO',
  'application-management.quick-status': 'Quick Status',
  'service-order.tech-edit': 'Tech Edit',
  'service-order.admin-edit': 'Admin Edit',
  'work-order.manage': 'Manage',
  'reports.manage': 'Manage',
  'reports.delete': 'Delete',
  'bonus-history.payout': 'Payout',
  'agent-payout.approve': 'Approve',
  'agent-invoices.generate': 'Generate',
  'agent-invoices.status': 'Set Status',
  'agent-invoices.payout': 'Pay Out',
  'soa-generation.manage': 'Manage',
};

/**
 * How a key is written on screen.
 *
 * A standard verb is answered from CRUD_VERB_LABELS rather than needing its own
 * line in PERMISSION_LABELS: there is one label for "Add" however many pages
 * declare `<page>.create`, and a page added to ACTIONS is legible in the Role
 * modal without a second edit here. An explicit entry still wins, for the
 * handful of pages that want to name a verb differently.
 */
export const labelFor = (key: string): string => {
  const explicit = PERMISSION_LABELS[key];
  if (explicit) return explicit;

  const verb = key.includes('.') ? key.slice(key.indexOf('.') + 1) : '';

  return CRUD_VERB_LABELS[verb] ?? key;
};

/**
 * The order and grouping Role Management presents the pages in.
 *
 * Any page not named in a group is appended to "Other", so a page added to
 * PAGES is always grantable even if nobody remembers to file it here.
 */
export const PERMISSION_GROUPS: Array<{ label: string; pages: string[] }> = [
  { label: 'Dashboards', pages: ['dashboard', 'agent-dashboard', 'live-monitor', 'support'] },
  {
    label: 'Billing',
    pages: [
      'customer', 'transaction-list', 'transactions-revert', 'payment-portal',
      'soa', 'invoice', 'overdue', 'so-charge', 'dc-notice', 'mass-rebate',
      'staggered-payment', 'discounts', 'soa-generation',
    ],
  },
  {
    label: 'Operations',
    pages: [
      'application-management', 'job-order', 'service-order', 'radius-queue',
      'work-order', 'lcp-nap-location', 'sms-blast', 'reports',
    ],
  },
  {
    label: 'Agent',
    pages: ['bonus-history', 'agent-invoices', 'agent-payout', 'agent-management', 'team-agent'],
  },
  { label: 'Inventory', pages: ['inventory', 'inventory-category-list'] },
  {
    // Grouped apart from Configurations because these do not describe the
    // system, they act on it — each writes corrections into a live downstream.
    label: 'Tools',
    pages: [
      'smartolt-tool', 'mikrotik-radius-tool',
      'xendit-reconcile-tool', 'billing-reconcile-tool',
    ],
  },
  {
    label: 'Configurations',
    pages: [
      'promo-list', 'plan-list', 'location-list', 'lcp', 'nap', 'ports',
      'router-models', 'status-remarks-list', 'usage-type', 'vlan-config',
      'payment-method', 'work-category', 'radius-config', 'smart-olt',
      'sms-config', 'sms-template', 'email-templates', 'pppoe-setup',
      'concern-config', 'billing-config',
    ],
  },
  {
    label: 'Users',
    pages: ['user-management', 'tech-users', 'organization', 'roles', 'group-management'],
  },
  {
    label: 'Logs',
    pages: [
      'disconnected-logs', 'reconnection-logs', 'sms-logs', 'sms-blast-logs',
      'email-logs', 'data-logs', 'expenses-log', 'smart-olt-logs',
      'radius-logs', 'system-logs', 'modem-router-logs',
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
 * What each seeded role holds.
 *
 * This reproduces the access the sidebar's allowedRoles tables already granted,
 * with one deliberate change: the technician and head technician now hold their
 * edit keys. Sub-permissions were only ever read from a custom role's array,
 * which a locked role has none of, so a technician's Done button resolved to
 * "no permission" and did nothing at all.
 */
export const ROLE_PERMISSIONS: Record<number, string[]> = {
  [ROLE.SUPER_ADMIN]: [WILDCARD],

  [ROLE.ADMINISTRATOR]: [
    'dashboard',
    'live-monitor',
    'customer',
    'customer.so-request', 'customer.details-edit', 'customer.attachment', 'customer.transact',
    'transaction-list',
    'transaction-list.batch-approve', 'transaction-list.approve', 'transaction-list.revert-request',
    'transactions-revert',
    'payment-portal',
    'soa',
    'invoice',
    'overdue',
    'so-charge',
    'dc-notice',
    'mass-rebate', 'mass-rebate.add',
    'staggered-payment', 'staggered-payment.add',
    'discounts', 'discounts.add',
    'application-management',
    'application-management.move-to-jo', 'application-management.quick-status',
    'job-order',
    'job-order.approve', 'job-order.failed', 'job-order.admin-edit', 'job-order.attachment',
    'job-order.pre-install',
    'service-order', 'service-order.admin-edit',
    'work-order', 'work-order.manage',
    'lcp-nap-location',
    'sms-blast',
    'reports', 'reports.manage',
    'support',
    'bonus-history', 'bonus-history.payout',
    'team-agent',
    'agent-management',
    'agent-payout', 'agent-payout.approve',
    'agent-invoices', 'agent-invoices.generate', 'agent-invoices.status',
    'agent-invoices.payout',
    'inventory',
    'inventory-category-list',
    'disconnected-logs',
    'reconnection-logs',
    'sms-logs',
    'sms-blast-logs',
    'email-logs',
    'data-logs',
    'expenses-log',
    'modem-router-logs',
    // The RADIUS retry queue. Read-only, and an operational screen rather than
    // a configuration one.
    'radius-queue',
    // Tools suite. Every one of these mutates live state — subscriber ONUs,
    // RADIUS accounts, posted payments — so they are granted deliberately
    // rather than inherited from a group.
    'smartolt-tool',
    'mikrotik-radius-tool',
    'xendit-reconcile-tool',
  ],

  [ROLE.TECHNICIAN]: [
    'job-order',
    'job-order.tech-edit',
    'job-order.attachment',
    'job-order.pre-install',
    'service-order',
    'service-order.tech-edit',
    // Work orders are a technician's work too. The web sidebar never listed the
    // page for them, but the page itself has always had technician-specific
    // behaviour — the queue ordering and the lock in
    // utils/technicianWorkOrderAccess.ts, enforced server side by
    // WorkOrderApiController::isWorkOrderLockedForTechnician(). The mobile app
    // did list it. The omission was the sidebar's.
    'work-order', 'work-order.manage',
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
    'modem-router-logs',
  ],

  [ROLE.OSP]: [
    'work-order', 'work-order.manage',
    'lcp-nap-location',
  ],

  [ROLE.HEAD_TECH]: [
    'application-management',
    'application-management.move-to-jo', 'application-management.quick-status',
    'job-order',
    'job-order.approve', 'job-order.failed', 'job-order.admin-edit', 'job-order.attachment',
    'job-order.pre-install',
    'service-order', 'service-order.admin-edit',
    'work-order', 'work-order.manage',
    'lcp-nap-location',
    // The head technician maintains the outside-plant records, so the three
    // verbs are spelled out rather than left to the server's grandfathering
    // rule, which only covers stored custom roles.
    'location-list', 'location-list.create', 'location-list.edit', 'location-list.delete',
    'lcp', 'lcp.create', 'lcp.edit', 'lcp.delete',
    'nap', 'nap.create', 'nap.edit', 'nap.delete',
    // The two network tools. Xendit Reconciliation is deliberately NOT here:
    // it settles real money against real accounts, which is an Administrator
    // and SuperAdmin concern rather than a field-operations one.
    'smartolt-tool',
    'mikrotik-radius-tool',
    'modem-router-logs',
  ],
};

/** Where each seeded role lands after signing in. */
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

/**
 * What a section of the app requires to be opened.
 *
 * Section ids and permission keys are the same strings by design — the sidebar
 * item id, the Dashboard switch case and the Role modal checkbox all use one
 * name — so a section needs an entry here only when it does not follow that
 * rule. Everything else is checked against its own id.
 */
export const SECTION_PERMISSION_OVERRIDES: Record<string, string | string[]> = {
  // The default case: which dashboard renders depends on the role, so any of
  // the three landing keys may open it.
  dashboard: ['dashboard', 'agent-dashboard', 'customer-dashboard'],
};

/** The key(s) a section requires. */
export const permissionForSection = (section: string): string | string[] =>
  SECTION_PERMISSION_OVERRIDES[section] ?? section;

/** The shape this module reads out of localStorage's authData. */
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
 * Parse the permissions field.
 *
 * Rows written before the model cast existed hold a JSON string or a
 * comma-separated list, so all three shapes are accepted — the same three the
 * server accepts.
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
      // Not JSON — fall through to the comma-separated reading.
    }
    return raw.split(',').map(p => p.trim()).filter(Boolean);
  }

  return [];
};

/**
 * The keys a seeded role holds — what a hybrid role inherits.
 *
 * Empty for anything that is not one of the eight, so a custom role can never
 * be inherited from and a cleared base grants nothing.
 */
export const inheritedPermissions = (baseRoleId?: number | string | null): string[] => {
  const base = Number(baseRoleId);

  return isLockedRole(base) ? ROLE_PERMISSIONS[base] ?? [] : [];
};

/**
 * The keys a user effectively holds.
 *
 * A seeded role is answered from the table above, so it does not depend on the
 * server having sent a list. A custom role uses the list it was sent, which is
 * the only place that information exists — for a hybrid that list already has
 * its base role's keys merged in, done server side so this copy cannot grant a
 * menu entry from a base that has since changed. Either way the result also
 * contains the parent page of every sub action, matching the server.
 */
export const permissionsFor = (auth?: AuthLike | null): string[] => {
  if (!auth) return [];

  const roleId = roleIdOf(auth);

  if (roleId === ROLE.SUPER_ADMIN) return [WILDCARD];

  const keys = isLockedRole(roleId)
    ? ROLE_PERMISSIONS[roleId] ?? []
    : parsePermissions(auth.permissions);

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
 * Does this set of keys satisfy the requirement?
 *
 * `required` may be one key or several, in which case holding any one is
 * enough. An empty requirement means "no permission needed".
 */
export const permissionsAllow = (held: string[], required?: string | string[] | null): boolean => {
  if (!required || (Array.isArray(required) && required.length === 0)) return true;
  if (held.includes(WILDCARD)) return true;

  return (Array.isArray(required) ? required : [required]).some(key => held.includes(key));
};

/** Where to send this user when they sign in, or when the section they asked for is not theirs. */
export const homeSectionFor = (auth?: AuthLike | null): string => {
  if (!auth) return 'dashboard';

  const roleId = roleIdOf(auth);
  const declared = auth.home;

  if (declared && permissionsAllow(permissionsFor(auth), declared)) return declared;
  if (ROLE_HOME[roleId]) return ROLE_HOME[roleId];

  // A custom role: the first page it was granted, preferring a real page over a
  // sub action so it does not land on something like "job-order.approve".
  // A hybrid does not usually reach here — the server names its base role's
  // landing page in `home`, which the first line above accepts.
  const held = permissionsFor(auth).filter(key => !key.includes('.'));
  return held[0] ?? 'dashboard';
};
