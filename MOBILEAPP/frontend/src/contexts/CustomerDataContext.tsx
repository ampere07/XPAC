import React, { createContext, useContext, useState, useCallback, ReactNode, useEffect } from 'react';
import { AppState, DeviceEventEmitter } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getCustomerDetail, getCustomerPaySummary, PAY_SUMMARY_TIMEOUTS_MS, CustomerDetailData, CustomerPaySummary } from '../services/customerDetailService';
import apiClient, { SESSION_EXPIRED_EVENT } from '../config/api';
import { readDashboardCache, writeDashboardCache } from '../utils/customerDashboardCache';

/**
 * How long the secondary lists wait for the balance before going out anyway.
 *
 * Covers the summary's first attempt and the pause before its second, so the
 * lists do not compete with the try that answers on most connections. Not the
 * whole ladder: a balance on its long third attempt must not hold the rest of
 * the screen back for the best part of a minute.
 */
const SECONDARY_REQUEST_GRACE_MS = 9000;

interface PaymentRecord {
    id: string;
    date: string;
    reference: string;
    amount: number;
    source: 'Online' | 'Manual';
    status?: string;
}

interface SOARecord {
    id: number;
    statement_date?: string;
    statement_no?: string;
    print_link?: string;
    total_amount_due?: number;
}

interface InvoiceRecord {
    id: number;
    invoice_date?: string;
    invoice_balance?: number;
    due_date?: string;
    status?: string;
    print_link?: string;
}

interface ServiceOrderRecord {
    id: string;
    date: string;
    rawTimestamp: string | null;
    requestId: string;
    issue: string;
    issueDetails: string;
    status: string;
    statusNote: string;
    assignedEmail: string;
    visitNote: string;
    visitInfo: { status: string };
}

interface CustomerDataContextType {
    customerDetail: CustomerDetailData | null;
    /**
     * The fast path for the balance card. Requested alongside customerDetail rather than
     * derived from it, because the amount due is the one figure Pay Now cannot work
     * without and it lives one indexed row away — while the full detail response is four
     * eager-loaded relations, two payment SUMs and the entire customer record.
     *
     * Never restored from cache, so a non-null value always means a fresh server
     * response. That is what lets the dashboard tell a confirmed balance from a
     * carried-over one without another flag.
     */
    paySummary: CustomerPaySummary | null;
    isPaySummaryLoading: boolean;
    /**
     * What is on screen came from the stored snapshot and has not been confirmed against
     * the server yet. Safe to display; not safe to act on.
     */
    isFromCache: boolean;
    payments: PaymentRecord[];
    soaRecords: SOARecord[];
    invoiceRecords: InvoiceRecord[];
    serviceOrders: ServiceOrderRecord[];
    isLoading: boolean;
    /**
     * Statements and invoices, requested by Bills rather than at launch.
     *
     * Nothing on the dashboard renders them, so fetching them there put three
     * requests on the connection ahead of the balance for lists most sessions
     * never open. Call this when the tab mounts; it is a no-op once loaded, so
     * tab switches are free. force reloads for pull-to-refresh.
     */
    fetchBillsData: (force?: boolean) => Promise<void>;
    isBillsLoading: boolean;
    /**
     * The resolved billing account, or null until the main load returns one.
     * Tabs watch it so they can load as soon as it appears, however late that is.
     */
    accountNo: string | null;
    /** Service orders, requested by Support. Same contract as fetchBillsData. */
    fetchSupportData: (force?: boolean) => Promise<void>;
    isSupportLoading: boolean;
    error: string | null;
    refreshData: () => Promise<void>;
    silentRefresh: () => Promise<void>;
    lastUpdated: Date | null;
    /**
     * Has a load actually been issued yet?
     *
     * The loading flags say what is in flight NOW, which is also false before the
     * first request has been made. A consumer that reads "nothing loading, nothing
     * loaded" as a failed load reports one on its very first render, every time.
     * This is the signal that there is a request to be settled at all.
     */
    hasAttemptedLoad: boolean;
}

const CustomerDataContext = createContext<CustomerDataContextType | undefined>(undefined);

export const useCustomerDataContext = () => {
    const context = useContext(CustomerDataContext);
    if (!context) {
        throw new Error('useCustomerDataContext must be used within a CustomerDataProvider');
    }
    return context;
};

export const CustomerDataProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [customerDetail, setCustomerDetail] = useState<CustomerDetailData | null>(null);
    const [paySummary, setPaySummary] = useState<CustomerPaySummary | null>(null);
    const [isPaySummaryLoading, setIsPaySummaryLoading] = useState<boolean>(true);
    const [isFromCache, setIsFromCache] = useState<boolean>(false);
    const [payments, setPayments] = useState<PaymentRecord[]>([]);
    const [soaRecords, setSoaRecords] = useState<SOARecord[]>([]);
    const [invoiceRecords, setInvoiceRecords] = useState<InvoiceRecord[]>([]);
    const [serviceOrders, setServiceOrders] = useState<ServiceOrderRecord[]>([]);
    const [accountNo, setAccountNo] = useState<string | null>(null);
    const [isBillsLoading, setIsBillsLoading] = useState<boolean>(false);
    const [isSupportLoading, setIsSupportLoading] = useState<boolean>(false);
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);
    const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
    const [hasAttemptedLoad, setHasAttemptedLoad] = useState<boolean>(false);

    // Use a ref for the guard check so fetchData doesn't need customerDetail as a dependency.
    // This prevents a new fetchData/silentRefresh from being created on every data update,
    // which was causing DashboardCustomer to remount and lose its modal state.
    const customerDetailRef = React.useRef<CustomerDetailData | null>(null);

    // Set only by a server response, never by a restored snapshot. customerDetailRef is
    // the "do we have something to show?" guard; this is the "has the server actually
    // answered?" one, and the retry loop needs the second.
    const confirmedRef = React.useRef<boolean>(false);

    /**
     * Set once the server has rejected the app's credential.
     *
     * The retry loop below is deliberately relentless — a dashboard whose first
     * request lost the network has to recover on its own — but a 401 is the one
     * failure retrying cannot fix. Without this it re-sent the same dead token
     * every 30 seconds for as long as the app stayed open, and again on every
     * return to the foreground. App.tsx is already showing the re-login modal by
     * then, so there is nothing left here to recover.
     *
     * A ref rather than state: nothing renders from it, and the retry loop is bound
     * once and must see the current value rather than the one it closed over.
     */
    const sessionExpiredRef = React.useRef(false);
    useEffect(() => {
        const subscription = DeviceEventEmitter.addListener(SESSION_EXPIRED_EVENT, () => {
            sessionExpiredRef.current = true;
        });

        return () => subscription.remove();
    }, []);

    /**
     * The account the main load resolved, so the lazy tab loaders below do not
     * have to resolve it again.
     */
    const accountNoRef = React.useRef<string | null>(null);

    /**
     * The lists Bills and Support own, mirrored into refs.
     *
     * Refs rather than the state above because the cache write and the load
     * guards read them from inside callbacks that must not take the lists as
     * dependencies — doing so would rebuild fetchData on every list update and
     * remount the screens that depend on it, which is the problem
     * customerDetailRef already exists to avoid.
     */
    const soaRecordsRef = React.useRef<SOARecord[]>([]);
    const invoiceRecordsRef = React.useRef<InvoiceRecord[]>([]);

    /** Each tab's data has been loaded once. Cleared by a forced refresh. */
    const billsLoadedRef = React.useRef<boolean>(false);
    const supportLoadedRef = React.useRef<boolean>(false);

    /** A load is already running, so a second call is not started alongside it. */
    const billsInFlightRef = React.useRef<boolean>(false);
    const supportInFlightRef = React.useRef<boolean>(false);

    /**
     * Load the signed-in customer's data.
     *
     * Returns whether there is nothing left to load — either it succeeded, or the
     * viewer is not a customer and never had anything to fetch. False means "try
     * again": no stored session yet, or the request failed. getCustomerDetail
     * swallows every error into null, so this return value is the only signal a
     * caller gets.
     */
    const runFetch = useCallback(async (force = false, silent = false): Promise<boolean> => {
        if (!force && confirmedRef.current) return true;

        // Marked before the bail-outs below, not after the requests: a load that
        // stopped because there is no stored account has still been attempted, and a
        // consumer waiting for it to settle must not wait for ever.
        setHasAttemptedLoad(true);

        if (!silent) setIsLoading(true);

        try {
            const storedUser = await AsyncStorage.getItem('authData');
            if (!storedUser) {
                setIsPaySummaryLoading(false);
                return false;
            }

            const parsedUser = JSON.parse(storedUser);
            if (!parsedUser.username) {
                setIsPaySummaryLoading(false);
                return false;
            }

            // Only fetch customer details if the user role is 'customer'
            const role = (parsedUser.role || '').toLowerCase();
            const roleId = Number(parsedUser.role_id);
            const isCustomer = role === 'customer' || roleId === 3;
            if (!isCustomer) {
                setIsLoading(false);
                setIsPaySummaryLoading(false);
                return true;
            }

            // Put the last visit's figures on screen before any request goes out. On a cold
            // start — which on a phone is the common case, not the rare one — this is the
            // difference between opening on content and opening on skeletons. Only when
            // nothing is in memory yet: a stored snapshot must never overwrite a response
            // already fetched this session.
            if (!customerDetailRef.current) {
                const cached = await readDashboardCache(parsedUser.username);
                if (cached && !customerDetailRef.current) {
                    customerDetailRef.current = cached.customerDetail;
                    setCustomerDetail(cached.customerDetail);
                    setPayments(cached.payments);
                    setSoaRecords(cached.soaRecords);
                    setInvoiceRecords(cached.invoiceRecords);
                    soaRecordsRef.current = cached.soaRecords;
                    invoiceRecordsRef.current = cached.invoiceRecords;
                    setIsFromCache(true);
                }
            }

            // Started BEFORE the detail request is awaited, so the two are concurrent. This
            // is the point: the balance arrives on the short request instead of behind the
            // long one, and Pay Now unlocks as soon as it does.
            setIsPaySummaryLoading(true);

            // Three attempts, each on a longer leash than the last.
            //
            // getCustomerPaySummary never throws — a refused request, a timeout
            // and an empty body all come back as null — so a single blip used to
            // end the balance's only fast path and leave the card reading
            // unavailable with the figure sitting in the database. Retrying
            // recovers that. Lengthening the leash as it goes is what stops a
            // phone on a weak signal being cut off three times over: see
            // PAY_SUMMARY_TIMEOUTS_MS for why one short leash could not serve
            // both a stalled request and a slow connection.
            const fetchPaySummary = async () => {
                const waits = [0, 400, 1200];

                for (let attempt = 0; attempt < PAY_SUMMARY_TIMEOUTS_MS.length; attempt++) {
                    if (waits[attempt] > 0) {
                        await new Promise((resolve) => setTimeout(resolve, waits[attempt]));
                    }

                    const summary = await getCustomerPaySummary(
                        parsedUser.username,
                        PAY_SUMMARY_TIMEOUTS_MS[attempt]
                    );
                    if (summary) {
                        if (attempt > 0) {
                            console.info('[Dashboard] Pay summary recovered on attempt', attempt + 1);
                        }
                        return summary;
                    }
                }

                console.warn('[Dashboard] Pay summary unavailable after 3 attempts', parsedUser.username);
                return null;
            };

            const paySummaryDone = fetchPaySummary()
                .then((summary) => {
                    if (summary) {
                        setPaySummary(summary);
                        // Whichever of the two responses lands first has confirmed the
                        // figure this flag exists to guard, so the card should stop
                        // labelling it as carried over from the last visit.
                        setIsFromCache(false);
                    }
                })
                .catch(() => { /* falls back to the balance on the detail payload */ })
                .finally(() => setIsPaySummaryLoading(false));

            // 1. Fetch Customer Detail
            const detail = await getCustomerDetail(parsedUser.username);
            if (!detail) {
                // The fast request may still land and carry a usable balance, so let it
                // finish before reporting the failure rather than settling over it.
                await paySummaryDone;
                throw new Error('Could not fetch customer details');
            }

            customerDetailRef.current = detail;
            confirmedRef.current = true;
            setCustomerDetail(detail);
            setIsFromCache(false);
            const accNo = detail.billingAccount?.accountNo;

            if (accNo) {
                // The balance gets a clear run at the connection before the five
                // lists below compete with it for one.
                //
                // On a fast line this resolves at once — the summary landed long
                // ago. On a weak signal it decides whether the figure the customer
                // opened the app for arrives before, or behind, lists of
                // history they have not scrolled to yet.
                await Promise.race([
                    paySummaryDone,
                    new Promise((resolve) => setTimeout(resolve, SECONDARY_REQUEST_GRACE_MS)),
                ]);

                // 2. Only what the dashboard itself renders: the two payment
                //    sources behind Recent Payments.
                //
                //    Statements, invoices and service orders are NOT requested
                //    here any more. Nothing on this screen shows them — Bills
                //    renders the first two, Support the third — so three of the
                //    five requests were made on every dashboard open for data
                //    most sessions never look at, competing with the balance.
                //    Bills and Support ask for their own through
                //    fetchBillsData() and fetchSupportData().
                //
                //    The account is kept so those two do not have to resolve it
                //    again.
                accountNoRef.current = accNo;
                // Published as state as well, so a tab that mounted before the
                // account resolved — or while a failed load was still retrying —
                // is told when it finally does, instead of sitting empty.
                setAccountNo(accNo);

                const [logsRes, txRes] = await Promise.all([
                    apiClient.get(`/payment-portal-logs/account/${accNo}`).catch((e) => { console.error('Payment logs fetch error:', e); return { data: { data: [] } }; }),
                    apiClient.get(`/transactions/by-account/${accNo}`).catch((e) => { console.error('Transactions fetch error:', e); return { data: { data: [] } }; }),
                ]);

                // Process Payment Portal Logs
                const logsData = logsRes?.data?.data || [];
                const formattedLogs: PaymentRecord[] = Array.isArray(logsData) ? logsData.map((l: any) => ({
                    id: `log-${l.id}`,
                    date: l.date_time,
                    reference: l.reference_no,
                    amount: parseFloat(l.total_amount) || 0,
                    source: 'Online' as const,
                    status: l.status
                })) : [];

                // Process Transactions
                const txData = txRes?.data?.data || [];
                const formattedTxs: PaymentRecord[] = Array.isArray(txData) ? txData.map((t: any) => ({
                    id: `tx-${t.id}`,
                    date: t.payment_date || t.created_at,
                    reference: t.or_no || t.reference_no || `TR-${t.id}`,
                    amount: parseFloat(t.received_payment || t.amount || 0),
                    source: 'Manual' as const,
                    status: t.status || 'Posted'
                })) : [];

                const allPayments = [...formattedLogs, ...formattedTxs].sort((a, b) =>
                    new Date(b.date).getTime() - new Date(a.date).getTime()
                );

                setPayments(allPayments);

                // Statements and invoices are whatever Bills last loaded — kept
                // rather than blanked, so a refresh from the dashboard does not
                // wipe a list the customer has already seen.
                writeDashboardCache(parsedUser.username, {
                    customerDetail: detail,
                    payments: allPayments,
                    soaRecords: soaRecordsRef.current,
                    invoiceRecords: invoiceRecordsRef.current,
                });
            }

            setLastUpdated(new Date());
            setError(null);
            return true;
        } catch (err: any) {
            console.error('Failed to fetch customer data:', err);
            if (!silent) setError(err.message || 'Failed to load data');
            return false;
        } finally {
            setIsLoading(false);
        }
        // Stable dependency array — customerDetailRef.current is used instead of the state
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const inFlightRef = React.useRef<Promise<boolean> | null>(null);

    /**
     * runFetch, but at most one at a time. Callers that arrive while a load is running
     * join it instead of starting a second one.
     *
     * Launch used to fire three overlapping full loads. The provider starts one on mount,
     * and DashboardCustomer's effect is keyed on the account no — which changes twice as it
     * resolves, from 'N/A' to the stored username to the account on the detail response —
     * so it called silentRefresh again each time. Nothing deduplicated them, so the
     * customer's phone opened by requesting the same payloads three times over, on
     * the connection this whole change is about.
     *
     * A silent load in progress will absorb a non-silent caller, so a refresh that wanted
     * to show a spinner may not. On the launch path they are all the same work, and doing
     * it once quietly beats doing it three times.
     */
    const fetchData = useCallback((force = false, silent = false): Promise<boolean> => {
        if (inFlightRef.current) return inFlightRef.current;

        const run = runFetch(force, silent).finally(() => { inFlightRef.current = null; });
        inFlightRef.current = run;
        return run;
    }, [runFetch]);

    /**
     * The account the tab loaders need, waiting for the main load if it has not
     * resolved one yet.
     *
     * Bills and Support can be opened before the dashboard's fetch has returned —
     * the tab bar is live immediately, which is the point of this change — so
     * "no account yet" has to mean "wait", not "give up". Without this a customer
     * who went straight to Bills got an empty screen until they navigated away
     * and back.
     */
    const resolveAccountNo = useCallback(async (): Promise<string | null> => {
        if (accountNoRef.current) return accountNoRef.current;
        if (inFlightRef.current) await inFlightRef.current;
        return accountNoRef.current;
    }, []);

    /**
     * Statements and invoices, for Bills.
     *
     * Loaded on the first visit to the tab and then kept, so moving between tabs
     * costs nothing. force is for pull-to-refresh.
     */
    const fetchBillsData = useCallback(async (force = false): Promise<void> => {
        if (billsLoadedRef.current && !force) return;
        if (billsInFlightRef.current) return;

        billsInFlightRef.current = true;
        setIsBillsLoading(true);

        try {
            const accNo = await resolveAccountNo();
            if (!accNo) return;

            // Separate catches, not one around both: a failed statements request
            // must still leave the customer their invoices.
            const [soaRes, invoiceRes] = await Promise.all([
                apiClient.get(`/statement-of-accounts/by-account/${accNo}`).catch((e) => { console.error('SOA fetch error:', e); return null; }),
                apiClient.get(`/invoices/by-account/${accNo}`).catch((e) => { console.error('Invoice fetch error:', e); return null; }),
            ]);

            if (soaRes) {
                const rows = soaRes?.data?.data || [];
                soaRecordsRef.current = rows;
                setSoaRecords(rows);
            }

            if (invoiceRes) {
                const rows = invoiceRes?.data?.data || [];
                invoiceRecordsRef.current = rows;
                setInvoiceRecords(rows);
            }

            // Only a clean pass counts as loaded, so a tab that failed retries on
            // the next visit instead of staying empty for the session.
            if (soaRes && invoiceRes) billsLoadedRef.current = true;
        } catch (e) {
            console.error('Bills data fetch error:', e);
        } finally {
            billsInFlightRef.current = false;
            setIsBillsLoading(false);
        }
    }, [resolveAccountNo]);

    /**
     * Service orders, for Support. Same guards as fetchBillsData.
     */
    const fetchSupportData = useCallback(async (force = false): Promise<void> => {
        if (supportLoadedRef.current && !force) return;
        if (supportInFlightRef.current) return;

        supportInFlightRef.current = true;
        setIsSupportLoading(true);

        try {
            const accNo = await resolveAccountNo();
            if (!accNo) return;

            const soRes = await apiClient
                .get(`/service-orders/by-account/${accNo}`)
                .catch((e) => { console.error('Service orders fetch error:', e); return null; });

            if (!soRes) return;

            const soData = soRes?.data?.data || [];
            const mappedOrders: ServiceOrderRecord[] = Array.isArray(soData) ? soData.map((order: any) => ({
                id: order.id,
                date: order.created_at ? (() => {
                    const d = new Date(order.created_at);
                    if (isNaN(d.getTime())) return '';
                    return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`;
                })() : '',
                // Preserve the precise submission time for the support cooldown calc.
                rawTimestamp: order.created_at || null,
                requestId: order.ticket_id,
                issue: order.concern || '',
                issueDetails: order.concern_remarks || '',
                status: order.support_status || 'Pending',
                statusNote: order.support_remarks || '',
                assignedEmail: order.assigned_email || '',
                visitNote: order.visit_remarks || '',
                visitInfo: { status: order.visit_status || 'Pending' }
            })) : [];

            setServiceOrders(mappedOrders);
            supportLoadedRef.current = true;
        } catch (e) {
            console.error('Support data fetch error:', e);
        } finally {
            supportInFlightRef.current = false;
            setIsSupportLoading(false);
        }
    }, [resolveAccountNo]);

    // A failed first load used to be permanent. This runs once on mount, and
    // getCustomerDetail turns any 401, timeout or dropped connection into a plain
    // null — so one bad moment at launch left customerDetail null for the whole
    // session. Nothing retried it, which is why the dashboard read "No Plan" until
    // the customer signed in again: the fields that still looked right (name,
    // account number) come from stored authData, not from this fetch.
    //
    // So: retry with a widening delay until it lands, and try again whenever the
    // app returns to the foreground, where the connection that failed at launch has
    // usually come back. Retries are silent, so they never flash a spinner over a
    // screen the customer is already reading.
    useEffect(() => {
        let cancelled = false;
        let timer: ReturnType<typeof setTimeout> | null = null;
        let attempt = 0;
        const backoffMs = [2000, 5000, 15000, 30000];

        const attemptLoad = async () => {
            // confirmedRef, not customerDetailRef: a restored snapshot fills the latter in,
            // and treating that as a completed load would stop the retries that are the
            // only thing recovering a launch whose network call failed.
            if (cancelled || confirmedRef.current || sessionExpiredRef.current) return;

            const done = await fetchData(true, attempt > 0);
            if (cancelled || done || sessionExpiredRef.current) return;

            timer = setTimeout(attemptLoad, backoffMs[Math.min(attempt, backoffMs.length - 1)]);
            attempt += 1;
        };

        attemptLoad();

        const subscription = AppState.addEventListener('change', state => {
            if (state === 'active' && !confirmedRef.current && !sessionExpiredRef.current) {
                if (timer) clearTimeout(timer);
                attempt = 0;
                attemptLoad();
            }
        });

        return () => {
            cancelled = true;
            if (timer) clearTimeout(timer);
            subscription.remove();
        };
    }, [fetchData]);

    /**
     * Pull-to-refresh. Reloads the dashboard, then re-runs only the tab loaders
     * the customer has actually opened this session — a refresh from the
     * dashboard should not go and fetch lists they never asked for, which is
     * the whole reason those requests were split out.
     */
    const refreshData = useCallback(async () => {
        const hadBills = billsLoadedRef.current;
        const hadSupport = supportLoadedRef.current;
        billsLoadedRef.current = false;
        supportLoadedRef.current = false;

        await fetchData(true, false);

        await Promise.allSettled([
            hadBills ? fetchBillsData(true) : Promise.resolve(),
            hadSupport ? fetchSupportData(true) : Promise.resolve(),
        ]);
    }, [fetchData, fetchBillsData, fetchSupportData]);
    const silentRefresh = useCallback(async () => { await fetchData(true, true); }, [fetchData]);

    return (
        <CustomerDataContext.Provider
            value={{
                customerDetail,
                paySummary,
                isPaySummaryLoading,
                isFromCache,
                payments,
                soaRecords,
                invoiceRecords,
                serviceOrders,
                isLoading,
                fetchBillsData,
                isBillsLoading,
                accountNo,
                fetchSupportData,
                isSupportLoading,
                error,
                refreshData,
                silentRefresh,
                lastUpdated,
                hasAttemptedLoad
            }}
        >
            {children}
        </CustomerDataContext.Provider>
    );
};
