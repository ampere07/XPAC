// Who may do what in the Agent module.
//
// Identity (is this person an administrator, a superadmin, an agent?) is read
// from authData by role, the same way the sidebar places the agent's own
// entries. What they may DO is answered from the permission keys the Agent
// pages share with the server (config/permissions.ts, App\Support\Permissions):
//
//   agent-payout.approve     approve / reject a pending payout
//   agent-invoices.generate  generate the weekly invoices by hand
//   agent-invoices.status    change an invoice's status
//   agent-invoices.payout    raise a payout against an invoice
//   bonus-history.payout     raise a bonus or payout from Bonus History
//
// The seeded Administrator and SuperAdmin hold all five, as they always have;
// a custom role holds whichever it was granted. This only decides whether a
// control is worth drawing: the API checks the same keys.

import { currentUserCan } from '../hooks/usePermissions';

export const ROLE_ID = {
  ADMINISTRATOR: 1,
  AGENT: 4,
  SUPER_ADMIN: 7,
} as const;

interface StoredUser {
  role?: string | null;
  role_id?: number | string | null;
}

const readStoredUser = (): StoredUser => {
  try {
    return JSON.parse(localStorage.getItem('authData') || '{}') || {};
  } catch {
    // Unreadable authData proves nothing, so nothing is granted.
    return {};
  }
};

const normalizedRole = (user: StoredUser): string =>
  (user.role || '').toLowerCase().replace(/\s+/g, '');

const roleIdString = (user: StoredUser): string => String(user.role_id ?? '');

/** Superadmin: role_id 7. */
export const isSuperAdminUser = (user: StoredUser = readStoredUser()): boolean =>
  roleIdString(user) === String(ROLE_ID.SUPER_ADMIN) || normalizedRole(user) === 'superadmin';

/** Administrator in the sidebar's sense, which includes the superadmin (role_id 1 or 7). */
export const isAdministratorUser = (user: StoredUser = readStoredUser()): boolean =>
  roleIdString(user) === String(ROLE_ID.ADMINISTRATOR) ||
  normalizedRole(user) === 'administrator' ||
  isSuperAdminUser(user);

/** An agent reading their own records: role_id 4. */
export const isAgentRoleUser = (user: StoredUser = readStoredUser()): boolean =>
  roleIdString(user) === String(ROLE_ID.AGENT) || normalizedRole(user) === 'agent';

export interface AgentAccess {
  isAdministrator: boolean;
  isSuperAdmin: boolean;
  isAgent: boolean;
  /** Approve or reject a pending agent payout. */
  canApprovePayout: boolean;
  /** Generate the weekly agent invoices by hand. */
  canGenerateInvoices: boolean;
  /** Change an agent invoice's status (Generated / Paid / Unpaid). */
  canChangeInvoiceStatus: boolean;
  /** Raise a payout against an agent invoice. */
  canPayOutInvoice: boolean;
  /** Raise a bonus or payout against an agent from Bonus History. */
  canManageBonus: boolean;
}

/** The signed-in user's Agent-module access. */
export const getAgentAccess = (): AgentAccess => {
  const user = readStoredUser();

  return {
    isAdministrator: isAdministratorUser(user),
    isSuperAdmin: isSuperAdminUser(user),
    isAgent: isAgentRoleUser(user),
    canApprovePayout: currentUserCan('agent-payout.approve'),
    canGenerateInvoices: currentUserCan('agent-invoices.generate'),
    canChangeInvoiceStatus: currentUserCan('agent-invoices.status'),
    canPayOutInvoice: currentUserCan('agent-invoices.payout'),
    canManageBonus: currentUserCan('bonus-history.payout'),
  };
};
