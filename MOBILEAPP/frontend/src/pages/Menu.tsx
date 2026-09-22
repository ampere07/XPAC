import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, ScrollView, Pressable, useWindowDimensions, ActivityIndicator, Image, Modal, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import {
    User,
    Settings,
    Bell,
    LogOut,
    Info,
    Clock,
    CreditCard,
    Gauge,
    Tags,
    MessageSquare,
    Router,
    Layers,
    Ticket,
    AlertCircle,
    Server,
    Wifi,
    Send,
    Router as RouterIcon,
    Receipt,
    Network,
    Cable,
    MapPin,
    AlertTriangle,
    FileWarning,
    Mail,
    MessageSquareText,
    FileText,
    Wallet,
    Database,
    BarChart2,
    Users,
    RefreshCw,
    Zap,
    ScrollText,
    HardDrive,
    TestTube2,
    Tag,
    Coins,
    Activity,
    ClipboardList,
    MapPinCheck,
    Building,
    Shield,
    Wrench,
    UserCog,
    DollarSign,
    Package,
    List,
} from 'lucide-react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import { formUIService } from '../services/formUIService';
import { useCustomerDataContext } from '../contexts/CustomerDataContext';
import { usePermissions } from '../hooks/usePermissions';
import { permissionForSection } from '../config/permissions';
import NotificationModal from '../modals/NotificationModal';
import AboutAppModal from '../modals/AboutAppModal';
import TimeInOutModal from '../modals/TimeInOutModal';
import packageJson from '../../package.json';
const version = packageJson.version;

interface MenuProps {
    onLogout?: () => void;
    onSectionChange?: (section: string) => void;
}

/**
 * The groups that make an account an administrator rather than a field user.
 *
 * Holding something in one of these is what opens the administrative menu at
 * all. Operations, Agent and Inventory are deliberately absent: a technician
 * holds Job Order and Work Order, an agent holds Bonus History, inventory staff
 * hold Inventory, and none of them has ever had this menu — they reach those
 * screens through their own navigation. Billing, Configurations, Users, Logs and
 * System are the surfaces no field role holds any part of, so requiring one of
 * them is what separates the two populations without naming a single role id.
 *
 * A Head Technician holds the plant records under Configurations (LCP, NAP and
 * Location), so this does give them an administrative menu containing those —
 * which is what the web sidebar already shows them.
 */
const ADMIN_SURFACE_GROUPS = ['Billing', 'Configurations', 'Users', 'Logs', 'System', 'Tools'];

/**
 * The administrative sections, in the order the menu lists them.
 *
 * Static, and lifted out of the component so the list is not rebuilt on every
 * render and so what a role may see is decided in one place below rather than
 * interleaved with the markup.
 *
 * Ids are mobile section ids, which is what onSectionChange expects. Several
 * differ from the permission key that guards them (`organizations` against
 * `organization`, `lcp-list` against `lcp`); permissionForSection() is what
 * translates between the two, so the ids here stay as Dashboard routes them.
 *
 * @see ADMIN_SURFACE_GROUPS for which of these make a user an administrator.
 */
const ADMIN_MENU_GROUPS: Array<{ title: string; items: Array<{ id: string; label: string; icon: any }> }> = [
        {
            title: 'Operations',
            items: [
                { id: 'live-monitor', label: 'Monitoring', icon: Activity },
                { id: 'applicationManagement', label: 'Applications', icon: ClipboardList },
                { id: 'applicationVisit', label: 'App Visits', icon: MapPinCheck },
                { id: 'job-order', label: 'Job Order', icon: Wrench },
                { id: 'service-order', label: 'Service Order', icon: Wrench },
                { id: 'radius-queue', label: 'RADIUS Queue', icon: Server },
                { id: 'work-order', label: 'Work Order', icon: Wrench },
                { id: 'lcp-nap-location', label: 'LCP/NAP Location', icon: MapPin },
                { id: 'sms-blast', label: 'SMS Blast', icon: Zap },
                { id: 'reports', label: 'Reports', icon: BarChart2 },
            ]
        },
        {
            title: 'Billing',
            items: [
                { id: 'customer', label: 'Customer', icon: User },
                { id: 'transaction-list', label: 'Transaction List', icon: Receipt },
                { id: 'transactions-revert', label: 'Revert Requests', icon: RefreshCw },
                { id: 'payment-portal', label: 'Payment Portal', icon: DollarSign },
                { id: 'soa', label: 'Statements', icon: FileText },
                { id: 'soa-generation', label: 'SOA Generation', icon: FileText },
                { id: 'invoice', label: 'Invoice', icon: Receipt },
                { id: 'overdue', label: 'Overdue', icon: Clock },
                { id: 'so-charges', label: 'SO Charge', icon: Coins },
                { id: 'dc-notice', label: 'DC Notice', icon: FileWarning },
                { id: 'rebate', label: 'Rebates', icon: Coins },
                { id: 'discounts', label: 'Discounts', icon: Tag },
                { id: 'billing', label: 'Billing List', icon: CreditCard },
                { id: 'staggered-payment', label: 'Staggered Payment', icon: CreditCard },
            ]
        },
        {
            title: 'Agent',
            items: [
                { id: 'commission', label: 'Pay Out/In', icon: DollarSign },
                { id: 'team-agent', label: 'Team Agents', icon: Users },
                { id: 'agent-management', label: 'Agent Management', icon: UserCog },
                { id: 'agent-payout', label: 'Agent Payout', icon: Wallet },
                { id: 'agent-invoices', label: 'Invoices', icon: FileText },
                { id: 'group-management', label: 'Affiliates', icon: Users },
            ]
        },
        {
            title: 'Inventory',
            items: [
                { id: 'inventory', label: 'Inventory', icon: Package },
                { id: 'inventory-category-list', label: 'Inventory Category List', icon: List },
            ]
        },
        {
            // See the Sidebar's copy of this group: only ported tools are listed.
            title: 'Tools',
            items: [
                { id: 'smartolt-tool', label: 'SmartOLT Tool', icon: Network },
                { id: 'mikrotik-radius-tool', label: 'Mikrotik Radius Tool', icon: Router },
                { id: 'xendit-reconcile-tool', label: 'Xendit Reconciliation', icon: CreditCard },
                { id: 'billing-reconcile-tool', label: 'Billing Reconcile', icon: Receipt },
            ]
        },
        {
            title: 'Configurations',
            items: [
                { id: 'promo-list', label: 'Promo', icon: Ticket },
                { id: 'plan-list', label: 'Plan', icon: Layers },
                { id: 'location-list', label: 'Location', icon: MapPin },
                { id: 'lcp-list', label: 'LCP', icon: Network },
                { id: 'nap-list', label: 'NAP', icon: Network },
                { id: 'usage-type-list', label: 'Usage Type', icon: Gauge },
                { id: 'vlan-config', label: 'VLAN', icon: Network },
                { id: 'payment-method-list', label: 'Payment Method', icon: CreditCard },
                { id: 'work-category-list', label: 'Work Category', icon: Tags },
                { id: 'status-remarks-list', label: 'Status Remarks', icon: MessageSquare },
                { id: 'router-model-list', label: 'Router Models', icon: Router },
                { id: 'ports', label: 'Ports', icon: Cable },
                { id: 'radius-config', label: 'Radius Config', icon: Wifi },
                { id: 'smart-olt-config', label: 'SmartOLT Config', icon: Server },
                { id: 'sms-config', label: 'SMS Config', icon: Send },
                { id: 'sms-template', label: 'SMS Template', icon: MessageSquare },
                { id: 'email-templates', label: 'Email Templates', icon: Mail },
                { id: 'pppoe-setup', label: 'PPPoE Setup', icon: RouterIcon },
                { id: 'concern-config', label: 'Concern Config', icon: AlertCircle },
                { id: 'billing-config', label: 'Billing Configurations', icon: Receipt },
            ]
        },
        {
            title: 'Users',
            items: [
                { id: 'user-management', label: 'Users Management', icon: Users },
                { id: 'tech-users', label: 'Tech Users', icon: Wrench },
                { id: 'organizations', label: 'Organizations', icon: Building },
                { id: 'roles', label: 'Roles', icon: Shield },
            ]
        },
        {
            title: 'Logs',
            items: [
                { id: 'disconnection-logs', label: 'Disconnected Logs', icon: AlertTriangle },
                { id: 'reconnection-logs', label: 'Reconnection Logs', icon: RefreshCw },
                { id: 'sms-logs', label: 'SMS Logs', icon: MessageSquareText },
                { id: 'email-logs', label: 'Email Logs', icon: Mail },
                { id: 'data-logs', label: 'Data Logs', icon: Database },
                { id: 'file-log-viewer', label: 'Smart OLT Logs', icon: FileText },
                { id: 'radius-logs', label: 'Radius Logs', icon: Activity },
                { id: 'activity-logs', label: 'System Logs', icon: ScrollText },
                { id: 'sms-blast-logs', label: 'SMS Blast Logs', icon: ScrollText },
                { id: 'expenses-log', label: 'Expenses', icon: Wallet },
                { id: 'modem-router-logs', label: 'Modem/Router Logs', icon: Router },
            ]
        },
        {
            title: 'System',
            items: [
                { id: 'database-setup', label: 'Database Setup', icon: HardDrive },
                { id: 'database-test', label: 'Database Test', icon: TestTube2 },
                { id: 'settings', label: 'Settings', icon: Settings },
            ]
        },
];

const Menu: React.FC<MenuProps> = ({ onLogout, onSectionChange }) => {
    const { width, height } = useWindowDimensions();
    const isMobile = width < 768;
    const isShort = height < 700;
    const { customerDetail, isLoading: contextLoading, silentRefresh } = useCustomerDataContext();
    const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
    const [userData, setUserData] = useState<any>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [logoUrl, setLogoUrl] = useState<string | null>(null);
    const [showLogoutModal, setShowLogoutModal] = useState(false);
    const [showNotificationModal, setShowNotificationModal] = useState(false);
    const [showAboutModal, setShowAboutModal] = useState(false);
    const [showTimeInOutModal, setShowTimeInOutModal] = useState(false);

    const initials = (customerDetail?.firstName && customerDetail?.lastName)
        ? `${customerDetail.firstName.charAt(0)}${customerDetail.lastName.charAt(0)}`.toUpperCase()
        : (customerDetail?.fullName || 'Customer').split(' ').map((n: any) => n[0]).join('').substring(0, 2).toUpperCase();


    const convertGoogleDriveUrl = (url: string): string => {
        if (!url) return '';
        const apiUrl = process.env.EXPO_PUBLIC_API_BASE_URL || process.env.REACT_APP_API_BASE_URL || '';
        return `${apiUrl}/proxy/image?url=${encodeURIComponent(url)}`;
    };

    const handleCancelPendingPayment = useCallback(() => {
        // Reserved for future use if needed
    }, []);

    useEffect(() => {
        const initialize = async () => {
            try {
                const [palette, authData] = await Promise.all([
                    settingsColorPaletteService.getActive(),
                    AsyncStorage.getItem('authData')
                ]);
                setColorPalette(palette);
                if (authData) {
                    setUserData(JSON.parse(authData));
                }

                // Fetch Logo
                const config = await formUIService.getConfig();
                if (config && config.logo_url) {
                    setLogoUrl(convertGoogleDriveUrl(config.logo_url));
                }
            } catch (err) {
                console.error('Failed to initialize Menu:', err);
            } finally {
                setIsLoading(false);
            }
        };

        initialize();
    }, []);

    const normalizedRole = (typeof userData?.role === 'string' ? userData.role : userData?.role?.name)?.toLowerCase() || '';
    const isTechnician = normalizedRole === 'technician' || userData?.role_id === 2;

    // Handed this screen's own copy of the account so the two agree about who is
    // signed in. Passed rather than left to load from storage on its own, the
    // way Dashboard does it, so the menu and the section it opens are decided
    // from one reading.
    const { can } = usePermissions(userData);

    /**
     * The administrative menu, or nothing at all.
     *
     * Two decisions, and they are deliberately separate.
     *
     * First, whether this account gets an administrative menu. That used to be
     * `normalizedRole === 'administrator' || role_id === '1'`, which asked the
     * wrong question in two ways: a SuperAdmin is role_id 7, so the one role
     * holding every key in the system was shown no admin menu at all, and a
     * hybrid custom role built on Administrator carries an id of 9 or above, so
     * those were hidden too however they were configured. It is now settled by
     * what the account can actually reach — see ADMIN_SURFACE_GROUPS.
     *
     * Second, which entries it gets, filtered through the permission table the
     * way the web Sidebar already filters its own (`can(permissionForSection)`),
     * so a role is offered what it holds rather than all of it or none.
     *
     * The first test is what keeps the second from changing anybody else's app.
     * A technician holds Job Order and Work Order, which appear in the Operations
     * group here, so filtering alone would have handed every field role an admin
     * menu duplicating navigation they already have. Requiring an administrative
     * key first leaves Technician, Agent, OSP, Inventory Staff and Customer
     * exactly as they were: no admin menu.
     */
    const adminGroups = (() => {
        const visible = ADMIN_MENU_GROUPS
            .map(group => ({ ...group, items: group.items.filter(item => can(permissionForSection(item.id))) }))
            .filter(group => group.items.length > 0);

        const isAdministrative = visible.some(group => ADMIN_SURFACE_GROUPS.includes(group.title));

        return isAdministrative ? visible : [];
    })();

    const menuGroups = [
        {
            title: 'Menu',
            items: [
                ...(isTechnician ? [{ id: 'time-in-out', label: 'Time In/Out', icon: Clock }] : []),
                { id: 'notifications', label: 'Notifications', icon: Bell },
                { id: 'about', label: 'About App', icon: Info },
                { id: 'release-notes', label: 'Release Notes', icon: Clock },
            ]
        },
        ...adminGroups,
    ];

    const displayName = customerDetail?.fullName || userData?.full_name || userData?.name || 'User Name';
    const accountNo = customerDetail?.billingAccount?.accountNo || userData?.username || 'username';
    const email = customerDetail?.emailAddress || userData?.email || 'user@example.com';
    const role = (typeof userData?.role === 'string' ? userData.role : userData?.role?.name)?.toUpperCase() || 'ROLE';

    if (isLoading && !customerDetail) {
        return (
            <View style={s.loadingContainer}>
                <ActivityIndicator size="large" color={colorPalette?.primary || '#ef4444'} />
            </View>
        );
    }

    return (
        <ScrollView style={s.scrollView} showsVerticalScrollIndicator={false}>
            {/* Header Section */}
            <LinearGradient
                colors={[colorPalette?.primary || '#ef4444', '#000000']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={[s.headerGradient, { paddingTop: isShort ? 30 : 60 }]}
            >
                {/* Logo Section */}
                <View style={[s.logoWrap, { marginBottom: isShort ? 20 : 40 }]}>
                    {logoUrl ? (
                        <Image source={{ uri: logoUrl }} style={s.logoImage} />
                    ) : (
                        <View style={s.logoFallbackRow}>
                            <View style={[s.logoCircle, { backgroundColor: '#ffffff' }]}>
                                <Text style={[s.logoLetter, { color: colorPalette?.primary || '#ef4444' }]}>X</Text>
                            </View>
                            <Text style={s.logoText}>
                                XPAC <Text style={s.logoTextBold}>PORTAL</Text>
                            </Text>
                        </View>
                    )}
                </View>

                {/* Standardized Balance Card */}
                <View style={s.balanceCard}>
                    <View style={[s.profileRow, { marginBottom: isShort ? 12 : 24 }]}>
                        <View style={[s.initialsCircle, { width: isShort ? 56 : 64, height: isShort ? 56 : 64, borderRadius: isShort ? 28 : 32 }]}>
                            <Text style={[s.initialsText, { fontSize: isShort ? 20 : 24 }]}>{initials}</Text>
                        </View>
                        <View style={{ alignItems: 'center' }}>
                            <Text style={[s.customerNameText, { fontSize: isShort ? 18 : 22, textAlign: 'center' }]}>{displayName}</Text>
                            <Text style={[s.customerAccountText, { textAlign: 'center', marginTop: 4 }]}>{isTechnician ? 'Username' : 'Account No'}: {accountNo}</Text>
                            <Text style={[s.customerEmailText, { textAlign: 'center', marginTop: 2 }]}>{email}</Text>
                        </View>
                    </View>
                </View>
            </LinearGradient>

            {/* Menu Groups */}
            <View style={s.menuContainer}>
                {menuGroups.map((group, groupIndex) => (
                    <View key={groupIndex} style={s.groupWrap}>
                        {!!group.title && <Text style={s.groupTitle}>{group.title}</Text>}
                        <View style={s.groupCard}>
                            {group.items.map((item, itemIndex) => (
                                <React.Fragment key={item.id}>
                                    <Pressable
                                        onPress={() => {
                                            if (item.id === 'notifications') {
                                                setShowNotificationModal(true);
                                            } else if (item.id === 'about') {
                                                setShowAboutModal(true);
                                            } else if (item.id === 'release-notes') {
                                                console.log('[Menu] Navigating to release-notes');
                                                if (onSectionChange) onSectionChange('release-notes');
                                            } else if (item.id === 'time-in-out') {
                                                setShowTimeInOutModal(true);
                                            } else if (onSectionChange) {
                                                // Configuration pages route through the Dashboard section switch.
                                                onSectionChange(item.id);
                                            }
                                        }}
                                        style={({ pressed }) => [
                                            s.menuItem,
                                            { backgroundColor: pressed ? '#f9fafb' : '#ffffff' }
                                        ]}
                                    >
                                        <View style={s.menuItemLeft}>
                                            <View style={s.menuIconWrap}>
                                                <item.icon size={20} color="#4b5563" />
                                            </View>
                                            <Text style={s.menuItemLabel}>{item.label}</Text>
                                        </View>
                                    </Pressable>
                                    {itemIndex < group.items.length - 1 && <View style={s.separator} />}
                                </React.Fragment>
                            ))}
                        </View>
                    </View>
                ))}

                {/* Logout Button */}
                <View style={s.logoutWrap}>
                    <View style={[s.logoutBtn, { backgroundColor: colorPalette?.primary || '#ef4444' }]}>
                        <Pressable
                            onPress={() => setShowLogoutModal(true)}
                            style={({ pressed }) => [s.logoutPressable, { backgroundColor: pressed ? 'rgba(0,0,0,0.1)' : 'transparent' }]}
                        >
                            <Text style={s.logoutText}>Sign out</Text>
                        </Pressable>
                    </View>
                </View>

                <Text style={s.versionText}>Version {version}</Text>
            </View>

            {/* Logout Confirmation Modal */}
            <Modal
                visible={showLogoutModal}
                transparent
                animationType="fade"
                onRequestClose={() => setShowLogoutModal(false)}
            >
                <View style={s.modalOverlay}>
                    <View style={s.modalCard}>
                        <Text style={s.modalTitle}>Sign Out</Text>
                        <Text style={s.modalDesc}>Are you sure you want to sign out of your account?</Text>

                        <View style={s.modalBtns}>
                            <Pressable onPress={() => setShowLogoutModal(false)} style={s.cancelBtn}>
                                <Text style={s.cancelBtnText}>Cancel</Text>
                            </Pressable>

                            <Pressable
                                onPress={() => {
                                    setShowLogoutModal(false);
                                    if (onLogout) onLogout();
                                }}
                                style={[s.confirmBtn, { backgroundColor: colorPalette?.primary || '#ef4444' }]}
                            >
                                <Text style={s.confirmBtnText}>Sign Out</Text>
                            </Pressable>
                        </View>
                    </View>
                </View>
            </Modal>

            <NotificationModal
                visible={showNotificationModal}
                onClose={() => setShowNotificationModal(false)}
            />

            <AboutAppModal
                visible={showAboutModal}
                onClose={() => setShowAboutModal(false)}
            />

            <TimeInOutModal
                visible={showTimeInOutModal}
                onClose={() => setShowTimeInOutModal(false)}
                userData={userData}
                colorPalette={colorPalette}
            />

        </ScrollView>
    );
};

const s = StyleSheet.create({
    loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f9fafb' },
    scrollView: { flex: 1, backgroundColor: '#f9fafb' },
    headerGradient: { paddingBottom: 30, paddingHorizontal: 24, borderBottomLeftRadius: 32, borderBottomRightRadius: 32 },
    logoWrap: { alignItems: 'center' },
    logoImage: { height: 90, width: 280, resizeMode: 'contain', tintColor: '#ffffff' },
    logoFallbackRow: { flexDirection: 'row', alignItems: 'center' },
    logoCircle: { width: 56, height: 56, borderRadius: 28, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginRight: 16 },
    logoLetter: { fontWeight: 'bold', fontSize: 24 },
    logoText: { color: '#ffffff', fontWeight: 'bold', fontSize: 28, letterSpacing: 0.5 },
    logoTextBold: { fontWeight: '800', color: '#ffffff' },
    avatarCircle: { width: 64, height: 64, borderRadius: 32, backgroundColor: '#ffffff', justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: '#ffffff' },
    profileInfo: { marginLeft: 20 },
    profileName: { fontSize: 22, fontWeight: 'bold', color: '#ffffff' },
    profileUsername: { fontSize: 15, color: 'rgba(255, 255, 255, 0.9)', fontWeight: '600' },
    profileEmail: { fontSize: 13, color: 'rgba(255, 255, 255, 0.7)', marginTop: 2 },
    // Standardized Balance Card Styles
    balanceCard: { width: '100%' },
    profileRow: { flexDirection: 'column', alignItems: 'center', gap: 16 },
    initialsCircle: { backgroundColor: 'rgba(255, 255, 255, 0.15)', justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: 'rgba(255, 255, 255, 0.3)' },
    initialsText: { color: '#ffffff', fontWeight: 'bold' },
    customerNameText: { color: '#ffffff', fontWeight: 'bold', textTransform: 'capitalize' },
    customerAccountText: { color: '#e5e7eb', fontSize: 13, opacity: 0.9 },
    customerEmailText: { color: 'rgba(255, 255, 255, 0.7)', fontSize: 12 },
    billingRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
    billingLeft: { flex: 1 },
    billingRightCol: { alignItems: 'flex-end', gap: 12 },
    dueDateContainerCard: { alignItems: 'flex-end' },
    balanceLabelCard: { color: '#e5e7eb', fontSize: 11, marginBottom: 2 },
    balanceAmountTextCard: { fontWeight: 'bold', color: '#ffffff' },
    infoTextCard: { color: '#e5e7eb', fontSize: 11 },
    infoValueCard: { color: '#ffffff', fontWeight: 'bold', fontSize: 11 },
    payBtnCard: { borderWidth: 1, borderColor: '#ffffff', paddingHorizontal: 24, paddingVertical: 8, borderRadius: 12 },
    payBtnInner: { alignItems: 'center' },
    payBtnTextCard: { color: '#ffffff', fontWeight: 'bold', textAlign: 'center', fontSize: 13 },
    // Payment Modal Styles
    modalOverlayPay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
    modalBackdropPay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
    modalSheetPay: { backgroundColor: '#ffffff', borderTopLeftRadius: 32, borderTopRightRadius: 32, width: '100%', maxHeight: '90%' },
    modalHeaderPay: { padding: 24, alignItems: 'center' },
    modalHandlePay: { width: 40, height: 4, backgroundColor: '#e5e7eb', borderRadius: 2, marginBottom: 12 },
    modalTitlePay: { fontSize: 20, fontWeight: '800', color: '#111827' },
    modalContentPay: { padding: 24 },
    modalContentCenterPay: { padding: 32, alignItems: 'center' },
    verifyBoxPay: { backgroundColor: '#f9fafb', padding: 20, borderRadius: 20, marginBottom: 24, borderWidth: 1, borderColor: '#f1f5f9' },
    verifyRowMbPay: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 },
    verifyRowPay: { flexDirection: 'row', justifyContent: 'space-between' },
    verifyLabelPay: { color: '#6b7280', fontSize: 14 },
    verifyValuePay: { fontWeight: '700', color: '#111827' },
    inputWrapPay: { marginBottom: 24 },
    inputLabelPay: { fontWeight: '600', marginBottom: 8, color: '#374151' },
    inputFieldPay: { borderWidth: 1, borderColor: '#d1d5db', borderRadius: 12, padding: 12, fontSize: 16, color: '#111827' },
    primaryBtnPay: { paddingVertical: 14, borderRadius: 12, alignItems: 'center' },
    primaryBtnTextPay: { color: '#ffffff', fontWeight: 'bold', fontSize: 16 },
    errorBoxPay: { padding: 12, borderRadius: 8, marginBottom: 24, borderWidth: 1 },
    errorTextPay: { fontSize: 14, textAlign: 'center' },
    linkDescPay: { color: '#4b5563', marginBottom: 24, textAlign: 'center' },
    closeTextPay: { color: '#6b7280', textAlign: 'center', fontWeight: '600' },
    pendingBoxPay: { backgroundColor: '#fffbeb', padding: 16, borderRadius: 12, marginBottom: 24, borderLeftWidth: 4, borderLeftColor: '#f59e0b' },
    pendingLabelPay: { color: '#92400e', fontSize: 14 },
    pendingAmountPay: { fontWeight: 'bold', color: '#92400e' },
    pendingDescPay: { color: '#4b5563', marginBottom: 32, textAlign: 'center' },
    cancelBtnPay: { paddingVertical: 14, borderRadius: 12, backgroundColor: '#f3f4f6', alignItems: 'center' },
    cancelBtnTextPay: { color: '#4b5563', fontWeight: 'bold' },
    successCirclePay: { width: 80, height: 80, borderRadius: 40, backgroundColor: '#dcfce7', justifyContent: 'center', alignItems: 'center', marginBottom: 24 },
    successDescPay: { fontSize: 16, color: '#4b5563', textAlign: 'center', marginBottom: 32, lineHeight: 24 },
    roleBadge: { backgroundColor: 'rgba(255, 255, 255, 0.25)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12, alignSelf: 'flex-start', marginTop: 12 },
    roleText: { color: '#ffffff', fontSize: 10, fontWeight: 'bold' },
    menuContainer: { paddingHorizontal: 20, paddingTop: 24, paddingBottom: 40 },
    groupWrap: { marginBottom: 24 },
    groupTitle: { fontSize: 13, fontWeight: '600', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12, marginLeft: 4 },
    groupCard: { backgroundColor: '#ffffff', borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: '#f1f5f9' },
    menuItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 20, paddingHorizontal: 20 },
    separator: { height: StyleSheet.hairlineWidth, backgroundColor: '#e5e7eb', marginHorizontal: 20 },
    menuItemLeft: { flexDirection: 'row', alignItems: 'center' },
    menuIconWrap: { width: 36, height: 36, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
    menuItemLabel: { fontSize: 15, fontWeight: '500', color: '#374151', marginLeft: 14 },
    logoutWrap: { width: '100%', alignItems: 'center', marginTop: 10 },
    logoutBtn: { borderRadius: 24, width: '60%', height: 48, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 4, elevation: 3, overflow: 'hidden' },
    logoutPressable: { width: '100%', height: '100%' },
    logoutText: { color: '#ffffff', fontSize: 16, fontWeight: 'bold', textAlign: 'center', lineHeight: 48, width: '100%' },
    versionText: { textAlign: 'center', color: '#9ca3af', fontSize: 12, marginTop: 32 },
    modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 24 },
    modalCard: { backgroundColor: '#ffffff', borderRadius: 24, padding: 24, width: '100%', maxWidth: 400, alignItems: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.25, shadowRadius: 15, elevation: 10 },
    modalTitle: { fontSize: 22, fontWeight: 'bold', color: '#111827', marginBottom: 12, textAlign: 'center', marginTop: 12 },
    modalDesc: { fontSize: 16, color: '#6b7280', textAlign: 'center', marginBottom: 32, lineHeight: 24 },
    modalBtns: { flexDirection: 'row', gap: 12, width: '100%' },
    cancelBtn: { flex: 1, paddingVertical: 14, borderRadius: 12, backgroundColor: '#f3f4f6', alignItems: 'center' },
    cancelBtnText: { fontSize: 16, fontWeight: '600', color: '#4b5563' },
    confirmBtn: { flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: 'center' },
    confirmBtnText: { fontSize: 16, fontWeight: '600', color: '#ffffff' },
});

export default Menu;
