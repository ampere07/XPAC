import React, { useState, useEffect, useRef, useMemo } from 'react';
import { LayoutDashboard, Users, FileText, LogOut, ChevronRight, User, FileCheck, Wrench, MapPinned, MapPin, Package, CreditCard, FileWarning, List, Router, DollarSign, Receipt, ReceiptText, FileBarChart, Clock, Calendar, AlertTriangle, Tag, MessageSquare, Settings, Network, Activity, AlertCircle, RefreshCw, Building, Shield, UserCheck, Gift } from 'lucide-react';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import { useTransactionStore } from '../store/transactionStore';
import { useTransactionRevertStore } from '../store/transactionRevertStore';
import { useApplicationStore } from '../store/applicationStore';
import { useJobOrderStore } from '../store/jobOrderStore';
import { useServiceOrderStore } from '../store/serviceOrderStore';
import { useWorkOrderStore } from '../store/workOrderStore';
import { usePermissions } from '../hooks/usePermissions';
import { ROLE } from '../config/permissions';

// ---------------------------------------------------------------------------
// Notification badge counts
//
// Each badge counts the records in that section that still need action. The status
// values below are the "unfinished" side of the buckets the section pages already
// use, and are compared lowercased + trimmed. Anything not listed is treated as a
// finished/terminal outcome and is not counted.
// ---------------------------------------------------------------------------
const UNFINISHED_STATUSES = {
  // transactions.status — the same 'pending' test that drives TransactionList's approve flow
  transaction: ['pending'],
  // transaction_revert.status — 'done' and 'rejected' are terminal
  revertRequest: ['pending'],
  // applications.status — terminal: confirmed, cancelled, duplicate, no slot, no facility,
  // and 'scheduled' (a booked visit is already actioned, so it is not counted).
  // The store defaults a blank status to 'pending', so blanks are already covered.
  application: ['pending', 'in progress', 'inprogress'],
  // job_orders.onsite_status — terminal: done/completed/finish, failed, cancelled.
  // '' is the Job Order page's "Empty" bucket, i.e. no onsite outcome recorded yet.
  jobOrder: ['pending', 'in progress', 'inprogress', 'reschedule', ''],
  // service_orders.support_status — terminal: resolved, failed, cancelled, closed
  serviceOrder: ['pending', 'open', 'in progress', 'in-progress', 'for visit', 'for-visit', 'for confirmation'],
  // work_orders.work_status — terminal: completed/done, cancelled, failed, and 'scheduled'
  // (already actioned, so not counted). A blank status renders as 'Scheduled' in the Work
  // Order table, so blanks are excluded too — otherwise a row shown as Scheduled would count.
  workOrder: ['pending', 'in progress', 'inprogress'],
};

// Count rows whose status field is one of the unfinished values. Tolerates a missing or
// not-yet-loaded array so a section that failed to load simply reports 0 (badge hidden).
const countUnfinished = <T,>(rows: T[] | undefined | null, pickStatus: (row: T) => unknown, unfinished: string[]): number => {
  if (!Array.isArray(rows)) return 0;
  return rows.reduce<number>((total, row) => {
    const value = String(pickStatus(row) ?? '').toLowerCase().trim();
    return unfinished.includes(value) ? total + 1 : total;
  }, 0);
};

interface SidebarProps {
  activeSection: string;
  onSectionChange: (section: string) => void;
  onLogout: () => void;
  isCollapsed?: boolean;
  userRole: string;
  roleId?: number | string | null;
  organizationId?: number | string | null;
  userEmail?: string;
  permissions?: string[] | null;
}

/**
 * A menu entry.
 *
 * `id` doubles as the permission key and as the section Dashboard renders —
 * one name for the checkbox in Role Management, the entry here, and the case in
 * the switch. A parent group has no key of its own and is listed whenever any
 * of its children is.
 *
 * `onlyRoles` / `exceptRoles` exist for the two entries that appear twice under
 * different labels: an agent sees their own bonus history as "History" at the
 * top level, while an administrator reaches the same page as "Bonus History"
 * inside the Agent group. Both users hold the same key, so the key alone cannot
 * choose between the two presentations.
 */
interface MenuItem {
  id: string;
  label: string;
  icon: React.ElementType;
  children?: MenuItem[];
  onlyRoles?: number[];
  exceptRoles?: number[];
}

const Sidebar: React.FC<SidebarProps> = ({ activeSection, onSectionChange, onLogout, isCollapsed, userRole, roleId, organizationId, userEmail, permissions }) => {
  const [expandedItems, setExpandedItems] = useState<string[]>([]);
  const [isDarkMode, setIsDarkMode] = useState<boolean>(true);
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
  const [currentDateTime, setCurrentDateTime] = useState('');
  const [tooltipItem, setTooltipItem] = useState<{ id: string; label: string; y: number } | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    const updateDateTime = () => {
      const now = new Date();
      const dateStr = now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: '2-digit', year: 'numeric' });
      const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
      setCurrentDateTime(`${dateStr} ${timeStr}`);
    };
    updateDateTime();
    const interval = setInterval(updateDateTime, 60000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const checkDarkMode = () => {
      const theme = localStorage.getItem('theme');
      setIsDarkMode(theme === 'dark' || theme === null);
    };
    checkDarkMode();
    const observer = new MutationObserver(checkDarkMode);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const fetchColorPalette = async () => {
      if (!mountedRef.current) return;
      try {
        const activePalette = await settingsColorPaletteService.getActive();
        if (mountedRef.current) setColorPalette(activePalette);
      } catch (err) {
        console.error('Failed to fetch color palette:', err);
      }
    };
    fetchColorPalette();
    const handlePaletteUpdate = () => fetchColorPalette();
    window.addEventListener('palette-updated', handlePaletteUpdate);
    window.addEventListener('storage', handlePaletteUpdate);
    return () => {
      window.removeEventListener('palette-updated', handlePaletteUpdate);
      window.removeEventListener('storage', handlePaletteUpdate);
    };
  }, []);

  // Every entry is listed for everyone; what a role may open is decided by the
  // permission table, not here. An entry appears when its id is a key the role
  // holds, and a group appears when at least one of its children does.
  const menuItems: MenuItem[] = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'live-monitor', label: 'Monitoring', icon: Activity },
    {
      id: 'billing',
      label: 'Billing',
      icon: CreditCard,
      children: [
        { id: 'customer', label: 'Customer', icon: User },
        { id: 'transaction-list', label: 'Transaction List', icon: Receipt },
        { id: 'transactions-revert', label: 'Revert Requests', icon: RefreshCw },
        { id: 'payment-portal', label: 'Payment Portal', icon: DollarSign },
        { id: 'soa', label: 'Statements', icon: FileText },
        { id: 'invoice', label: 'Invoice', icon: Receipt },
        { id: 'overdue', label: 'Overdue', icon: Clock },
        { id: 'so-charge', label: 'SO Charge', icon: DollarSign },
        { id: 'dc-notice', label: 'DC Notice', icon: AlertTriangle },
        { id: 'mass-rebate', label: 'Rebates', icon: DollarSign },
        // { id: 'staggered-payment', label: 'Staggered', icon: Calendar },
        { id: 'discounts', label: 'Discounts', icon: Tag }
      ]
    },
    { id: 'application-management', label: 'Application', icon: FileCheck },
    { id: 'job-order', label: 'Job Order', icon: Wrench },
    { id: 'service-order', label: 'Service Order', icon: Wrench },
    { id: 'radius-queue', label: 'Radius Queue', icon: RefreshCw },
    { id: 'work-order', label: 'Work Order', icon: Wrench },
    { id: 'lcp-nap-location', label: 'LCP/NAP Location', icon: MapPinned },
    { id: 'sms-blast', label: 'SMS Blast', icon: MessageSquare },
    { id: 'reports', label: 'Reports', icon: FileText },
    // An agent's own payout/incentive/bonus history. Read-only and scoped server side to
    // the signed-in agent — same entry the mobile app exposes as "History".
    { id: 'bonus-history', label: 'History', icon: ReceiptText, onlyRoles: [ROLE.AGENT] },
    // An agent's own weekly referral invoices. Scoped server side to their team,
    // or to themselves when they belong to none, so this entry can never show
    // another team's documents.
    { id: 'agent-invoices', label: 'Invoices', icon: FileText, onlyRoles: [ROLE.AGENT] },
    {
      id: 'agent-group',
      label: 'Agent',
      icon: UserCheck,
      // An agent has the two entries above instead; without this they would see
      // a one-child "Agent" group duplicating them.
      exceptRoles: [ROLE.AGENT],
      children: [
        { id: 'bonus-history', label: 'Bonus History', icon: Gift },
        { id: 'team-agent', label: 'Team Agents', icon: Users },
        { id: 'agent-management', label: 'Agent Management', icon: User },
        { id: 'agent-payout', label: 'Agent Payout', icon: DollarSign },
        // Weekly referral invoices, one per team and one per solo agent. The
        // page is scoped server side, so an agent reaching it sees only their
        // own team's invoices.
        { id: 'agent-invoices', label: 'Invoices', icon: FileText }
      ]
    },
    {
      id: 'inventory-group',
      label: 'Inventory',
      icon: Package,
      children: [
        { id: 'inventory', label: 'Inventory', icon: Package },
        { id: 'inventory-category-list', label: 'Inventory Category List', icon: List }
      ]
    },
    {
      id: 'technical',
      label: 'Configurations',
      icon: Network,
      children: [
        { id: 'promo-list', label: 'Promo', icon: Tag },
        { id: 'plan-list', label: 'Plan', icon: List },
        { id: 'location-list', label: 'Location', icon: MapPin },
        { id: 'lcp', label: 'LCP', icon: Network },
        { id: 'nap', label: 'NAP', icon: Network },
        { id: 'usage-type', label: 'Usage Type', icon: Activity },
        { id: 'vlan-config', label: 'VLAN Config', icon: Network },
        { id: 'payment-method', label: 'Payment Method', icon: CreditCard },
        { id: 'work-category', label: 'Work Category', icon: Wrench },
        { id: 'radius-config', label: 'Radius Config', icon: MapPin },
        { id: 'smart-olt', label: 'SmartOLT Config', icon: Network },
        { id: 'sms-config', label: 'SMS Config', icon: MessageSquare },
        { id: 'sms-template', label: 'SMS Template', icon: MessageSquare },
        { id: 'email-templates', label: 'Email Templates', icon: FileText },
        { id: 'pppoe-setup', label: 'PPPoE Setup', icon: Router },
        { id: 'concern-config', label: 'Concern Config', icon: AlertCircle },
        { id: 'billing-config', label: 'Billing Configurations', icon: Receipt }
      ]
    },
    {
      id: 'users',
      label: 'Users',
      icon: Users,
      children: [
        { id: 'user-management', label: 'Users Management', icon: User },
        { id: 'tech-users', label: 'Tech Users', icon: Wrench },
        { id: 'team-agent', label: 'Team Agents', icon: Users },
        { id: 'organization', label: 'Organization', icon: Building },
        { id: 'roles', label: 'Roles', icon: Shield }
      ]
    },
    {
      id: 'logs-category',
      label: 'Logs',
      icon: FileBarChart,
      children: [
        { id: 'disconnected-logs', label: 'Disconnected Logs', icon: AlertTriangle },
        { id: 'reconnection-logs', label: 'Reconnection Logs', icon: FileBarChart },
        { id: 'sms-logs', label: 'SMS Logs', icon: MessageSquare },
        { id: 'email-logs', label: 'Email Logs', icon: FileText },
        { id: 'data-logs', label: 'Data Logs', icon: FileText },
        { id: 'modem-router-logs', label: 'Modem/Router Logs', icon: Router },
        { id: 'smart-olt-logs', label: 'Smart OLT Logs', icon: Network },
        { id: 'radius-logs', label: 'Radius Logs', icon: Activity },
        { id: 'system-logs', label: 'System Logs', icon: FileText }
      ]
    },
    {
      id: 'tools-group',
      label: 'Tools',
      icon: Wrench,
      children: [
        { id: 'smartolt-tool', label: 'SmartOLT Tool', icon: Network },
        { id: 'mikrotik-radius-tool', label: 'Mikrotik Radius Tool', icon: Router },
        // Payment reconciliation settles real money against real accounts, so it is
        // deliberately not offered to HeadTechnician the way the network tools are.
        // Visibility is decided by ROLE_PERMISSIONS in config/permissions.ts, which is
        // the same key the page itself checks.
        { id: 'xendit-reconcile-tool', label: 'Xendit Reconciliation', icon: CreditCard },
        // Billing reconciliation decides whether a subscriber is invoiced at all, so
        // it sits with the money tools rather than the network ones.
        { id: 'billing-reconcile-tool', label: 'Billing Reconcile', icon: FileWarning }
      ]
    },
    { id: 'settings', label: 'Settings', icon: Settings },
  ];

  // Auto-expand the parent of the active section
  useEffect(() => {
    if (activeSection) {
      menuItems.forEach(item => {
        if (item.children && item.children.some(child => child.id === activeSection)) {
          setExpandedItems(prev => prev.includes(item.id) ? prev : [...prev, item.id]);
        }
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSection]);

  // What this user may open. Seeded roles are answered from the role table and
  // custom roles from the list the server sent at sign-in; either way the menu
  // and Dashboard's section guard read the same answer, so an entry can never
  // be listed for a page that then refuses to open.
  //
  // The `permissions` prop is still accepted for callers that pass one — it is
  // written into authData by Dashboard, which is where this reads it from — and
  // Dashboard owns the one fetch needed when a custom role's list is missing.
  const { can, roleId: numericRoleId, isCustomer } = usePermissions();

  // ---- Notification badges -------------------------------------------------
  // Read straight from the existing section stores. Zustand re-renders the sidebar when any
  // of these arrays change, so a badge follows the section's own fetches, polling and
  // fetchUpdates automatically — no separate data source and no duplicate requests.
  // All of these hooks sit above the early return below so hook order stays stable.
  const transactions = useTransactionStore(state => state.transactions);
  const fetchTransactions = useTransactionStore(state => state.fetchTransactions);
  const revertRequests = useTransactionRevertStore(state => state.revertRequests);
  const fetchRevertRequests = useTransactionRevertStore(state => state.fetchRevertRequests);
  const applications = useApplicationStore(state => state.applications);
  const fetchApplications = useApplicationStore(state => state.fetchApplications);
  const jobOrders = useJobOrderStore(state => state.jobOrders);
  const fetchJobOrders = useJobOrderStore(state => state.fetchJobOrders);
  const serviceOrders = useServiceOrderStore(state => state.serviceOrders);
  const fetchServiceOrders = useServiceOrderStore(state => state.fetchServiceOrders);
  const workOrders = useWorkOrderStore(state => state.workOrders);
  const fetchWorkOrders = useWorkOrderStore(state => state.fetchWorkOrders);

  useEffect(() => {
    if (isCustomer) return;

    // Only pull a section's data if this user can actually open it — a
    // technician must not fire (and be refused) the billing endpoints. Same
    // permission key the menu entry and the page itself use.
    //
    // Each store guards its own cache, so these are no-ops once a section has loaded.
    // Errors are swallowed here and left in the store's error state: a section that cannot
    // load reports 0 and its badge stays hidden rather than breaking the sidebar.
    const load = (permission: string, run: () => Promise<unknown>) => {
      if (!can(permission)) return;
      Promise.resolve(run()).catch(() => { /* store records its own error */ });
    };

    load('transaction-list', () => fetchTransactions());
    load('transactions-revert', () => fetchRevertRequests());
    load('application-management', () => fetchApplications());
    load('job-order', () => fetchJobOrders());
    load('service-order', () => fetchServiceOrders());
    load('work-order', () => fetchWorkOrders(1, 1000, '', ''));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [can, isCustomer]);

  // Counts keyed by menu item id, recomputed only when the underlying arrays change.
  const badgeCounts = useMemo<Record<string, number>>(() => ({
    'transaction-list': countUnfinished(transactions, (row: any) => row?.status, UNFINISHED_STATUSES.transaction),
    'transactions-revert': countUnfinished(revertRequests, (row: any) => row?.status, UNFINISHED_STATUSES.revertRequest),
    'application-management': countUnfinished(applications, (row: any) => row?.status, UNFINISHED_STATUSES.application),
    'job-order': countUnfinished(jobOrders, (row: any) => row?.Onsite_Status ?? row?.onsite_status, UNFINISHED_STATUSES.jobOrder),
    'service-order': countUnfinished(serviceOrders, (row: any) => row?.supportStatus ?? row?.support_status, UNFINISHED_STATUSES.serviceOrder),
    'work-order': countUnfinished(workOrders, (row: any) => row?.work_status, UNFINISHED_STATUSES.workOrder),
  }), [transactions, revertRequests, applications, jobOrders, serviceOrders, workOrders]);

  // A collapsed parent group (e.g. Billing) surfaces the total of its children so counts
  // hidden inside it are still visible.
  const groupBadgeCount = (item: MenuItem): number =>
    (item.children || []).reduce((total, child) => total + (badgeCounts[child.id] || 0) + groupBadgeCount(child), 0);

  // A customer has no admin sidebar at all; their portal is its own layout.
  if (isCustomer) return null;

  /**
   * The menu this user gets.
   *
   * One pass for every kind of role. What used to be two functions — one
   * walking a per-item allowedRoles list for the eight seeded roles, another
   * walking the permissions array for custom ones — disagreed in ways that
   * showed: the Billing group's own allowedRoles hid children that listed a
   * role the group did not, so an entry could be granted and still never
   * appear. There is now one rule, and it is the same key the page itself
   * checks.
   */
  const filterMenu = (items: MenuItem[]): MenuItem[] =>
    items.reduce<MenuItem[]>((acc, item) => {
      if (item.onlyRoles && !item.onlyRoles.includes(numericRoleId)) return acc;
      if (item.exceptRoles && item.exceptRoles.includes(numericRoleId)) return acc;

      // Organization is a multi-tenant control: it belongs to the global
      // SuperAdmin, not to a user who sits inside one organization.
      if (item.id === 'organization') {
        const effectiveUserData = JSON.parse(localStorage.getItem('authData') || '{}');
        const effectiveOrgId = organizationId || effectiveUserData.organization?.id || effectiveUserData.organization_id;
        if (effectiveOrgId && effectiveOrgId !== '0' && effectiveOrgId !== 0) return acc;
      }

      if (item.children && item.children.length > 0) {
        // A group is worth showing only if something inside it is.
        const children = filterMenu(item.children);
        if (children.length > 0) acc.push({ ...item, children });
        return acc;
      }

      if (can(item.id)) acc.push(item);

      return acc;
    }, []);

  const filteredMenuItems = filterMenu(menuItems);

  const toggleExpanded = (itemId: string) => {
    setExpandedItems(prev =>
      prev.includes(itemId) ? prev.filter(id => id !== itemId) : [...prev, itemId]
    );
  };

  // Flatten menu items for collapsed icon-only view
  const flattenForCollapsed = (items: MenuItem[]): MenuItem[] => {
    const result: MenuItem[] = [];
    items.forEach(item => {
      if (item.children && item.children.length > 0) {
        // Push children directly (skip the parent group header)
        item.children.forEach(child => result.push(child));
      } else {
        result.push(item);
      }
    });
    return result;
  };

  const collapsedItems = flattenForCollapsed(filteredMenuItems);

  // Notification badge — hidden entirely at 0, capped at 99+, tinted with the active
  // palette colour so it matches the rest of the sidebar.
  const renderBadge = (count: number) => {
    if (!count || count < 1) return null;
    return (
      <span
        className="ml-2 min-w-[20px] px-1.5 rounded-full text-[10px] font-bold leading-[18px] text-center text-white"
        style={{ backgroundColor: colorPalette?.primary || '#7c3aed' }}
        title={`${count} pending`}
      >
        {count > 99 ? '99+' : count}
      </span>
    );
  };

  // Shared active style
  const activeStyle = {
    backgroundColor: colorPalette?.primary ? `${colorPalette.primary}33` : isDarkMode ? 'rgba(249, 115, 22, 0.2)' : 'rgba(249, 115, 22, 0.1)',
    color: colorPalette?.primary || '#7c3aed',
    borderRightWidth: '2px',
    borderRightStyle: 'solid' as const,
    borderRightColor: colorPalette?.primary || '#7c3aed'
  };

  // ---- COLLAPSED MODE ----
  if (isCollapsed) {
    return (
      <div
        className={`w-14 h-full flex flex-col border-r transition-all duration-300 ease-in-out overflow-visible ${isDarkMode ? 'bg-gray-800 border-gray-600' : 'bg-white border-gray-300'
          }`}
        style={{ position: 'relative' }}
      >
        <nav className="flex-1 py-4 overflow-y-auto overflow-x-visible scrollbar-none">
          {collapsedItems.map(item => {
            const IconComponent = item.icon;
            const isActive = activeSection === item.id;
            return (
              <div key={item.id} className="relative group">
                <button
                  onClick={() => onSectionChange(item.id)}
                  onMouseEnter={e => {
                    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                    const parentRect = (e.currentTarget as HTMLElement).closest('.h-full')?.getBoundingClientRect();
                    setTooltipItem({ id: item.id, label: item.label, y: rect.top - (parentRect?.top ?? 0) });
                  }}
                  onMouseLeave={() => setTooltipItem(null)}
                  className={`w-full flex items-center justify-center py-3 transition-colors ${isActive
                    ? ''
                    : isDarkMode
                      ? 'text-gray-300 hover:text-white hover:bg-gray-700'
                      : 'text-gray-700 hover:text-black hover:bg-gray-100'
                    }`}
                  style={isActive ? activeStyle : {}}
                  title=""
                >
                  <IconComponent
                    className={`h-5 w-5 ${isActive ? '' : isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}
                    style={isActive ? { color: colorPalette?.primary || '#7c3aed' } : {}}
                  />

                  {/* Icon-only mode: badge overlays the top-right of the icon */}
                  {(badgeCounts[item.id] || 0) > 0 && (
                    <span
                      className="absolute top-1.5 right-1.5 min-w-[16px] h-4 px-1 rounded-full text-[9px] font-bold text-white flex items-center justify-center"
                      style={{ backgroundColor: colorPalette?.primary || '#7c3aed' }}
                    >
                      {badgeCounts[item.id] > 99 ? '99+' : badgeCounts[item.id]}
                    </span>
                  )}
                </button>

                {/* Floating tooltip */}
                {tooltipItem?.id === item.id && (
                  <div
                    className={`fixed z-50 left-16 px-3 py-1.5 rounded-md text-xs font-medium shadow-lg whitespace-nowrap pointer-events-none ${isDarkMode ? 'bg-gray-900 text-white border border-gray-700' : 'bg-white text-gray-900 border border-gray-200'
                      }`}
                    style={{ top: `${tooltipItem.y}px`, transform: 'translateY(8px)' }}
                  >
                    {item.label}
                    {/* Arrow */}
                    <div
                      className={`absolute left-0 top-1/2 -translate-x-1 -translate-y-1/2 w-2 h-2 rotate-45 ${isDarkMode ? 'bg-gray-900 border-l border-b border-gray-700' : 'bg-white border-l border-b border-gray-200'
                        }`}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        {/* Logout icon only */}
        <div className={`px-0 py-3 border-t flex-shrink-0 flex justify-center ${isDarkMode ? 'border-gray-600' : 'border-gray-300'}`}>
          <button
            onClick={onLogout}
            onMouseEnter={e => {
              const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
              const parentRect = (e.currentTarget as HTMLElement).closest('.h-full')?.getBoundingClientRect();
              setTooltipItem({ id: '__logout__', label: 'Logout', y: rect.top - (parentRect?.top ?? 0) });
            }}
            onMouseLeave={() => setTooltipItem(null)}
            className={`p-2 rounded transition-colors ${isDarkMode ? 'text-gray-400 hover:text-white hover:bg-gray-700' : 'text-gray-600 hover:text-black hover:bg-gray-100'}`}
          >
            <LogOut className="h-5 w-5" />
          </button>
          {tooltipItem?.id === '__logout__' && (
            <div
              className={`fixed z-50 left-16 px-3 py-1.5 rounded-md text-xs font-medium shadow-lg whitespace-nowrap pointer-events-none ${isDarkMode ? 'bg-gray-900 text-white border border-gray-700' : 'bg-white text-gray-900 border border-gray-200'
                }`}
              style={{ top: `${tooltipItem.y}px`, transform: 'translateY(8px)' }}
            >
              Logout
            </div>
          )}
        </div>
      </div>
    );
  }

  // ---- EXPANDED MODE (unchanged) ----
  const renderMenuItem = (item: MenuItem, level = 0) => {
    const hasChildren = item.children && item.children.length > 0;
    const isExpanded = expandedItems.includes(item.id);
    const isCurrentItemActive = activeSection === item.id;
    const IconComponent = item.icon;

    return (
      <div key={item.id}>
        <button
          onClick={() => {
            if (hasChildren) {
              toggleExpanded(item.id);
            } else {
              if (level === 0) setExpandedItems([]);
              onSectionChange(item.id);
            }
          }}
          className={`w-full flex items-center justify-between px-4 py-3 text-sm transition-colors ${level > 0 ? 'pl-8' : 'pl-4'
            } ${isCurrentItemActive
              ? ''
              : isDarkMode
                ? 'text-gray-300 hover:text-white hover:bg-gray-700'
                : 'text-gray-700 hover:text-black hover:bg-gray-100'
            }`}
          style={isCurrentItemActive ? activeStyle : {}}
        >
          <div className="flex items-center min-w-0">
            <IconComponent className={`h-5 w-5 mr-3 flex-shrink-0 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`} />
            <span className="truncate">{item.label}</span>
            {/* Leaf items show their own count; a collapsed group shows its children's total */}
            {renderBadge(hasChildren
              ? (isExpanded ? 0 : groupBadgeCount(item))
              : (badgeCounts[item.id] || 0))}
          </div>
          {hasChildren && (
            <ChevronRight
              className={`h-4 w-4 flex-shrink-0 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'} transition-transform ${isExpanded ? 'rotate-90' : ''}`}
            />
          )}
        </button>

        {hasChildren && isExpanded && (
          <div>
            {item.children!.map(child => renderMenuItem(child, level + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className={`w-64 border-r h-full ${isDarkMode ? 'bg-gray-800 border-gray-600' : 'bg-white border-gray-300'} flex flex-col transition-all duration-300 ease-in-out overflow-hidden`}>
      <nav className="flex-1 py-4 overflow-y-auto overflow-x-hidden scrollbar-none">
        {filteredMenuItems.map(item => renderMenuItem(item))}
      </nav>

      <div className={`px-3 py-3 ${isDarkMode ? 'border-gray-600' : 'border-gray-300'} border-t flex-shrink-0`}>
        <div className="mb-3">
          <div className={`text-xs mb-2 text-center ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
            {currentDateTime}
          </div>
          <div className="flex items-center mb-2">
            <div className={`w-10 h-10 rounded-full flex items-center justify-center ${isDarkMode ? 'bg-gray-700 border-gray-600' : 'bg-gray-200 border-gray-300'} border-2`}>
              <User className={`h-5 w-5 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`} />
            </div>
            <div className="ml-3 flex-1 min-w-0">
              <div className={`text-sm font-medium truncate ${isDarkMode ? 'text-gray-200' : 'text-gray-800'}`}>
                {userEmail || 'user@example.com'}
              </div>
              <div className={`text-xs truncate ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                {userRole}
              </div>
            </div>
          </div>
          <div className={`h-px ${isDarkMode ? 'bg-gray-700' : 'bg-gray-300'} mb-2`} />
        </div>

        <button
          onClick={onLogout}
          className={`w-full px-3 py-2 ${isDarkMode
            ? 'text-gray-300 hover:text-white hover:bg-gray-700'
            : 'text-gray-700 hover:text-black hover:bg-gray-100'
            } rounded transition-colors text-sm flex items-center`}
        >
          <LogOut className="h-4 w-4 mr-2" />
          <span>Logout</span>
        </button>
      </div>
    </div>
  );
};

export default Sidebar;
