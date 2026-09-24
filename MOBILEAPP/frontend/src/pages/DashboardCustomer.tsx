import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { View, Text, Pressable, TextInput, ScrollView, ActivityIndicator, Alert, Linking, useWindowDimensions, Modal, PanResponder, Animated, RefreshControl, KeyboardAvoidingView, Platform, StyleSheet, DeviceEventEmitter } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import * as LinkingExpo from 'expo-linking';
import { User, Activity, Clock, Users, FileText, CheckCircle, HelpCircle, RefreshCcw, AlertCircle } from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { paymentService, PendingPayment } from '../services/paymentService';
import { useCustomerDataContext } from '../contexts/CustomerDataContext';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import { planService, Plan } from '../services/planService';

interface Payment {
    id: string;
    date: string;
    reference: string;
    amount: number;
    source: string;
    status?: string;
}

interface DashboardCustomerProps {
    onNavigate?: (section: string, tab?: string) => void;
}

const DashboardCustomer: React.FC<DashboardCustomerProps> = ({ onNavigate }) => {
    const { width, height } = useWindowDimensions();
    const isMobile = width < 768;
    const isShort = height < 700;
    const { customerDetail, payments, invoiceRecords, billingType, isPrepaid, isLoading: contextLoading, silentRefresh } = useCustomerDataContext();
    const [user, setUser] = useState<any>(null);

    const [isPaymentProcessing, setIsPaymentProcessing] = useState<boolean>(false);
    const [showPaymentVerifyModal, setShowPaymentVerifyModal] = useState<boolean>(false);
    const [paymentAmount, setPaymentAmount] = useState<number>(0);

    // ── Prepaid plan selection ──────────────────────────────────────────────
    // Prepaid customers buy a service period at a plan's price, so they pick the plan they are
    // paying for and the amount follows it. Postpaid is untouched: they keep paying their balance.
    const [plans, setPlans] = useState<Plan[]>([]);
    const [isLoadingPlans, setIsLoadingPlans] = useState<boolean>(false);
    const [selectedPlanId, setSelectedPlanId] = useState<number | null>(null);
    const [isPlanListOpen, setIsPlanListOpen] = useState<boolean>(false);
    // Prepaid-only: "Pay Current Balance" mode — settle the outstanding balance directly
    // instead of buying a plan/plan-change (no plan_id is sent when this is on).
    const [payCurrentBalance, setPayCurrentBalance] = useState<boolean>(false);
    // Prepaid-only: start the newly bought plan immediately, forfeiting the days remaining on the
    // current one, instead of queueing the switch for when the period lapses. Opt-in, and only
    // ever offered when there is actually something to forfeit — see canActivateNow.
    const [activateNow, setActivateNow] = useState<boolean>(false);
    // Prepaid onboarding re-price: a customer who has not paid their first bill yet may still swap
    // plan, which re-prices that unpaid bill. The server quotes the real amount (plan + VAT minus
    // withholding) so the tax maths is never duplicated here.
    const [onboardingQuoteAmount, setOnboardingQuoteAmount] = useState<number | null>(null);
    const [isQuotingPlan, setIsQuotingPlan] = useState<boolean>(false);
    // Whether this account is in that window at all. Resolved when the modal opens, BEFORE any
    // plan is picked - the cheaper plans must be selectable for a quote to ever happen.
    const [canRepriceOnboarding, setCanRepriceOnboarding] = useState<boolean>(false);
    // Convenience fee rate the ISP adds on top of an online payment (2.5 = 2.5%). Disclosed under
    // the amount field so the customer is not surprised by a higher total at the gateway. 0 = none.
    const [convenienceFeePercentage, setConvenienceFeePercentage] = useState<number>(0);

    const latestPayments = useMemo(() => {
        return (payments || []).slice(0, 3);
    }, [payments]);

    const formatDate = useCallback((dateStr?: string) => {
        if (!dateStr) return '-';
        const date = new Date(dateStr);
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        return `${months[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
    }, []);
    const [showPaymentLinkModal, setShowPaymentLinkModal] = useState<boolean>(false);
    const [paymentLinkData, setPaymentLinkData] = useState<{ referenceNo: string; amount: number; paymentUrl: string } | null>(null);
    const [showPendingPaymentModal, setShowPendingPaymentModal] = useState<boolean>(false);
    const [pendingPayment, setPendingPayment] = useState<PendingPayment | null>(null);
    const [errorMessage, setErrorMessage] = useState<string>('');
    const [showSuccessModal, setShowSuccessModal] = useState<boolean>(false);
    const [showEmailErrorModal, setShowEmailErrorModal] = useState<boolean>(false);
    const [colorPalette, setColorPalette] = useState<ColorPalette | null>(() => settingsColorPaletteService.getActiveSync());
    const [currentAdPos, setCurrentAdPos] = useState(1);
    const [refreshing, setRefreshing] = useState(false);
    const [isCardFlipped, setIsCardFlipped] = useState(false);
    const flipAnim = React.useRef(new Animated.Value(0)).current;
    const adsScrollRef = React.useRef<ScrollView>(null);

    const ads = [
        { id: 1, title: 'Payment Made Easy', desc: 'Secure payments powered by Xendit. Fast & Reliable.', colors: ['#6366f1', '#3730a3'] as string[] },
        { id: 2, title: 'Upgrade Your Plan', desc: 'Need more speed? Contact us to boost your connection today.', colors: ['#3b82f6', '#1e3a8a'] as string[] },
        { id: 3, title: 'Stay Connected', desc: 'Settle your balance easily to avoid service interruption.', colors: ['#10b981', '#064e3b'] as string[] }
    ];

    const displayAds = [ads[ads.length - 1], ...ads, ads[0]];

    const pan = React.useRef(new Animated.ValueXY()).current;
    const stackAnim = React.useRef(new Animated.Value(0)).current;

    const handleFlipCard = useCallback(() => {
        // Phase 1: squish card horizontally (like turning sideways)
        Animated.timing(flipAnim, {
            toValue: 1,
            duration: 250,
            useNativeDriver: true,
        }).start(() => {
            // Swap content at the midpoint
            setIsCardFlipped(prev => !prev);
            // Phase 2: expand back out
            Animated.timing(flipAnim, {
                toValue: 0,
                duration: 250,
                useNativeDriver: true,
            }).start();
        });
    }, [flipAnim]);

    const cardScaleY = flipAnim.interpolate({
        inputRange: [0, 1],
        outputRange: [1, 0]
    });

    // Reset pan position when modal opens
    useEffect(() => {
        if (showPaymentVerifyModal || showPaymentLinkModal || showPendingPaymentModal || showSuccessModal || showEmailErrorModal) {
            pan.setValue({ x: 0, y: 0 });
        }
    }, [showPaymentVerifyModal, showPaymentLinkModal, showPendingPaymentModal, showSuccessModal, showEmailErrorModal]);

    // Use refs to avoid stale closures in PanResponder
    const panResponder = React.useRef(
        PanResponder.create({
            onStartShouldSetPanResponder: () => true,
            onMoveShouldSetPanResponder: (_, gestureState) => {
                return Math.abs(gestureState.dy) > 10;
            },
            onPanResponderMove: (_, gestureState) => {
                if (gestureState.dy > 0) {
                    pan.setValue({ x: 0, y: gestureState.dy });
                }
            },
            onPanResponderRelease: (_, gestureState) => {
                if (gestureState.dy > 120) {
                    // Smoothly animate off screen before closing
                    Animated.timing(pan, {
                        toValue: { x: 0, y: 1000 },
                        duration: 250,
                        useNativeDriver: true,
                    }).start(() => {
                        const handlers = modalHandlersRef.current;
                        if (handlers.showPaymentVerifyModal) handlers.handleCloseVerifyModal();
                        else if (handlers.showPaymentLinkModal) handlers.handleCancelPaymentLink();
                        else if (handlers.showPendingPaymentModal) handlers.handleCancelPendingPayment();
                        else if (handlers.showSuccessModal) handlers.setShowSuccessModal(false);
                    });
                } else {
                    Animated.spring(pan, {
                        toValue: { x: 0, y: 0 },
                        useNativeDriver: true,
                        bounciness: 0,
                        speed: 10
                    }).start();
                }
            },
        })
    ).current;

    const displayName = customerDetail?.fullName || user?.full_name || 'Customer';
    const initials = (customerDetail?.firstName && customerDetail?.lastName)
        ? `${customerDetail.firstName.charAt(0)}${customerDetail.lastName.charAt(0)}`.toUpperCase()
        : displayName.split(' ').map((n: any) => n[0]).join('').substring(0, 2).toUpperCase();
    const accountNo = customerDetail?.billingAccount?.accountNo || user?.username || 'N/A';
    const planName = customerDetail?.desiredPlan || 'No Plan';
    const address = customerDetail?.address || 'No Address';
    const installationDate = customerDetail?.billingAccount?.dateInstalled || 'Pending';
    const rawBalance = Number(customerDetail?.billingAccount?.accountBalance || 0);
    const emailAddress = customerDetail?.emailAddress || user?.email || 'N/A';

    // ── Prepaid state ───────────────────────────────────────────────────────
    // Resolved centrally in CustomerDataContext (see utils/billingType), which mirrors the
    // backend's BillingAccount::isPrepaidType() — so both the canonical 'Prepaid' and the older
    // 'Pre Paid' resolve, and an account that has not been through the rename still gets the
    // plan picker. `billingType` is the same value as the customer-facing label.

    // A prepaid customer never carries a negative (credit) balance: paying only extends the
    // prepaid period, it does not bank a credit, so a fully-paid prepaid account reads as 0 —
    // never a negative overpayment. Postpaid / blank generation_type keep the real balance
    // (including any negative credit from overpayment), which is the existing behaviour.
    const balance = isPrepaid ? Math.max(0, rawBalance) : rawBalance;

    /**
     * Partial payments are not accepted. An outstanding balance has to be cleared in full, so the
     * amount is pinned rather than merely validated:
     *
     *  - Postpaid: the amount IS the balance, and the field is read-only.
     *  - Prepaid : the amount still comes from the plan picker (so a plan change is still a
     *              payment), but the chosen plan's price has to cover the balance. A cheaper plan
     *              is rejected; the same or a dearer one is fine.
     *
     * Neither applies while nothing is owed — a zero/credit balance keeps the ₱1 floor only.
     */
    const requiresExactPayment = !isPrepaid && balance > 0;
    // A quoted onboarding re-price REPLACES the outstanding balance rather than paying it off, so
    // the "plan must cover the balance" floor does not apply - that is what lets a first-time
    // customer move to a cheaper plan before they have paid anything.
    const requiresPlanCoversBalance = isPrepaid && balance > 0 && !canRepriceOnboarding;

    // Compared at 2 decimal places: the balance arrives as a decimal string, and float maths on
    // centavos would otherwise make an exact-equality check fail on a legitimate amount.
    const toCentavos = (value: number) => Math.round(value * 100);
    const paymentCoversBalance = toCentavos(paymentAmount) >= toCentavos(balance);
    const isPaymentAmountValid = requiresExactPayment
        ? toCentavos(paymentAmount) === toCentavos(balance)
        : requiresPlanCoversBalance
            ? paymentCoversBalance
            : paymentAmount >= 1;

    // Convenience fee preview. Mirrors the server's maths (fee on top of the bill, 2 dp) purely so
    // the customer can see the real total before leaving for the gateway — the charge is still
    // computed server-side at checkout, so this is disclosure only and never sent anywhere.
    const feeBaseAmount = requiresExactPayment ? balance : paymentAmount;
    const convenienceFeeAmount = convenienceFeePercentage > 0
        ? Math.round(feeBaseAmount * (convenienceFeePercentage / 100) * 100) / 100
        : 0;
    const totalWithConvenienceFee = feeBaseAmount + convenienceFeeAmount;
    // formatCurrency() rounds to whole pesos, which would hide the centavos a percentage fee almost
    // always produces. No padding either: 922.5 stays 922.5. Capped at 2 dp only because the fee
    // above is already rounded to centavos, so nothing here is ever actually rounded away.
    const formatPeso = (value: number) =>
        `₱${value.toLocaleString('en-PH', { maximumFractionDigits: 2 })}`;
    // Trailing zeros trimmed so 2.50 reads as "2.5%".
    const convenienceFeeLabel = String(Number(convenienceFeePercentage));

    const prepaidExpiresAt = customerDetail?.billingAccount?.prepaid_expires_at || null;
    const pendingPlanId = customerDetail?.billingAccount?.pending_plan_id ?? null;
    const pendingPlanName = customerDetail?.billingAccount?.pending_plan_name || null;
    const pendingPlanEffectiveAt = customerDetail?.billingAccount?.pending_plan_effective_at || null;

    // Whether the paid-for period is still running. This is what makes a plan change QUEUE
    // rather than apply immediately, so the modal can tell the customer which will happen.
    const isPrepaidPeriodActive = useMemo(() => {
        if (!prepaidExpiresAt) return false;
        const expiry = new Date(String(prepaidExpiresAt).replace(' ', 'T')).getTime();
        return !isNaN(expiry) && expiry > Date.now();
    }, [prepaidExpiresAt]);

    // Mirrors the backend's extractPlanName(): the plan name is the first token, before any
    // ' - ' separator or space. Keeps "which plan am I on" consistent with what billing resolves.
    const extractPlanName = useCallback((raw?: string | null): string => {
        if (!raw) return '';
        let value = String(raw);
        if (value.includes(' - ')) value = value.split(' - ')[0].trim();
        if (value.includes(' ')) return value.split(' ')[0].trim();
        return value.trim();
    }, []);

    const currentPlan = useMemo(
        () => plans.find(p => p.name === extractPlanName(planName)) || null,
        [plans, planName, extractPlanName]
    );
    const selectedPlan = useMemo(
        () => plans.find(p => p.id === selectedPlanId) || null,
        [plans, selectedPlanId]
    );
    // A switch already paid for and waiting. It takes priority when preselecting, so a top-up is
    // priced at the plan the customer will actually be on rather than the one they are leaving.
    const pendingPlan = useMemo(
        () => (pendingPlanId ? plans.find(p => p.id === Number(pendingPlanId)) || null : null),
        [plans, pendingPlanId]
    );

    /**
     * Whether "Activate Now" is worth offering. Mirrors the web portal exactly.
     *
     * All three conditions matter:
     *  - a genuine switch    activating the plan already in force forfeits days for nothing
     *  - a live period       once it has lapsed the new plan starts immediately regardless, so
     *                        there is no decision left to make
     *  - not paying balance  "Pay Current Balance" sends no plan at all
     *
     * The server independently refuses to forfeit days when the switch is not genuine
     * (PrepaidPlanChangeService::isGenuineSwitch), so this governs the UI, not the outcome.
     */
    const canActivateNow = useMemo(
        () => isPrepaid
            && !payCurrentBalance
            && isPrepaidPeriodActive
            && !!selectedPlan
            && !!currentPlan
            && selectedPlan.id !== currentPlan.id,
        [isPrepaid, payCurrentBalance, isPrepaidPeriodActive, selectedPlan, currentPlan]
    );

    // Load the plan list once, only for prepaid customers — postpaid never sees the picker.
    // Gated on a ref, not on plans.length: an empty or all-zero-price response would otherwise
    // leave the guard false and re-trigger this effect forever.
    const plansRequestedRef = React.useRef(false);
    useEffect(() => {
        if (!isPrepaid || plansRequestedRef.current) return;
        plansRequestedRef.current = true;
        let cancelled = false;
        (async () => {
            setIsLoadingPlans(true);
            try {
                const fetched = await planService.getAllPlans();
                if (!cancelled) setPlans(fetched.filter(p => Number(p.price) > 0));
            } finally {
                if (!cancelled) setIsLoadingPlans(false);
            }
        })();
        return () => { cancelled = true; };
    }, [isPrepaid]);

    // Format a stored date string ('YYYY-MM-DD', 'YYYY-MM-DD HH:MM:SS', or ISO) to
    // MM/DD/YYYY by reading the parts directly — avoids the timezone shift that
    // `new Date(...)` can introduce (which turned 07/17 into 08/17, etc.).
    const formatDbDate = (raw?: string | null): string | null => {
        if (!raw) return null;
        const datePart = String(raw).split('T')[0].split(' ')[0];
        const [y, m, d] = datePart.split('-');
        if (!y || !m || !d) return null;
        return `${m.padStart(2, '0')}/${d.padStart(2, '0')}/${y}`;
    };

    let dueDateString = 'Upon Receipt';
    // Prefer the real due date stored on the latest invoice (invoiceRecords are
    // ordered by invoice_date desc by the backend). Only fall back to deriving it
    // from the billing day when the account has no invoice yet.
    const latestInvoiceDueDate = formatDbDate(invoiceRecords?.[0]?.due_date);
    if (latestInvoiceDueDate) {
        dueDateString = latestInvoiceDueDate;
    } else if (customerDetail?.billingAccount?.billingDay) {
        const today = new Date();
        const billingDay = customerDetail.billingAccount.billingDay;

        let dueYear = today.getFullYear();
        let dueMonth = today.getMonth();

        if (today.getDate() > billingDay) {
            dueMonth++;
            if (dueMonth > 11) {
                dueMonth = 0;
                dueYear++;
            }
        }

        const nextDueDate = new Date(dueYear, dueMonth, billingDay);
        dueDateString = `${String(nextDueDate.getMonth() + 1).padStart(2, '0')}/${String(nextDueDate.getDate()).padStart(2, '0')}/${nextDueDate.getFullYear()}`;
    }

    // ── Prepaid: the card shows the end of the paid period, not an invoice due date ──────────
    // A prepaid customer's service is governed by prepaid_expires_at, so a billing-day due date
    // is meaningless to them. Show the expiry plus how long they have left.
    const prepaidDaysLeft = useMemo(() => {
        if (!isPrepaid || !prepaidExpiresAt) return null;
        // Replace the space so the string parses on both iOS and Android.
        const expiry = new Date(String(prepaidExpiresAt).replace(' ', 'T')).getTime();
        if (isNaN(expiry)) return null;
        // Rounded UP, so any remaining part of a day still reads as "1 day left" rather than 0.
        return Math.ceil((expiry - Date.now()) / (24 * 60 * 60 * 1000));
    }, [isPrepaid, prepaidExpiresAt]);

    const dueDateLabel = isPrepaid ? 'Expires' : 'Due Date';
    const dueDateValue = isPrepaid
        ? (formatDbDate(prepaidExpiresAt) ?? 'Not started')
        : dueDateString;

    // null when there is nothing meaningful to say (postpaid, or a prepaid clock not yet started).
    const prepaidDaysLeftText = useMemo(() => {
        if (prepaidDaysLeft === null) return null;
        if (prepaidDaysLeft <= 0) return 'Expired';
        return `${prepaidDaysLeft} ${prepaidDaysLeft === 1 ? 'day' : 'days'} left`;
    }, [prepaidDaysLeft]);

    useEffect(() => {
        const loadData = async () => {
            const storedUser = await AsyncStorage.getItem('authData');
            if (storedUser) {
                try {
                    setUser(JSON.parse(storedUser));
                } catch (e) {
                    console.error('Failed to parse auth data:', e);
                }
            }

            if (accountNo && accountNo !== 'N/A') {
                try {
                    const pending = await paymentService.checkPendingPayment(accountNo);
                    setPendingPayment(pending);
                } catch (error) {
                    console.error('Error checking pending payment:', error);
                }
            }
        };
        loadData();
        silentRefresh();
    }, [accountNo]);

    useEffect(() => {
        if (ads.length > 0) {
            const adTimer = setInterval(() => {
                Animated.timing(stackAnim, {
                    toValue: 1,
                    duration: 600,
                    useNativeDriver: true,
                }).start(() => {
                    setCurrentAdPos(prev => (prev % ads.length) + 1);
                    stackAnim.setValue(0);
                });
            }, 5000);
            return () => clearInterval(adTimer);
        }
    }, [ads.length, width]);



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

        const fetchConvenienceFee = async () => {
            const percentage = await paymentService.getConvenienceFeePercentage();
            setConvenienceFeePercentage(percentage);
        };
        fetchConvenienceFee();

        const paletteSub = DeviceEventEmitter.addListener('colorPaletteChanged', (newPalette) => {
            setColorPalette(newPalette);
        });

        return () => paletteSub.remove();
    }, []);

    const onRefresh = React.useCallback(async () => {
        setRefreshing(true);
        try {
            await silentRefresh();
        } catch (error) {
            console.error('Refresh failed:', error);
        } finally {
            setRefreshing(false);
        }
    }, [silentRefresh]);

    // Use refs to avoid stale closures in PanResponder
    const modalHandlersRef = React.useRef({
        handleCloseVerifyModal,
        handleCancelPaymentLink,
        handleCancelPendingPayment,
        setShowSuccessModal,
        showPaymentVerifyModal,
        showPaymentLinkModal,
        showPendingPaymentModal,
        showSuccessModal
    });

    useEffect(() => {
        modalHandlersRef.current = {
            handleCloseVerifyModal,
            handleCancelPaymentLink,
            handleCancelPendingPayment,
            setShowSuccessModal,
            showPaymentVerifyModal,
            showPaymentLinkModal,
            showPendingPaymentModal,
            showSuccessModal
        };
    });

    const formatCurrency = useCallback((amount: number) => {
        const isNegative = amount < 0;
        // Use toFixed(0) to remove decimals or replace .00 with empty string
        const formatted = Math.abs(amount).toFixed(0).replace(/\d(?=(\d{3})+$)/g, '$&,');
        return `₱${isNegative ? '-' : ''}${formatted}`;
    }, []);

    if (contextLoading && !customerDetail) return (
        <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#111827" />
        </View>
    );

    const getStatusStyle = (status: string) => {
        switch (status) {
            case 'Done': return { bg: '#dcfce7', text: '#16a34a', border: '#bbf7d0' };
            case 'Failed': return { bg: '#fee2e2', text: '#dc2626', border: '#fecaca' };
            case 'Scheduled': return { bg: '#fef3c7', text: '#ca8a04', border: '#fde68a' };
            default: return { bg: '#f3f4f6', text: '#6b7280', border: '#f3f4f6' };
        }
    };



    // A payment cannot be created without a valid customer email (Xendit requires it
    // and the backend rejects invalid ones). Treat empty / 'N/A' / malformed as invalid.
    const isValidEmail = (email?: string | null): boolean => {
        if (!email) return false;
        const trimmed = email.trim();
        if (trimmed === '' || trimmed.toLowerCase() === 'n/a') return false;
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
    };

    const handlePayNow = async () => {
        setErrorMessage('');

        // Block the payment up front if the account has no valid email on file.
        if (!isValidEmail(emailAddress)) {
            setShowEmailErrorModal(true);
            return;
        }

        if (pendingPayment && pendingPayment.payment_url) {
            setShowPendingPaymentModal(true);
            return;
        }

        setIsPaymentProcessing(true);

        try {
            const pending = await paymentService.checkPendingPayment(accountNo);

            if (pending && pending.payment_url) {
                setPendingPayment(pending);
                setShowPendingPaymentModal(true);
            } else {
                openVerifyModal();
            }
        } catch (error: any) {
            console.error('Error checking pending payment:', error);
            openVerifyModal();
        } finally {
            setIsPaymentProcessing(false);
        }
    };

    /**
     * Open the confirm-payment sheet with the right starting amount.
     *
     * Prepaid: preselect the plan they are currently on and set the amount to that plan's price —
     * they are buying a service period, so the amount always tracks the selected plan.
     * Postpaid: unchanged, the amount starts at the outstanding balance.
     */
    async function openVerifyModal() {
        setOnboardingQuoteAmount(null);
        setCanRepriceOnboarding(false);
        let preselectedPlan: Plan | null = null;
        if (isPrepaid) {
            // A queued switch wins over the plan currently in force: the customer has already
            // bought it, so a top-up must be priced at that plan, not the one being replaced.
            preselectedPlan = pendingPlan ?? currentPlan ?? plans[0] ?? null;
            setSelectedPlanId(preselectedPlan?.id ?? null);
            setPaymentAmount(Number(preselectedPlan?.price ?? 0));
        } else {
            setPaymentAmount(balance);
        }
        setPayCurrentBalance(false);
        setIsPlanListOpen(false);
        setShowPaymentVerifyModal(true);

        // Resolve up front whether this is an unpaid first bill that can be re-priced. Without
        // this, every plan cheaper than the balance renders as under-balance and the customer
        // could never pick one to find out.
        if (isPrepaid && preselectedPlan) {
            setIsQuotingPlan(true);
            try {
                const quote = await paymentService.quotePlanChange(accountNo, preselectedPlan.id);
                if (quote?.eligible && typeof quote.amount === 'number') {
                    setCanRepriceOnboarding(true);
                    setOnboardingQuoteAmount(quote.amount);
                    setPaymentAmount(quote.amount);
                }
            } finally {
                setIsQuotingPlan(false);
            }
        }
    }

    /** Picking a plan re-drives the amount — the two are never allowed to disagree. */
    const handleSelectPlan = async (plan: Plan) => {
        const price = Number(plan.price ?? 0);
        setPayCurrentBalance(false);
        setSelectedPlanId(plan.id);
        // Deliberately reset: forfeiting days is a decision about ONE specific switch, so it has
        // to be made again for a different plan rather than carried over silently.
        setActivateNow(false);
        setPaymentAmount(price);
        setIsPlanListOpen(false);
        setErrorMessage('');

        // A customer still on their unpaid FIRST bill may swap plan freely: the server re-prices
        // that bill, so the amount becomes the new plan's total rather than the old balance.
        setIsQuotingPlan(true);
        try {
            const quote = await paymentService.quotePlanChange(accountNo, plan.id);
            if (quote?.eligible && typeof quote.amount === 'number') {
                setCanRepriceOnboarding(true);
                setOnboardingQuoteAmount(quote.amount);
                setPaymentAmount(quote.amount);
                return;
            }
            setCanRepriceOnboarding(false);
            setOnboardingQuoteAmount(null);
        } finally {
            setIsQuotingPlan(false);
        }

        // Flag a plan too cheap to clear the balance straight away, rather than letting the
        // customer discover it only when they press Pay.
        if (requiresPlanCoversBalance && toCentavos(price) < toCentavos(balance)) {
            setErrorMessage(`${plan.name} costs ${formatCurrency(price)}, which does not cover your balance of ${formatCurrency(balance)}. Pick a plan priced at ${formatCurrency(balance)} or more.`);
        } else {
            setErrorMessage('');
        }
    };

    /** "Pay Current Balance": settle the outstanding balance directly — no plan change. */
    const handleSelectPayCurrentBalance = () => {
        setPayCurrentBalance(true);
        setSelectedPlanId(null);
        setActivateNow(false);
        setPaymentAmount(balance);
        setIsPlanListOpen(false);
        setErrorMessage('');
        // Drop any onboarding re-price quote - this mode pays the balance as it stands and sends
        // no plan, so nothing gets re-priced.
        setOnboardingQuoteAmount(null);
        setCanRepriceOnboarding(false);
    };

    function handleCloseVerifyModal() {
        setShowPaymentVerifyModal(false);
        setIsPlanListOpen(false);
        setPayCurrentBalance(false);
        setActivateNow(false);
        setPaymentAmount(isPrepaid ? Number(selectedPlan?.price ?? 0) : balance);
    };

    const handleProceedToCheckout = async () => {
        // Guard again at the point of payment in case the verify modal was reached
        // without a valid email on file.
        if (!isValidEmail(emailAddress)) {
            setShowPaymentVerifyModal(false);
            setShowEmailErrorModal(true);
            return;
        }

        // Prepaid still pays the selected plan's price — that is how a plan change is bought — but
        // the price has to cover what is already owed, so a cheaper plan cannot be used to underpay
        // an outstanding balance. Postpaid must settle the balance exactly.
        if (isPrepaid && payCurrentBalance) {
            // Paying the outstanding balance directly (no plan change). Amount is pinned to the
            // balance; only guard against a nothing-to-pay case.
            if (balance < 1) {
                setErrorMessage('There is no balance to pay.');
                return;
            }
        } else if (isPrepaid) {
            if (!selectedPlan) {
                setErrorMessage('Please select a plan to continue.');
                return;
            }
            if (requiresPlanCoversBalance && !paymentCoversBalance) {
                setErrorMessage(`${selectedPlan.name} costs ${formatCurrency(paymentAmount)}, which does not cover your balance of ${formatCurrency(balance)}. Pick a plan priced at ${formatCurrency(balance)} or more.`);
                return;
            }
        } else if (requiresExactPayment && !isPaymentAmountValid) {
            setErrorMessage(`Payment must be exactly your current balance of ${formatCurrency(balance)}`);
            return;
        }

        if (isPaymentProcessing) return;

        setIsPaymentProcessing(true);
        setErrorMessage('');

        try {
            const redirectUrl = LinkingExpo.createURL('payment-success');
            // activate_now is re-checked against canActivateNow rather than sent raw: the flag
            // is only meaningful for the exact selection it was ticked for, and the server
            // ignores it without a genuine plan switch anyway.
            const response = await paymentService.createPayment(
                accountNo,
                paymentAmount,
                redirectUrl,
                (isPrepaid && !payCurrentBalance) ? selectedPlanId : null,
                activateNow && canActivateNow
            );

            if (response.status === 'success' && response.payment_url) {
                setShowPaymentVerifyModal(false);
                setPaymentLinkData({
                    referenceNo: response.reference_no || '',
                    // total_charged, not amount: this modal is telling the customer what they are
                    // about to pay at the gateway, which includes the convenience fee.
                    amount: response.total_charged ?? response.amount ?? paymentAmount,
                    paymentUrl: response.payment_url
                });
                setShowPaymentLinkModal(true);
            } else {
                throw new Error(response.message || 'Failed to create payment link');
            }
        } catch (error: any) {
            console.error('Payment error:', error);
            const msg = error?.message || '';
            // Invalid/missing customer email is blocked by the backend before a
            // payment URL is generated — surface it as a dedicated error modal.
            if (/email/i.test(msg)) {
                setShowPaymentVerifyModal(false);
                setShowEmailErrorModal(true);
            } else {
                setErrorMessage(msg || 'Failed to create payment. Please try again.');
            }
        } finally {
            setIsPaymentProcessing(false);
        }
    };

    const handleOpenPaymentLink = async () => {
        const url = paymentLinkData?.paymentUrl || pendingPayment?.payment_url;
        const refNo = paymentLinkData?.referenceNo || pendingPayment?.reference_no || '';
        if (url) {
            try {
                const redirectUrl = LinkingExpo.createURL('payment-success');
                await WebBrowser.openAuthSessionAsync(url, redirectUrl);

                await silentRefresh();

                if (accountNo && accountNo !== 'N/A') {
                    const updatedPending = await paymentService.checkPendingPayment(accountNo);
                    setPendingPayment(updatedPending);
                }

                setShowPaymentLinkModal(false);
                setShowPendingPaymentModal(false);
                setPaymentLinkData(null);
                setPendingPayment(null);

                // Verify actual payment status from Xendit before showing success
                if (refNo) {
                    try {
                        const statusRes = await paymentService.checkPaymentStatus(refNo);
                        if (statusRes.status === 'success' && statusRes.payment?.status === 'PAID') {
                            setShowSuccessModal(true);
                        }
                    } catch (err) {
                        console.error('Error checking payment status:', err);
                    }
                }
            } catch (error) {
                console.error('Error opening browser:', error);
                Linking.openURL(url);
            }
        }
    };

    function handleCancelPaymentLink() {
        setShowPaymentLinkModal(false);
        setPaymentLinkData(null);
    };

    const handleResumePendingPayment = () => {
        handleOpenPaymentLink();
    };

    function handleCancelPendingPayment() {
        setShowPendingPaymentModal(false);
        setPendingPayment(null);
    };

    const handleDeletePendingPayment = async () => {
        if (!pendingPayment?.reference_no) return;
        
        setIsPaymentProcessing(true);
        try {
            await paymentService.cancelPayment(pendingPayment.reference_no);
            setShowPendingPaymentModal(false);
            setPendingPayment(null);
            Alert.alert("Success", "Pending payment cancelled successfully.");
        } catch (error: any) {
            Alert.alert("Error", error.message || "Failed to cancel payment.");
        } finally {
            setIsPaymentProcessing(false);
        }
    };

    return (
        <View style={styles.container}>
            <ScrollView
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ paddingTop: !isMobile ? 16 : (isShort ? 20 : 60), paddingHorizontal: isMobile ? 16 : 24, paddingBottom: 100, gap: isShort ? 16 : 24 }}
                refreshControl={
                    <RefreshControl
                        refreshing={refreshing}
                        onRefresh={onRefresh}
                        colors={[colorPalette?.primary || '#ef4444']} // Android
                        tintColor={colorPalette?.primary || '#ef4444'} // iOS
                        progressViewOffset={80}
                    />
                }
            >


                <View style={styles.contentGap}>
                    <Animated.View style={[styles.balanceCard, { transform: [{ scaleY: cardScaleY }] }]}>
                        <LinearGradient
                            colors={isCardFlipped ? ['#000000', colorPalette?.primary || '#ef4444'] : [colorPalette?.primary || '#ef4444', '#000000']}
                            start={{ x: 0, y: 0 }}
                            end={{ x: 1, y: 1 }}
                            style={[styles.gradientInner, { paddingVertical: isShort ? 24 : 32, minHeight: isShort ? 200 : 230 }]}
                        >
                            <View style={[styles.profileRow, { marginBottom: isShort ? 16 : 32, justifyContent: 'space-between' }]}>
                                <View style={[styles.initialsCircle, { width: isShort ? 44 : 50, height: isShort ? 44 : 50, borderRadius: isShort ? 22 : 25 }]}>
                                    <Text style={[styles.initialsText, { fontSize: isShort ? 18 : 20 }]}>{initials}</Text>
                                </View>
                                <View style={{ flex: 1, marginHorizontal: 12 }}>
                                    <Text 
                                        allowFontScaling={false} 
                                        numberOfLines={1} 
                                        adjustsFontSizeToFit
                                        style={[styles.customerNameText, { fontSize: isShort ? 16 : 18 }]}
                                    >
                                        {displayName}
                                    </Text>
                                    <Text allowFontScaling={false} style={styles.customerAccountText}>Account No: {accountNo}</Text>
                                    {isCardFlipped && <Text allowFontScaling={false} numberOfLines={1} style={styles.customerAccountText}>{emailAddress}</Text>}
                                </View>
                                <Pressable 
                                    onPress={handleFlipCard}
                                    style={({ pressed }) => ({
                                        opacity: pressed ? 0.6 : 1,
                                        padding: 8
                                    })}
                                >
                                    <RefreshCcw size={20} color="#ffffff" />
                                </Pressable>
                            </View>

                            {!isCardFlipped ? (
                                <View style={{ minHeight: isShort ? 80 : 90 }}>
                                <View style={styles.billingRow}>
                                    <View style={styles.billingLeft}>
                                        <Text allowFontScaling={false} style={styles.balanceLabel}>Total Amount</Text>
                                        <Text 
                                            numberOfLines={1} 
                                            adjustsFontSizeToFit
                                            minimumFontScale={0.5}
                                            allowFontScaling={false}
                                            style={[styles.balanceAmountText, { fontSize: balance >= 1000 ? (isMobile ? (isShort ? 28 : 32) : 44) : (isMobile ? (isShort ? 36 : 40) : 56) }]}
                                        >
                                            {formatCurrency(balance)}
                                        </Text>
                                    </View>

                                    <View style={styles.billingRightCol}>
                                        <View style={styles.dueDateContainer}>
                                            {/* Prepaid shows when the paid period ends; postpaid keeps the invoice due date. */}
                                            <Text allowFontScaling={false} style={styles.infoText}>{dueDateLabel}: <Text allowFontScaling={false} style={styles.infoValue}>{dueDateValue}</Text></Text>
                                            {prepaidDaysLeftText && (
                                                <Text
                                                    allowFontScaling={false}
                                                    style={[
                                                        styles.daysLeftText,
                                                        prepaidDaysLeft !== null && prepaidDaysLeft <= 3 && styles.daysLeftUrgent,
                                                    ]}
                                                >
                                                    {prepaidDaysLeftText}
                                                </Text>
                                            )}
                                        </View>

                                        <Pressable
                                            onPress={handlePayNow}
                                            disabled={isPaymentProcessing}
                                            style={[styles.payBtn, { opacity: isPaymentProcessing ? 0.5 : 1 }]}
                                        >
                                            <View style={styles.payBtnInner}>
                                                <Text style={styles.payBtnText}>
                                                    {isPaymentProcessing ? '...' : (pendingPayment ? 'Proceed' : 'Pay Now')}
                                                </Text>
                                            </View>
                                        </Pressable>
                                    </View>
                                </View>
                                </View>
                            ) : (
                                <View style={{ gap: 16, minHeight: isShort ? 80 : 90, justifyContent: 'center' }}>
                                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <View style={{ flex: 1 }}>
                                            <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 12, marginBottom: 4 }}>Plan</Text>
                                            <Text style={{ color: '#ffffff', fontSize: 18, fontWeight: '700' }}>{planName}</Text>
                                        </View>
                                        <View style={{ flex: 1, alignItems: 'flex-end' }}>
                                            {/* Was "Usage Type", which read N/A for every customer because the
                                                usage type is an internal technical-details field that is not
                                                captured for retail accounts. Billing type is the value the
                                                customer actually needs here — it explains why they see an
                                                expiry instead of a due date, and top-ups instead of bills. */}
                                            <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 12, marginBottom: 4 }}>Billing Type</Text>
                                            <Text style={{ color: '#ffffff', fontSize: 18, fontWeight: '700' }}>{billingType}</Text>
                                        </View>
                                    </View>
                                </View>
                            )}
                        </LinearGradient>
                    </Animated.View>

                    {/* Prepaid plan summary. Prepaid buys a service period, so the plan only means
                        something next to the date it runs out — and a plan change already paid for
                        is listed separately, because it is NOT what they are on today. Shown here
                        rather than on the flipped card so it needs no interaction to find. */}
                    {isPrepaid && (
                        <View style={styles.sectionGap}>
                            <View style={styles.sectionHeader}>
                                <Text style={styles.sectionTitle}>Plan</Text>
                            </View>

                            <View style={styles.referralContent}>
                                <View style={styles.verifyRow}>
                                    <Text style={styles.verifyLabel}>Current Plan</Text>
                                    <Text style={styles.verifyValue}>{planName}</Text>
                                </View>
                                <View style={styles.verifyRow}>
                                    <Text style={styles.verifyLabel}>Expires</Text>
                                    <Text style={styles.verifyValue}>
                                        {formatDbDate(prepaidExpiresAt) ?? 'Not started'}
                                    </Text>
                                </View>

                                {pendingPlanName && (
                                    <>
                                        <View style={styles.verifyRow}>
                                            <Text style={styles.verifyLabel}>Upcoming Plan</Text>
                                            <Text style={[styles.verifyValue, { color: colorPalette?.primary || '#ef4444' }]}>
                                                {pendingPlanName}
                                            </Text>
                                        </View>
                                        <View style={styles.verifyRow}>
                                            <Text style={styles.verifyLabel}>Starts</Text>
                                            <Text style={styles.verifyValue}>
                                                {/* No effective date stored means the switch lands as soon as
                                                    the current period lapses, not on a fixed day. */}
                                                {formatDbDate(pendingPlanEffectiveAt)
                                                    ?? (formatDbDate(prepaidExpiresAt)
                                                        ? `After ${formatDbDate(prepaidExpiresAt)}`
                                                        : 'After current period')}
                                            </Text>
                                        </View>
                                    </>
                                )}
                            </View>
                        </View>
                    )}

                    {/* Payment History Section */}
                    <View style={styles.sectionGap}>
                        <View style={styles.sectionHeader}>
                            <Text style={styles.sectionTitle}>Payment History</Text>
                        </View>

                        <View style={styles.referralContent}>
                            {latestPayments.length > 0 ? (
                                latestPayments.map((payment: any) => (
                                    <View key={payment.id} style={styles.paymentItem}>
                                        <View style={{ flex: 1 }}>
                                            <Text numberOfLines={1} ellipsizeMode="tail" style={styles.paymentRef}>Ref: {payment.reference}</Text>
                                            <Text style={styles.paymentDate}>{formatDate(payment.date)}</Text>
                                        </View>
                                        <View style={styles.alignEnd}>
                                            <Text style={styles.paymentAmountValue}>{formatCurrency(payment.amount)}</Text>
                                            <View style={[styles.statusBadgeSmall, { backgroundColor: 'transparent' }]}>
                                                <Text style={[
                                                    styles.statusTextSmall, 
                                                    { color: (payment.status === 'Completed' || payment.status === 'PAID' || payment.status === 'Success' || payment.status === 'Done') ? '#16a34a' : (payment.status === 'Failed' ? '#ef4444' : '#374151') }
                                                ]}>
                                                    {(payment.status || 'Posted').toUpperCase()}
                                                </Text>
                                            </View>
                                        </View>
                                    </View>
                                ))
                            ) : (
                                <View style={styles.emptyReferrals}>
                                    <Text style={styles.emptyReferralsText}>No payments found</Text>
                                </View>
                            )}
                        </View>
                        <View style={styles.divider} />
                        {/* Promotional Ads Section */}
                        <View style={styles.adsWrapper}>
                            <View style={styles.adsInner}>
                                <View style={{ height: 160, position: 'relative' }}>
                                    {[2, 1, 0].map((stackIdx) => {
                                        const actualActiveIndex = (currentAdPos - 1 + ads.length) % ads.length;
                                        const adIdx = (actualActiveIndex + stackIdx) % ads.length;
                                        const ad = ads[adIdx];
                                        const adWidth = width - (isMobile ? 32 : 48);
                                        
                                        const translateX = stackIdx === 0 
                                            ? stackAnim.interpolate({ inputRange: [0, 1], outputRange: [0, -width] })
                                            : 0;
                                        
                                        const scale = stackAnim.interpolate({
                                            inputRange: [0, 1],
                                            outputRange: [1 - (stackIdx * 0.05), 1 - (Math.max(0, stackIdx - 1) * 0.05)]
                                        });

                                        const translateY = stackAnim.interpolate({
                                            inputRange: [0, 1],
                                            outputRange: [stackIdx * 8, (Math.max(0, stackIdx - 1) * 8)]
                                        });

                                        const opacity = stackAnim.interpolate({
                                            inputRange: [0, 1],
                                            outputRange: [1 - (stackIdx * 0.3), 1 - (Math.max(0, stackIdx - 1) * 0.3)]
                                        });
                                        
                                        return (
                                            <Animated.View
                                                key={ad.id}
                                                style={[
                                                    styles.adCard,
                                                    {
                                                        width: adWidth,
                                                        position: 'absolute',
                                                        transform: [
                                                            { scale },
                                                            { translateX },
                                                            { translateY }
                                                        ],
                                                        zIndex: 10 - stackIdx,
                                                        opacity
                                                    }
                                                ]}
                                            >
                                                <LinearGradient
                                                    colors={ad.colors as any}
                                                    start={{ x: 0, y: 0 }}
                                                    end={{ x: 1, y: 1 }}
                                                    style={StyleSheet.absoluteFill}
                                                />
                                                {/* Design Elements */}
                                                <View style={[styles.adCircle, { top: -20, right: -20, width: 100, height: 100, opacity: 0.2 }]} />
                                                <View style={[styles.adCircle, { bottom: -50, left: -30, width: 150, height: 150, opacity: 0.1 }]} />
                                                
                                                <View style={styles.adContent}>
                                                    <Text style={styles.adTitle}>{ad.title}</Text>
                                                    <Text style={styles.adDesc}>{ad.desc}</Text>
                                                </View>
                                            </Animated.View>
                                        );
                                    })}
                                </View>

                                <View style={styles.dotsRow}>
                                    {ads.map((_, i) => {
                                        const actualActiveIndex = (currentAdPos - 1 + ads.length) % ads.length;
                                        return (
                                            <View
                                                key={i}
                                                style={[styles.dotBase, { backgroundColor: actualActiveIndex === i ? '#111827' : '#d1d5db' }]}
                                            />
                                        );
                                    })}
                                </View>
                            </View>
                        </View>

                    </View>
                </View>
            </ScrollView>

            <Modal
                visible={showPaymentVerifyModal}
                transparent={true}
                animationType="slide"
                statusBarTranslucent={true}
                onRequestClose={handleCloseVerifyModal}
            >
                <KeyboardAvoidingView
                    behavior={Platform.OS === 'ios' ? 'padding' : 'padding'}
                    style={{
                        flex: 1,
                        backgroundColor: 'transparent',
                        justifyContent: 'flex-end'
                    }}
                >
                    <Pressable style={styles.modalBackdrop} onPress={handleCloseVerifyModal} />
                    <Animated.View style={[styles.modalSheet, { transform: [{ translateY: pan.y }] }]}>
                        <View {...panResponder.panHandlers} style={styles.modalHeader}>
                            <Pressable onPress={handleCloseVerifyModal} style={styles.modalHandleBtn}>
                                <View style={styles.modalHandle} />
                            </Pressable>
                            <Text style={styles.modalTitle}>Confirm Payment</Text>
                        </View>

                        <ScrollView contentContainerStyle={styles.modalContent} keyboardShouldPersistTaps="handled">
                            <View style={styles.verifyBox}>
                                <View style={styles.verifyRowMb}>
                                    <Text style={styles.verifyLabel}>Account Name</Text>
                                    <View style={{ flex: 1, alignItems: 'flex-end', marginLeft: 16 }}>
                                        <Text 
                                            numberOfLines={1} 
                                            adjustsFontSizeToFit
                                            style={styles.verifyValue}
                                        >
                                            {displayName}
                                        </Text>
                                    </View>
                                </View>
                                <View style={styles.verifyRow}>
                                    <Text style={styles.verifyLabel}>Current Balance</Text>
                                    <Text style={[styles.verifyValue, { fontWeight: 'bold', color: balance > 0 ? (colorPalette?.primary || '#ef4444') : '#16a34a' }]}>
                                        {formatCurrency(balance)}
                                    </Text>
                                </View>
                            </View>

                            {errorMessage && (
                                <View style={[styles.errorBox, { backgroundColor: (colorPalette?.primary || '#ef4444') + '15', borderColor: (colorPalette?.primary || '#ef4444') + '30' }]}>
                                    <Text style={[styles.errorText, { color: colorPalette?.primary || '#ef4444' }]}>{errorMessage}</Text>
                                </View>
                            )}

                            {/* Prepaid only: pick the plan being paid for. The amount below follows
                                this selection, so the two can never disagree. */}
                            {isPrepaid && (
                                <View style={styles.planWrap}>
                                    <Text style={styles.inputLabel}>Plan</Text>

                                    {isLoadingPlans ? (
                                        <View style={styles.planLoading}>
                                            <ActivityIndicator size="small" color={colorPalette?.primary || '#111827'} />
                                            <Text style={styles.planLoadingText}>Loading plans…</Text>
                                        </View>
                                    ) : plans.length === 0 ? (
                                        <Text style={styles.planEmptyText}>
                                            No plans are available right now. Please contact support.
                                        </Text>
                                    ) : (
                                        <>
                                            <Pressable
                                                onPress={() => setIsPlanListOpen(open => !open)}
                                                style={[styles.planTrigger, isPlanListOpen && { borderColor: colorPalette?.primary || '#7c3aed' }]}
                                            >
                                                <Text style={styles.planTriggerText} numberOfLines={1}>
                                                    {payCurrentBalance
                                                        ? `Pay Current Balance — ${formatCurrency(balance)}`
                                                        : selectedPlan
                                                            ? `${selectedPlan.name} — ${formatCurrency(Number(selectedPlan.price ?? 0))}`
                                                            : 'Select a plan'}
                                                </Text>
                                                <Text style={styles.planChevron}>{isPlanListOpen ? '▲' : '▼'}</Text>
                                            </Pressable>

                                            {isPlanListOpen && (
                                                <View style={styles.planList}>
                                                    <ScrollView
                                                        style={{ maxHeight: 200 }}
                                                        nestedScrollEnabled
                                                        keyboardShouldPersistTaps="handled"
                                                    >
                                                        {/* Static option: pay the outstanding balance directly, no plan
                                                            change. Only offered when there is actually a balance to settle. */}
                                                        {balance > 0 && (
                                                            <Pressable
                                                                onPress={handleSelectPayCurrentBalance}
                                                                style={[
                                                                    styles.planOption,
                                                                    payCurrentBalance && { backgroundColor: (colorPalette?.primary || '#7c3aed') + '12' },
                                                                ]}
                                                            >
                                                                <View style={{ flex: 1, marginRight: 8 }}>
                                                                    <Text style={styles.planOptionName} numberOfLines={1}>Pay Current Balance</Text>
                                                                </View>
                                                                <Text style={[styles.planOptionPrice, payCurrentBalance && { color: colorPalette?.primary || '#7c3aed' }]}>
                                                                    {formatCurrency(balance)}
                                                                </Text>
                                                            </Pressable>
                                                        )}
                                                        {plans.map(plan => {
                                                            const isSelected = plan.id === selectedPlanId;
                                                            const isCurrent = plan.id === currentPlan?.id;
                                                            return (
                                                                <Pressable
                                                                    key={plan.id}
                                                                    onPress={() => handleSelectPlan(plan)}
                                                                    style={[
                                                                        styles.planOption,
                                                                        isSelected && { backgroundColor: (colorPalette?.primary || '#7c3aed') + '12' },
                                                                    ]}
                                                                >
                                                                    <View style={{ flex: 1, marginRight: 8 }}>
                                                                        <Text style={styles.planOptionName} numberOfLines={1}>
                                                                            {plan.name}{isCurrent ? '  (current)' : ''}
                                                                        </Text>
                                                                        {!!plan.description && (
                                                                            <Text style={styles.planOptionDesc} numberOfLines={1}>{plan.description}</Text>
                                                                        )}
                                                                    </View>
                                                                    <Text style={[styles.planOptionPrice, isSelected && { color: colorPalette?.primary || '#7c3aed' }]}>
                                                                        {formatCurrency(Number(plan.price ?? 0))}
                                                                    </Text>
                                                                </Pressable>
                                                            );
                                                        })}
                                                    </ScrollView>
                                                </View>
                                            )}
                                        </>
                                    )}

                                    {/* Explain what this payment will actually do. Three distinct
                                        cases, because a plan bought mid-period does not take
                                        effect until the paid-for period lapses. */}
                                    {selectedPlan && pendingPlan && selectedPlan.id === pendingPlan.id ? (
                                        <Text style={styles.planNoteText}>
                                            {pendingPlanName || selectedPlan.name} is already scheduled
                                            {pendingPlanEffectiveAt ? ` for ${formatDbDate(pendingPlanEffectiveAt)}` : ''}.
                                            This payment extends your service period.
                                        </Text>
                                    ) : selectedPlan && currentPlan && selectedPlan.id === currentPlan.id && pendingPlan ? (
                                        <Text style={styles.planNoteText}>
                                            You have {pendingPlan.name} scheduled
                                            {pendingPlanEffectiveAt ? ` for ${formatDbDate(pendingPlanEffectiveAt)}` : ''}.
                                            Paying for {selectedPlan.name} instead will cancel that change.
                                        </Text>
                                    ) : selectedPlan && currentPlan && selectedPlan.id !== currentPlan.id ? (
                                        <Text style={styles.planNoteText}>
                                            {activateNow
                                                ? `${selectedPlan.name} starts as soon as this payment is confirmed.`
                                                : isPrepaidPeriodActive && prepaidExpiresAt
                                                    ? `Your current plan stays active until ${formatDbDate(prepaidExpiresAt)}. ${selectedPlan.name} starts right after.`
                                                    : `${selectedPlan.name} starts as soon as this payment is confirmed.`}
                                        </Text>
                                    ) : null}

                                    {/* Activate Now — only worth offering while there are days left
                                        to forfeit AND the selection is a real switch. Outside those
                                        conditions the new plan already starts immediately, so the
                                        choice would be meaningless. */}
                                    {canActivateNow && (
                                        <View style={styles.activateNowWrap}>
                                            <Pressable
                                                onPress={() => setActivateNow(!activateNow)}
                                                style={styles.activateNowRow}
                                                accessibilityRole="checkbox"
                                                accessibilityState={{ checked: activateNow }}
                                                accessibilityLabel="Activate Now"
                                            >
                                                <View
                                                    style={[
                                                        styles.activateNowBox,
                                                        activateNow && {
                                                            backgroundColor: colorPalette?.primary || '#7c3aed',
                                                            borderColor: colorPalette?.primary || '#7c3aed',
                                                        },
                                                    ]}
                                                >
                                                    {activateNow && <Text style={styles.activateNowTick}>✓</Text>}
                                                </View>
                                                <Text style={styles.activateNowLabel}>Activate Now</Text>
                                            </Pressable>

                                            {activateNow ? (
                                                <View style={styles.activateNowWarning}>
                                                    <Text style={styles.activateNowWarningText}>
                                                        Heads up: {selectedPlan?.name} starts as soon as your payment is
                                                        confirmed and your service period resets to 30 days from today.
                                                        You will lose the{' '}
                                                        {prepaidDaysLeft !== null && prepaidDaysLeft > 0
                                                            ? `${prepaidDaysLeft} ${prepaidDaysLeft === 1 ? 'day' : 'days'}`
                                                            : 'days'}{' '}
                                                        remaining on your current plan. This cannot be undone.
                                                    </Text>
                                                </View>
                                            ) : (
                                                <Text style={styles.activateNowHint}>
                                                    Tick to switch immediately instead of waiting for your current
                                                    period to end.
                                                </Text>
                                            )}
                                        </View>
                                    )}
                                </View>
                            )}

                            <View style={styles.inputWrap}>
                                <Text style={styles.inputLabel}>Payment Amount</Text>
                                <TextInput
                                    keyboardType="decimal-pad"
                                    // Not hand-editable when the amount is already determined:
                                    // prepaid takes it from the plan picker above, and postpaid
                                    // with a balance owed must settle that balance in full.
                                    editable={!isPrepaid && !requiresExactPayment}
                                    value={paymentAmount !== undefined && paymentAmount !== null ? paymentAmount.toString() : ''}
                                    onChangeText={(value) => {
                                        if (value === '' || /^-?\d*\.?\d*$/.test(value)) {
                                            const amount = value === '' || value === '-' ? 0 : parseFloat(value) || 0;
                                            setPaymentAmount(amount);
                                            setErrorMessage('');
                                        }
                                    }}
                                    placeholder="0.00"
                                    style={[styles.inputField, (isPrepaid || requiresExactPayment) && styles.inputFieldLocked]}
                                />
                                <View style={styles.inputHint}>
                                    <Text style={styles.inputHintText}>
                                        {isPrepaid
                                            ? (isQuotingPlan
                                                ? 'Computing amount…'
                                                : payCurrentBalance
                                                    ? 'Paying your current balance'
                                                    : selectedPlan
                                                        ? (onboardingQuoteAmount !== null
                                                            ? `${selectedPlan.name} — first bill re-priced (incl. VAT/withholding)`
                                                            : `Set by your ${selectedPlan.name} plan`)
                                                        : 'Select a plan above')
                                            : (requiresExactPayment ? `Full settlement required: ${formatCurrency(balance)}` : 'Minimum: ₱1.00')}
                                    </Text>
                                </View>

                                {/* Convenience fee disclosure. The field above is the amount that
                                    settles the bill; the gateway collects this total instead. */}
                                {convenienceFeePercentage > 0 && feeBaseAmount > 0 && (
                                    <Text style={styles.feeNoteText}>
                                        + convenience fee: {convenienceFeeLabel}% = {formatPeso(totalWithConvenienceFee)}
                                    </Text>
                                )}
                            </View>

                            <Pressable
                                onPress={handleProceedToCheckout}
                                disabled={
                                    isPaymentProcessing
                                    || paymentAmount < 1
                                    || !isPaymentAmountValid
                                    || (isPrepaid && !selectedPlan && !payCurrentBalance)
                                }
                                style={[styles.primaryBtn, {
                                    backgroundColor: colorPalette?.primary || '#ef4444',
                                    opacity: (isPaymentProcessing || paymentAmount < 1 || !isPaymentAmountValid || (isPrepaid && !selectedPlan && !payCurrentBalance)) ? 0.5 : 1,
                                }]}
                            >
                                <Text style={styles.primaryBtnText}>
                                    {isPaymentProcessing ? 'Processing...' : 'Pay'}
                                </Text>
                            </Pressable>

                            <View style={styles.spacer} />
                        </ScrollView>
                    </Animated.View>
                </KeyboardAvoidingView>
            </Modal>

            <Modal
                visible={showPaymentLinkModal && !!paymentLinkData}
                transparent={true}
                animationType="slide"
                statusBarTranslucent={true}
                onRequestClose={handleCancelPaymentLink}
            >
                <View style={styles.modalOverlay}>
                    <Pressable style={styles.modalBackdrop} onPress={handleCancelPaymentLink} />
                    <Animated.View style={[styles.modalSheet, { transform: [{ translateY: pan.y }] }]}>
                        <View {...panResponder.panHandlers} style={styles.modalHeader}>
                            <Pressable onPress={handleCancelPaymentLink} style={styles.modalHandleBtn}>
                                <View style={styles.modalHandle} />
                            </Pressable>
                            <Text style={styles.modalTitle}>Payment Link Created!</Text>
                        </View>

                        <ScrollView contentContainerStyle={styles.modalContent}>
                            <View style={styles.verifyBox}>
                                <View style={styles.verifyRowMb}>
                                    <Text style={styles.verifyLabel}>Reference No.</Text>
                                    <View style={styles.refRow}>
                                        <Text style={[styles.verifyValue, { textAlign: 'right' }]}>{paymentLinkData?.referenceNo}</Text>
                                    </View>
                                </View>
                                <View style={styles.verifyRow}>
                                    <Text style={styles.verifyLabel}>Payment Amount</Text>
                                    {/* Exact centavos, not formatCurrency's rounded pesos: this is the
                                        figure the gateway will charge, so it has to match to the cent. */}
                                    <Text style={[styles.verifyValue, { fontWeight: 'bold', color: colorPalette?.primary || '#ef4444' }]}>
                                        {formatPeso(paymentLinkData?.amount || 0)}
                                    </Text>
                                </View>
                            </View>

                            <Text style={styles.linkDesc}>
                                Please click the button below to complete your payment.
                            </Text>

                            <Pressable onPress={handleOpenPaymentLink} style={styles.openPortalBtn}>
                                <Text style={styles.primaryBtnText}>Open Payment Portal</Text>
                            </Pressable>

                            <Pressable onPress={handleCancelPaymentLink}>
                                <Text style={styles.closeText}>Close</Text>
                            </Pressable>

                            <View style={styles.spacer} />
                        </ScrollView>
                    </Animated.View>
                </View>
            </Modal>

            <Modal
                visible={showPendingPaymentModal && !!pendingPayment}
                transparent={true}
                animationType="slide"
                statusBarTranslucent={true}
                onRequestClose={handleCancelPendingPayment}
            >
                <View style={styles.modalOverlay}>
                    <Pressable style={styles.modalBackdrop} onPress={handleCancelPendingPayment} />
                    <Animated.View style={[styles.modalSheet, { transform: [{ translateY: pan.y }] }]}>
                        <View {...panResponder.panHandlers} style={styles.modalHeader}>
                            <Pressable onPress={handleCancelPendingPayment} style={styles.modalHandleBtn}>
                                <View style={styles.modalHandle} />
                            </Pressable>
                            <Text style={styles.modalTitle}>Pending Payment Found</Text>
                        </View>

                        <ScrollView contentContainerStyle={styles.modalContent}>
                            <View style={styles.pendingBox}>
                                <View style={styles.verifyRow}>
                                    <Text style={styles.pendingLabel}>Amount Due</Text>
                                    {/* Gross, to the cent — a resumed payment is charged the same
                                        total (convenience fee included) that was quoted at checkout. */}
                                    <Text style={styles.pendingAmount}>
                                        {formatPeso(pendingPayment?.amount || 0)}
                                    </Text>
                                </View>
                            </View>

                            <Text style={styles.pendingDesc}>
                                You have a pending payment session. Would you like to resume it?
                            </Text>

                            <View style={styles.pendingBtns}>
                                <Pressable
                                    onPress={handleResumePendingPayment}
                                    style={[styles.resumeBtn, { backgroundColor: colorPalette?.primary || '#0f172a' }]}
                                    disabled={isPaymentProcessing}
                                >
                                    <Text style={styles.primaryBtnText}>{isPaymentProcessing ? 'Processing...' : 'Resume Payment'}</Text>
                                </Pressable>
                                <Pressable 
                                    onPress={handleDeletePendingPayment} 
                                    style={[styles.cancelBtn, { backgroundColor: '#fee2e2' }]}
                                    disabled={isPaymentProcessing}
                                >
                                    <Text style={[styles.cancelBtnText, { color: '#dc2626' }]}>Cancel Payment</Text>
                                </Pressable>
                                <Pressable 
                                    onPress={handleCancelPendingPayment} 
                                    style={styles.cancelBtn}
                                    disabled={isPaymentProcessing}
                                >
                                    <Text style={styles.cancelBtnText}>Close</Text>
                                </Pressable>
                            </View>

                            <View style={styles.spacer} />
                        </ScrollView>
                    </Animated.View>
                </View>
            </Modal>

            {/* Success Modal */}
            <Modal
                visible={showSuccessModal}
                transparent={true}
                animationType="slide"
                statusBarTranslucent={true}
                onRequestClose={() => setShowSuccessModal(false)}
            >
                <View style={styles.modalOverlayDark}>
                    <Pressable style={styles.modalBackdrop} onPress={() => setShowSuccessModal(false)} />
                    <Animated.View style={[styles.modalSheet30, { transform: [{ translateY: pan.y }] }]}>
                        <View {...panResponder.panHandlers} style={styles.modalHeader}>
                            <View style={styles.modalHandleSm} />
                            <Text style={[styles.modalTitle, { fontWeight: '700' }]}>Payment Successful!</Text>
                        </View>
                        <ScrollView contentContainerStyle={styles.modalContentCenter}>
                            <View style={styles.successCircle}>
                                <CheckCircle size={48} color="#16a34a" />
                            </View>
                            <Text style={styles.successDesc}>
                                Thank you! Your payment has been processed successfully. Your balance will be updated shortly.
                            </Text>
                            <Pressable
                                onPress={() => setShowSuccessModal(false)}
                                style={[styles.successBtn, { backgroundColor: colorPalette?.primary || '#ef4444' }]}
                            >
                                <Text style={styles.primaryBtnText}>Great!</Text>
                            </Pressable>
                            <View style={styles.spacerLg} />
                        </ScrollView>
                    </Animated.View>
                </View>
            </Modal>

            {/* Invalid Email Error Modal */}
            <Modal
                visible={showEmailErrorModal}
                transparent={true}
                animationType="slide"
                statusBarTranslucent={true}
                onRequestClose={() => setShowEmailErrorModal(false)}
            >
                <View style={styles.modalOverlayDark}>
                    <Pressable style={styles.modalBackdrop} onPress={() => setShowEmailErrorModal(false)} />
                    <Animated.View style={[styles.modalSheet30, { transform: [{ translateY: pan.y }] }]}>
                        <View {...panResponder.panHandlers} style={styles.modalHeader}>
                            <View style={styles.modalHandleSm} />
                            <Text style={[styles.modalTitle, { fontWeight: '700' }]}>Invalid Email Address</Text>
                        </View>
                        <ScrollView contentContainerStyle={styles.modalContentCenter}>
                            <View style={styles.errorCircle}>
                                <AlertCircle size={48} color="#dc2626" />
                            </View>
                            <Text style={styles.successDesc}>
                                Your account does not have a valid email address on file. Please contact support to update your email before making a payment.
                            </Text>
                            <Pressable
                                onPress={() => setShowEmailErrorModal(false)}
                                style={[styles.successBtn, { backgroundColor: colorPalette?.primary || '#ef4444' }]}
                            >
                                <Text style={styles.primaryBtnText}>OK</Text>
                            </Pressable>
                            <View style={styles.spacerLg} />
                        </ScrollView>
                    </Animated.View>
                </View>
            </Modal>
        </View>
    );
};

const styles = StyleSheet.create({
    loadingContainer: { padding: 32, flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f9fafb' },
    container: { flex: 1, backgroundColor: '#f9fafb', position: 'relative' },
    contentGap: { gap: 32 },
    balanceCard: { borderRadius: 24, shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.15, shadowRadius: 16, elevation: 8, backgroundColor: '#ffffff' },
    gradientInner: { borderRadius: 24, paddingHorizontal: 24, position: 'relative', overflow: 'hidden' },
    profileRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    initialsCircle: { backgroundColor: 'rgba(255, 255, 255, 0.15)', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: 'rgba(255, 255, 255, 0.3)' },
    initialsText: { color: '#ffffff', fontWeight: 'bold' },
    customerNameText: { color: '#ffffff', fontWeight: 'bold', textTransform: 'capitalize' },
    customerAccountText: { color: '#e5e7eb', fontSize: 11, opacity: 0.9 },
    billingRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 12 },
    billingLeft: { flex: 1, minWidth: 120 },
    billingRightCol: { alignItems: 'flex-end', gap: 12, flexShrink: 0 },
    dueDateContainer: { alignItems: 'flex-end' },
    balanceLabel: { color: '#e5e7eb', fontSize: 12, marginBottom: 4 },
    balanceAmountText: { fontWeight: 'bold', color: '#ffffff' },
    infoText: { color: '#e5e7eb', fontSize: 12 },
    infoValue: { color: '#ffffff', fontWeight: 'bold', fontSize: 12 },
    // Prepaid remaining-days line under the expiry, on the dark billing card.
    daysLeftText: { color: '#d1d5db', fontSize: 11, marginTop: 2 },
    daysLeftUrgent: { color: '#fca5a5', fontWeight: 'bold' },
    payBtn: { borderWidth: 1, borderColor: '#ffffff', paddingHorizontal: 32, paddingVertical: 10, borderRadius: 12 },
    payBtnInner: { alignItems: 'center' },
    payBtnText: { color: '#ffffff', fontWeight: 'bold', textAlign: 'center' },
    sectionGap: { gap: 16 },
    sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    sectionTitle: { fontSize: 18, fontWeight: 'bold', color: '#111827' },
    referralScroll: { maxHeight: 270 },
    referralContent: { gap: 12, paddingBottom: 8 },
    paymentItem: { 
        flexDirection: 'row', 
        justifyContent: 'space-between', 
        alignItems: 'center', 
        paddingVertical: 14, 
        backgroundColor: 'transparent', 
        borderBottomWidth: 1,
        borderBottomColor: '#f1f5f9'
    },
    paymentRef: { fontSize: 14, fontWeight: '700', color: '#1e293b' },
    paymentDate: { fontSize: 12, color: '#64748b', marginTop: 2 },
    paymentAmountValue: { fontSize: 15, fontWeight: '800', color: '#1e293b', textAlign: 'right' },
    statusBadgeSmall: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, marginTop: 4, alignSelf: 'flex-end' },
    statusTextSmall: { fontSize: 10, fontWeight: '800' },
    alignEnd: { alignItems: 'flex-end' },
    emptyReferrals: { padding: 40, alignItems: 'center', justifyContent: 'center' },
    emptyReferralsText: { color: '#6b7280', fontSize: 14 },
    divider: { height: 2, backgroundColor: '#e2e8f0', marginVertical: 16, width: '80%', alignSelf: 'center', borderRadius: 1 },
    adsWrapper: { gap: 0 },
    adsInner: { position: 'relative' },
    adCard: { height: 140, borderRadius: 24, overflow: 'hidden', justifyContent: 'center', position: 'relative' },
    adContent: { paddingHorizontal: 24, zIndex: 10 },
    adTitle: { color: '#ffffff', fontSize: 20, fontWeight: '900', letterSpacing: -0.5 },
    adDesc: { color: '#ffffff', opacity: 0.85, marginTop: 6, fontSize: 13, lineHeight: 18, fontWeight: '500' },
    adCircle: { position: 'absolute', backgroundColor: '#ffffff', borderRadius: 100 },
    dotsRow: { flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: 14 },
    dotBase: { width: 6, height: 6, borderRadius: 3 },
    // Modal styles
    modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'transparent' },
    modalOverlayDark: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
    modalBackdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
    modalSheet: { backgroundColor: '#ffffff', borderTopLeftRadius: 40, borderTopRightRadius: 40, width: '100%', maxHeight: '90%', shadowColor: '#000', shadowOffset: { width: 0, height: -15 }, shadowOpacity: 1.0, shadowRadius: 40, elevation: 30 },
    modalSheet30: { backgroundColor: '#ffffff', borderTopLeftRadius: 30, borderTopRightRadius: 30, width: '100%', maxHeight: '90%', shadowColor: '#000', shadowOffset: { width: 0, height: -15 }, shadowOpacity: 0.3, shadowRadius: 15, elevation: 20 },
    modalHeader: { paddingHorizontal: 24, paddingVertical: 16, alignItems: 'center', backgroundColor: 'transparent' },
    modalHandleBtn: { width: '100%', alignItems: 'center', paddingVertical: 8 },
    modalHandle: { width: '20%', height: 3, backgroundColor: '#d1d5db', borderRadius: 2, marginBottom: 8 },
    modalHandleSm: { width: 40, height: 4, backgroundColor: '#e5e7eb', borderRadius: 2, marginBottom: 12 },
    modalTitle: { fontSize: 18, fontWeight: 'bold', color: '#111827' },
    modalContent: { padding: 24 },
    modalContentCenter: { padding: 24, alignItems: 'center' },
    verifyBox: { backgroundColor: '#f9fafb', padding: 16, borderRadius: 12, marginBottom: 24, borderWidth: 1, borderColor: '#f3f4f6' },
    verifyRowMb: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 },
    verifyRow: { flexDirection: 'row', justifyContent: 'space-between' },
    verifyLabel: { color: '#6b7280', fontSize: 14 },
    verifyValue: { fontWeight: '600', color: '#111827', fontSize: 14 },
    errorBox: { padding: 12, borderRadius: 8, marginBottom: 24, borderWidth: 1 },
    errorText: { fontSize: 14, textAlign: 'center' },
    inputWrap: { marginBottom: 32 },
    inputLabel: { fontWeight: '500', marginBottom: 8, color: '#374151', fontSize: 14 },
    inputField: { width: '100%', paddingHorizontal: 16, paddingVertical: 12, borderRadius: 8, fontSize: 16, borderWidth: 1, borderColor: '#d1d5db', color: '#111827', backgroundColor: '#ffffff' },
    // Prepaid: the amount is derived from the selected plan, so it reads as locked.
    inputFieldLocked: { backgroundColor: '#f3f4f6', color: '#374151' },
    planWrap: { marginBottom: 20 },
    planTrigger: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderRadius: 8, borderWidth: 1, borderColor: '#d1d5db', backgroundColor: '#ffffff' },
    planTriggerText: { flex: 1, fontSize: 15, color: '#111827', fontWeight: '500' },
    planChevron: { fontSize: 10, color: '#6b7280', marginLeft: 8 },
    planList: { marginTop: 6, borderRadius: 8, borderWidth: 1, borderColor: '#e5e7eb', backgroundColor: '#ffffff', overflow: 'hidden' },
    planOption: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#f3f4f6' },
    planOptionName: { fontSize: 14, color: '#111827', fontWeight: '500' },
    planOptionDesc: { fontSize: 12, color: '#6b7280', marginTop: 2 },
    planOptionPrice: { fontSize: 14, color: '#374151', fontWeight: '700' },
    planLoading: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12 },
    planLoadingText: { marginLeft: 8, fontSize: 14, color: '#6b7280' },
    planEmptyText: { fontSize: 13, color: '#b45309', paddingVertical: 8 },
    planNoteText: { fontSize: 12, color: '#6b7280', marginTop: 8, lineHeight: 17 },
    // Activate Now. Separated from the plan note above by a hairline rule, because ticking it is
    // an irreversible choice and should not read as more of the same explanatory copy.
    activateNowWrap: { marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#e5e7eb' },
    activateNowRow: { flexDirection: 'row', alignItems: 'center' },
    activateNowBox: {
        width: 18, height: 18, borderRadius: 4, borderWidth: 1.5, borderColor: '#9ca3af',
        alignItems: 'center', justifyContent: 'center', marginRight: 8,
    },
    activateNowTick: { color: '#ffffff', fontSize: 12, fontWeight: '700', lineHeight: 14 },
    activateNowLabel: { fontSize: 14, fontWeight: '600', color: '#374151' },
    activateNowHint: { fontSize: 12, color: '#6b7280', marginTop: 6, marginLeft: 26, lineHeight: 17 },
    activateNowWarning: {
        marginTop: 8, borderWidth: 1, borderColor: '#fbbf24', backgroundColor: '#fffbeb',
        borderRadius: 6, paddingHorizontal: 10, paddingVertical: 8,
    },
    activateNowWarningText: { fontSize: 12, color: '#92400e', lineHeight: 17 },
    inputHint: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 8 },
    inputHintText: { fontSize: 12, color: '#6b7280' },
    feeNoteText: { fontSize: 11, color: '#6b7280', marginTop: 8, lineHeight: 16 },
    primaryBtn: { paddingVertical: 12, borderRadius: 50, width: '50%', alignSelf: 'center', alignItems: 'center' },
    primaryBtnText: { color: '#ffffff', fontWeight: 'bold', fontSize: 16 },
    spacer: { height: 24 },
    spacerLg: { height: 40 },
    refRow: { flex: 1, alignItems: 'flex-end', marginLeft: 16 },
    linkDesc: { color: '#4b5563', marginBottom: 24, textAlign: 'center', fontSize: 15 },
    openPortalBtn: { paddingVertical: 12, borderRadius: 50, backgroundColor: '#16a34a', width: '60%', alignSelf: 'center', alignItems: 'center', marginBottom: 16 },
    closeText: { color: '#6b7280', textDecorationLine: 'underline', fontSize: 14, textAlign: 'center' },
    pendingBox: { backgroundColor: '#fef3c7', padding: 16, borderRadius: 12, marginBottom: 24, borderWidth: 1, borderColor: '#fde68a' },
    pendingLabel: { color: '#92400e', fontSize: 14 },
    pendingAmount: { fontWeight: 'bold', color: '#92400e', fontSize: 14 },
    pendingDesc: { color: '#4b5563', marginBottom: 32, textAlign: 'center', fontSize: 15 },
    pendingBtns: { gap: 12 },
    resumeBtn: { paddingVertical: 12, borderRadius: 50, alignItems: 'center' },
    cancelBtn: { paddingVertical: 12, borderRadius: 50, backgroundColor: '#f3f4f6', alignItems: 'center' },
    cancelBtnText: { color: '#111827', fontWeight: 'bold', fontSize: 16 },
    successCircle: { width: 80, height: 80, borderRadius: 40, backgroundColor: '#dcfce7', alignItems: 'center', justifyContent: 'center', marginBottom: 24 },
    errorCircle: { width: 80, height: 80, borderRadius: 40, backgroundColor: '#fee2e2', alignItems: 'center', justifyContent: 'center', marginBottom: 24 },
    successDesc: { fontSize: 16, color: '#4b5563', textAlign: 'center', marginBottom: 32, lineHeight: 22 },
    successBtn: { paddingVertical: 16, borderRadius: 16, width: '100%', alignItems: 'center' },
    kav: { flex: 1, backgroundColor: 'transparent', justifyContent: 'flex-end' },
});

export default DashboardCustomer;
