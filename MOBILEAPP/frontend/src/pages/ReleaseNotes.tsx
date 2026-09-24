import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, useWindowDimensions, LayoutAnimation, Platform, UIManager } from 'react-native';
import { ChevronDown, ChevronUp, Calendar, Tag, ChevronLeft } from 'lucide-react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import { SafeAreaView } from 'react-native-safe-area-context';

// Enable LayoutAnimation for Android
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
    UIManager.setLayoutAnimationEnabledExperimental(true);
}

interface ReleaseNote {
    version: string;
    date: string;
    title: string;
    updates: { text: string; visibility: 'all' | 'customer' | 'technician' | 'agent' }[];
}

interface ReleaseNotesProps {
    onBack: () => void;
}

const ReleaseNotes: React.FC<ReleaseNotesProps> = ({ onBack }) => {
    const { width } = useWindowDimensions();
    const isMobile = width < 768;
    const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);

    const allNotes: ReleaseNote[] = [
        {
            version: '2.5.49',
            date: 'July 3, 2026',
            title: 'Application Form Crash Fix & Searchable Dropdowns',
            updates: [
                { text: 'Application Form Stability: Resolved a crash when opening the New Application form. Region, City, and Barangay lists are now loaded on demand instead of downloading the entire country at once, dramatically reducing memory usage and load time.', visibility: 'agent' },
                { text: 'Searchable Dropdowns: Upgraded the Region, City/Municipality, Barangay, and Plan dropdowns to searchable pickers. Just start typing to instantly filter long lists instead of scrolling through thousands of entries.', visibility: 'agent' },
                { text: 'Service Order RADIUS Queue: Reconnect, Restrict, Pullout, and Migration updates no longer fail when the RADIUS server is temporarily unavailable. The operation is now safely queued and retried automatically in the background, and you\'ll see a confirmation that it was saved to the queue.', visibility: 'technician' }
            ]
        },
        {
            version: '2.5.48',
            date: 'June 21, 2026',
            title: 'Native Crash Fix & UI Optimization',
            updates: [
                { text: 'Onsite Status Optimization: Upgraded the Onsite Status dropdown in the Job Order completion form to a custom searchable modal. This resolves a native Android crash during status transitions and improves UI consistency.', visibility: 'technician' }
            ]
        },
        {
            version: '2.5.47',
            date: 'June 20, 2026',
            title: 'Customer Payment Session Management',
            updates: [
                { text: 'Cancel Pending Payments: Added a "Cancel Payment" button in the Pending Payment modal, allowing customers to easily void and clear any stuck or unwanted payment sessions directly from the dashboard.', visibility: 'customer' }
            ]
        },
        {
            version: '2.5.46',
            date: 'June 15, 2026',
            title: 'Agent Dashboard & Form Automation',
            updates: [
                { text: 'Auto-fill Referred By: The "Referred By" field in the application form now automatically populates with your full name.', visibility: 'agent' },
                { text: 'Creator Tracking: Application submissions now securely record your User ID for accurate attribution.', visibility: 'agent' },
                { text: 'Dashboard Referral Accuracy: Fixed a matching logic issue so your "In Progress" and "Onboarded" counts now perfectly mirror your actual Job Order statistics.', visibility: 'agent' }
            ]
        },
        {
            version: '2.5.45',
            date: 'June 12, 2026',
            title: 'Agent Commission UI & Filters',
            updates: [
                { text: 'Separated Balances: Incentives and Bonuses are now split into distinct UI components on the dashboard for clearer visibility.', visibility: 'agent' },
                { text: 'Payout Filtering: Added a new dropdown filter in the Commission history page, allowing agents to easily view records by specific type (Commission, Incentives, or Bonus).', visibility: 'agent' }
            ]
        },
        {
            version: '2.5.43',
            date: 'June 11, 2026',
            title: 'Technician Service Order Visibility',
            updates: [
                { text: 'Resolved Order Auto-Hide: Service orders with a \"Resolved\" support status are now automatically hidden from the technician\'s list, keeping the view focused on active and pending tasks only.', visibility: 'technician' }
            ]
        },
        {
            version: '2.5.37',
            date: 'May 23, 2026',
            title: 'Map POI Removal & Stability Fixes',
            updates: [
                { text: 'Map POI Removal: Switched to ESRI Light Gray Canvas Base + Reference tiles and disabled native Points of Interest (POIs) to ensure a clean, distraction-free map interface without commercial markers.', visibility: 'technician' },
                { text: 'Android Map Crash Resolution: Removed unstable custom map style components, resolving a native Android crash (ArrayIndexOutOfBoundsException) during MapView bridge initialization.', visibility: 'technician' }
            ]
        },
        {
            version: '2.5.36',
            date: 'May 21, 2026',
            title: 'Validation Cooldown & Work Started Logic Fix',
            updates: [
                { text: 'Validate Button Cooldown: Added a 30-second cooldown timer to the Modem/Router SN validation button in both Job Order Completion and Service Order Edit modals to prevent API spamming.', visibility: 'technician' },
                { text: 'Work Started Display Logic: Corrected the status badge logic for Service, Job, and Work Orders to show "Work Started" strictly when a start time is recorded and no end time is present.', visibility: 'technician' }
            ]
        },
        {
            version: '2.5.34',
            date: 'May 20, 2026',
            title: 'Attendance Alerts & Job Start Refinements',
            updates: [
                { text: 'Auto Time-Out Alerts: Technicians will now receive an automatic time-out reminder at 9:00 PM and 9:10 PM PH Time if they are still timed in.', visibility: 'technician' },
                { text: 'User-Bound Job Start Checks: Resolved an issue where technicians were blocked from starting a job due to other technicians\' active tasks. The start validator is now strictly user-specific.', visibility: 'technician' }
            ]
        },
        {
            version: '2.5.33',
            date: 'May 13, 2026',
            title: 'Service Order Precision & Error Handling',
            updates: [
                { text: 'Standardized Error Feedback: Improved diagnostic messages for Service Order updates. Technicians now see clear, specific reasons for failures (e.g., RADIUS conflicts or duplicate records) instead of generic system errors.', visibility: 'technician' },
                { text: 'Radius Conflict Awareness: Enhanced the backend-to-frontend error bridge to specifically identify and report configuration conflicts during Field Technician updates.', visibility: 'technician' },
                { text: 'UI Stability Improvements: Refined state management in the Service Order edit flow to ensure real-time error reporting without UI flickering or stale data display.', visibility: 'technician' }
            ]
        },
        {
            version: '2.5.32',
            date: 'May 12, 2026',
            title: 'Agent Dashboard & Performance Analytics',
            updates: [
                { text: 'New Agent Dashboard: Launched a dedicated portal for agents featuring real-time referral tracking and commission monitoring.', visibility: 'agent' },
                { text: 'Commission Trend Graph: Integrated a dynamic line graph with 1M, 3M, 1Y, and 5Y filters for historical earnings analysis.', visibility: 'agent' },
                { text: 'Referral Counters: Real-time tracking of "In Progress" vs "Onboarded" referrals directly on the main dashboard.', visibility: 'agent' },
                { text: 'Premium UI Overhaul: Implemented a high-end Glassmorphism balance card with interactive flip animations for agent profiles.', visibility: 'agent' }
            ]
        },
        {
            version: '2.5.31',
            date: 'May 11, 2026',
            title: 'Technical Infrastructure & Inventory Refinement',
            updates: [
                { text: 'Global Timezone Standardization: Enforced Asia/Manila (GMT+8) precision across all system timers, audit logs, and inventory records, eliminating calculation drift during technician shifts.', visibility: 'technician' },
                { text: 'Dynamic User Identification: The "Modified By" and "User Email" fields in inventory forms now automatically populate with the logged-in technician\'s email, ensuring accurate accountability for stock movements.', visibility: 'technician' },
                { text: 'Service & Work Order Detail Fixes: Resolved critical TypeScript errors and variable hoisting issues in detail screens, improving application stability and UI performance.', visibility: 'technician' },
                { text: 'Refined Timer Visibility: Standardized the visibility of the "Start Timer" button for "Reschedule" status orders across Service, Job, and Work Orders to prevent overlapping sessions.', visibility: 'technician' }
            ]
        },
        {
            version: '2.5.30',
            date: 'May 11, 2026',
            title: 'Timer Precision & Workflow Updates',
            updates: [
                { text: 'Reschedule Timer Fix: Submitting a Job Order or Service Order with a "Reschedule" status no longer deletes the original start and end times, ensuring accurate historical tracking.', visibility: 'technician' },
                { text: 'Resume Timer Functionality: The "Start Timer" button will now reappear for tasks in the "Reschedule" state. Clicking it allows technicians to cleanly restart the timer and clear the previous end time.', visibility: 'technician' },
                { text: 'Work Order Timers: Work Orders now automatically record a precise GMT+8 Start Time when set to "In Progress", and an End Time when "Completed", "Cancelled", or "Failed".', visibility: 'technician' },
                { text: 'Enhanced Details UI: You can now clearly view the Start Time and End Time fields directly inside the Work Order details page, and all details screens can now be scrolled down fully without being blocked by the navigation bar.', visibility: 'technician' },
                { text: 'Timezone Accuracy Fix: Resolved a bug where timer logs could record incorrect UTC times (e.g., 2 AM instead of 10 AM). All timers now strictly adhere to GMT+8 precision regardless of device settings.', visibility: 'technician' }
            ]
        },
        {
            version: '2.5.28',
            date: 'May 10, 2026',
            title: 'Timer Reliability & UI Workflow Updates',
            updates: [
                { text: 'Optimized Timer Logic: Refined the "Job in progress" detection to prevent technicians from being blocked by inactive or completed historical records.', visibility: 'technician' },
                { text: 'Smart Button Visibility: The "Start Time" and "Edit" buttons are now context-aware, appearing only when a job is in an "In Progress" or "Reschedule" state to reduce UI clutter.', visibility: 'technician' },
                { text: 'Contextual Attachment Access: The Speedtest attachment button now automatically hides for "Failed" or "Reschedule" outcomes, ensuring images are only uploaded when relevant.', visibility: 'technician' },
                { text: 'User-Specific Timer Binding: Active job checks are now strictly bound to individual technicians, ensuring one user\'s active session never interferes with another technician\'s workflow.', visibility: 'technician' }
            ]
        },
        {
            version: '2.5.27',
            date: 'May 9, 2026',
            title: 'Account Management & Speedtest Integration',
            updates: [
                { text: 'Automated Account Deactivation: Service Orders with a "Pullout" category now automatically deactivate the customer\'s account upon completion, ensuring accurate billing and service status.', visibility: 'technician' },
                { text: 'Independent Speedtest Upload: Technicians can now upload speedtest images directly from the Job Order details page using the new attachment button, even after the initial form is submitted.', visibility: 'technician' },
                { text: 'Account Suspension Enforcement: Implemented a security check during login. Suspended accounts (active = 0) are now blocked from accessing the mobile application with a clear contact support notification.', visibility: 'all' },
                { text: 'Enhanced Image Queuing: Attachment uploads now utilize the same robust background queuing system as primary forms to ensure reliability in low-bandwidth areas.', visibility: 'technician' }
            ]
        },
        {
            version: '2.5.25',
            date: 'May 9, 2026',
            title: 'UI Stability & Performance Optimization',
            updates: [
                { text: 'Persistent Theme Branding: Fixed an issue where the color palette would intermittently default to purple. Your selected branding now persists reliably across app restarts.', visibility: 'all' },
                { text: 'Real-time UI Sync: Implemented real-time theme synchronization. Changing your dashboard colors now updates all active pages instantly for a seamless experience.', visibility: 'all' },
                { text: 'Improved App Stability: General performance optimizations and bug fixes across the Dashboard, Bills, and Support sections for a smoother user experience.', visibility: 'customer' },
                { text: 'Simplified Completion Form: Removed the redundant "Status Remarks" field from the Job Order completion form to streamline the technician workflow.', visibility: 'technician' },
                { text: 'Enhanced Assignment Sync: Resolved an issue where technician assignments were not correctly saving to the database in certain Service Order scenarios.', visibility: 'technician' },
                { text: 'Advanced Error Diagnostics: Improved backend logging for SmartOLT and Radius-related operations to facilitate faster troubleshooting of connection issues.', visibility: 'technician' }
            ]
        },
        {
            version: '2.5.23',
            date: 'May 5, 2026',
            title: 'Proof Persistence & LCP/NAP Management',
            updates: [
                { text: 'Mandatory Proof Images: Standardized mandatory proof image submission for all Job Order outcomes (Done, Failed, Rescheduled) to ensure accountability.', visibility: 'technician' },
                { text: 'Local Gallery Backup: Implemented robust local persistence for technical photos. Images are now saved to the phone gallery first, ensuring no data is lost during slow uploads.', visibility: 'technician' },
                { text: 'LCP/NAP Editing: Technicians can now edit existing LCP/NAP locations directly from the map details view.', visibility: 'technician' },
                { text: 'LCP/NAP Naming Fix: Resolved an issue where LCP and NAP names were being truncated; they now save correctly in full format (e.g., LP 013 NP 06).', visibility: 'technician' },
                { text: 'Required Field Indicators: Added red asterisk indicators to all mandatory form fields for clearer guidance during submission.', visibility: 'technician' },
                { text: 'Enhanced Dashboard Responsiveness: Optimized the customer dashboard layout for better performance and readability on a wider range of mobile devices.', visibility: 'customer' },
                { text: 'Support Center Refinements: Improved the support ticket interface and interaction flow for a smoother customer support experience.', visibility: 'customer' }
            ]
        },
        {
            version: '2.5.22',
            date: 'May 5, 2026',
            title: 'Optimized Technician Workflow & Field Visibility',
            updates: [
                { text: 'LCP-NAP Available Ports: Technicians can now view a list of available ports directly in the LCP-NAP location details, making port assignment much faster.', visibility: 'technician' },
                { text: 'Simplified Completion Form: Removed mandatory SmartOLT validation and duplicate SN checks during submission for both Job Orders and Service Orders.', visibility: 'technician' },
                { text: 'UI Refinement: The Router Model field in the Job Order completion form is now read-only to ensure data consistency.', visibility: 'technician' }
            ]
        },
        {
            version: '2.5.21',
            date: 'May 4, 2026',
            title: 'Modern Dashboard & Interactive UI',
            updates: [
                { text: 'Gliding Navigation: Experience a modern, floating oval navigation bar with a smooth gliding indicator that follows your active section.', visibility: 'customer' },
                { text: 'Interactive Ads Stack: Replaced the ad slider with a Tinder-style stacked card system featuring smooth slide animations.', visibility: 'customer' },
                { text: 'Vertical Flip Balance Card: Added a vertical flip animation to the balance card. Flip it to instantly view your Plan, Usage Type, and Email details.', visibility: 'customer' },
                { text: 'Payment History Polish: Cleaned up the payment list by removing icons and adding smart truncation for long reference numbers.', visibility: 'customer' },
                { text: 'On-Demand SOA: Generate your Statement of Account PDF on-demand directly from the Bills page if it hasn\'t been created yet.', visibility: 'customer' }
            ]
        },
        {
            version: '2.5.20',
            date: 'May 3, 2026',
            title: 'UI/UX Overhaul & Technician Workflow Updates',
            updates: [
                { text: 'Redesigned Customer Dashboard: Experience a more premium, modern interface with vibrant gradients, glassmorphism effects, and dynamic color palettes.', visibility: 'customer' },
                { text: 'Streamlined Menu: The Menu page has been simplified by removing redundant billing info and centering user profile details for a cleaner look.', visibility: 'all' },
                { text: 'Enhanced Mobile Support: Optimized layouts across all pages to ensure a seamless experience on various mobile screen sizes and orientations.', visibility: 'all' },
                { text: 'Service Order Efficiency: Technicians can now select and copy field values in Service Order Details for easier information sharing.', visibility: 'technician' },
                { text: 'Simplified Job Order Completion: Removed the mandatory Speed Test image requirement from the technician completion form for a faster workflow.', visibility: 'technician' },
                { text: 'Technician UI Refinement: The Menu header now displays "Username" instead of "Account No" and includes the email address for technical accounts.', visibility: 'technician' }
            ]
        },
        {
            version: '2.5.19',
            date: 'May 3, 2026',
            title: 'Forgot Password & Security Updates',
            updates: [
                { text: 'Forgot Password Cooldown: Implemented a 3-minute safety timer between recovery requests to prevent misuse and improve security.', visibility: 'all' },
                { text: 'Expanded Recovery Options: You can now recover your account using your Account Number, Email, or Username for a more flexible login experience.', visibility: 'all' }
            ]
        },
        {
            version: '2.5.18',
            date: 'May 3, 2026',
            title: 'Fullscreen Mode & Screen Sharing Fixes',
            updates: [
                { text: 'Immersive Fullscreen: The app now automatically opens in true fullscreen mode. The top status bar and bottom navigation buttons are hidden by default for an uninterrupted experience.', visibility: 'all' },
                { text: 'Login Screen Sharing: Fixed a security issue that caused the login screen to turn black when sharing your screen or recording.', visibility: 'all' }
            ]
        },
        {
            version: '2.5.17',
            date: 'May 2, 2026',
            title: 'Billing Layout & App Updates',
            updates: [
                { text: 'Bills UI Update: Unified the layout structure for Invoices, SOA, and History tabs to ensure a consistent look and feel.', visibility: 'customer' },
                { text: 'Invoice Status: Replaced the PDF download button in the Invoices tab with a dynamic status badge (PAID/UNPAID) for better clarity.', visibility: 'customer' },
                { text: 'Support Center UI: Completely redesigned the Ticket Details page for a cleaner, full-screen experience without bulky modals or drop shadows.', visibility: 'customer' }
            ]
        },
        {
            version: '2.5.16',
            date: 'May 1, 2026',
            title: 'Role-Based Permissions & UI Optimizations',
            updates: [
                { text: 'Mandatory Attendance: Technicians are now required to "Time In" before they can access Job Orders. The modal cannot be dismissed until they are clocked in.', visibility: 'technician' },
                { text: 'Dashboard UI: Fixed an issue where high account balances (thousands) would wrap to two lines. The font size now dynamically adjusts to stay on a single line.', visibility: 'customer' },
                { text: 'Login Flow: Technicians are now automatically checked for their attendance status immediately after login or when opening the app.', visibility: 'technician' },
                { text: 'New Section: Added this Release Notes page to keep track of application improvements.', visibility: 'all' }
            ]
        },
        {
            version: '2.5.14',
            date: 'April 18, 2026',
            title: 'Technician Attendance & Modal Improvements',
            updates: [
                { text: 'Time In/Out Modal: Finalized the attendance tracking modal with mobile-friendly swipe gestures.', visibility: 'technician' },
                { text: 'Service Restrictions: Blocked technicians from starting orders if they haven\'t timed in.', visibility: 'technician' }
            ]
        }
    ];

    const [notes, setNotes] = useState<ReleaseNote[]>([]);
    const [userRole, setUserRole] = useState<string>('');

    useEffect(() => {
        const initialize = async () => {
            try {
                const [palette, authData] = await Promise.all([
                    settingsColorPaletteService.getActive(),
                    AsyncStorage.getItem('authData')
                ]);
                setColorPalette(palette);

                let role = '';
                if (authData) {
                    const parsed = JSON.parse(authData);
                    role = parsed.role?.toLowerCase() || '';
                    setUserRole(role);
                }

                // Filter notes based on role
                const isCustomer = role === 'customer';
                const filteredNotes = allNotes.map(note => {
                    const visibleUpdates = note.updates.filter(u => {
                        if (u.visibility === 'all') return true;
                        if (role === 'customer') return u.visibility === 'customer';
                        if (role === 'technician' || role === 'tech') return u.visibility === 'technician';
                        if (role === 'agent') return u.visibility === 'agent';
                        return false;
                    });
                    return { ...note, updates: visibleUpdates };
                }).filter(note => note.updates.length > 0);

                setNotes(filteredNotes);
            } catch (err) {
                console.error('Failed to initialize ReleaseNotes:', err);
            }
        };
        initialize();
    }, []);

    const primaryColor = colorPalette?.primary || '#ef4444';

    console.log('[ReleaseNotes] Rendering', notes.length, 'notes');

    return (
        <SafeAreaView style={styles.safeArea}>
            {/* Custom Header */}
            <View style={[styles.header, { borderBottomColor: '#e2e8f0' }]}>
                <Pressable onPress={onBack} style={styles.backBtn}>
                    <ChevronLeft size={24} color="#000000" />
                </Pressable>
                <Text style={styles.headerTitle}>Release Notes</Text>
                <View style={{ width: 40 }} />
            </View>

            <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
                <View style={styles.introBox}>
                    <Text style={[styles.introText, { color: '#475569' }]}>
                        Keep track of the latest features, improvements, and bug fixes in the GOWISER Portal.
                    </Text>
                </View>

                {notes.map((note, index) => (
                    <View key={index} style={{ marginBottom: 30, padding: 15, borderBottomWidth: 1, borderBottomColor: '#eee' }}>
                        <Text style={{ fontSize: 18, fontWeight: 'bold', color: '#000', marginBottom: 5 }}>{note.date}</Text>
                        <Text style={{ fontSize: 12, color: primaryColor, marginBottom: 10 }}>Version {note.version}</Text>
                        {note.updates.map((update, uIdx) => (
                            <View key={uIdx} style={{ flexDirection: 'row', marginBottom: 12 }}>
                                <Text style={{ marginRight: 10, color: primaryColor }}>•</Text>
                                <Text style={{ flex: 1, color: '#333', lineHeight: 20 }}>{update.text}</Text>
                            </View>
                        ))}
                    </View>
                ))}

                <View style={styles.footer}>
                    <Text style={{ color: '#94a3b8', fontSize: 13 }}>You're up to date!</Text>
                </View>
            </ScrollView>
        </SafeAreaView>
    );
};

const styles = StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: '#ffffff' },
    header: {
        height: 60,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 16,
        backgroundColor: '#ffffff',
        borderBottomWidth: 1,
    },
    backBtn: { padding: 8 },
    headerTitle: { fontSize: 18, fontWeight: '700', color: '#1e293b' },
    container: { flex: 1 },
    scrollContent: { padding: 20, paddingBottom: 40 },
    introBox: { marginBottom: 24 },
    introText: { fontSize: 14, color: '#64748b', lineHeight: 20 },
    noteCard: {
        backgroundColor: '#ffffff',
        borderRadius: 16,
        marginBottom: 16,
        overflow: 'hidden',
    },
    cardHeader: {
        padding: 20,
    },
    headerLeft: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        marginBottom: 10,
    },
    versionBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 8,
        gap: 4,
    },
    versionText: { fontSize: 12, fontWeight: '700' },
    dateRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    dateText: { fontSize: 12, color: '#94a3b8', fontWeight: '500' },
    titleText: { fontSize: 16, fontWeight: '700', color: '#1e293b', paddingRight: 24 },
    toggleIcon: { position: 'absolute', right: 20, bottom: 20 },
    cardContent: { padding: 20, paddingTop: 0 },
    divider: { height: 1, marginBottom: 16 },
    updateRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 12, gap: 12 },
    bullet: { width: 6, height: 6, borderRadius: 3, marginTop: 7, flexShrink: 0 },
    updateText: { fontSize: 14, color: '#475569', lineHeight: 20, flex: 1 },
    footer: { marginTop: 20, alignItems: 'center' },
    footerText: { fontSize: 13, color: '#94a3b8', fontWeight: '500' },
});

export default ReleaseNotes;
