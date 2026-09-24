import React, { useState, useEffect, useRef } from 'react';
import { User, Activity, Clock, Users, CreditCard, HelpCircle, FileText, CheckCircle, XCircle } from 'lucide-react';
import { getCustomerDetail, CustomerDetailData } from '../services/customerDetailService';
import { transactionService } from '../services/transactionService';
import { paymentPortalLogsService } from '../services/paymentPortalLogsService';
import { paymentService, PendingPayment } from '../services/paymentService'; // Import paymentService
import { useCustomerDashboardStore } from '../store/customerDashboardStore';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import { planService, Plan } from '../services/planService';
import pusher from '../services/pusherService';

// Interfaces for data types
interface Payment {
    id: string;
    date: string;
    reference: string;
    amount: number;
    source: string;
}

interface Referral {
    id: string;
    date: string;
    name: string;
    stage: string;
    status: 'Done' | 'Failed' | 'Scheduled' | 'Pending';
}

interface DashboardCustomerProps {
    onNavigate?: (section: string, tab?: string) => void;
    autoOpenPayModal?: boolean;
}

const DashboardCustomer: React.FC<DashboardCustomerProps> = ({ onNavigate, autoOpenPayModal }) => {
    const [user, setUser] = useState<any>(null);
    const [error, setError] = useState('');

    const { customerDetail, paymentRecords, invoiceRecords, isLoading, fetchCustomerData } = useCustomerDashboardStore();
    const payments = paymentRecords.slice(0, 4);
    const [referrals, setReferrals] = useState<Referral[]>([]);

    // Payment State
    const [isPaymentProcessing, setIsPaymentProcessing] = useState<boolean>(false);
    const [showPaymentVerifyModal, setShowPaymentVerifyModal] = useState<boolean>(false);
    const [paymentAmount, setPaymentAmount] = useState<number>(0);
    const [showPaymentLinkModal, setShowPaymentLinkModal] = useState<boolean>(false);
    const [paymentLinkData, setPaymentLinkData] = useState<{ referenceNo: string; amount: number; paymentUrl: string } | null>(null);
    const [showPendingPaymentModal, setShowPendingPaymentModal] = useState<boolean>(false);
    const [pendingPayment, setPendingPayment] = useState<PendingPayment | null>(null);
    const [errorMessage, setErrorMessage] = useState<string>('');
    const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
    const [showPaymentSuccessModal, setShowPaymentSuccessModal] = useState<boolean>(false);

    // Prepaid plan selection. A prepaid customer buys a service period at a plan's price, so the
    // plan and the amount are two views of one choice — postpaid never sees any of this.
    const [plans, setPlans] = useState<Plan[]>([]);
    const [isLoadingPlans, setIsLoadingPlans] = useState<boolean>(false);
    const [selectedPlanId, setSelectedPlanId] = useState<number | null>(null);
    const [isPlanListOpen, setIsPlanListOpen] = useState<boolean>(false);
    // Prepaid onboarding re-price: a customer who has not paid their first bill yet may still swap
    // plan, which re-prices that unpaid bill. The server quotes the real amount (plan + VAT −
    // withholding) so the tax maths is never duplicated here. null = not in that window.
    const [onboardingQuoteAmount, setOnboardingQuoteAmount] = useState<number | null>(null);
    const [isQuotingPlan, setIsQuotingPlan] = useState<boolean>(false);
    // Whether this account is in that window at all. Resolved when the modal opens, BEFORE any
    // plan is picked — the cheaper plans have to be clickable for a quote to ever happen, so this
    // cannot be inferred from a quote that only arrives after a click.
    const [canRepriceOnboarding, setCanRepriceOnboarding] = useState<boolean>(false);
    // Prepaid-only: "Pay Current Balance" mode — settle the outstanding balance directly
    // instead of buying a plan/plan-change (no plan_id is sent when this is on).
    const [payCurrentBalance, setPayCurrentBalance] = useState<boolean>(false);
    // Prepaid-only: start the newly bought plan immediately, forfeiting the days remaining on the
    // current one, instead of queueing the switch for when the period lapses. Opt-in, and only
    // ever offered when there is actually something to forfeit — see canActivateNow.
    const [activateNow, setActivateNow] = useState<boolean>(false);
    // Convenience fee rate the ISP adds on top of an online payment (2.5 = 2.5%). Disclosed under
    // the amount field so the customer is not surprised by a higher total at the gateway. 0 = none.
    const [convenienceFeePercentage, setConvenienceFeePercentage] = useState<number>(0);

    useEffect(() => {
        const fetchData = async () => {
            try {
                const storedUser = localStorage.getItem('authData');
                if (storedUser) {
                    const parsedUser = JSON.parse(storedUser);
                    setUser(parsedUser);

                    if (parsedUser.username) {
                        await fetchCustomerData(parsedUser.username, true);

                        // Need the current updated customer details for account number to get pending payment
                        const updatedDetail = useCustomerDashboardStore.getState().customerDetail;
                        if (updatedDetail && updatedDetail.billingAccount) {
                            try {
                                const accNo = updatedDetail.billingAccount.accountNo;
                                const pending = await paymentService.checkPendingPayment(accNo);
                                setPendingPayment(pending);
                            } catch (pendingErr) {
                                console.error("Error checking pending payment on load", pendingErr);
                            }
                        }
                    }
                }
            } catch (err) {
                console.error("Error fetching dashboard data:", err);
                setError('Failed to load dashboard data');
            }
        };

        const fetchColorPalette = async () => {
            try {
                const activePalette = await settingsColorPaletteService.getActive();
                setColorPalette(activePalette);
            } catch (err) {
                console.error('Failed to fetch color palette:', err);
            }
        };

        const fetchConvenienceFee = async () => {
            const percentage = await paymentService.getConvenienceFeePercentage();
            setConvenienceFeePercentage(percentage);
        };

        fetchData();
        fetchColorPalette();
        fetchConvenienceFee();
    }, [fetchCustomerData]);

    // Handle auto-opening the pay modal (e.g., from Bills page)
    useEffect(() => {
        if (autoOpenPayModal && !isLoading && customerDetail) {
            handlePayNow();
        }
    }, [autoOpenPayModal, isLoading, customerDetail]);

    // Real-time updates via Pusher/Soketi
    useEffect(() => {
        const handleUpdate = async (data: any) => {
            try {
                const storedUser = localStorage.getItem('authData');
                if (storedUser) {
                    const parsedUser = JSON.parse(storedUser);
                    if (parsedUser.username) {
                        await fetchCustomerData(parsedUser.username, true);
                    }
                }
            } catch (err) {
                console.error('[DashboardCustomer Soketi] Failed to refresh data:', err);
            }
        };

        const handlePaymentUpdate = async (data: any) => {
            // Show success modal when a webhook confirms payment for this account
            if (data?.action === 'webhook_update' && data?.status === 'QUEUED' && data?.reference_no) {
                const currentAccountNo = customerDetail?.billingAccount?.accountNo;
                if (currentAccountNo && data.reference_no.startsWith(currentAccountNo)) {
                    setShowPaymentSuccessModal(true);
                    setPendingPayment(null);
                }
            }
            await handleUpdate(data);
        };

        const txChannel = pusher.subscribe('transactions');
        const invChannel = pusher.subscribe('invoices');
        const soaChannel = pusher.subscribe('soa');
        const payChannel = pusher.subscribe('payments');

        txChannel.bind('transaction-updated', handleUpdate);
        invChannel.bind('invoice-updated', handleUpdate);
        soaChannel.bind('soa-updated', handleUpdate);
        payChannel.bind('payment-updated', handlePaymentUpdate);

        return () => {
            txChannel.unbind('transaction-updated', handleUpdate);
            invChannel.unbind('invoice-updated', handleUpdate);
            soaChannel.unbind('soa-updated', handleUpdate);
            payChannel.unbind('payment-updated', handlePaymentUpdate);
            pusher.unsubscribe('transactions');
            pusher.unsubscribe('invoices');
            pusher.unsubscribe('soa');
            pusher.unsubscribe('payments');
        };
    }, [fetchCustomerData, customerDetail?.billingAccount?.accountNo]);

    // Load the plan list once, only for prepaid customers — postpaid never sees the picker.
    // Lives above the early return because it is a hook; isPrepaid is re-derived from the store
    // here rather than reusing the const further down, which is computed after that return.
    // Gated on a ref, not on plans.length: an empty or all-zero-price response would otherwise
    // leave the guard false and re-trigger this effect forever.
    const plansRequestedRef = useRef(false);
    useEffect(() => {
        const prepaid = String(customerDetail?.billingAccount?.generation_type ?? '')
            .toLowerCase().replace(/[^a-z]/g, '') === 'prepaid';
        if (!prepaid || plansRequestedRef.current) return;
        plansRequestedRef.current = true;
        let cancelled = false;
        (async () => {
            setIsLoadingPlans(true);
            try {
                const fetched = await planService.getAllPlans();
                if (!cancelled) setPlans(fetched.filter(p => Number(p.price) > 0));
            } catch (err) {
                console.error('Failed to load plans:', err);
            } finally {
                if (!cancelled) setIsLoadingPlans(false);
            }
        })();
        return () => { cancelled = true; };
    }, [customerDetail?.billingAccount?.generation_type]);

    if (isLoading && !customerDetail) return <div className="p-8 flex justify-center bg-gray-50 min-h-screen"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div></div>;

    const getStatusColor = (status: string) => {
        switch (status) {
            case 'Done': return 'bg-green-100 text-green-600 border border-green-200';
            case 'Failed': return 'bg-red-100 text-red-600 border border-red-200';
            case 'Scheduled': return 'bg-yellow-100 text-yellow-600 border border-yellow-200';
            default: return 'bg-gray-100 text-gray-600';
        }
    };

    // Use detailed data if available, otherwise fall back to auth data or placeholders
    const displayName = customerDetail?.fullName || user?.full_name || 'Customer';
    const accountNo = customerDetail?.billingAccount?.accountNo || user?.username || 'N/A';
    const planName = customerDetail?.desiredPlan || 'No Plan';
    const address = customerDetail?.address || 'No Address';
    const installationDate = customerDetail?.billingAccount?.dateInstalled || 'Pending';

    // Prepaid vs postpaid drives how the balance is treated (and, further down, the due-date card).
    // Letters-only compare so a row still holding the older 'Pre Paid' also resolves.
    const isPrepaid = String(customerDetail?.billingAccount?.generation_type ?? '')
        .toLowerCase().replace(/[^a-z]/g, '') === 'prepaid';

    // A prepaid customer never carries a negative (credit) balance: paying only extends the
    // prepaid period, it does not bank a credit, so a fully-paid prepaid account reads as 0 —
    // never a negative overpayment. Postpaid / blank generation_type keep the real balance
    // (including any negative credit from overpayment), which is the existing behaviour.
    const rawBalance = customerDetail?.billingAccount?.accountBalance || 0;
    const balance = isPrepaid ? Math.max(0, rawBalance) : rawBalance;

    // ── Prepaid plan selection ────────────────────────────────────────────────────────────────
    // Plain consts and functions rather than useMemo/useCallback: this runs after the early
    // return above, where a hook would break the rules of hooks. Mirrors the mobile app so both
    // clients price a prepaid payment identically.
    const pendingPlanId = customerDetail?.billingAccount?.pending_plan_id ?? null;
    const pendingPlanName = customerDetail?.billingAccount?.pending_plan_name || null;
    const pendingPlanEffectiveAt = customerDetail?.billingAccount?.pending_plan_effective_at || null;

    // Mirrors the backend's extractPlanName(): the plan name is the first token, before any
    // ' - ' separator or space. Keeps "which plan am I on" consistent with what billing resolves.
    const extractPlanName = (raw?: string | null): string => {
        if (!raw) return '';
        let value = String(raw);
        if (value.includes(' - ')) value = value.split(' - ')[0].trim();
        if (value.includes(' ')) return value.split(' ')[0].trim();
        return value.trim();
    };

    const currentPlan = plans.find(p => p.name === extractPlanName(planName)) || null;
    const selectedPlan = plans.find(p => p.id === selectedPlanId) || null;
    // A switch already paid for and waiting. It takes priority when preselecting, so a top-up is
    // priced at the plan the customer will actually be on rather than the one they are leaving.
    const pendingPlan = pendingPlanId ? plans.find(p => p.id === Number(pendingPlanId)) || null : null;

    /**
     * Partial payments are not accepted. An outstanding balance has to be cleared in full, so the
     * amount is pinned rather than merely validated:
     *
     *  - Postpaid: the amount IS the balance, and the field is read-only.
     *  - Prepaid : the amount comes from the plan picker (so a plan change is still a payment),
     *              but the chosen plan's price has to cover the balance. A cheaper plan is
     *              rejected; the same or a dearer one is fine.
     *
     * Neither applies while nothing is owed — a zero/credit balance keeps the ₱1 floor only.
     */
    const requiresExactPayment = !isPrepaid && balance > 0;
    // A quoted onboarding re-price REPLACES the outstanding balance rather than paying it off, so
    // the "plan must cover the balance" floor does not apply — that is exactly what lets a
    // first-time customer move to a cheaper plan before they have paid anything.
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
    // No padding to 2 dp: 922.5 stays 922.5. Capped at 2 dp only because the fee above is already
    // rounded to centavos, so nothing here is ever actually rounded away.
    const formatPeso = (value: number) => value.toLocaleString('en-PH', { maximumFractionDigits: 2 });
    // Trailing zeros trimmed so 2.50 reads as "2.5%".
    const convenienceFeeLabel = String(Number(convenienceFeePercentage));

    // Due Date: read from the latest invoice's due_date (not recalculated from billingDay)
    let dueDateString = 'Upon Receipt';
    if (invoiceRecords && invoiceRecords.length > 0) {
        const latestInvoice = invoiceRecords[0]; // already sorted by date descending from the store
        const rawDueDate = latestInvoice.due_date;
        if (rawDueDate) {
            const parsed = new Date(rawDueDate);
            if (!isNaN(parsed.getTime())) {
                dueDateString = parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
            }
        }
    }

    // ── Prepaid: the card shows the end of the paid period, not an invoice due date ──────────
    // A prepaid customer's service is governed by prepaid_expires_at, so an invoice due date is
    // meaningless to them. Plain consts rather than useMemo: this runs after the early return
    // above, where a hook would break the rules of hooks.
    // (isPrepaid is computed above, next to the balance.)
    const prepaidExpiresAt = customerDetail?.billingAccount?.prepaid_expires_at || null;

    let prepaidDaysLeft: number | null = null;
    let prepaidExpiryString: string | null = null;
    if (isPrepaid && prepaidExpiresAt) {
        const expiry = new Date(String(prepaidExpiresAt).replace(' ', 'T'));
        if (!isNaN(expiry.getTime())) {
            prepaidExpiryString = expiry.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
            // Rounded UP, so any remaining part of a day still reads as "1 day left", not 0.
            prepaidDaysLeft = Math.ceil((expiry.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
        }
    }

    // Whether the paid-for period is still running. This is what makes a plan change QUEUE rather
    // than apply immediately, so the confirm-payment modal can say which will happen.
    const isPrepaidPeriodActive = prepaidDaysLeft !== null && prepaidDaysLeft > 0;

    /**
     * Whether "Activate Now" is worth offering.
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
    const canActivateNow = isPrepaid
        && !payCurrentBalance
        && isPrepaidPeriodActive
        && !!selectedPlan
        && !!currentPlan
        && selectedPlan.id !== currentPlan.id;

    const dueDateLabel = isPrepaid ? 'Expires' : 'Due';
    const dueDateValue = isPrepaid ? (prepaidExpiryString ?? 'Not started') : dueDateString;
    // null when there is nothing meaningful to say (postpaid, or a prepaid clock not yet started).
    const prepaidDaysLeftText = prepaidDaysLeft === null
        ? null
        : prepaidDaysLeft <= 0
            ? 'Expired'
            : `${prepaidDaysLeft} ${prepaidDaysLeft === 1 ? 'day' : 'days'} left`;

    // Restriction logic removed as requested

    /** MM/DD/YYYY from a stored date string, read part-wise to avoid a timezone day-shift. */
    const formatDbDate = (raw?: string | null): string => {
        if (!raw) return '';
        const match = String(raw).match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (match) return `${match[2]}/${match[3]}/${match[1]}`;
        const parsed = new Date(String(raw));
        return isNaN(parsed.getTime()) ? String(raw) : parsed.toLocaleDateString('en-US');
    };

    /**
     * Open the confirm-payment modal with the right starting amount.
     *
     * Prepaid: preselect the plan they will actually be on and set the amount to that plan's price.
     * A queued switch wins over the plan currently in force — the customer has already bought it,
     * so a top-up must be priced at that plan, not the one being replaced.
     * Postpaid: the amount starts at (and stays) the outstanding balance.
     */
    const openVerifyModal = async () => {
        setOnboardingQuoteAmount(null);
        setCanRepriceOnboarding(false);

        let preselected: Plan | null = null;
        if (isPrepaid) {
            preselected = pendingPlan ?? currentPlan ?? plans[0] ?? null;
            setSelectedPlanId(preselected?.id ?? null);
            setPaymentAmount(Number(preselected?.price ?? 0));
        } else {
            setPaymentAmount(Math.abs(balance));
        }
        setPayCurrentBalance(false);
        setIsPlanListOpen(false);
        setShowPaymentVerifyModal(true);

        // Resolve up front whether this is an unpaid first bill that can be re-priced. Without
        // this, every plan cheaper than the balance would render disabled and the customer could
        // never click one to find out.
        if (isPrepaid && preselected) {
            setIsQuotingPlan(true);
            try {
                const quote = await paymentService.quotePlanChange(accountNo, preselected.id);
                if (quote?.eligible && typeof quote.amount === 'number') {
                    setCanRepriceOnboarding(true);
                    setOnboardingQuoteAmount(quote.amount);
                    setPaymentAmount(quote.amount);
                }
            } finally {
                setIsQuotingPlan(false);
            }
        }
    };

    // Payment Handlers
    const handlePayNow = async () => {

        setErrorMessage('');
        setIsPaymentProcessing(true);

        try {
            // Check for pending payments
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
        // that bill, so the amount becomes the new plan's total (plan + VAT − withholding) rather
        // than the old balance. Quoted server-side so the tax maths is never duplicated here.
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

        // Not an onboarding re-price, so the plan price still has to cover what is already owed.
        // Flagged on selection rather than letting the customer discover it only on Proceed.
        if (isPrepaid && balance > 0 && toCentavos(price) < toCentavos(balance)) {
            setErrorMessage(`${plan.name} costs ₱${price.toLocaleString('en-PH', { minimumFractionDigits: 2 })}, which does not cover your balance of ₱${balance.toLocaleString('en-PH', { minimumFractionDigits: 2 })}. Pick a plan priced at ₱${balance.toLocaleString('en-PH', { minimumFractionDigits: 2 })} or more.`);
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
        // Drop any onboarding re-price quote from a previously picked plan — this mode pays the
        // balance as it stands and sends no plan, so nothing gets re-priced.
        setOnboardingQuoteAmount(null);
    };

    const handleCloseVerifyModal = () => {
        setShowPaymentVerifyModal(false);
        setIsPlanListOpen(false);
        setPayCurrentBalance(false);
        setActivateNow(false);
        setPaymentAmount(isPrepaid ? Number(selectedPlan?.price ?? 0) : balance);
    };

    const handleProceedToCheckout = async () => {
        // Prepaid pays the selected plan's price — that is how a plan change is bought — but the
        // price has to cover what is already owed, so a cheaper plan cannot be used to underpay an
        // outstanding balance. Postpaid must settle the balance exactly. These are backstops: the
        // amount is never hand-typed in either case.
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
                setErrorMessage(`${selectedPlan.name} costs ₱${paymentAmount.toLocaleString('en-PH', { minimumFractionDigits: 2 })}, which does not cover your balance of ₱${balance.toLocaleString('en-PH', { minimumFractionDigits: 2 })}. Pick a plan priced at ₱${balance.toLocaleString('en-PH', { minimumFractionDigits: 2 })} or more.`);
                return;
            }
        } else if (requiresExactPayment && !isPaymentAmountValid) {
            setErrorMessage(`Payment must be exactly your current balance of ₱${balance.toLocaleString('en-PH', { minimumFractionDigits: 2 })}`);
            return;
        }

        if (paymentAmount < 1) {
            setErrorMessage('Payment amount must be at least ₱1.00');
            return;
        }

        if (isPaymentProcessing) return;

        setIsPaymentProcessing(true);
        setErrorMessage('');

        try {
            // plan_id only for prepaid: it is the plan being switched TO. Postpaid is settling a
            // balance and never changes plan, so it sends nothing.
            // activate_now is re-checked against canActivateNow rather than sent raw: the flag
            // is only meaningful for the exact selection it was ticked for, and the server
            // ignores it without a genuine plan switch anyway.
            const response = await paymentService.createPayment(
                accountNo,
                paymentAmount,
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
            setErrorMessage(error.message || 'Failed to create payment. Please try again.');
        } finally {
            setIsPaymentProcessing(false);
        }
    };

    const handleOpenPaymentLink = () => {
        if (paymentLinkData?.paymentUrl) {
            window.open(paymentLinkData.paymentUrl, '_blank');
            setShowPaymentLinkModal(false);
            setPaymentLinkData(null);
        }
    };

    const handleCancelPaymentLink = () => {
        setShowPaymentLinkModal(false);
        setPaymentLinkData(null);
    };

    const handleResumePendingPayment = () => {
        if (pendingPayment && pendingPayment.payment_url) {
            window.open(pendingPayment.payment_url, '_blank');
            setShowPendingPaymentModal(false);
            setPendingPayment(null);
        }
    };

    const handleClosePendingPaymentModal = () => {
        setErrorMessage('');
        setShowPendingPaymentModal(false);
        setPendingPayment(null);
    };

    const handleCancelPendingPaymentFromDb = async () => {
        if (!pendingPayment) return;
        setIsPaymentProcessing(true);
        setErrorMessage('');
        try {
            const response = await paymentService.cancelPayment(pendingPayment.reference_no);
            if (response.status === 'success') {
                setPendingPayment(null);
                setShowPendingPaymentModal(false);
            } else {
                throw new Error(response.message || 'Failed to cancel payment');
            }
        } catch (error: any) {
            console.error('Cancel payment error:', error);
            setErrorMessage(error.message || 'Failed to cancel payment. Please try again.');
        } finally {
            setIsPaymentProcessing(false);
        }
    };

    return (
        <div className="min-h-screen bg-gray-50 p-6 md:p-12 font-sans relative">
            {/* Welcome Header */}
            <div className="mb-8">
                <h1 className="text-3xl font-bold text-gray-900">Hello, {displayName.split(' ')[0]}!</h1>
                <p className="text-gray-500 mt-1">Welcome back to your dashboard.</p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* Left Column: Profile Card */}
                <div className="lg:col-span-1 space-y-6">
                    <div className="bg-white rounded-3xl shadow-sm p-8 text-center border border-gray-100">
                        <div className="relative inline-block mb-4">
                            <div className="w-24 h-24 bg-gray-200 rounded-full mx-auto flex items-center justify-center">
                                <User className="w-12 h-12 text-gray-400" />
                            </div>
                            <div className="absolute -bottom-2 transform -translate-x-1/2 left-1/2 bg-green-600 text-white text-xs px-3 py-1 rounded-full font-medium">
                                Active
                            </div>
                        </div>

                        <h2 className="text-xl font-bold text-gray-900 mt-4">{displayName}</h2>
                        <p className="text-sm font-semibold text-gray-900 mt-1">{accountNo}</p>

                        <div className="mt-8 space-y-4 text-left">
                            {/* Prepaid buys a service period, so the plan only means something next
                                to the date it runs out — and a plan change already paid for is
                                shown separately, because it is NOT what they are on today. */}
                            <div className="flex justify-between border-b border-gray-50 pb-3">
                                <span className="text-gray-400 text-sm">{isPrepaid ? 'Current Plan' : 'Plan'}</span>
                                <span className="text-gray-900 font-bold text-sm uppercase">{planName}</span>
                            </div>

                            {isPrepaid && (
                                <div className="flex justify-between border-b border-gray-50 pb-3">
                                    <span className="text-gray-400 text-sm">Expires</span>
                                    <span className="text-gray-900 font-bold text-sm">
                                        {prepaidExpiryString ?? 'Not started'}
                                    </span>
                                </div>
                            )}

                            {isPrepaid && pendingPlanName && (
                                <>
                                    <div className="flex justify-between border-b border-gray-50 pb-3">
                                        <span className="text-gray-400 text-sm">Upcoming Plan</span>
                                        <span className="font-bold text-sm uppercase" style={{ color: colorPalette?.primary || '#0f172a' }}>
                                            {pendingPlanName}
                                        </span>
                                    </div>
                                    <div className="flex justify-between border-b border-gray-50 pb-3">
                                        <span className="text-gray-400 text-sm">Starts</span>
                                        <span className="text-gray-900 font-bold text-sm">
                                            {/* No effective date stored means the switch lands as soon as the
                                                current period lapses, rather than on a fixed day. */}
                                            {pendingPlanEffectiveAt
                                                ? formatDbDate(pendingPlanEffectiveAt)
                                                : (prepaidExpiryString ? `After ${prepaidExpiryString}` : 'After current period')}
                                        </span>
                                    </div>
                                </>
                            )}

                            <div className="flex justify-between border-b border-gray-50 pb-3">
                                <span className="text-gray-400 text-sm">Installed</span>
                                <span className="text-gray-900 font-bold text-sm">{installationDate}</span>
                            </div>
                            <div className="flex justify-between pb-3">
                                <span className="text-gray-400 text-sm">Location</span>
                                <span className="text-gray-900 font-bold text-sm text-right">{address}</span>
                            </div>
                        </div>

                        <div className="mt-8 space-y-3">
                            <button
                                onClick={() => onNavigate?.('customer-bills')}
                                className="w-full flex items-center justify-center space-x-2 py-3 border rounded-full font-semibold hover:bg-gray-50 transition"
                                style={{ borderColor: colorPalette?.primary || '#0f172a', color: colorPalette?.primary || '#0f172a' }}
                            >
                                <FileText className="w-4 h-4" />
                                <span>My Bills</span>
                            </button>
                            <button
                                onClick={() => onNavigate?.('customer-support')}
                                className="w-full flex items-center justify-center space-x-2 py-3 border rounded-full font-semibold hover:bg-gray-50 transition"
                                style={{ borderColor: colorPalette?.primary || '#0f172a', color: colorPalette?.primary || '#0f172a' }}
                            >
                                <HelpCircle className="w-4 h-4" />
                                <span>Help & Support</span>
                            </button>
                        </div>
                    </div>
                </div>

                {/* Right Column: Balance & History */}
                <div className="lg:col-span-2 space-y-8">
                    {/* Balance Card */}
                    <div className="rounded-3xl p-8 md:p-12 text-center text-white relative overflow-hidden" style={{ background: `linear-gradient(135deg, ${colorPalette?.primary || '#0f172a'} 0%, #000000 100%)` }}>
                        <h3 className="text-white text-sm font-medium tracking-wide uppercase mb-2 opacity-80">Total Amount Due</h3>
                        <div className="text-5xl md:text-6xl font-bold mb-4">₱{balance.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</div>
                        <div className="text-white text-sm mb-8 flex items-center justify-center space-x-2 opacity-90">
                            <span>Reference: <span className="text-white font-medium">{accountNo}</span></span>
                            <span>|</span>
                            {/* Prepaid shows when the paid period ends; postpaid keeps the invoice due date. */}
                            <span>{dueDateLabel}: <span className="text-white">{dueDateValue}</span></span>
                            {prepaidDaysLeftText && (
                                <>
                                    <span>|</span>
                                    <span className={prepaidDaysLeft !== null && prepaidDaysLeft <= 3 ? 'text-red-300 font-bold' : 'text-gray-300'}>
                                        {prepaidDaysLeftText}
                                    </span>
                                </>
                            )}
                        </div>

                        <div className="flex justify-center space-x-4">
                            <button
                                onClick={handlePayNow}
                                disabled={isPaymentProcessing}
                                className="bg-white text-slate-900 px-8 py-3 rounded-full font-bold hover:bg-gray-100 transition min-w-[140px] disabled:opacity-50 disabled:cursor-not-allowed flex flex-col items-center justify-center leading-tight"
                                style={{ color: colorPalette?.primary || '#0f172a' }}
                            >
                                <span>{isPaymentProcessing ? 'Processing' : (pendingPayment && pendingPayment.payment_url) ? 'PROCEED PAYMENT' : 'PAY NOW'}</span>
                            </button>
                            <button
                                onClick={() => onNavigate?.('customer-bills', 'payments')}
                                className="bg-transparent border border-white text-white px-8 py-3 rounded-full font-bold hover:bg-white/10 transition min-w-[140px]"
                            >
                                History
                            </button>
                        </div>
                    </div>

                    {/* Recent Payments - Still Mocked for Now */}
                    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                        <div className="p-6 border-b border-gray-100 flex items-center space-x-2">
                            <Clock className="w-5 h-5" style={{ color: colorPalette?.primary || '#0f172a' }} />
                            <h3 className="font-bold" style={{ color: colorPalette?.primary || '#0f172a' }}>Recent Payments</h3>
                        </div>
                        <div>
                            {payments.length === 0 ? (
                                <div className="p-4 text-center text-gray-500">No payment history found.</div>
                            ) : (
                                payments.map((payment) => (
                                    <div key={payment.id} className="flex justify-between items-center p-4 border-b border-gray-50 last:border-0 hover:bg-gray-50 transition">
                                        <div className="text-sm text-gray-500">{payment.date}</div>
                                        <div className="text-sm font-mono text-gray-600 hidden md:block">{payment.reference}</div>
                                        <div className="text-sm font-bold text-green-600">+ ₱{payment.amount.toFixed(2)}</div>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>

                    {/* My Referrals - Still Mocked for Now */}
                    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                        <div className="p-6 border-b border-gray-100 flex justify-between items-center">
                            <div className="flex items-center space-x-2">
                                <Users className="w-5 h-5" style={{ color: colorPalette?.primary || '#0f172a' }} />
                                <h3 className="font-bold" style={{ color: colorPalette?.primary || '#0f172a' }}>My Referrals</h3>
                            </div>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full">
                                <thead className="bg-gray-50">
                                    <tr>
                                        <th className="text-left text-xs font-bold text-gray-500 uppercase tracking-wider py-3 px-6">Date</th>
                                        <th className="text-left text-xs font-bold text-gray-500 uppercase tracking-wider py-3 px-6">Name</th>
                                        <th className="text-left text-xs font-bold text-gray-500 uppercase tracking-wider py-3 px-6">Stage</th>
                                        <th className="text-right text-xs font-bold text-gray-500 uppercase tracking-wider py-3 px-6">Status</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100">
                                    {referrals.slice(0, 4).map((referral) => (
                                        <tr key={referral.id}>
                                            <td className="py-4 px-6 text-sm text-gray-500">{referral.date}</td>
                                            <td className="py-4 px-6 text-sm font-bold text-gray-900">{referral.name}</td>
                                            <td className="py-4 px-6 text-sm">
                                                <span className="bg-blue-100 text-blue-700 px-2 py-1 rounded text-xs font-medium">
                                                    {referral.stage}
                                                </span>
                                            </td>
                                            <td className="py-4 px-6 text-sm text-right">
                                                <span className={`px-3 py-1 rounded-full text-xs font-bold ${getStatusColor(referral.status)}`}>
                                                    {referral.status}
                                                </span>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            </div>


            {/* PAYMENT VERIFY MODAL */}
            {
                showPaymentVerifyModal && (
                    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
                        <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
                            <div className="p-6 border-b border-gray-200">
                                <h3 className="text-xl font-bold text-gray-900 text-center">Confirm Payment</h3>
                            </div>
                            <div className="p-6">
                                <div className="bg-gray-100 p-4 rounded mb-4">
                                    <div className="flex justify-between mb-2 text-gray-700">
                                        <span>Account:</span>
                                        <span className="font-bold">{displayName}</span>
                                    </div>
                                    <div className="flex justify-between text-gray-700">
                                        <span>Current Balance:</span>
                                        <span className={`font-bold ${balance > 0 ? 'text-red-500' : 'text-green-500'}`}>
                                            ₱{balance.toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                                        </span>
                                    </div>
                                </div>

                                {errorMessage && (
                                    <div className="bg-red-50 p-3 rounded mb-4 border border-red-200">
                                        <p className="text-red-500 text-sm text-center">{errorMessage}</p>
                                    </div>
                                )}

                                {/* Prepaid buys a service period at a plan's price, so the plan is
                                    the choice and the amount simply follows it. Postpaid is settling
                                    a balance and never sees this. */}
                                {isPrepaid && (
                                    <div className="mb-4">
                                        <label className="block font-bold mb-2 text-gray-700">Plan</label>
                                        {isLoadingPlans ? (
                                            <p className="text-sm text-gray-500 px-4 py-3 border border-gray-300 rounded">Loading plans…</p>
                                        ) : plans.length === 0 ? (
                                            <p className="text-sm text-gray-500 px-4 py-3 border border-gray-300 rounded">
                                                No plans are available right now. Please contact support.
                                            </p>
                                        ) : (
                                            <div className="relative">
                                                <button
                                                    type="button"
                                                    onClick={() => setIsPlanListOpen(open => !open)}
                                                    className="w-full px-4 py-3 rounded border border-gray-300 text-left font-bold text-gray-900 flex justify-between items-center hover:bg-gray-50"
                                                >
                                                    <span>
                                                        {payCurrentBalance
                                                            ? `Pay Current Balance — ₱${balance.toLocaleString('en-PH', { minimumFractionDigits: 2 })}`
                                                            : selectedPlan
                                                                ? `${selectedPlan.name} — ₱${Number(selectedPlan.price ?? 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`
                                                                : 'Select a plan'}
                                                    </span>
                                                    <span className="text-gray-400 text-xs ml-2">{isPlanListOpen ? '▲' : '▼'}</span>
                                                </button>

                                                {isPlanListOpen && (
                                                    <div className="absolute z-10 mt-1 w-full max-h-56 overflow-y-auto bg-white border border-gray-200 rounded shadow-lg">
                                                        {/* Static option: pay the outstanding balance directly, no plan change.
                                                            Only offered when there is actually a balance to settle. */}
                                                        {balance > 0 && (
                                                            <button
                                                                type="button"
                                                                onClick={handleSelectPayCurrentBalance}
                                                                className={`w-full px-4 py-3 text-left flex justify-between items-center border-b border-gray-100 hover:bg-gray-50 ${payCurrentBalance ? 'bg-gray-100' : ''}`}
                                                            >
                                                                <span className="text-gray-900 font-medium">Pay Current Balance</span>
                                                                <span className="text-gray-700 text-sm">
                                                                    ₱{balance.toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                                                                </span>
                                                            </button>
                                                        )}
                                                        {plans.map(plan => {
                                                            const price = Number(plan.price ?? 0);
                                                            const isSelected = plan.id === selectedPlanId;
                                                            const isCurrent = plan.id === currentPlan?.id;
                                                            // Shown but not selectable: a plan that cannot clear the
                                                            // outstanding balance would be an underpayment.
                                                            const isUnderBalance = requiresPlanCoversBalance && toCentavos(price) < toCentavos(balance);
                                                            return (
                                                                <button
                                                                    key={plan.id}
                                                                    type="button"
                                                                    disabled={isUnderBalance}
                                                                    onClick={() => handleSelectPlan(plan)}
                                                                    className={`w-full px-4 py-3 text-left flex justify-between items-center border-b border-gray-100 last:border-b-0 ${isUnderBalance ? 'opacity-50 cursor-not-allowed' : 'hover:bg-gray-50'
                                                                        } ${isSelected ? 'bg-gray-100' : ''}`}
                                                                >
                                                                    <span className="text-gray-900 font-medium">
                                                                        {plan.name}
                                                                        {isCurrent && <span className="ml-2 text-xs text-gray-500">(current)</span>}
                                                                    </span>
                                                                    <span className="text-gray-700 text-sm">
                                                                        ₱{price.toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                                                                        {isUnderBalance && <span className="ml-2 text-xs text-red-500">under balance</span>}
                                                                    </span>
                                                                </button>
                                                            );
                                                        })}
                                                    </div>
                                                )}
                                            </div>
                                        )}

                                        {/* Tell the customer whether the switch queues or applies now. */}
                                        {selectedPlan && pendingPlan && selectedPlan.id === pendingPlan.id ? (
                                            <p className="text-xs text-gray-500 mt-2">
                                                {pendingPlanName || selectedPlan.name} is already scheduled
                                                {pendingPlanEffectiveAt ? ` for ${formatDbDate(pendingPlanEffectiveAt)}` : ''}.
                                                This payment tops up that plan.
                                            </p>
                                        ) : selectedPlan && currentPlan && selectedPlan.id === currentPlan.id && pendingPlan ? (
                                            <p className="text-xs text-gray-500 mt-2">
                                                You have {pendingPlan.name} scheduled
                                                {pendingPlanEffectiveAt ? ` for ${formatDbDate(pendingPlanEffectiveAt)}` : ''}.
                                                Paying for {selectedPlan.name} instead will cancel that change.
                                            </p>
                                        ) : selectedPlan && currentPlan && selectedPlan.id !== currentPlan.id ? (
                                            <p className="text-xs text-gray-500 mt-2">
                                                {activateNow
                                                    ? `${selectedPlan.name} starts as soon as this payment is confirmed.`
                                                    : isPrepaidPeriodActive && prepaidExpiresAt
                                                        ? `Your current plan stays active until ${formatDbDate(prepaidExpiresAt)}. ${selectedPlan.name} starts right after.`
                                                        : `${selectedPlan.name} starts as soon as this payment is confirmed.`}
                                            </p>
                                        ) : null}

                                        {/* Activate Now — only worth offering while there are days
                                            left to forfeit AND the selection is a real switch.
                                            Outside those conditions the new plan already starts
                                            immediately, so the choice would be meaningless. */}
                                        {canActivateNow && (
                                            <div className="mt-3 pt-3 border-t border-gray-200">
                                                <label className="flex items-start gap-2 cursor-pointer">
                                                    <input
                                                        type="checkbox"
                                                        checked={activateNow}
                                                        onChange={(e) => setActivateNow(e.target.checked)}
                                                        className="mt-0.5 h-4 w-4 cursor-pointer"
                                                        style={{ accentColor: colorPalette?.primary || '#0f172a' }}
                                                    />
                                                    <span className="text-sm font-medium text-gray-700">
                                                        Activate Now
                                                    </span>
                                                </label>

                                                {activateNow ? (
                                                    <div className="mt-2 rounded border border-amber-400 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                                                        <strong>Heads up:</strong> {selectedPlan?.name} starts as soon as
                                                        your payment is confirmed and your service period resets to 30 days
                                                        from today. You will lose the{' '}
                                                        {prepaidDaysLeft !== null && prepaidDaysLeft > 0
                                                            ? `${prepaidDaysLeft} day${prepaidDaysLeft === 1 ? '' : 's'}`
                                                            : 'days'}{' '}
                                                        remaining on your current plan. This cannot be undone.
                                                    </div>
                                                ) : (
                                                    <p className="text-xs text-gray-500 mt-1 ml-6">
                                                        Tick to switch immediately instead of waiting for your current
                                                        period to end.
                                                    </p>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                )}

                                <div className="mb-4">
                                    <label className="block font-bold mb-2 text-gray-700">Payment Amount</label>
                                    <input
                                        type="text"
                                        inputMode="decimal"
                                        // Not hand-editable when the amount is already determined:
                                        // prepaid takes it from the plan picker above, and postpaid
                                        // with a balance owed must settle that balance in full.
                                        readOnly={isPrepaid || requiresExactPayment}
                                        value={requiresExactPayment
                                            ? balance.toLocaleString('en-PH', { minimumFractionDigits: 2 })
                                            : (paymentAmount || '')}
                                        onChange={(e) => {
                                            if (isPrepaid || requiresExactPayment) return;
                                            const value = e.target.value;
                                            if (value === '' || /^\d*\.?\d*$/.test(value)) {
                                                const newAmount = value === '' ? 0 : parseFloat(value) || 0;
                                                setPaymentAmount(newAmount);

                                                if (newAmount > 0 && newAmount < 1) {
                                                    setErrorMessage('Payment amount must be at least ₱1.00');
                                                } else {
                                                    setErrorMessage('');
                                                }
                                            }
                                        }}
                                        placeholder="0.00"
                                        className={`w-full px-4 py-3 rounded text-lg font-bold border ${!isPaymentAmountValid && paymentAmount > 0 ? 'border-red-500 ring-red-500' : 'border-gray-300'
                                            } text-gray-900 focus:outline-none focus:ring-2 ${(isPrepaid || requiresExactPayment) ? 'bg-gray-100 cursor-not-allowed' : ''}`}
                                        style={{ '--tw-ring-color': !isPaymentAmountValid && paymentAmount > 0 ? '#ef4444' : (colorPalette?.primary || '#0f172a') } as React.CSSProperties}
                                    />
                                    <div className="text-sm text-right mt-1 text-gray-500">
                                        {isPrepaid ? (
                                            <span>
                                                {isQuotingPlan
                                                    ? 'Computing amount…'
                                                    : payCurrentBalance
                                                        ? 'Paying your current balance'
                                                        : selectedPlan
                                                            ? (onboardingQuoteAmount !== null
                                                                // Re-priced first bill: say so, since the figure is
                                                                // no longer just the plan's sticker price.
                                                                ? `${selectedPlan.name} — first bill re-priced (incl. VAT/withholding)`
                                                                : `Set by your ${selectedPlan.name} plan`)
                                                            : 'Select a plan above'}
                                            </span>
                                        ) : requiresExactPayment ? (
                                            <span>Full settlement required: ₱{balance.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</span>
                                        ) : (
                                            <span>Minimum: ₱1.00</span>
                                        )}
                                    </div>

                                    {/* Convenience fee disclosure. The field above is the amount that
                                        settles the bill; the gateway collects this total instead. */}
                                    {convenienceFeePercentage > 0 && feeBaseAmount > 0 && (
                                        <p className="text-xs text-gray-500 mt-2">
                                            + convenience fee: {convenienceFeeLabel}% = {formatPeso(totalWithConvenienceFee)}
                                        </p>
                                    )}
                                </div>

                                <div className="flex gap-3">
                                    <button
                                        onClick={handleCloseVerifyModal}
                                        disabled={isPaymentProcessing}
                                        className="flex-1 px-4 py-3 rounded font-bold bg-gray-200 text-gray-900 hover:bg-gray-300 transition-colors disabled:opacity-50"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        onClick={handleProceedToCheckout}
                                        disabled={isPaymentProcessing || !isPaymentAmountValid || paymentAmount < 1 || (isPrepaid && !selectedPlan && !payCurrentBalance)}
                                        className="flex-1 px-4 py-3 rounded font-bold text-white transition-colors disabled:opacity-50"
                                        style={{ background: `linear-gradient(135deg, ${colorPalette?.primary || '#0f172a'} 0%, #000000 100%)` }}
                                    >
                                        {isPaymentProcessing ? 'Processing...' : 'Proceed to Pay'}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                )
            }

            {/* PAYMENT LINK MODAL */}
            {
                showPaymentLinkModal && paymentLinkData && (
                    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
                        <div className="bg-white rounded-lg shadow-xl max-w-md w-full text-center">
                            <div className="p-6 border-b border-gray-200">
                                <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-green-100 mb-4">
                                    <CheckCircle className="h-6 w-6 text-green-600" />
                                </div>
                                <h3 className="text-xl font-bold text-gray-900">Payment Link Created!</h3>
                                <p className="text-gray-500 mt-2">Reference: {paymentLinkData.referenceNo}</p>
                            </div>
                            <div className="p-6">
                                <p className="text-gray-600 mb-6">
                                    Please click the button below to complete your payment of
                                    <span className="font-bold text-gray-900"> ₱{paymentLinkData.amount.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</span>
                                </p>
                                <button
                                    onClick={handleOpenPaymentLink}
                                    className="w-full px-4 py-3 rounded font-bold bg-green-600 text-white hover:bg-green-700 transition-colors mb-3"
                                >
                                    Open Payment Portal
                                </button>
                                <button
                                    onClick={handleCancelPaymentLink}
                                    className="text-gray-500 underline text-sm hover:text-gray-700"
                                >
                                    Close
                                </button>
                            </div>
                        </div>
                    </div>
                )
            }

            {/* PENDING PAYMENT MODAL */}
            {
                showPendingPaymentModal && pendingPayment && (
                    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
                        <div className="bg-white rounded-lg shadow-xl max-w-md w-full text-center">
                            <div className="p-6 border-b border-gray-200">
                                <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-yellow-100 mb-4">
                                    <Activity className="h-6 w-6 text-yellow-600" />
                                </div>
                                <h3 className="text-xl font-bold text-gray-900">Pending Payment Found</h3>
                            </div>
                            <div className="p-6">
                                <p className="text-gray-600 mb-6">
                                    You have a pending payment of
                                    <span className="font-bold text-gray-900"> ₱{pendingPayment.amount.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</span>.
                                    Would you like to complete it?
                                </p>
                                
                                {errorMessage && (
                                    <div className="bg-red-50 p-3 rounded mb-4 border border-red-200">
                                        <p className="text-red-500 text-sm text-center">{errorMessage}</p>
                                    </div>
                                )}

                                <div className="flex flex-col sm:flex-row gap-3">
                                    <button
                                        onClick={handleClosePendingPaymentModal}
                                        disabled={isPaymentProcessing}
                                        className="sm:flex-1 px-4 py-3 rounded font-bold bg-gray-200 text-gray-900 hover:bg-gray-300 transition-colors disabled:opacity-50"
                                    >
                                        Close
                                    </button>
                                    <button
                                        onClick={handleCancelPendingPaymentFromDb}
                                        disabled={isPaymentProcessing}
                                        className="sm:flex-1 px-4 py-3 rounded font-bold bg-red-600 text-white hover:bg-red-700 transition-colors disabled:opacity-50"
                                    >
                                        {isPaymentProcessing ? 'Processing...' : 'Cancel Payment'}
                                    </button>
                                    <button
                                        onClick={handleResumePendingPayment}
                                        disabled={isPaymentProcessing}
                                        className="sm:flex-1 px-4 py-3 rounded font-bold text-white transition-colors disabled:opacity-50"
                                        style={{ background: `linear-gradient(135deg, ${colorPalette?.primary || '#0f172a'} 0%, #000000 100%)` }}
                                    >
                                        Resume Payment
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                )
            }
            {/* PAYMENT SUCCESS MODAL */}
            {
                showPaymentSuccessModal && (
                    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
                        <div className="bg-white rounded-lg shadow-xl max-w-md w-full text-center">
                            <div className="p-6 border-b border-gray-200">
                                <div className="mx-auto flex items-center justify-center h-16 w-16 rounded-full bg-green-100 mb-4">
                                    <CheckCircle className="h-8 w-8 text-green-600" />
                                </div>
                                <h3 className="text-xl font-bold text-gray-900">Payment Successful!</h3>
                            </div>
                            <div className="p-6">
                                <p className="text-gray-600 mb-6">
                                    Your payment has been received and is being processed. Your balance will be updated shortly.
                                </p>
                                <button
                                    onClick={() => setShowPaymentSuccessModal(false)}
                                    className="w-full px-4 py-3 rounded font-bold text-white transition-colors"
                                    style={{ background: `linear-gradient(135deg, ${colorPalette?.primary || '#0f172a'} 0%, #000000 100%)` }}
                                >
                                    OK
                                </button>
                            </div>
                        </div>
                    </div>
                )
            }
        </div >
    );
};

export default DashboardCustomer;
