import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { View, Text, Pressable, TextInput, ScrollView, Alert, Linking, useWindowDimensions, Modal, PanResponder, Animated, RefreshControl, KeyboardAvoidingView, Platform, StyleSheet, DeviceEventEmitter } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import * as LinkingExpo from 'expo-linking';
import { User, Activity, Clock, Users, FileText, CheckCircle, HelpCircle, RefreshCcw, AlertCircle } from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { paymentService, PendingPayment } from '../services/paymentService';
import { useCustomerDataContext } from '../contexts/CustomerDataContext';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import { reportClientEvent } from '../services/clientLogService';
import { SESSION_EXPIRED_EVENT } from '../config/api';

/**
 * A pulsing placeholder block.
 *
 * Rendered instead of a number that has not arrived. The balance card would otherwise
 * show a confident zero while the request is still in flight, which reads as "you owe
 * nothing" rather than "not loaded yet".
 */
const Skeleton: React.FC<{
  width: number | string;
  height: number;
  radius?: number;
  light?: boolean;
  style?: any;
}> = ({ width, height, radius = 8, light = false, style }) => {
  const pulse = React.useRef(new Animated.Value(0.35)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.85, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.35, duration: 700, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  return (
    <Animated.View
      accessibilityLabel="Loading"
      style={[
        {
          width: width as any,
          height,
          borderRadius: radius,
          backgroundColor: light ? 'rgba(255,255,255,0.35)' : '#e5e7eb',
          opacity: pulse,
        },
        style,
      ]}
    />
  );
};

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
    // paySummary and its own flag rather than contextLoading: the amount due comes from a
    // dedicated one-row request, so it must not wait on the list calls this card does
    // not render.
    const {
        customerDetail,
        paySummary,
        isPaySummaryLoading,
        isFromCache,
        payments,
        invoiceRecords,
        isLoading: contextLoading,
        hasAttemptedLoad,
        silentRefresh,
    } = useCustomerDataContext();
    const [user, setUser] = useState<any>(null);

    // An expired session is not a balance failure.
    //
    // Customers routinely stay signed in between visits rather than logging out, so a
    // stale token is an ordinary state here. Every staff page in this app already
    // watches the fetch error for an auth failure and offers a re-login; this page,
    // the only customer-facing one, did not — so a customer whose token had lapsed sat
    // on a dashboard reading unavailable, with a Pay Now that could never work and
    // nothing telling them to sign in again, while each visit filed a
    // balance-unavailable report against what was really an authentication fault.
    //
    // Detected from SESSION_EXPIRED_EVENT rather than from contextError, because the
    // message this used to search was never going to contain what it was looking for.
    // getCustomerDetail and getCustomerPaySummary each swallow their own failure and
    // return null, so a 401 never reached the context as a status — it re-threw
    // 'Could not fetch customer details', this test for '401' failed, and a customer
    // with an expired token got a balance card reading Unavailable with their name and
    // account number still showing from the stale authData behind it. The interceptor
    // is the only place that still has the status, so that is where the event is raised.
    //
    // The modal itself now lives in App.tsx: the credential belongs to the app, not to
    // this screen, and the old handler here only removed authData — which left the app
    // sitting on a dashboard it could not load until it was restarted, instead of
    // returning to the login screen.
    //
    // The ref exists as well as the state because the suppression below must not depend
    // on render timing: the interceptor emits synchronously as the 401 arrives, which is
    // before the rejection reaches the context and clears its loading flags.
    const [showSessionExpired, setShowSessionExpired] = useState(false);
    const sessionExpiredRef = React.useRef(false);
    useEffect(() => {
        const subscription = DeviceEventEmitter.addListener(SESSION_EXPIRED_EVENT, () => {
            sessionExpiredRef.current = true;
            setShowSessionExpired(true);
        });

        return () => subscription.remove();
    }, []);

    const [isPaymentProcessing, setIsPaymentProcessing] = useState<boolean>(false);
    const [showPaymentVerifyModal, setShowPaymentVerifyModal] = useState<boolean>(false);
    const [paymentAmount, setPaymentAmount] = useState<number>(0);

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
    // "No Plan" is a claim about the account, so it is only said once the record is
    // actually here. Every customer in the database has a plan; a blank one meant the
    // fetch had not landed, and the surrounding fields kept looking right because they
    // fall back to stored authData rather than to this record.
    const planKnown = !!customerDetail;
    const planName = customerDetail?.desiredPlan || 'No Plan';
    const address = customerDetail?.address || 'No Address';
    const installationDate = customerDetail?.billingAccount?.dateInstalled || 'Pending';
    // The pay-summary first, the full detail only as a fallback for when that request
    // fails. Losing the fast path should cost speed, not the ability to pay.
    const rawBalance = paySummary
        ? paySummary.accountBalance
        : customerDetail?.billingAccount?.accountBalance;
    const balance = Number(rawBalance) || 0;

    // A settled account legitimately reads 0, so only a missing/unparsable value counts
    // as "not loaded yet". `|| 0` collapsed the two, which is what rendered a confident
    // zero while the request was still in flight.
    const balanceKnown = rawBalance !== null && rawBalance !== undefined
        && String(rawBalance).trim() !== '' && !isNaN(Number(rawBalance));

    // Showing a figure and charging against it are different bars. A balance restored from
    // the last visit is worth reading — far better than a skeleton on a phone connection —
    // but it may have moved since, so Pay Now stays locked until the server confirms it.
    //
    // Gated on the pay-summary alone, deliberately not on contextLoading as well: making
    // the button wait for the whole batch is exactly what it used to do, and a slow SOA or
    // service-order call (neither of which this card renders) kept the amount due
    // shimmering and the button reading '...'.
    const balanceConfirmed = balanceKnown && !isPaySummaryLoading && !isFromCache;

    // Still on the restored snapshot after the request finished, which means it did not
    // land. Distinguished from "still arriving" so the card can offer a retry instead of
    // sitting on a cached figure claiming to be checking for updates forever.
    const revalidateInFlight = isFromCache && isPaySummaryLoading;
    const revalidateFailed = isFromCache && !isPaySummaryLoading;

    // Nothing is in flight any more and still no figure arrived.
    //
    // The skeleton below used to be the only alternative to a known balance, so a
    // pay-summary that resolved with an empty body — which records no error, the store
    // just clears its loading flag — left the amount shimmering for good on a fast
    // connection with every request long finished. Once nothing is loading, none is
    // coming: say so, and let the customer pull to refresh rather than watch an
    // animation that will never resolve.
    //
    // Gated on hasAttemptedLoad as well, because "settled" has to mean the requests RAN
    // and finished — not merely that none is in flight. Both loading flags read false
    // before the first fetch is issued too, so without this the card reports a failed
    // load on its first render, before it has asked for anything. That the pay-summary
    // flag happens to start true is what has been hiding it here; the web dashboard,
    // whose store starts both flags false, logged balance-unavailable with accountNo
    // 'unknown' and error 'none' on every single visit. Not worth leaving to chance.
    const balanceRequestsSettled = hasAttemptedLoad && !isPaySummaryLoading && !contextLoading;
    const balanceUnavailable = !balanceKnown && balanceRequestsSettled;

    // Report the outcome the customer actually sees.
    //
    // The service reports why each individual request failed; this reports that
    // the card gave up, which is the thing being complained about and is not the
    // same fact — the balance can also go missing with every request apparently
    // fine, and only this would catch that. Once per session per account, so a
    // re-render cannot turn it into a stream.
    useEffect(() => {
        // Not when the session is what failed: the modal is the right handling, and
        // filing it here would put an auth event in customer-dashboard.log under a
        // billing heading — the exact noise this report exists to cut through.
        if (balanceUnavailable && !sessionExpiredRef.current) {
            reportClientEvent('balance-unavailable', {
                accountNo: paySummary?.accountNo
                    || customerDetail?.billingAccount?.accountNo
                    || user?.username
                    || 'unknown',
                hadDetail: String(!!customerDetail),
                hadPaySummary: String(!!paySummary),
                fromCache: String(isFromCache),
                rawBalance: rawBalance === null || rawBalance === undefined
                    ? 'missing'
                    : String(rawBalance),
            });
        }
    }, [balanceUnavailable, showSessionExpired, customerDetail, paySummary, isFromCache, rawBalance, user]);

    // The summary's flag is what labels the button on load; the fuller pendingPayment
    // object only exists once Pay Now has been tapped and fetched the payment URL.
    const hasPendingPayment = !!pendingPayment?.payment_url || !!paySummary?.hasPendingPayment;

    // An outstanding (positive) balance must be settled in full, so Pay Now is pinned to the
    // balance and locked. At zero or on a credit balance the customer chooses the amount.
    const isBalancePositive = balance > 0;
    const usageType = customerDetail?.technicalDetails?.usageType || 'N/A';
    const emailAddress = customerDetail?.emailAddress || user?.email || 'N/A';

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
    // Prefer the real due date stored on the latest invoice. The pay-summary carries it,
    // read on the server off the newest invoice with the same `invoice_date desc` ordering
    // the list endpoint uses — the same date, one row instead of the account's entire
    // invoice history. The list stays as the fallback for when that request fails.
    //
    // Only fall back to deriving it from the billing day when the account has no invoice.
    const latestInvoiceDueDate = formatDbDate(
        paySummary ? paySummary.dueDate : invoiceRecords?.[0]?.due_date
    );
    const billingDayForDueDate = paySummary
        ? paySummary.billingDay
        : customerDetail?.billingAccount?.billingDay;
    if (latestInvoiceDueDate) {
        dueDateString = latestInvoiceDueDate;
    } else if (billingDayForDueDate) {
        const today = new Date();
        const billingDay = billingDayForDueDate;

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

            // No pending-payment request here any more. The pay-summary carries
            // `hasPendingPayment`, which is all the button label needs, and handlePayNow
            // already re-checks for the payment URL when it is tapped — so this was a whole
            // extra round trip on the launch path to decide one word of button text.
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

    // Keep Pay Now aligned with the balance whenever it changes — first load, a pull-to-refresh,
    // or a live balance update — so the locked field is never stale. Declared above the loading
    // early-return below to keep a fixed position in the hook order (rules-of-hooks).
    useEffect(() => {
        if (isBalancePositive) {
            setPaymentAmount(balance);
        }
    }, [balance, isBalancePositive]);

    // Nothing at all yet: no response, and no snapshot from a previous launch. Laid out as
    // skeletons rather than a bare spinner so the balance card never appears with a
    // placeholder figure in it.
    //
    // paySummary counts as something to show, and that matters: it is the faster of the
    // two requests, so gating this on customerDetail alone would keep the skeleton up over
    // a balance that had already arrived — throwing away the point of splitting them.
    if (!customerDetail && !paySummary && (contextLoading || isPaySummaryLoading)) return (
        <View style={{ flex: 1, backgroundColor: '#f9fafb', padding: 16, paddingTop: 60 }}>
            <View style={{ borderRadius: 20, backgroundColor: '#111827', padding: 20, gap: 12 }}>
                <Skeleton light width={120} height={12} />
                <Skeleton light width={180} height={40} radius={10} />
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Skeleton light width={110} height={12} radius={6} />
                    <Skeleton light width={96} height={34} radius={17} />
                </View>
            </View>

            <View style={{ marginTop: 24, gap: 12 }}>
                <Skeleton width={140} height={14} />
                {[0, 1, 2].map((i) => (
                    <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                        <View style={{ gap: 6 }}>
                            <Skeleton width={180} height={12} />
                            <Skeleton width={120} height={10} />
                        </View>
                        <Skeleton width={70} height={14} />
                    </View>
                ))}
            </View>
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
        //
        // Only when the customer record is actually here to judge from. The balance now
        // arrives on its own request, so Pay Now can be tapped before the detail response
        // lands — and emailAddress falls back to the session's email, which comes from the
        // users table while the address Xendit is given comes from the customers table.
        // The two can differ, so refusing on the fallback would accuse an account that has
        // a perfectly good email of not having one. Unknown is not the same as invalid:
        // let it through and let the backend, which validates this anyway, be the judge.
        if (customerDetail && !isValidEmail(emailAddress)) {
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
                setPaymentAmount(balance);
                setShowPaymentVerifyModal(true);
            }
        } catch (error: any) {
            console.error('Error checking pending payment:', error);
            setPaymentAmount(balance);
            setShowPaymentVerifyModal(true);
        } finally {
            setIsPaymentProcessing(false);
        }
    };

    function handleCloseVerifyModal() {
        setShowPaymentVerifyModal(false);
        setPaymentAmount(balance);
    };

    const handleProceedToCheckout = async () => {
        // Guard again at the point of payment in case the verify modal was reached
        // without a valid email on file.
        if (!isValidEmail(emailAddress)) {
            setShowPaymentVerifyModal(false);
            setShowEmailErrorModal(true);
            return;
        }

        if (paymentAmount < balance) {
            setErrorMessage(`Payment amount must be at least your current balance of ₱${formatCurrency(balance)}`);
            return;
        }

        if (isPaymentProcessing) return;

        setIsPaymentProcessing(true);
        setErrorMessage('');

        try {
            const redirectUrl = LinkingExpo.createURL('payment-success');
            const response = await paymentService.createPayment(accountNo, paymentAmount, redirectUrl);

            if (response.status === 'success' && response.payment_url) {
                setShowPaymentVerifyModal(false);
                setPaymentLinkData({
                    referenceNo: response.reference_no || '',
                    amount: response.amount || paymentAmount,
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
                                        {balanceKnown && revalidateFailed ? (
                                            <Pressable onPress={() => { silentRefresh(); }} accessibilityRole="button">
                                                <Text allowFontScaling={false} style={styles.staleHintText}>
                                                    Last known balance — tap to retry
                                                </Text>
                                            </Pressable>
                                        ) : balanceKnown && revalidateInFlight ? (
                                            <Text allowFontScaling={false} style={styles.staleHintText}>
                                                Last known balance — updating…
                                            </Text>
                                        ) : null}
                                        {balanceKnown ? (
                                            <Text
                                                numberOfLines={1}
                                                adjustsFontSizeToFit
                                                minimumFontScale={0.5}
                                                allowFontScaling={false}
                                                style={[styles.balanceAmountText, { fontSize: balance >= 1000 ? (isMobile ? (isShort ? 28 : 32) : 44) : (isMobile ? (isShort ? 36 : 40) : 56) }]}
                                            >
                                                {formatCurrency(balance)}
                                            </Text>
                                        ) : balanceUnavailable ? (
                                            // Every request has finished without a figure.
                                            // A shimmer here would never resolve.
                                            <Text
                                                numberOfLines={1}
                                                allowFontScaling={false}
                                                style={[styles.balanceAmountText, { fontSize: isShort ? 20 : 24 }]}
                                            >
                                                Unavailable
                                            </Text>
                                        ) : (
                                            <Skeleton light width={isShort ? 150 : 180} height={isShort ? 34 : 42} radius={10} style={{ marginTop: 4 }} />
                                        )}
                                    </View>

                                    <View style={styles.billingRightCol}>
                                        <View style={styles.dueDateContainer}>
                                            {balanceKnown ? (
                                                <Text allowFontScaling={false} style={styles.infoText}>Due Date: <Text allowFontScaling={false} style={styles.infoValue}>{dueDateString}</Text></Text>
                                            ) : balanceUnavailable ? (
                                                // Same reasoning as the amount above: a
                                                // shimmer with nothing left in flight
                                                // never resolves.
                                                <Text allowFontScaling={false} style={styles.infoText}>Due Date: <Text allowFontScaling={false} style={styles.infoValue}>—</Text></Text>
                                            ) : (
                                                <Skeleton light width={110} height={12} radius={6} />
                                            )}
                                        </View>

                                        <Pressable
                                            onPress={handlePayNow}
                                            disabled={isPaymentProcessing || !balanceConfirmed}
                                            style={[styles.payBtn, { opacity: (isPaymentProcessing || !balanceConfirmed) ? 0.5 : 1 }]}
                                        >
                                            <View style={styles.payBtnInner}>
                                                <Text style={styles.payBtnText}>
                                                    {(!balanceConfirmed || isPaymentProcessing) ? '...' : (hasPendingPayment ? 'Proceed' : 'Pay Now')}
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
                                            {planKnown ? (
                                                <Text style={{ color: '#ffffff', fontSize: 18, fontWeight: '700' }}>{planName}</Text>
                                            ) : (
                                                <Skeleton light width={120} height={18} radius={6} />
                                            )}
                                        </View>
                                        <View style={{ flex: 1, alignItems: 'flex-end' }}>
                                            <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 12, marginBottom: 4 }}>Usage Type</Text>
                                            <Text style={{ color: '#ffffff', fontSize: 18, fontWeight: '700' }}>{usageType}</Text>
                                        </View>
                                    </View>
                                </View>
                            )}
                        </LinearGradient>
                    </Animated.View>




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
                                    {balanceConfirmed ? (
                                        <Text style={[styles.verifyValue, { fontWeight: 'bold', color: balance > 0 ? (colorPalette?.primary || '#ef4444') : '#16a34a' }]}>
                                            {formatCurrency(balance)}
                                        </Text>
                                    ) : (
                                        <Skeleton width={90} height={14} radius={6} />
                                    )}
                                </View>
                            </View>

                            {errorMessage && (
                                <View style={[styles.errorBox, { backgroundColor: (colorPalette?.primary || '#ef4444') + '15', borderColor: (colorPalette?.primary || '#ef4444') + '30' }]}>
                                    <Text style={[styles.errorText, { color: colorPalette?.primary || '#ef4444' }]}>{errorMessage}</Text>
                                </View>
                            )}

                            <View style={styles.inputWrap}>
                                <Text style={styles.inputLabel}>Payment Amount</Text>
                                <TextInput
                                    keyboardType="decimal-pad"
                                    value={paymentAmount !== undefined && paymentAmount !== null ? paymentAmount.toString() : ''}
                                    editable={!isBalancePositive}
                                    onChangeText={(value) => {
                                        // Locked to the outstanding balance; ignore any edit attempt.
                                        if (isBalancePositive) return;

                                        if (value === '' || /^-?\d*\.?\d*$/.test(value)) {
                                            const amount = value === '' || value === '-' ? 0 : parseFloat(value) || 0;
                                            setPaymentAmount(amount);

                                            if (balance > 0 && amount < balance) {
                                                setErrorMessage(`Payment amount must be at least your current balance of ${formatCurrency(balance)}`);
                                            } else {
                                                setErrorMessage('');
                                            }
                                        }
                                    }}
                                    placeholder="0.00"
                                    style={[styles.inputField, isBalancePositive && styles.inputFieldReadOnly]}
                                />
                                <View style={styles.inputHint}>
                                    <Text style={styles.inputHintText}>
                                        {isBalancePositive ? `Outstanding: ${formatCurrency(balance)} — full amount required` : 'Minimum: ₱1.00'}
                                    </Text>
                                </View>
                            </View>

                            <Pressable
                                onPress={handleProceedToCheckout}
                                disabled={!balanceConfirmed || isPaymentProcessing || paymentAmount < 1 || (balance > 0 && paymentAmount < balance)}
                                style={[styles.primaryBtn, {
                                    backgroundColor: colorPalette?.primary || '#ef4444',
                                    opacity: (!balanceConfirmed || isPaymentProcessing || paymentAmount < 1) ? 0.5 : 1,
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
                                    <Text style={[styles.verifyValue, { fontWeight: 'bold', color: colorPalette?.primary || '#ef4444' }]}>
                                        {formatCurrency(paymentLinkData?.amount || 0)}
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
                                    <Text style={styles.pendingAmount}>
                                        {formatCurrency(pendingPayment?.amount || 0)}
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
    staleHintText: { color: 'rgba(255,255,255,0.7)', fontSize: 11, marginTop: 2 },
    balanceLabel: { color: '#e5e7eb', fontSize: 12, marginBottom: 4 },
    balanceAmountText: { fontWeight: 'bold', color: '#ffffff' },
    infoText: { color: '#e5e7eb', fontSize: 12 },
    infoValue: { color: '#ffffff', fontWeight: 'bold', fontSize: 12 },
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
    inputFieldReadOnly: { backgroundColor: '#f3f4f6', color: '#4b5563' },
    inputHint: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 8 },
    inputHintText: { fontSize: 12, color: '#6b7280' },
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
