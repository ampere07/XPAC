// What the web app draws for each role must not change with the permission
// table.
//
// Before config/permissions.ts existed, each page decided its own buttons: a
// local hasPermission() that let Administrator and SuperAdmin through and read
// a custom role's stored list, or a role-id check, or nothing at all. This test
// writes those old rules down and checks that, for every seeded role and for
// legacy custom roles, the new permission answers agree on every button of
// every page the role could reach.

import {
  ACTIONS,
  AuthLike,
  LEGACY_GRANT_ALL_PAGES as CLIENT_LEGACY_GRANT_ALL_PAGES,
  PAGES,
  ROLE,
  canOpenSection,
  homeSectionFor,
  isSection,
  mergeAuth,
  permissionsAllow,
  permissionsFor,
  refreshPatch,
  roleModalSeed,
} from './permissions';

type Rule = (ctx: { roleId: number; stored: string[]; page: string }) => boolean;

const isAdmin = (roleId: number) => roleId === ROLE.ADMINISTRATOR || roleId === ROLE.SUPER_ADMIN;

/** hasPermission() as the detail panes had it: 1 and 7 pass, otherwise the stored list. */
const subKey = (key: string): Rule => ({ roleId, stored }) => isAdmin(roleId) || stored.includes(key);

/** CustomerDetails' copy, which also let the Head Technician through. */
const customerKey = (key: string): Rule => ({ roleId, stored }) =>
  isAdmin(roleId) || roleId === ROLE.HEAD_TECH || stored.includes(key);

const roles17: Rule = ({ roleId }) => isAdmin(roleId);
const role7: Rule = ({ roleId }) => roleId === ROLE.SUPER_ADMIN;
/** No gate: everyone who could open the page saw the button. */
const ungated: Rule = () => true;

/** Every web button and the rule that drew it before. */
const BEFORE: Record<string, Rule> = {
  'job-order.approve': subKey('job-order.approve'),
  'job-order.failed': subKey('job-order.failed'),
  'job-order.tech-edit': subKey('job-order.tech-edit'),
  'job-order.admin-edit': subKey('job-order.admin-edit'),
  'job-order.attachment': subKey('job-order.attachment'),
  'transaction-list.batch-approve': subKey('transaction-list.batch-approve'),
  'transaction-list.approve': subKey('transaction-list.approve'),
  'transaction-list.revert-request': subKey('transaction-list.revert-request'),
  'mass-rebate.add': subKey('mass-rebate.add'),
  'staggered-payment.add': subKey('staggered-payment.add'),
  'discounts.add': subKey('discounts.add'),
  'application-management.move-to-jo': subKey('application-management.move-to-jo'),
  'application-management.quick-status': subKey('application-management.quick-status'),
  'service-order.tech-edit': subKey('service-order.tech-edit'),
  'service-order.admin-edit': subKey('service-order.admin-edit'),
  'customer.so-request': customerKey('customer.so-request'),
  'customer.details-edit': customerKey('customer.details-edit'),
  'customer.attachment': customerKey('customer.attachment'),
  'customer.transact': customerKey('customer.transact'),
  'customer.prepaid-override': customerKey('customer.prepaid-override'),
  'agent-payout.approve': roles17,
  'agent-invoices.status': roles17,
  'agent-invoices.payout': roles17,
  'bonus-history.payout': roles17,
  'prepaid-override.approve': role7,
  'transaction-list.delete': role7,
  'transactions-revert.approve': role7,
  'commission.create': ungated,
  // Work Order's Add: everyone but the Agent.
  'work-order.manage': ({ roleId }) => roleId !== ROLE.AGENT,
};
[
  'expenses', 'expenses-category', 'promo-list', 'plan-list', 'location-list', 'lcp', 'nap',
  'usage-type', 'vlan-config', 'payment-method', 'work-category', 'radius-config', 'smart-olt',
  'sms-config', 'sms-template', 'email-templates', 'pppoe-setup', 'concern-config',
  'billing-config', 'user-management', 'tech-users',
].forEach(page => ['create', 'edit', 'delete'].forEach(verb => { BEFORE[`${page}.${verb}`] = ungated; }));
['create', 'edit', 'delete', 'generate', 'pay'].forEach(verb => { BEFORE[`monthly-payables.${verb}`] = ungated; });

/** The pages each seeded role's web sidebar listed before (captured from the old Sidebar). */
const MENU_BEFORE: Record<number, string[]> = {
  [ROLE.ADMINISTRATOR]: [
    'dashboard', 'live-monitor', 'customer', 'transaction-list', 'transactions-revert', 'prepaid-override',
    'payment-portal', 'soa', 'invoice', 'overdue', 'so-charge', 'dc-notice', 'mass-rebate', 'discounts',
    'application-management', 'job-order', 'service-order', 'work-order', 'lcp-nap-location', 'sms-blast',
    'commission', 'bonus-history', 'team-agent', 'agent-management', 'agent-payout', 'agent-invoices',
    'inventory', 'inventory-category-list', 'monthly-payables', 'expenses', 'expenses-category',
    'disconnected-logs', 'reconnection-logs', 'sms-logs', 'email-logs', 'data-logs',
    'smartolt-tool', 'mikrotik-radius-tool', 'xendit-reconcile-tool', 'billing-reconcile-tool',
  ],
  [ROLE.TECHNICIAN]: ['job-order', 'service-order', 'lcp-nap-location'],
  [ROLE.AGENT]: ['dashboard', 'job-order', 'work-order', 'bonus-history', 'agent-invoices'],
  [ROLE.INVENTORY_STAFF]: ['inventory', 'inventory-category-list'],
  [ROLE.OSP]: ['work-order', 'lcp-nap-location'],
  [ROLE.HEAD_TECH]: [
    'application-management', 'job-order', 'service-order', 'work-order', 'lcp-nap-location',
    'location-list', 'lcp', 'nap', 'smartolt-tool', 'mikrotik-radius-tool',
  ],
};

/** The page a button sits on. customer.* also sits in the pane a job order opens. */
const pagesShowing = (key: string): string[] => {
  const page = key.split('.')[0];
  return page === 'customer' ? ['customer', 'job-order'] : [page];
};

/** The server's resolution of a legacy custom row (permissions_version 0), per CATALOG.md. */
const LEGACY_GRANT_ALL_PAGES = [
  'promo-list', 'plan-list', 'location-list', 'lcp', 'nap', 'ports', 'router-models',
  'status-remarks-list', 'usage-type', 'vlan-config', 'payment-method', 'work-category',
  'radius-config', 'smart-olt', 'sms-config', 'sms-template', 'email-templates', 'pppoe-setup',
  'concern-config', 'billing-config', 'user-management', 'tech-users', 'organization', 'roles',
  'group-management', 'commission', 'monthly-payables', 'expenses', 'expenses-category',
  'work-order', 'soa-generation',
];
const resolveLegacy = (stored: string[]): string[] => {
  const extra = stored
    .filter(page => LEGACY_GRANT_ALL_PAGES.includes(page))
    .flatMap(page => ACTIONS[page] || []);
  return Array.from(new Set([...stored, ...extra]));
};

const LEGACY_CUSTOM_ROLES: Record<string, string[]> = {
  'billing + ops': [
    'customer', 'customer.transact', 'transaction-list', 'prepaid-override', 'job-order', 'job-order.approve',
    'team-agent', 'monthly-payables', 'lcp', 'data-logs', 'inventory', 'commission', 'expenses',
  ],
  'jo checker': ['job-order.approve', 'job-order', 'dashboard', 'service-order', 'service-order.admin-edit'],
  'field lead': ['job-order', 'job-order.tech-edit', 'job-order.attachment', 'work-order', 'lcp-nap-location'],
  'agent desk': ['bonus-history', 'agent-payout', 'agent-invoices', 'commission', 'team-agent'],
};

const differences = (auth: AuthLike, stored: string[], reachable: string[]): string[] => {
  const held = permissionsFor(auth);
  const roleId = Number(auth.role_id);
  const out: string[] = [];

  Object.entries(BEFORE).forEach(([key, rule]) => {
    const page = pagesShowing(key).find(p => reachable.includes(p));
    if (!page) return;
    let before = rule({ roleId, stored, page });
    let after = permissionsAllow(held, key);

    // Every screen checks admin-edit first, so tech-edit only ever opens the
    // technician's form for a role WITHOUT admin-edit. That effective answer is
    // what is compared: Administrator used to pass both checks and still got
    // the administrator's form.
    if (key.endsWith('.tech-edit')) {
      const partner = key.replace('.tech-edit', '.admin-edit');
      before = before && !BEFORE[partner]({ roleId, stored, page });
      after = after && !permissionsAllow(held, partner);
    }

    if (before !== after) out.push(`${key}: before=${before} after=${after}`);
  });

  return out;
};

describe('web buttons are unchanged by the permission table', () => {
  Object.entries(MENU_BEFORE).forEach(([roleId, menu]) => {
    test(`seeded role ${roleId}`, () => {
      expect(differences({ role_id: Number(roleId) }, [], menu)).toEqual([]);
    });
  });

  test('SuperAdmin keeps every button', () => {
    const everything = Object.keys(BEFORE).flatMap(pagesShowing);
    expect(differences({ role_id: ROLE.SUPER_ADMIN }, [], everything)).toEqual([]);
  });

  Object.entries(LEGACY_CUSTOM_ROLES).forEach(([name, stored]) => {
    test(`legacy custom role "${name}"`, () => {
      // A custom role reaches exactly the pages it stores.
      const reachable = stored.filter(key => !key.includes('.'));
      const auth: AuthLike = { role_id: 20, permissions: resolveLegacy(stored), home: null, permissions_resolved: true };
      expect(differences(auth, stored, reachable)).toEqual([]);
    });

    // Signed in before this version (or against a backend without the
    // permission table): authData holds the raw row, with no `home` and no
    // resolved marker, and /me/permissions may be pending, 404 or failing.
    test(`legacy custom role "${name}", raw row from an older sign-in`, () => {
      const reachable = stored.filter(key => !key.includes('.'));
      const auth: AuthLike = { role_id: 20, permissions: stored };
      expect(differences(auth, stored, reachable)).toEqual([]);
    });
  });

  test('the client grandfathers the same pages the server does', () => {
    expect([...CLIENT_LEGACY_GRANT_ALL_PAGES].sort()).toEqual([...LEGACY_GRANT_ALL_PAGES].sort());
  });
});

describe('sessions signed in before the permission table', () => {
  const STAFF_ROLES = [ROLE.ADMINISTRATOR, ROLE.TECHNICIAN, ROLE.AGENT, ROLE.INVENTORY_STAFF, ROLE.OSP, ROLE.SUPER_ADMIN, ROLE.HEAD_TECH];

  test('every seeded role lands where it always did, on a page it can open, with no stored list', () => {
    const before: Record<number, string> = { 1: 'dashboard', 2: 'job-order', 3: 'customer-dashboard', 4: 'dashboard', 5: 'inventory', 6: 'work-order', 7: 'dashboard', 8: 'application-management' };
    Object.entries(before).forEach(([roleId, landing]) => {
      const auth: AuthLike = { role_id: Number(roleId), permissions: null };
      expect(homeSectionFor(auth)).toBe(landing);
      expect(canOpenSection(auth, landing)).toBe(true);
    });
  });

  test('a custom role with no stored list opens on the general dashboard, and nothing else', () => {
    [undefined, null].forEach(permissions => {
      const auth: AuthLike = { role_id: 21, role: 'billing clerk', permissions };
      expect(homeSectionFor(auth)).toBe('dashboard');
      expect(canOpenSection(auth, 'dashboard')).toBe(true);
      expect(canOpenSection(auth, 'customer')).toBe(false);
      // Not a key: the menu stays empty, as it did while the list was fetched.
      expect(permissionsFor(auth)).toEqual([]);
    });
  });

  test('an empty list is an answer, not a pending one', () => {
    const auth: AuthLike = { role_id: 21, permissions: [], permissions_resolved: true };
    expect(canOpenSection(auth, 'dashboard')).toBe(false);
  });

  // The header bell's feed and "Needs attention" counts reach every staff
  // role, and before the section guard each shortcut opened its page.
  test('every staff role still opens the bell shortcuts it could open before', () => {
    const bell = ['application-management', 'job-order', 'service-order', 'work-order', 'transaction-list'];
    STAFF_ROLES.forEach(roleId => {
      bell.forEach(section => {
        expect(canOpenSection({ role_id: roleId }, section)).toBe(true);
      });
    });
  });

  test('a bell shortcut is not a key: no menu entry, no landing, no button', () => {
    const tech = { role_id: ROLE.TECHNICIAN };
    expect(permissionsAllow(permissionsFor(tech), 'transaction-list')).toBe(false);
    expect(permissionsAllow(permissionsFor(tech), 'work-order.manage')).toBe(false);
    expect(permissionsAllow(permissionsFor({ role_id: ROLE.INVENTORY_STAFF }), 'job-order')).toBe(false);
    expect(canOpenSection({ role_id: ROLE.CUSTOMER }, 'job-order')).toBe(false);
    // Revert requests reach SuperAdmin alone through the bell.
    expect(canOpenSection(tech, 'transactions-revert')).toBe(false);
  });

  test('a custom role opens exactly what it holds', () => {
    const auth: AuthLike = { role_id: 22, permissions: ['customer'], permissions_resolved: true };
    expect(canOpenSection(auth, 'customer')).toBe(true);
    expect(canOpenSection(auth, 'job-order')).toBe(false);
  });

  // Before the section guard, a custom role's bell shortcuts opened every
  // queue, whatever it held. A role saved before the permission table keeps
  // that until it is saved from the Roles screen.
  test('a legacy custom role still opens the bell queues, and gains nothing else', () => {
    const bell = ['application-management', 'job-order', 'service-order', 'work-order', 'transaction-list'];
    const flagged: AuthLike = { role_id: 22, permissions: ['customer'], permissions_resolved: true, permissions_legacy: true };
    // A session signed in before this version: the raw stored row, unresolved.
    const rawRow: AuthLike = { role_id: 22, permissions: ['customer'] };

    [flagged, rawRow].forEach(auth => {
      bell.forEach(section => expect(canOpenSection(auth, section)).toBe(true));
      // Not keys: no menu entry, no landing, no button, and nothing beyond the bell.
      expect(permissionsAllow(permissionsFor(auth), 'job-order')).toBe(false);
      expect(permissionsAllow(permissionsFor(auth), 'job-order.approve')).toBe(false);
      expect(homeSectionFor(auth)).toBe('customer');
      expect(canOpenSection(auth, 'transactions-revert')).toBe(false);
      expect(canOpenSection(auth, 'expenses')).toBe(false);
    });
  });

  test('a custom role saved from the Roles screen opens only what it holds', () => {
    const saved: AuthLike = { role_id: 22, permissions: ['customer'], permissions_resolved: true, permissions_legacy: false };
    expect(canOpenSection(saved, 'job-order')).toBe(false);
    expect(canOpenSection(saved, 'transaction-list')).toBe(false);
  });

  test('the refresh carries the legacy flag, and a change to it is written', () => {
    const current: AuthLike & { id: number } = { id: 5, role_id: 22, permissions: ['customer'], permissions_resolved: true, permissions_legacy: true };
    const patch = refreshPatch(current, { role_id: 22, permissions: ['customer'], home: null, permissions_legacy: false });
    expect(patch.permissions_legacy).toBe(false);
    expect(mergeAuth(current, 5, patch)).not.toBeNull();
  });
});

describe('homeSectionFor only chooses a page the guard opens', () => {
  const custom = (permissions: string[], home: string | null = null): AuthLike =>
    ({ role_id: 30, permissions, home, permissions_resolved: true });

  test('never a sub action or an unknown key', () => {
    expect(homeSectionFor(custom(['job-order.approve', 'not-a-page', 'job-order']))).toBe('job-order');
  });

  test('a server home the role cannot open is passed over', () => {
    expect(homeSectionFor(custom(['plan-list'], 'settings'))).toBe('plan-list');
    expect(homeSectionFor(custom(['plan-list'], 'not-a-page'))).toBe('plan-list');
    expect(homeSectionFor(custom(['plan-list'], 'job-order.approve'))).toBe('plan-list');
  });

  test("a hybrid lands on its base role's page", () => {
    expect(homeSectionFor(custom(['agent-dashboard', 'agent-application', 'job-order', 'customer'], 'agent-dashboard'))).toBe('agent-dashboard');
    expect(homeSectionFor(custom(['*'], 'dashboard'))).toBe('dashboard');
  });

  test('whatever it picks, the guard opens and Dashboard renders', () => {
    const samples: AuthLike[] = [
      ...Object.values(ROLE).map(roleId => ({ role_id: roleId })),
      custom(['team-agent']),
      custom(['job-order.approve', 'job-order']),
      // The server adds the page of each of a custom role's own sub actions.
      custom(['customer.transact', 'customer']),
      // A raw row from an older sign-in, resolved on this side.
      { role_id: 30, permissions: ['customer.transact'] },
      { role_id: 30, permissions: ['plan-list', 'ports.manage'] },
    ];
    samples.forEach(auth => {
      const landing = homeSectionFor(auth);
      expect(isSection(landing)).toBe(true);
      expect(canOpenSection(auth, landing)).toBe(true);
    });
  });

  test('every page key is a section', () => {
    PAGES.forEach(page => expect(isSection(page)).toBe(true));
    expect(isSection('job-order.approve')).toBe(false);
  });
});

describe('the /me/permissions refresh', () => {
  const stored = { id: 5, role: 'technician', role_id: 2, permissions: null as string[] | null, home: null };

  test('never writes after a sign-out', () => {
    expect(mergeAuth(null, 5, refreshPatch(stored, { role_id: 2, permissions: ['job-order'] }))).toBeNull();
  });

  test('never writes into another user signed in since', () => {
    const other = { ...stored, id: 6 };
    expect(mergeAuth(other, 5, refreshPatch(other, { role_id: 6, role: 'osp', permissions: ['work-order'] }))).toBeNull();
  });

  test('takes a changed role, so the old seeded table stops applying', () => {
    const updated = mergeAuth(stored, 5, refreshPatch(stored, { role_id: 6, role: 'osp', permissions: ['work-order', 'work-order.manage', 'lcp-nap-location'], home: 'work-order' }));
    expect(updated).toMatchObject({ id: 5, role_id: 6, role: 'osp', permissions_resolved: true, home: 'work-order' });
    expect(homeSectionFor(updated)).toBe('work-order');
  });

  test('a user moved off a seeded role onto a custom one stops using the seeded table', () => {
    const updated = mergeAuth(stored, 5, refreshPatch(stored, { role_id: 40, role: 'field lead', permissions: ['service-order'], home: null }));
    expect(permissionsFor(updated)).toEqual(['service-order']);
    expect(homeSectionFor(updated)).toBe('service-order');
  });

  test('writes nothing when nothing changed, and keeps a stored "2" as it is', () => {
    const resolved = { ...stored, role_id: '2', permissions: ['job-order'], permissions_resolved: true };
    const patch = refreshPatch(resolved, { role_id: 2, role: 'technician', permissions: ['job-order'], home: null });
    expect(patch).not.toHaveProperty('role_id');
    expect(mergeAuth(resolved, 5, patch)).toBeNull();
  });
});

describe('Role Management seeds its ticks from what the role holds', () => {
  test('a legacy row opens with the buttons it always had, and only catalog keys', () => {
    const seed = roleModalSeed({ permissions: ['plan-list', 'job-order', 'job-order.approve', 'ports.manage', 'bogus-key'] });
    expect(seed).toEqual(expect.arrayContaining(['plan-list', 'plan-list.create', 'plan-list.edit', 'plan-list.delete']));
    expect(seed).toEqual(expect.arrayContaining(['ports', 'ports.create', 'ports.edit', 'ports.delete']));
    expect(seed).toEqual(expect.arrayContaining(['job-order', 'job-order.approve']));
    // Stored sub-keys stay authoritative on job orders.
    expect(seed).not.toContain('job-order.failed');
    expect(seed).not.toContain('ports.manage');
    expect(seed).not.toContain('bogus-key');
  });

  test('a row saved from the new modal is read as ticked', () => {
    expect(roleModalSeed({ permissions: ['plan-list'], permissions_version: 1 })).toEqual(['plan-list']);
  });

  test("the server's list wins, still limited to catalog keys", () => {
    expect(roleModalSeed({ permissions: ['plan-list'], effective_permissions: ['plan-list', 'plan-list.edit', 'old-mobile-id'] }))
      .toEqual(['plan-list', 'plan-list.edit']);
  });

  test('older string encodings of the column are read', () => {
    expect(roleModalSeed({ permissions: '["customer","customer.transact"]', permissions_version: 1 })).toEqual(['customer', 'customer.transact']);
    expect(roleModalSeed({ permissions: 'customer, customer.transact', permissions_version: 1 })).toEqual(['customer', 'customer.transact']);
  });
});

describe('seeded roles do not gain pages from their sub actions', () => {
  test('Head Technician holds the customer actions but not the Customer page', () => {
    const held = permissionsFor({ role_id: ROLE.HEAD_TECH });
    expect(permissionsAllow(held, 'customer.transact')).toBe(true);
    expect(permissionsAllow(held, 'customer')).toBe(false);
  });

  test('Administrator does not open Reports or Settings on the web', () => {
    const held = permissionsFor({ role_id: ROLE.ADMINISTRATOR });
    expect(permissionsAllow(held, 'reports')).toBe(false);
    expect(permissionsAllow(held, 'reports.manage')).toBe(false);
    expect(permissionsAllow(held, 'settings')).toBe(false);
    expect(permissionsAllow(held, 'plan-list')).toBe(false);
  });

  test('a hybrid built on the Head Technician does not gain the Customer page either', () => {
    // The server merges the base keys as written, with no implied pages.
    const held = permissionsFor({ role_id: 30, permissions: ['customer.transact', 'job-order'], permissions_resolved: true });
    expect(permissionsAllow(held, 'customer')).toBe(false);
  });
});
