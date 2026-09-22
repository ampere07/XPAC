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
    updates: { text: string; visibility: 'all' | 'customer' | 'technician' | 'agent' | 'admin' }[];
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
            version: '2.5.68',
            date: 'September 18, 2026',
            title: 'One Layout for Every List & a Stricter Pullout Rule',
            updates: [
                { text: 'Every List Is a Card List: Discounts, Rebates, DC Notice, SO Charge, Overdue, Invoice, Statements, Payment Portal, Revert Requests, Transactions, Bonus History, Team Agents, Agent Management, Agent Payout and Invoices now share one layout. Nothing scrolls sideways any more — what used to sit in columns off the right edge of the screen is on the card itself.', visibility: 'admin' },
                { text: 'The Same Controls in the Same Place: Search, the filter drawer, column filters, export and refresh sit in one row, in the same order, on every one of those pages. What you learn on one page you already know on the next.', visibility: 'admin' },
                { text: 'Paging Where There Was None: Overdue, SO Charge, Payment Portal, Discounts, Bonus History and Agent Payout used to draw every record in one endless scroll. They now page, with a Show 10 / 25 / 50 / 100 picker beside the record count.', visibility: 'admin' },
                { text: 'Dashboard and Monitoring on the Bar: Both are on the floating navigation bar now, where the web sidebar has always had them, instead of being reachable only through the menu.', visibility: 'admin' },
                { text: 'The Logs Group Matches the Web: All nine log pages are on the bar, in the same order as the web sidebar, each with the same restriction on who may open it.', visibility: 'admin' },
                { text: 'No More Pages You Cannot Open: Administrators were being offered System Logs and Smart OLT Logs, and every request those pages made came back refused. They are now listed only for the accounts that can actually read them.', visibility: 'admin' },
                { text: 'Customer Bills and Support Off Your Bar: Those two are the customer portal, not administration. They no longer appear on an administrator or superadmin navigation bar.', visibility: 'admin' },
                { text: 'The Expenses Widget Loads: The Expenses breakdown on the Monitoring dashboard failed every time it was asked for. It returns figures again.', visibility: 'admin' },
                { text: 'Pulled-Out Accounts Offer Only Reactivation: When an account is at Pullout billing status, the Service Order form narrows Concern and Repair Category to reactivation alone. A relocation or a router swap can no longer be raised against a service that is not connected.', visibility: 'admin' },
                { text: 'A Returning Customer Can Sign In Again: Approving a Job Order for an account that had been pulled out now re-opens that customer portal login. Before this, the approval reported the account ready while the customer was still refused at sign-in.', visibility: 'admin' },
                { text: 'Related Records Read as Cards: The related lists inside a customer record, and the customers listed under an LCP/NAP, were tables that ran off the side of the screen — the customer name was the column being cut. They are cards now, with nothing hidden.', visibility: 'admin' },
                { text: 'Pullout Now Needs the Repair Category: To disconnect a customer on a pullout visit, choose Pullout as the Repair Category and set the visit to Done. Marking a visit Done on a ticket that only mentions pullout in the concern no longer disconnects anyone — the category is what decides it, so the disconnection is something you record rather than something inferred.', visibility: 'technician' },
                { text: 'Any Spelling Works: Pullout, Pull Out, For Pullout — the category is read the same way however it is written or spaced.', visibility: 'technician' },
                { text: 'Reactivation Only on a Pulled-Out Line: If the account you are visiting has already been pulled out, Concern and Repair Category offer reactivation and nothing else, so there is no way to record a relocation or a router replacement against a line that is not connected.', visibility: 'technician' },
                { text: 'Two-Line Menu Labels: Every option on the floating navigation bar now reads on two lines, one word per line. Longer names like Agent Management and Revert Requests are no longer cut short, and every icon in a row sits at the same height.', visibility: 'all' }
            ]
        },
        {
            version: '2.5.66',
            date: 'September 4, 2026',
            title: 'Completed Referrals in View & One History List',
            updates: [
                { text: 'Completed Referrals Back on Your List: Your Job Order page no longer drops a referral the moment it is installed. Done referrals stay on the page and sit at the very bottom, so you can look back over what you closed without leaving the list you work from.', visibility: 'agent' },
                { text: 'Read in the Order You Work It: Your referrals are now grouped the way you follow them up — In Progress first, then Reschedule, then Failed, with Done last — and newest first inside each group. The visits still happening lead the page.', visibility: 'agent' },
                { text: 'One History List: Pay Out/In no longer splits your history across Commission, Incentives and Bonus tabs. Every payout, incentive and bonus movement is in one list, newest first, each row tagged with what kind of record it is and whether it is still pending or has been approved.', visibility: 'agent' },
                { text: 'Payouts That Were Missing: A payout recorded against all of your balances at once belonged to none of the three old tabs, so your history read "No matching records found" while the record was sitting there. Every record now shows, whatever kind it is.', visibility: 'agent' },
                { text: 'Only Ever Your Own: Your history is matched to your account, so nothing belonging to another agent can appear on your screen — not even for the moment while the page is loading.', visibility: 'agent' },
                { text: 'Faster Across the Board: Your dashboard, Job Order list, Agent History and Achievements all do far less work to show the same figures. The matching that finds your referrals is now worked out once per screen instead of once per referral, and your incentive batches no longer search your whole history for every entry in them — a long referral history is where you will notice it most.', visibility: 'agent' }
            ]
        },
        {
            version: '2.5.61',
            date: 'August 25, 2026',
            title: 'Agent Dashboard Rebuilt & Full Referral History',
            updates: [
                { text: 'One Card, Three Tabs: Your dashboard card now has Wallet, Referrals and Applications tabs across the top instead of the flip button. Tap a tab to move between them — whichever one you are on shows a single headline figure rather than a grid of four.', visibility: 'agent' },
                { text: 'Tap to See the Breakdown: The arrow beside your balance opens the detail behind it. Wallet breaks down into Incentives, Commission, Bonus and Achievement; Referrals into In Progress, Done, Failed and Reschedule. Tap again to close it and the card shrinks back.', visibility: 'agent' },
                { text: 'Hide Your Figures: The eye beside the label masks every amount on the card, so you can open your dashboard in public without your earnings on show.', visibility: 'agent' },
                { text: 'Applications You Have Sent: A new Applications tab counts the application forms submitted from your account, with the form itself a tap away on the same card. The separate Total Balance panel below your achievements is gone — that figure is now the Wallet tab.', visibility: 'agent' },
                { text: 'Earnings and Achievements Load Again: Fixed the error that left your commission history, cashout history and achievement progress blank. Your Pay Out/In page is reachable again too.', visibility: 'agent' },
                { text: 'Your Full Referral History: The Job Order page no longer hides referrals for being old — every referral still in progress is listed however long ago it was raised, newest first. Completed ones are no longer mixed in with them: they live on your Agent History page, which is what that page is for.', visibility: 'agent' },
                { text: 'Faster Dashboard and History: Your dashboard and history screens no longer redraw the whole page every second behind the reset countdown, so both scroll and respond noticeably faster.', visibility: 'agent' }
            ]
        },
        {
            version: '2.5.56',
            date: 'August 15, 2026',
            title: 'Photo Backup & Job Order List Order',
            updates: [
                { text: 'Photos Saved to Your Phone: Every picture you take for a Job Order or Service Order is now copied to your phone gallery before it is uploaded. If the upload fails, you lose signal, or the app closes mid-submission, the photos are still on your phone.', visibility: 'technician' },
                { text: 'Named Photos: Saved pictures are filed as the field name followed by the customer, for example "setup_image, Juan Dela Cruz" — so you can find the right photo for the right visit without opening each one.', visibility: 'technician' },
                { text: 'Job Order List Order: Your Job Order list now runs oldest first through to newest. In Progress and Rescheduled jobs sit together among the work you still have to do, and only Done and Failed jobs are moved to the bottom.', visibility: 'technician' },
                { text: 'Completed Job Orders Save Again: Fixed an error that stopped a Job Order from saving when you submitted the completion form.', visibility: 'technician' },
                { text: 'One Remarks Box: The Job Order completion form now has a single Remarks field instead of two. Everything you write about the visit goes in the one place.', visibility: 'technician' }
            ]
        },
        {
            version: '2.5.55',
            date: 'August 14, 2026',
            title: 'Guided Work Queue — One Job at a Time',
            updates: [
                { text: 'Guided Work Queue: Job Orders, Service Orders, and Work Orders now appear in the order you are meant to work them. Anything already In Progress comes first, oldest first, followed by the rest of your active work, with Done, Failed, Rescheduled, and On Hold items moved to the bottom of the list.', visibility: 'technician' },
                { text: 'One Job at a Time: Only the job at the top of your list can be opened. The rest of your active work is greyed out and marked "Locked" until it is your turn, so there is never any doubt about what to do next. Tapping a locked job tells you why it is locked.', visibility: 'technician' },
                { text: 'Automatic Progression: As soon as you finish the job at the top — whether it ends as Done, Failed, or Rescheduled — the next one unlocks on its own. Nothing to request and nobody to wait for.', visibility: 'technician' },
                { text: 'Admin Override: When something needs doing out of turn, an administrator can release a specific job to you. It opens alongside the one you already have, so you can work more than one at a time whenever the office says so.', visibility: 'technician' },
                { text: 'Started Work Stays Open: A job you have already started always stays open to you, even if the order of your list changes around it. You can still stop the timer and finish the work in front of you.', visibility: 'technician' }
            ]
        },
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
                        // Administrators and superadmins had no branch at all, so the
                        // filter fell through to `false` and their Release Notes page
                        // showed only the entries marked 'all'. Role strings match the
                        // rest of the app: the server lower-cases role_name.
                        if (role === 'administrator' || role === 'superadmin') return u.visibility === 'admin';
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
                        Keep track of the latest features, improvements, and bug fixes in the XPAC Portal.
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
