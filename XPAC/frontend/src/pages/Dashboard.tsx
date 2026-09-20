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
import ModemRouterLogs from './ModemRouterLogs';
import RadiusQueue from './radiusqueue';
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
import SmartOltTool from './SmartOltTool';
import MikrotikRadiusTool from './MikrotikRadiusTool';
import XenditReconcileTool from './XenditReconcileTool';
import BillingReconcileTool from './BillingReconcileTool';
import SmsConfig from './SmsConfig';
import SMSTemplate from './SMSTemplate';
import EmailTemplates from './EmailTemplates';
import PPPoESetup from './PPPoESetup';
import Support from './Support';
import LiveMonitor from './LiveMonitor';
import ConcernConfig from './ConcernConfig';
import DashboardCustomer from './DashboardCustomer';
import DashboardAgent from './DashboardAgent';
import ApplicationForm from './ApplicationForm';
import Bills from './Bills';
import Reports from './Reports';
import TechUsers from './TechUsers';
import Organization from './organization';
import TeamAgent from './teamAgent';
import Roles from './roles';
import BonusHistory from './BonusHistory';
import AgentPayout from './AgentPayout';
import AgentInvoice from './AgentInvoice';
import AccessDenied from '../components/AccessDenied';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import { usePermissions } from '../hooks/usePermissions';
import { homeSectionFor, permissionForSection, permissionsAllow } from '../config/permissions';
import apiClient from '../config/api';

interface DashboardProps {
    onLogout: () => void;
}

const Dashboard: React.FC<DashboardProps> = ({ onLogout }) => {
    const [userData, setUserData] = useState<any>(() => {
        try {
            const authData = localStorage.getItem('authData');
            return authData ? JSON.parse(authData) : null;
        } catch (error) {
            console.error('Error parsing user data:', error);
            return null;
        }
    });

    // Where this user lands. The per-role ladder this replaced repeated the role
    // table a third time and had no answer for a custom role beyond "the first
    // key in the array", which could be a sub action. homeSectionFor uses the
    // landing page the server named, falling back to the role's own.
    const [activeSection, setActiveSection] = useState(() => {
        try {
            const authData = localStorage.getItem('authData');
            return homeSectionFor(authData ? JSON.parse(authData) : null);
        } catch (e) {
            console.error(e);
            return 'dashboard';
        }
    });

    const { can, home } = usePermissions();

    const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
    const [billsInitialTab, setBillsInitialTab] = useState<'soa' | 'invoices' | 'payments'>('soa');
    const [customerInitialSearch, setCustomerInitialSearch] = useState('');
    const [customerAutoOpenAccountNo, setCustomerAutoOpenAccountNo] = useState('');
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
     * role edited while somebody is signed in takes effect on their next load
     * rather than their next sign-in, and it is the server's answer rather than
     * the client's copy of the role table — so a custom role whose list never
     * reached the client (the mobile app used to drop it at login) still gets
     * one.
     *
     * A failure here is not fatal: the stored list, or the role table for a
     * seeded role, carries on being used.
     */
    useEffect(() => {
        if (!userData || !userData.role_id) return;

        let cancelled = false;

        const reconcile = async () => {
            try {
                const response = await apiClient.get<{
                    success: boolean;
                    data: { permissions: string[]; home: string | null };
                }>('/me/permissions');

                if (cancelled || !response.data?.success) return;

                const { permissions, home: serverHome } = response.data.data;
                if (!Array.isArray(permissions)) return;

                const stored = Array.isArray(userData.permissions) ? userData.permissions : [];
                const unchanged =
                    stored.length === permissions.length &&
                    stored.every((key: string) => permissions.includes(key)) &&
                    userData.home === serverHome;

                if (unchanged) return;

                const updatedUser = { ...userData, permissions, home: serverHome };
                setUserData(updatedUser);
                localStorage.setItem('authData', JSON.stringify(updatedUser));
                // usePermissions elsewhere in the tree listens for this; a
                // `storage` event only fires in other tabs.
                window.dispatchEvent(new Event('auth-changed'));

                // If the section on screen is no longer this role's to open,
                // move rather than leave them staring at a refusal.
                setActiveSection(current =>
                    permissionsAllow(permissions, permissionForSection(current))
                        ? current
                        : homeSectionFor(updatedUser)
                );
            } catch (err) {
                console.error('Failed to refresh permissions:', err);
            }
        };

        reconcile();

        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [userData?.role_id]);

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
     * This is the app's route protection. There is no URL router here — a
     * section is a piece of state — but the state is reachable from more than
     * the sidebar: a deep link handed to onNavigate, a restored session, a
     * button on another page. Checking here rather than in the sidebar means
     * the check holds however the section was chosen, and it is the same key
     * the API will demand a moment later.
     */
    const renderContent = () => {
        if (!can(permissionForSection(activeSection))) {
            return (
                <AccessDenied
                    section={activeSection}
                    onGoHome={() => handleSectionChange(home)}
                />
            );
        }

        return renderSection();
    };

    const renderSection = () => {
        switch (activeSection) {
            // Customer Routes
            case 'customer-dashboard':
                return <DashboardCustomer
                    onNavigate={(section, tab) => handleSectionChange(section, tab)}
                    autoOpenPayModal={customerAutoOpenPayModal}
                />;
            // Agent Routes
            case 'agent-dashboard':
                return <DashboardAgent onNavigate={handleSectionChange} />;
            case 'agent-application':
                return (
                    <ApplicationForm
                        onClose={() => handleSectionChange('agent-dashboard')}
                        onSubmitted={() => handleSectionChange('agent-dashboard')}
                    />
                );

            case 'customer-bills':
                return <Bills initialTab={billsInitialTab} onNavigate={handleSectionChange} />;
            case 'customer-support':
                return <Support forceLightMode={true} />;

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
            case 'modem-router-logs':
                return <ModemRouterLogs isDarkMode={isDarkMode} />;
            case 'smart-olt-logs':
                return <FileLogViewer type="smartolt" title="Smart OLT Logs" />;
            case 'radius-logs':
                return <FileLogViewer type="radius" title="Radius Logs" />;
            case 'radius-queue':
                return <RadiusQueue />;
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
                return <ApplicationManagement onNavigate={handleSectionChange} />;
            case 'customer':
                return <Customer initialSearchQuery={customerInitialSearch} autoOpenAccountNo={customerAutoOpenAccountNo} />;
            case 'transaction-list':
                return (
                    <TransactionList onNavigate={(section, search) => handleSectionChange(section, search)} />
                );
            case 'transactions-revert':
                return <TransactionsRevert />;
            case 'payment-portal':
                return <PaymentPortal />;
            case 'job-order':
                return <JobOrder />;
            case 'work-order':
                return <WorkOrder />;
            case 'service-order':
                return <ServiceOrder />;
            case 'reports':
                return <Reports />;
            case 'bonus-history':
                return <BonusHistory />;
            case 'agent-payout':
                return <AgentPayout />;
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
                if (userData && String(userData.role_id) === '3') {
                    return <DashboardCustomer onNavigate={(section, tab) => handleSectionChange(section, tab)} />;
                }
                if (userData && (userData.role?.toLowerCase() === 'agent' || String(userData.role_id) === '4')) {
                    return <DashboardAgent onNavigate={handleSectionChange} />;
                }
                return <DashboardContent />;
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
                <div className={`h-screen flex flex-col overflow-hidden ${isDarkMode ? 'bg-gray-950' : 'bg-gray-50'
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
                                } md:translate-x-0 h-screen md:h-auto`}>
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