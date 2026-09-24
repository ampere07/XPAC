import React, { useState, useEffect, useMemo, useRef } from 'react';
import { LayoutDashboard, Users, FileText, LogOut, ChevronRight, User, FileCheck, Wrench, MapPinned, MapPin, Package, CreditCard, FileWarning, List, Router, DollarSign, Receipt, FileBarChart, Clock, Calendar, AlertTriangle, Tag, MessageSquare, Settings, Network, Activity, AlertCircle, RefreshCw, Building, Shield, UserCheck, Wallet, CalendarClock, TimerReset, ReceiptText, Gift } from 'lucide-react';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import { getPayableAlertCount } from '../services/monthlyPayableService';
import { getNavBadgeCounts, EMPTY_NAV_BADGE_COUNTS, NavBadgeCounts } from '../services/navBadgeService';
import pusher from '../services/pusherService';
import { usePermissions } from '../hooks/usePermissions';
import { ROLE } from '../config/permissions';

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
 * `id` doubles as the permission key and as the section Dashboard renders: one
 * name for the checkbox in Role Management, the entry here, and the case in the
 * switch. A parent group has no key of its own and is listed whenever any of
 * its children is.
 *
 * `onlyRoles` / `exceptRoles` cover the few entries whose placement depends on
 * who is looking rather than on what they hold:
 *  - an agent sees their own History and Invoices at the top level, while an
 *    administrator reaches the same pages inside the Agent group;
 *  - Team Agents also sits under Users, which only SuperAdmin ever saw, so an
 *    Administrator (who holds team-agent for the Agent group) is kept out of it;
 *  - the Billing group was never offered to the Head Technician, who holds the
 *    customer actions for the customer panel inside a job order but has no
 *    Customer menu entry.
 */
interface MenuItem {
  id: string;
  label: string;
  icon: React.ElementType;
  children?: MenuItem[];
  /** Attention count rendered as a pill. Falsy or zero renders nothing. */
  badge?: number;
  onlyRoles?: number[];
  exceptRoles?: number[];
}

const Sidebar: React.FC<SidebarProps> = ({ activeSection, onSectionChange, onLogout, isCollapsed, userRole, roleId, organizationId, userEmail }) => {
  const [expandedItems, setExpandedItems] = useState<string[]>([]);
  const [isDarkMode, setIsDarkMode] = useState<boolean>(true);
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
  const [currentDateTime, setCurrentDateTime] = useState('');
  const [tooltipItem, setTooltipItem] = useState<{ id: string; label: string; y: number } | null>(null);
  const [payableAlerts, setPayableAlerts] = useState(0);
  const [navBadges, setNavBadges] = useState<NavBadgeCounts>(EMPTY_NAV_BADGE_COUNTS);
  const mountedRef = useRef(true);

  // What this user may open. Seeded roles are answered from the role table and
  // custom roles from the list the server resolved (login, refreshed by
  // Dashboard from /me/permissions); the menu and Dashboard's section guard read
  // the same answer, so an entry is never listed for a page that then refuses
  // to open. The `permissions` prop is still accepted from callers but the
  // stored authData is what is read.
  const { can, roleId: numericRoleId, isCustomer } = usePermissions();

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

  /**
   * Whether this user can reach Monthly Payables at all. Gates the badge fetch so a
   * technician's session never fires a request for a page they cannot open.
   */
  const canSeePayables = can('monthly-payables');

  /**
   * Overdue + due-today count for the Monthly Payables badge.
   *
   * Refreshed three ways because none alone is sufficient: the broadcast covers other
   * people's payments, the interval covers the midnight rollover that nothing broadcasts,
   * and the initial call covers the first paint.
   *
   * Cleanup unbinds the handler but never calls pusher.unsubscribe() — the Monthly
   * Payables page listens on this same channel, and unsubscribing would cut it off.
   */
  useEffect(() => {
    if (!canSeePayables) {
      setPayableAlerts(0);
      return;
    }

    let cancelled = false;

    const load = () => {
      getPayableAlertCount().then(({ count }) => {
        if (!cancelled && mountedRef.current) setPayableAlerts(count);
      });
    };

    load();
    const interval = setInterval(load, 10 * 60 * 1000);

    const channel = pusher.subscribe('monthly-payables');
    channel.bind('monthly-payables-updated', load);

    return () => {
      cancelled = true;
      clearInterval(interval);
      channel.unbind('monthly-payables-updated', load);
    };
  }, [canSeePayables]);

  /**
   * Whether this session sees the operational menus the badges belong to.
   *
   * Customers never see Application / Job Order / Service Order / Work Order / Transaction List,
   * so their session must not poll a staff endpoint for counts it would only discard.
   */
  const isStaff = useMemo(() => {
    const role = (userRole || '').toLowerCase().trim();
    return role !== 'customer' && String(roleId ?? '') !== '3';
  }, [userRole, roleId]);

  /**
   * Attention counts for the operational menus.
   *
   * Refreshed the same three ways as the payables badge above, for the same reasons: the
   * broadcasts cover other people's work, the interval covers anything nothing broadcasts (a
   * cron creating rows, a status aged into "overdue"), and the initial call covers first paint.
   *
   * Cleanup unbinds the handlers but never calls pusher.unsubscribe() — every one of these
   * channels is also listened to by the corresponding page, and unsubscribing would cut it off.
   */
  useEffect(() => {
    if (!isStaff) {
      setNavBadges(EMPTY_NAV_BADGE_COUNTS);
      return;
    }

    let cancelled = false;

    const load = () => {
      getNavBadgeCounts().then(counts => {
        if (!cancelled && mountedRef.current) setNavBadges(counts);
      });
    };

    load();
    const interval = setInterval(load, 2 * 60 * 1000);

    // One channel per badge, bound to the event that page already broadcasts on a change.
    const subscriptions: [string, string][] = [
      ['applications', 'new-application'],
      ['job-orders', 'job-order-done'],
      ['service-orders', 'service-order-updated'],
      ['work-orders', 'work-order-updated'],
      ['transactions', 'transaction-updated'],
    ];

    const bound = subscriptions.map(([channelName, event]) => {
      const channel = pusher.subscribe(channelName);
      channel.bind(event, load);
      return { channel, event };
    });

    return () => {
      cancelled = true;
      clearInterval(interval);
      bound.forEach(({ channel, event }) => channel.unbind(event, load));
    };
  }, [isStaff]);

  const menuItems: MenuItem[] = [
    // An agent lands on their own dashboard (DashboardAgent) through this same entry.
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'live-monitor', label: 'Monitoring', icon: Activity },
    {
      id: 'billing',
      label: 'Billing',
      icon: CreditCard,
      children: [
        { id: 'customer', label: 'Customer', icon: User, exceptRoles: [ROLE.HEAD_TECH] },
        // Badge: transactions awaiting approval or processing (Pending / QUEUED).
        { id: 'transaction-list', label: 'Transaction List', icon: Receipt, badge: navBadges.transaction },
        { id: 'transactions-revert', label: 'Revert Requests', icon: RefreshCw },
        // Approval queue for manual changes to a prepaid customer's expiry. The date is no longer
        // editable on the customer form, so this is where every adjustment is reviewed.
        // TimerReset rather than Clock — Overdue two rows down already owns Clock in this menu.
        { id: 'prepaid-override', label: 'Prepaid Override', icon: TimerReset },
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
    // Badges below count what still needs attention — see navBadgeService for each rule.
    { id: 'application-management', label: 'Application', icon: FileCheck, badge: navBadges.application },
    { id: 'job-order', label: 'Job Order', icon: Wrench, badge: navBadges.job_order },
    { id: 'service-order', label: 'Service Order', icon: Wrench, badge: navBadges.service_order },
    { id: 'work-order', label: 'Work Order', icon: Wrench, badge: navBadges.work_order },
    { id: 'lcp-nap-location', label: 'LCP/NAP Location', icon: MapPinned },
    { id: 'sms-blast', label: 'SMS Blast', icon: MessageSquare },
    { id: 'reports', label: 'Reports', icon: FileText },
    // An agent's own payout/incentive/bonus history. Read-only and scoped server side to
    // the signed-in agent — the same entry the mobile app exposes as "History".
    { id: 'bonus-history', label: 'History', icon: ReceiptText, onlyRoles: [ROLE.AGENT] },
    // An agent's own weekly referral invoices, scoped server side to their team, or to
    // themselves when they belong to none.
    { id: 'agent-invoices', label: 'Invoices', icon: FileText, onlyRoles: [ROLE.AGENT] },
    {
      id: 'agent-group',
      label: 'Agent',
      icon: UserCheck,
      // Not offered to agents: they have the two entries above instead.
      exceptRoles: [ROLE.AGENT],
      children: [
        { id: 'commission', label: 'Pay Out/In', icon: DollarSign },
        { id: 'bonus-history', label: 'Bonus History', icon: Gift },
        { id: 'team-agent', label: 'Team Agents', icon: Users },
        { id: 'agent-management', label: 'Agent Management', icon: User },
        { id: 'agent-payout', label: 'Agent Payout', icon: DollarSign },
        // Weekly referral invoices, one per team and one per solo agent.
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
      id: 'expenses-group',
      label: 'Expenses',
      icon: Wallet,
      children: [
        // Badge counts what needs attention today: anything past due, plus anything
        // falling due today. Zero renders nothing.
        { id: 'monthly-payables', label: 'Monthly Payables', icon: CalendarClock, badge: payableAlerts },
        { id: 'expenses', label: 'Expenses', icon: Wallet },
        { id: 'expenses-category', label: 'Expenses Category', icon: Tag }
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
        { id: 'team-agent', label: 'Team Agents', icon: Users, exceptRoles: [ROLE.ADMINISTRATOR] },
        // { id: 'organization', label: 'Organization', icon: Building },
        // Role Management. Listed for whoever holds `roles`: SuperAdmin among
        // the seeded roles (the web withholds it from Administrator), and any
        // custom role granted it.
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
        { id: 'xendit-reconcile-tool', label: 'Xendit Reconciliation', icon: CreditCard },
        // Billing reconciliation decides whether a subscriber is invoiced at all, so
        // it sits with the money tools rather than the network ones and is closed to
        // HeadTechnician for the same reason Xendit is.
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

  // A customer has no admin sidebar at all; their portal is its own layout.
  if (isCustomer || userRole?.toLowerCase() === 'customer') return null;

  /**
   * The key an entry needs. Dashboard is the one exception: an agent reaches
   * their own dashboard through the same entry, so the agent landing key opens
   * it for them too.
   */
  const requiredFor = (item: MenuItem): string | string[] =>
    item.id === 'dashboard' && numericRoleId === ROLE.AGENT ? ['dashboard', 'agent-dashboard'] : item.id;

  /**
   * The menu this user gets: one pass for every kind of role. An entry appears
   * when its id is a key the role holds, and a group appears when at least one
   * of its children does.
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
        const children = filterMenu(item.children);
        if (children.length > 0) acc.push({ ...item, children });
        return acc;
      }

      if (can(requiredFor(item))) acc.push(item);

      return acc;
    }, []);

  const filteredMenuItems = filterMenu(menuItems);

  const toggleExpanded = (itemId: string) => {
    setExpandedItems(prev =>
      prev.includes(itemId) ? prev.filter(id => id !== itemId) : [...prev, itemId]
    );
  };

  // Flatten menu items for collapsed icon-only view.
  //
  // Deduplicated by id, which is what keeps this list renderable: the same destination can sit
  // under two groups — 'team-agent' is a child of both Agent and Users — and once the group
  // headers are dropped, both copies land in ONE list keyed by item.id. Duplicate keys in a single
  // list are undefined behaviour in React: it warns, then reconciles unpredictably, orphaning
  // rendered nodes and silently dropping the entries that follow. Collapsing and reopening the
  // sidebar was leaving stray label-less icons behind and losing the tail of the menu because of
  // exactly that. Showing one icon per destination is also the right thing on its own — two
  // identical icons pointing at the same section tell the user nothing.
  const flattenForCollapsed = (items: MenuItem[]): MenuItem[] => {
    const result: MenuItem[] = [];
    const seen = new Set<string>();

    const push = (item: MenuItem) => {
      if (seen.has(item.id)) return;
      seen.add(item.id);
      result.push(item);
    };

    items.forEach(item => {
      if (item.children && item.children.length > 0) {
        // Push children directly (skip the parent group header)
        item.children.forEach(push);
      } else {
        push(item);
      }
    });
    return result;
  };

  const collapsedItems = flattenForCollapsed(filteredMenuItems);

  /** Rolls child badges up to the parent, so a collapsed group still shows the alert. */
  const badgeFor = (item: MenuItem): number =>
    (item.badge ?? 0) + (item.children?.reduce((sum, child) => sum + (child.badge ?? 0), 0) ?? 0);

  const badgePill = (count: number) => (
    <span className="ml-2 min-w-[18px] h-[18px] px-1.5 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center leading-none flex-shrink-0">
      {count > 99 ? '99+' : count}
    </span>
  );

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
      // Keyed per mode so toggling remounts the tree instead of reconciling the icon-only list
      // against the labelled one. Both modes return div > nav > keyed rows, so without this React
      // matches them position-by-position and carries collapsed rows over into the expanded view.
      // Only the DOM is remounted — this component's own state (expandedItems) is untouched.
      <div
        key="sidebar-collapsed"
        className={`w-14 h-full flex flex-col border-r transition-all duration-300 ease-in-out overflow-visible ${isDarkMode ? 'bg-gray-800 border-gray-600' : 'bg-white border-gray-300'
          }`}
        style={{ position: 'relative' }}
      >
        <nav className="flex-1 py-4 overflow-y-auto overflow-x-visible scrollbar-none">
          {collapsedItems.map(item => {
            const IconComponent = item.icon;
            const isActive = activeSection === item.id;
            const badgeCount = badgeFor(item);
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
                  <div className="relative">
                    <IconComponent
                      className={`h-5 w-5 ${isActive ? '' : isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}
                      style={isActive ? { color: colorPalette?.primary || '#7c3aed' } : {}}
                    />
                    {/* Count sits on the icon here — there is no label to sit beside. */}
                    {badgeCount > 0 && (
                      <span className="absolute -top-1.5 -right-2 min-w-[15px] h-[15px] px-1 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center leading-none">
                        {badgeCount > 99 ? '99+' : badgeCount}
                      </span>
                    )}
                  </div>
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

        {/* Logout icon only. Same home-indicator clearance as the expanded sidebar. */}
        <div
          className={`px-0 pt-3 pb-3 border-t flex-shrink-0 flex justify-center ${isDarkMode ? 'border-gray-600' : 'border-gray-300'}`}
          style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom, 0px))' }}
        >
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
    // A collapsed group surfaces its children's alerts; an expanded one does not, or the
    // same count would be shown twice.
    const badgeCount = hasChildren && isExpanded ? (item.badge ?? 0) : badgeFor(item);

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
            {badgeCount > 0 && badgePill(badgeCount)}
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
    // See the collapsed branch: distinct key so the two modes never share reconciled DOM.
    <div
      key="sidebar-expanded"
      className={`w-64 border-r h-full ${isDarkMode ? 'bg-gray-800 border-gray-600' : 'bg-white border-gray-300'} flex flex-col transition-all duration-300 ease-in-out overflow-hidden`}
    >
      <nav className="flex-1 py-4 overflow-y-auto overflow-x-hidden scrollbar-none">
        {filteredMenuItems.map(item => renderMenuItem(item))}
      </nav>

      {/* Bottom block (account + Logout).
          The extra bottom padding clears the iPhone home indicator, which
          otherwise overlaps the Logout button on a notched device. env() returns 0
          where there is no inset, so desktop and Android are unaffected. Requires
          viewport-fit=cover on the viewport meta. */}
      <div
        className={`px-3 pt-3 pb-3 ${isDarkMode ? 'border-gray-600' : 'border-gray-300'} border-t flex-shrink-0`}
        style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom, 0px))' }}
      >
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
