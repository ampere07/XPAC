// Menu parity: every seeded role, and custom roles saved before the permission
// table existed, see exactly the sidebar they saw before it, and land on the
// same page.
//
// EXPECTED was captured by rendering the pre-permission Sidebar (the one that
// filtered by allowedRoles) for each role, walking every group. The intended
// differences:
//  - a custom role whose first stored key is a sub action ("job-order.approve")
//    used to "land" on that string, which rendered the administrator dashboard
//    by accident; it now lands on its first page;
//  - the Users group lists Roles (Role Management) for whoever holds `roles`:
//    SuperAdmin, and a custom role granted Roles Management (the entry was
//    commented out for everyone before). Administrator does not get it: the web
//    withholds the Users pages from role 1.
import React from 'react';
import { render, fireEvent, cleanup } from '@testing-library/react';
import Sidebar from './Sidebar';

jest.mock('../services/settingsColorPaletteService', () => ({
  settingsColorPaletteService: { getActive: () => Promise.resolve(null) },
}));
jest.mock('../services/userService', () => ({
  roleService: { getRoleById: () => Promise.resolve({ success: false }) },
}));
jest.mock('../services/monthlyPayableService', () => ({
  getPayableAlertCount: () => Promise.resolve({ count: 0 }),
}));
jest.mock('../services/navBadgeService', () => ({
  EMPTY_NAV_BADGE_COUNTS: { application: 0, job_order: 0, service_order: 0, work_order: 0, transaction: 0, total: 0 },
  getNavBadgeCounts: () => Promise.resolve({ application: 0, job_order: 0, service_order: 0, work_order: 0, transaction: 0, total: 0 }),
}));
jest.mock('../services/pusherService', () => ({
  __esModule: true,
  default: { subscribe: () => ({ bind: () => {}, unbind: () => {} }) },
}));
jest.mock('../config/api', () => ({
  __esModule: true,
  default: { get: () => Promise.resolve({ data: { success: false } }) },
  API_BASE_URL: '',
}));

type Auth = {
  role: string;
  role_id: number;
  permissions?: string[] | null;
  home?: string | null;
  organization_id?: number | null;
  permissions_resolved?: boolean;
};

const ROLES: Record<string, Auth> = {
  '1 administrator': { role: 'administrator', role_id: 1, organization_id: 1 },
  '2 technician': { role: 'technician', role_id: 2, organization_id: 1 },
  '3 customer': { role: 'customer', role_id: 3, organization_id: 1 },
  '4 agent': { role: 'agent', role_id: 4, organization_id: 1 },
  '5 inventorystaff': { role: 'inventorystaff', role_id: 5, organization_id: 1 },
  '6 osp': { role: 'osp', role_id: 6, organization_id: 1 },
  '7 superadmin': { role: 'superadmin', role_id: 7, organization_id: 1 },
  '8 headtech': { role: 'headtech', role_id: 8, organization_id: 1 },
  // Legacy custom roles: page ids from the pre-port Role modal.
  '12 custom billing+ops': {
    role: 'billing supervisor', role_id: 12, organization_id: 1,
    permissions: ['customer', 'customer.transact', 'transaction-list', 'prepaid-override', 'job-order', 'job-order.approve',
      'team-agent', 'monthly-payables', 'lcp', 'data-logs', 'roles', 'organization', 'settings', 'inventory'],
  },
  '13 custom team-agent only': { role: 'team lead', role_id: 13, organization_id: 1, permissions: ['team-agent'] },
  '14 custom dashboard first sub': {
    role: 'jo checker', role_id: 14, organization_id: 1,
    permissions: ['job-order.approve', 'job-order', 'dashboard', 'service-order', 'service-order.admin-edit'],
  },
  // Signed in before its list was stored: the menu stays empty and the role
  // lands on the general dashboard until the server answers, as before.
  '15 custom no list yet': { role: 'field lead', role_id: 15, organization_id: 1, permissions: null },
};

/** Walks the rendered expanded sidebar, expanding each group, recording ids via onSectionChange. */
const captureMenu = (auth: Auth): string[] => {
  localStorage.clear();
  localStorage.setItem('authData', JSON.stringify(auth));
  const picked: string[] = [];
  const onSectionChange = (id: string) => picked.push(id);
  const { container } = render(
    <Sidebar
      activeSection="__none__"
      onSectionChange={onSectionChange}
      onLogout={() => {}}
      isCollapsed={false}
      userRole={auth.role}
      roleId={auth.role_id}
      organizationId={auth.organization_id}
      userEmail="x@example.com"
      permissions={auth.permissions || null}
    />
  );
  const out: string[] = [];
  const nav = container.querySelector('nav');
  if (!nav) return ['<no sidebar>'];
  const topCount = nav.children.length;
  for (let i = 0; i < topCount; i++) {
    const item = nav.children[i] as HTMLElement;
    const btn = item.querySelector(':scope > button') as HTMLElement;
    const label = btn.textContent || '';
    const before = picked.length;
    fireEvent.click(btn);
    if (picked.length > before) {
      out.push(`${picked[picked.length - 1]}  [${label}]`);
      continue;
    }
    // A group: now expanded.
    const childWrap = (nav.children[i] as HTMLElement).querySelector(':scope > div');
    const children = childWrap ? Array.from(childWrap.children) : [];
    const childIds: string[] = [];
    children.forEach(child => {
      const cb = (child as HTMLElement).querySelector(':scope > button') as HTMLElement;
      const b = picked.length;
      fireEvent.click(cb);
      childIds.push(picked.length > b ? `${picked[picked.length - 1]} [${cb.textContent}]` : `?? [${cb.textContent}]`);
    });
    out.push(`GROUP ${label}: ${childIds.join(', ')}`);
    fireEvent.click((nav.children[i] as HTMLElement).querySelector(':scope > button') as HTMLElement);
  }
  cleanup();
  return out;
};

/** After the port the server resolves a legacy row: stored keys plus the actions of ungated pages. */
const resolveLegacy = (auth: Auth): Auth => {
  if (!auth.permissions) return auth;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { ACTIONS } = require('../config/permissions');
  const ungated = ['lcp', 'roles', 'organization', 'monthly-payables'];
  const extra = auth.permissions.filter(k => ungated.includes(k)).flatMap(k => ACTIONS[k] || []);
  return { ...auth, permissions: Array.from(new Set([...auth.permissions, ...extra])), home: null, permissions_resolved: true };
};

const EXPECTED: Record<string, { landing: string; menu: string[] }> = {
  '1 administrator': {
    'landing': 'dashboard',
    'menu': [
      'dashboard  [Dashboard]',
      'live-monitor  [Monitoring]',
      'GROUP Billing: customer [Customer], transaction-list [Transaction List], transactions-revert [Revert Requests], prepaid-override [Prepaid Override], payment-portal [Payment Portal], soa [Statements], invoice [Invoice], overdue [Overdue], so-charge [SO Charge], dc-notice [DC Notice], mass-rebate [Rebates], discounts [Discounts]',
      'application-management  [Application]',
      'job-order  [Job Order]',
      'service-order  [Service Order]',
      'work-order  [Work Order]',
      'lcp-nap-location  [LCP/NAP Location]',
      'sms-blast  [SMS Blast]',
      'GROUP Agent: commission [Pay Out/In], bonus-history [Bonus History], team-agent [Team Agents], agent-management [Agent Management], agent-payout [Agent Payout], agent-invoices [Invoices]',
      'GROUP Inventory: inventory [Inventory], inventory-category-list [Inventory Category List]',
      'GROUP Expenses: monthly-payables [Monthly Payables], expenses [Expenses], expenses-category [Expenses Category]',
      'GROUP Logs: disconnected-logs [Disconnected Logs], reconnection-logs [Reconnection Logs], sms-logs [SMS Logs], email-logs [Email Logs], data-logs [Data Logs]',
      'GROUP Tools: smartolt-tool [SmartOLT Tool], mikrotik-radius-tool [Mikrotik Radius Tool], xendit-reconcile-tool [Xendit Reconciliation], billing-reconcile-tool [Billing Reconcile]'
    ]
  },
  '2 technician': {
    'landing': 'job-order',
    'menu': [
      'job-order  [Job Order]',
      'service-order  [Service Order]',
      'lcp-nap-location  [LCP/NAP Location]'
    ]
  },
  '3 customer': {
    'landing': 'customer-dashboard',
    'menu': [
      '<no sidebar>'
    ]
  },
  '4 agent': {
    'landing': 'dashboard',
    'menu': [
      'dashboard  [Dashboard]',
      'job-order  [Job Order]',
      'work-order  [Work Order]',
      'bonus-history  [History]',
      'agent-invoices  [Invoices]'
    ]
  },
  '5 inventorystaff': {
    'landing': 'inventory',
    'menu': [
      'GROUP Inventory: inventory [Inventory], inventory-category-list [Inventory Category List]'
    ]
  },
  '6 osp': {
    'landing': 'work-order',
    'menu': [
      'work-order  [Work Order]',
      'lcp-nap-location  [LCP/NAP Location]'
    ]
  },
  '7 superadmin': {
    'landing': 'dashboard',
    'menu': [
      'dashboard  [Dashboard]',
      'live-monitor  [Monitoring]',
      'GROUP Billing: customer [Customer], transaction-list [Transaction List], transactions-revert [Revert Requests], prepaid-override [Prepaid Override], payment-portal [Payment Portal], soa [Statements], invoice [Invoice], overdue [Overdue], so-charge [SO Charge], dc-notice [DC Notice], mass-rebate [Rebates], discounts [Discounts]',
      'application-management  [Application]',
      'job-order  [Job Order]',
      'service-order  [Service Order]',
      'work-order  [Work Order]',
      'lcp-nap-location  [LCP/NAP Location]',
      'sms-blast  [SMS Blast]',
      'reports  [Reports]',
      'GROUP Agent: commission [Pay Out/In], bonus-history [Bonus History], team-agent [Team Agents], agent-management [Agent Management], agent-payout [Agent Payout], agent-invoices [Invoices]',
      'GROUP Inventory: inventory [Inventory], inventory-category-list [Inventory Category List]',
      'GROUP Expenses: monthly-payables [Monthly Payables], expenses [Expenses], expenses-category [Expenses Category]',
      'GROUP Configurations: promo-list [Promo], plan-list [Plan], location-list [Location], lcp [LCP], nap [NAP], usage-type [Usage Type], vlan-config [VLAN Config], payment-method [Payment Method], work-category [Work Category], radius-config [Radius Config], smart-olt [SmartOLT Config], sms-config [SMS Config], sms-template [SMS Template], email-templates [Email Templates], pppoe-setup [PPPoE Setup], concern-config [Concern Config], billing-config [Billing Configurations]',
      'GROUP Users: user-management [Users Management], tech-users [Tech Users], team-agent [Team Agents], roles [Roles]',
      'GROUP Logs: disconnected-logs [Disconnected Logs], reconnection-logs [Reconnection Logs], sms-logs [SMS Logs], email-logs [Email Logs], data-logs [Data Logs], smart-olt-logs [Smart OLT Logs], radius-logs [Radius Logs], system-logs [System Logs]',
      'GROUP Tools: smartolt-tool [SmartOLT Tool], mikrotik-radius-tool [Mikrotik Radius Tool], xendit-reconcile-tool [Xendit Reconciliation], billing-reconcile-tool [Billing Reconcile]',
      'settings  [Settings]'
    ]
  },
  '8 headtech': {
    'landing': 'application-management',
    'menu': [
      'application-management  [Application]',
      'job-order  [Job Order]',
      'service-order  [Service Order]',
      'work-order  [Work Order]',
      'lcp-nap-location  [LCP/NAP Location]',
      'GROUP Configurations: location-list [Location], lcp [LCP], nap [NAP]',
      'GROUP Tools: smartolt-tool [SmartOLT Tool], mikrotik-radius-tool [Mikrotik Radius Tool]'
    ]
  },
  '12 custom billing+ops': {
    'landing': 'customer',
    'menu': [
      'GROUP Billing: customer [Customer], transaction-list [Transaction List], prepaid-override [Prepaid Override]',
      'job-order  [Job Order]',
      'GROUP Agent: team-agent [Team Agents]',
      'GROUP Inventory: inventory [Inventory]',
      'GROUP Expenses: monthly-payables [Monthly Payables]',
      'GROUP Configurations: lcp [LCP]',
      'GROUP Users: team-agent [Team Agents], roles [Roles]',
      'GROUP Logs: data-logs [Data Logs]',
      'settings  [Settings]'
    ]
  },
  '13 custom team-agent only': {
    'landing': 'team-agent',
    'menu': [
      'GROUP Agent: team-agent [Team Agents]',
      'GROUP Users: team-agent [Team Agents]'
    ]
  },
  '14 custom dashboard first sub': {
    'landing': 'job-order',
    'menu': [
      'dashboard  [Dashboard]',
      'job-order  [Job Order]',
      'service-order  [Service Order]'
    ]
  },
  '15 custom no list yet': {
    'landing': 'dashboard',
    'menu': []
  }
};

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { homeSectionFor } = require('../config/permissions');

describe('sidebar menu parity', () => {
  Object.entries(ROLES).forEach(([name, raw]) => {
    test(name, () => {
      const auth = resolveLegacy(raw);
      expect({ landing: homeSectionFor(auth), menu: captureMenu(auth) }).toEqual(EXPECTED[name]);
    });
  });

  // The same custom roles as an older sign-in stored them: the raw row, no
  // `home`, not marked as resolved — while /me/permissions is pending, or on a
  // backend that does not have it.
  Object.entries(ROLES)
    .filter(([, raw]) => raw.role_id > 8 && Array.isArray(raw.permissions))
    .forEach(([name, raw]) => {
      test(`${name}, raw row from an older sign-in`, () => {
        const auth: Auth = { role: raw.role, role_id: raw.role_id, organization_id: raw.organization_id, permissions: raw.permissions };
        expect({ landing: homeSectionFor(auth), menu: captureMenu(auth) }).toEqual(EXPECTED[name]);
      });
    });
});
