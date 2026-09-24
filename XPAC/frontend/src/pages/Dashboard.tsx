import React, { useState, useEffect } from 'react';
import { DCNoticeProvider } from '../contexts/DCNoticeContext';
import { StaggeredPaymentProvider } from '../contexts/StaggeredPaymentContext';
// import { DiscountProvider } from '../contexts/DiscountContext';
// import { ApplicationProvider } from '../contexts/ApplicationContext';
// import { ApplicationVisitProvider } from '../contexts/ApplicationVisitContext';
// import { JobOrderProvider } from '../contexts/JobOrderContext';
// import { ServiceOrderProvider } from '../contexts/ServiceOrderContext';
import DCNotice from './DCNotice';
import Discounts from './Discounts';
import Overdue from './Overdue';
import SOChargePage from './SOcharge';
import StaggeredPayment from './StaggeredPayment';
import MassRebate from './Rebate';
import SMSBlast from './SMSBlast';
import SMSBlastLogs from './SMSBlastLogs';
import DisconnectionLogs from './DisconnectionLogs';
import ReconnectionLogs from './ReconnectionLogs';
import SmsLogs from './SmsLogs';
import EmailLogs from './EmailLogs';
import DataLogs from './DataLogs';
import FileLogViewer from './FileLogViewer';
import Sidebar from './Sidebar';
import Header from './Header';
import DashboardContent from '../components/DashboardContent';
import UserManagement from './UserManagement';
import GroupManagement from './GroupManagement';
import ApplicationManagement from './ApplicationManagement';
import Customer from './Customer';
import BillingListView from './BillingListView';
import TransactionList from './TransactionList';
import TransactionsRevert from './TransactionsRevert';
import PrepaidOverride from './PrepaidOverride';
import PaymentPortal from './PaymentPortal';
import JobOrder from './JobOrder';
import WorkOrder from './WorkOrder';
import ServiceOrder from './ServiceOrder';
// import ApplicationVisit from './ApplicationVisit';
import LocationList from './LocationList';
import PlanList from './PlanList';
import PromoList from './PromoList';
import RouterModelList from './RouterModelList';
import LcpList from './LcpList';
import NapList from './NapList';
import Inventory from './Inventory';
import ExpensesLog from './ExpensesLog';
import Expenses from './Expenses';
import ExpensesCategoryList from './ExpensesCategoryList';
import MonthlyPayables from './MonthlyPayables';
import Logs from './Logs';
import SOA from './SOA';
import Invoice from './Invoice';
import InventoryCategoryList from './InventoryCategoryList';
import SOAGeneration from './SOAGeneration';
import UsageTypeList from './UsageTypeList';
import VlanList from './VlanList';
import PaymentMethodList from './PaymentMethodList';
import WorkCategoryList from './WorkCategoryList';
import Ports from './Ports';
import StatusRemarksList from './StatusRemarksList';
import Settings from './Settings';
import LcpNapLocation from './LcpNapLocation';
import BillingConfig from './BillingConfig';
import RadiusConfig from './RadiusConfig';
import SmartOltConfig from './SmartOltConfig';
import SmsConfig from './SmsConfig';
import SMSTemplate from './SMSTemplate';
import EmailTemplates from './EmailTemplates';
import PPPoESetup from './PPPoESetup';
import Support from './Support';
import LiveMonitor from './LiveMonitor';
import ConcernConfig from './ConcernConfig';
import DashboardCustomer from './DashboardCustomer';
import Bills from './Bills';
import Reports from './Reports';
import TechUsers from './TechUsers';
import Organization from './organization';
import TeamAgent from './teamAgent';
import Roles from './roles';
import Commission from './Commission';
import AgentPayout from './AgentPayout';
import BonusHistory from './BonusHistory';
import AgentInvoice from './AgentInvoice';
import DashboardAgent from './DashboardAgent';
import ApplicationForm from './ApplicationForm';
import SmartOltTool from './SmartOltTool';
import MikrotikRadiusTool from './MikrotikRadiusTool';
import XenditReconcileTool from './XenditReconcileTool';
import BillingReconcileTool from './BillingReconcileTool';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import AccessDenied from '../components/AccessDenied';
import { usePermissions } from '../hooks/usePermissions';
import {
    AuthLike,
    PermissionRefresh,
    canOpenSection,
    homeSectionFor,
    inheritedPermissions,
    isLockedRole,
    mergeAuth,
    parsePermissions,
    refreshPatch,
    roleIdOf,
} from '../config/permissions';
import apiClient from '../config/api';
import { roleService } from '../services/userService';

interface DashboardProps {
    onLogout: () => void;
}

/** authData as stored right now, or null when signed out or unreadable. */
const readStoredAuth = (): any | null => {
    try {
        const authData = localStorage.getItem('authData');
        return authData ? JSON.parse(authData) : null;
    } catch (error) {
        console.error('Error parsing user data:', error);
        return null;
    }
};

const Dashboard: React.FC<DashboardProps> = ({ onLogout }) => {
    const [userData, setUserData] = useState<any>(readStoredAuth);

    // Where this user lands. A seeded role lands where it always has (see
    // ROLE_HOME in config/permissions.ts); a custom role lands on the page the
    // server named, or else the first page it holds, never on a sub action.
    // Kept, so the permission refresh below can tell whether the user is still
    // on the page they were first shown.
    const [initialLanding] = useState<string>(() => homeSectionFor(readStoredAuth()));
    const [activeSection, setActiveSection] = useState<string>(initialLanding);

    const { can, canOpen, home } = usePermissions();

    const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
    const [billsInitialTab, setBillsInitialTab] = useState<'soa' | 'invoices' | 'payments'>('soa');
    const [customerInitialSearch, setCustomerInitialSearch] = useState('');
    const [customerAutoOpenAccountNo, setCustomerAutoOpenAccountNo] = useState('');
    // Set when a notification is clicked, so the target page opens that record's
    // details rather than just landing on the list.
    const [jobOrderAutoOpenId, setJobOrderAutoOpenId] = useState('');
    const [applicationAutoOpenId, setApplicationAutoOpenId] = useState('');
    const [revertAutoOpenId, setRevertAutoOpenId] = useState('');
    const [prepaidOverrideAutoOpenId, setPrepaidOverrideAutoOpenId] = useState('');
    const [serviceOrderAutoOpenId, setServiceOrderAutoOpenId] = useState('');
    const [customerAutoOpenPayModal, setCustomerAutoOpenPayModal] = useState(false);
    const [planInitialSearch, setPlanInitialSearch] = useState('');
    const [isDarkMode, setIsDarkMode] = useState<boolean>(() => {
        try {
            const authData = localStorage.getItem('authData');
            if (authData) {
                const user = JSON.parse(authData);
                if (user.role === 'customer' || String(user.role_id) === '3') {
                    return false;
                }
            }
            const theme = localStorage.getItem('theme');
            return theme === 'dark' || theme === null;
        } catch (e) {
            return true;
        }
    });
    // Track dark mode changes
    useEffect(() => {
        const checkDarkMode = () => {
            const theme = localStorage.getItem('theme');
            setIsDarkMode(theme === 'dark' || theme === null);
        };

        checkDarkMode();

        const observer = new MutationObserver(() => {
            checkDarkMode();
        });

        observer.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ['class']
        });

        const handleStorageChange = (e: StorageEvent) => {
            if (e.key === 'theme' || !e.key) {
                checkDarkMode();
                // Update document layout as well
                const theme = localStorage.getItem('theme');
                if (theme === 'dark' || theme === null) {
                    document.documentElement.classList.add('dark');
                } else {
                    document.documentElement.classList.remove('dark');
                }
            }
        };

        window.addEventListener('storage', handleStorageChange);

        return () => {
            observer.disconnect();
            window.removeEventListener('storage', handleStorageChange);
        };
    }, []);

    /**
     * Reconcile this session's permissions against the server.
     *
     * The list stored at sign-in is a snapshot. Asking once per load means a
     * role edited while somebody is signed in — or the user moved to another
     * role — takes effect on their next load, and that a custom role always
     * uses the server's resolved list (base role merged in, grandfathered
     * actions included) rather than its raw row.
     *
     * A failure here is not fatal: the stored list, or the role table for a
     * seeded role, carries on being used.
     */
    useEffect(() => {
        if (!userData) return;

        // Set on unmount, i.e. sign-out.
        let cancelled = false;
        const signedInAs = userData.id;

        /**
         * Merge a fresher account into authData.
         *
         * Only into what is stored NOW, and only while it is still the account
         * this request was made for. Signing out (the Logout button, the
         * session-expired prompt, a failed revalidation on load) clears
         * authData before this component unmounts, and another tab may have
         * signed someone else in; an answer landing late must neither bring a
         * signed-out session back nor overwrite another user's.
         */
        const commit = (patch: (current: AuthLike) => Partial<AuthLike>) => {
            if (cancelled) return;

            const current = readStoredAuth();
            const updated = current ? mergeAuth(current, signedInAs, patch(current)) : null;
            if (!updated) return;

            localStorage.setItem('authData', JSON.stringify(updated));
            setUserData(updated);
            // usePermissions elsewhere in the tree listens for this; a
            // `storage` event only fires in other tabs.
            window.dispatchEvent(new Event('auth-changed'));

            // Move somebody still on the page they were first shown to where
            // the refreshed role lands, and anybody on a page the role can no
            // longer open; leave everyone else where they are.
            const nextHome = homeSectionFor(updated);
            setActiveSection(section =>
                section === initialLanding || !canOpenSection(updated, section) ? nextHome : section
            );
        };

        /**
         * The path the app took before GET /me/permissions existed, kept for a
         * backend that does not have it yet: a custom role signed in without
         * its list reads it off its own role row.
         */
        const fallBackToRoleRow = async () => {
            const roleId = roleIdOf(userData);
            if (roleId <= 0 || isLockedRole(roleId)) return;
            if (userData.permissions !== undefined && userData.permissions !== null) return;

            try {
                const response = await roleService.getRoleById(roleId);
                const row: any = response?.success ? response.data : null;
                if (!row) return;

                if (Array.isArray(row.effective_permissions)) {
                    commit(() => ({
                        permissions: [...inheritedPermissions(row.base_role_id), ...row.effective_permissions],
                        permissions_resolved: true,
                    }));
                    return;
                }

                const stored = parsePermissions(row.permissions);
                if (stored.length > 0) {
                    commit(() => ({ permissions: stored, permissions_resolved: false }));
                }
            } catch (err) {
                console.warn('Failed to read role permissions:', err);
            }
        };

        const reconcile = async () => {
            try {
                const response = await apiClient.get<{
                    success: boolean;
                    data: PermissionRefresh;
                }>('/me/permissions');

                const fresh = response.data?.data;
                if (!response.data?.success || !fresh || !Array.isArray(fresh.permissions)) return;

                // Permissions, landing page, and the role itself: the user may
                // have been moved to another role since signing in.
                commit(current => refreshPatch(current, fresh));
            } catch (err: any) {
                const status = err?.response?.status;
                // A 404 is a backend without this endpoint; a 401/419 is a
                // lapsed session, which the API client already handles.
                console.warn('Failed to refresh permissions:', status ?? err?.message ?? err);
                if (!cancelled && status !== 401 && status !== 419) {
                    await fallBackToRoleRow();
                }
            }
        };

        reconcile();

        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [userData?.id, userData?.role_id]);

    useEffect(() => {
        const fetchColorPalette = async () => {
            try {
                const activePalette = await settingsColorPaletteService.getActive();
                setColorPalette(activePalette);
            } catch (err) {
                console.error('Failed to fetch color palette:', err);
            }
        };

        fetchColorPalette();
    }, []);

    /**
     * The section guard.
     *
     * There is no URL router here: a section is a piece of state, reachable from
     * the sidebar, a notification, a restored session or a button on another
     * page. Checking here means the check holds however the section was chosen,
     * and it is the same key the API will demand a moment later. `canOpen` also
     * honours the header bell's shortcuts a seeded role has always had
     * (WEB_REACHABLE in config/permissions.ts).
     */
    const renderContent = () => {
        if (!canOpen(activeSection)) {
            return (
                <AccessDenied
                    section={activeSection}
                    // No way "home" when home is this refusal, or is refused too.
                    onGoHome={home !== activeSection && canOpen(home) ? () => handleSectionChange(home) : undefined}
                />
            );
        }

        return renderSection();
    };

    /**
     * The 'dashboard' section, which opens for any of the three dashboard keys.
     *
     * A seeded role gets the dashboard it always had, chosen by role. A custom
     * role gets the one its keys name: the general dashboard when it holds
     * `dashboard` (or has no list yet, as before), else the agent's or the
     * customer's.
     */
    const renderDashboard = () => {
        const roleId = roleIdOf(userData);
        const custom = !isLockedRole(roleId);

        if ((userData && String(userData.role_id) === '3') ||
            (custom && !can('dashboard') && !can('agent-dashboard') && can('customer-dashboard'))) {
            return <DashboardCustomer onNavigate={(section, tab) => handleSectionChange(section, tab)} />;
        }
        if ((userData && (userData.role?.toLowerCase() === 'agent' || String(userData.role_id) === '4')) ||
            (custom && !can('dashboard') && can('agent-dashboard'))) {
            return <DashboardAgent onNavigate={handleSectionChange} />;
        }
        return <DashboardContent />;
    };

    const renderSection = () => {
        switch (activeSection) {
            // Customer Routes
            case 'customer-dashboard':
                return <DashboardCustomer
                    onNavigate={(section, tab) => handleSectionChange(section, tab)}
                    autoOpenPayModal={customerAutoOpenPayModal}
                />;
            case 'customer-bills':
                return <Bills initialTab={billsInitialTab} onNavigate={handleSectionChange} />;
            case 'customer-support':
                return <Support forceLightMode={true} />;

            // Agent Routes
            case 'agent-dashboard':
                return <DashboardAgent onNavigate={handleSectionChange} />;
            case 'agent-application':
                // Back to the dashboard it was opened from: the agent's
                // 'dashboard', or a custom role's own landing page.
                return (
                    <ApplicationForm
                        onClose={() => handleSectionChange(home)}
                        onSubmitted={() => handleSectionChange(home)}
                    />
                );

            case 'live-monitor':
                return <LiveMonitor />;
            case 'support':
                return <Support />;
            case 'soa':
                return <SOA />;
            case 'invoice':
                return <Invoice />;
            case 'overdue':
                return <Overdue />;
            case 'so-charge':
                return <SOChargePage />;
            case 'dc-notice':
                return <DCNotice />;
            case 'discounts':
                return <Discounts />;
            case 'billing-config':
                return <BillingConfig />;
            case 'radius-config':
                return <RadiusConfig />;
            case 'smart-olt':
                return <SmartOltConfig />;
            case 'sms-config':
                return <SmsConfig />;
            case 'sms-template':
                return <SMSTemplate />;
            case 'email-templates':
                return <EmailTemplates />;
            case 'pppoe-setup':
                return <PPPoESetup />;
            case 'concern-config':
                return <ConcernConfig />;


            case 'staggered-payment':
                return <StaggeredPayment />;
            case 'mass-rebate':
                return <MassRebate />;
            case 'sms-blast':
                return <SMSBlast />;
            case 'sms-blast-logs':
                return <SMSBlastLogs />;
            case 'disconnected-logs':
                return <DisconnectionLogs />;
            case 'reconnection-logs':
                return <ReconnectionLogs />;
            case 'sms-logs':
                return <SmsLogs />;
            case 'email-logs':
                return <EmailLogs />;
            case 'data-logs':
                return <DataLogs />;
            case 'smart-olt-logs':
                return <FileLogViewer type="smartolt" title="Smart OLT Logs" />;
            case 'radius-logs':
                return <FileLogViewer type="radius" title="Radius Logs" />;
            case 'agent-management':
                return <UserManagement agentOnly />;
            case 'user-management':
                return <UserManagement />;
            case 'tech-users':
                return <TechUsers />;
            case 'organization':
                return <Organization />;
            case 'team-agent':
                return <TeamAgent />;
            case 'roles':
                return <Roles />;
            case 'group-management':
                return <GroupManagement />;
            case 'application-management':
                return <ApplicationManagement onNavigate={handleSectionChange} autoOpenApplicationId={applicationAutoOpenId} />;
            case 'customer':
                return <Customer initialSearchQuery={customerInitialSearch} autoOpenAccountNo={customerAutoOpenAccountNo} />;
            case 'transaction-list':
                return (
                    <TransactionList onNavigate={(section, search) => handleSectionChange(section, search)} />
                );
            case 'transactions-revert':
                return <TransactionsRevert autoOpenRevertId={revertAutoOpenId} />;
            case 'prepaid-override':
                return <PrepaidOverride autoOpenOverrideId={prepaidOverrideAutoOpenId} />;
            case 'payment-portal':
                return <PaymentPortal />;
            case 'job-order':
                return <JobOrder autoOpenJobOrderId={jobOrderAutoOpenId} />;
            case 'work-order':
                return <WorkOrder />;
            case 'service-order':
                return <ServiceOrder autoOpenServiceOrderId={serviceOrderAutoOpenId} />;
            // Opened only for a role holding 'reports' (SuperAdmin among the
            // seeded roles); the section guard above enforces it.
            case 'reports':
                return <Reports />;
            case 'commission':
                return <Commission />;
            case 'agent-payout':
                return <AgentPayout />;
            case 'bonus-history':
                return <BonusHistory />;
            case 'agent-invoices':
                return <AgentInvoice />;
            // case 'application-visit':
            //     return <ApplicationVisit />;
            case 'location-list':
                return <LocationList />;
            case 'plan-list':
                return <PlanList onNavigate={handleSectionChange} initialSearchQuery={planInitialSearch} />;
            case 'promo-list':
                return <PromoList />;
            case 'router-models':
                return <RouterModelList />;
            case 'lcp':
                return <LcpList />;
            case 'nap':
                return <NapList />;
            case 'lcp-nap-location':
                return <LcpNapLocation />;
            case 'usage-type':
                return <UsageTypeList />;
            case 'vlan-config':
                return <VlanList />;
            case 'payment-method':
                return <PaymentMethodList />;
            case 'work-category':
                return <WorkCategoryList />;
            case 'ports':
                return <Ports />;
            case 'status-remarks-list':
                return <StatusRemarksList />;
            case 'inventory':
                return <Inventory />;
            case 'inventory-category-list':
                return <InventoryCategoryList />;
            case 'monthly-payables':
                return <MonthlyPayables />;
            case 'expenses':
                return <Expenses />;
            case 'expenses-category':
                return <ExpensesCategoryList />;
            case 'expenses-log':
                return <ExpensesLog />;
            case 'system-logs':
                return <Logs />;
            case 'soa-generation':
                return <SOAGeneration />;
            case 'smartolt-tool':
                return <SmartOltTool isDarkMode={isDarkMode} />;
            case 'mikrotik-radius-tool':
                return <MikrotikRadiusTool isDarkMode={isDarkMode} />;
            case 'xendit-reconcile-tool':
                return <XenditReconcileTool isDarkMode={isDarkMode} />;
            case 'billing-reconcile-tool':
                return <BillingReconcileTool isDarkMode={isDarkMode} />;
            case 'settings':
                return <Settings />;
            case 'dashboard':
            default:
                return renderDashboard();
        }
    };

    const handleSearch = (query: string) => {
        setSearchQuery(query);
    };

    const toggleSidebar = () => {
        const isMobile = window.innerWidth < 768;
        if (isMobile) {
            setIsMobileMenuOpen(!isMobileMenuOpen);
        } else {
            setSidebarCollapsed(!sidebarCollapsed);
        }
    };

    const closeMobileMenu = () => {
        setIsMobileMenuOpen(false);
    };

    const handleSectionChange = (section: string, extra?: string) => {
        setActiveSection(section);
        if (section === 'customer-bills') {
            setBillsInitialTab((extra as any) || 'soa');
        } else if (section === 'customer-dashboard') {
            if (extra === 'paynow') {
                setCustomerAutoOpenPayModal(true);
            } else {
                setCustomerAutoOpenPayModal(false);
            }
        } else if (section === 'customer') {
            setCustomerInitialSearch(extra || '');
            setCustomerAutoOpenAccountNo(extra || '');
        } else if (section === 'plan-list') {
            setPlanInitialSearch(extra || '');
        } else if (section === 'job-order') {
            // Carries the id of a job order to open, sent when a "Job Done"
            // notification is clicked. Cleared on a plain navigation so returning to
            // the page later does not reopen whatever was last looked at.
            setJobOrderAutoOpenId(extra || '');
        } else if (section === 'application-management') {
            setApplicationAutoOpenId(extra || '');
        } else if (section === 'transactions-revert') {
            setRevertAutoOpenId(extra || '');
        } else if (section === 'prepaid-override') {
            setPrepaidOverrideAutoOpenId(extra || '');
        } else if (section === 'service-order') {
            setServiceOrderAutoOpenId(extra || '');
        }

        if (window.innerWidth < 768) {
            closeMobileMenu();
        }
    };

    // Helper to determine if we should show sidebar
    const showSidebar = userData && String(userData.role_id) !== '3';

    return (
        <DCNoticeProvider>
            <StaggeredPaymentProvider>
                {/* <DiscountProvider> */}
                {/* <ApplicationProvider> */}
                {/* <ApplicationVisitProvider> */}
                {/* <JobOrderProvider> */}
                {/* <ServiceOrderProvider> */}
                {/* h-[100dvh], not h-screen: 100vh on iOS Safari is the LARGE viewport
                    (measured as if the address bar were hidden), so the bottom of the
                    shell sits behind the browser chrome and anything pinned there —
                    the sidebar's Logout button — is unreachable. dvh tracks the
                    actually-visible height. Matches the h-[100dvh] already used by the
                    detail panels. */}
                <div className={`h-[100dvh] flex flex-col overflow-hidden ${isDarkMode ? 'bg-gray-950' : 'bg-gray-50'
                    }`}>
                    {/* Fixed Header */}
                    <div className="flex-shrink-0">
                        <Header
                            onSearch={handleSearch}
                            onToggleSidebar={toggleSidebar}
                            onNavigate={handleSectionChange}
                            onLogout={onLogout}
                            activeSection={activeSection}
                        />
                    </div>

                    {/* Main Content Area with Fixed Sidebar and Scrollable Content */}
                    <div className="flex-1 flex overflow-hidden">
                        {/* Mobile Overlay */}
                        {isMobileMenuOpen && (
                            <div
                                className="fixed inset-0 bg-black bg-opacity-50 z-40 md:hidden"
                                onClick={closeMobileMenu}
                            />
                        )}

                        {/* Fixed Sidebar */}
                        {showSidebar && (
                            <div className={`flex-shrink-0 fixed md:relative z-50 transition-all duration-300 top-0 md:top-auto left-0 ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
                                } md:translate-x-0 h-[100dvh] md:h-auto`}>
                                <div className="h-full md:h-full">
                                    <Sidebar
                                        activeSection={activeSection}
                                        onSectionChange={handleSectionChange}
                                        onLogout={onLogout}
                                        isCollapsed={sidebarCollapsed}
                                        userRole={userData?.role || ''}
                                        roleId={userData?.role_id}
                                        organizationId={userData?.organization?.id || userData?.organization_id}
                                        userEmail={userData?.email || ''}
                                        permissions={userData?.permissions || null}
                                    />
                                </div>
                            </div>
                        )}

                        {/* Scrollable Content Area Only */}
                        <div className={`flex-1 overflow-hidden ${isDarkMode ? 'bg-gray-950' : 'bg-gray-50'
                            }`}>
                            <div className="h-full overflow-y-auto">
                                {renderContent()}
                            </div>
                        </div>
                    </div>
                </div>
                {/* </ServiceOrderProvider> */}
                {/* </JobOrderProvider> */}
                {/* </ApplicationProvider> */}
                {/* </ApplicationVisitProvider> */}
                {/* </DiscountProvider> */}
            </StaggeredPaymentProvider>
        </DCNoticeProvider >
    );
};

export default Dashboard;