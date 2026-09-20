import { create } from 'zustand';
import { getCustomerDetail, getCustomerPaySummary, PAY_SUMMARY_TIMEOUTS_MS, CustomerDetailData, CustomerPaySummary } from '../services/customerDetailService';
import { soaService } from '../services/soaService';
import { invoiceService } from '../services/invoiceService';
import { paymentPortalLogsService } from '../services/paymentPortalLogsService';
import { transactionService } from '../services/transactionService';
import { serviceChargeService, ServiceChargeRecord } from '../services/serviceChargeService';
import { readDashboardCache, writeDashboardCache } from '../utils/customerDashboardCache';

interface Payment {
    id: string;
    date: string;
    reference: string;
    amount: number;
    source: string;
    status: string;
}

interface CustomerDashboardState {
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
    soaRecords: any[];
    invoiceRecords: any[];
    paymentRecords: Payment[];
    serviceChargeRecords: ServiceChargeRecord[];
    /** The whole batch — the primary record and every secondary list — is still in flight. */
    isLoading: boolean;
    /**
     * Only the primary customer-detail request is in flight.
     *
     * Kept separate from isLoading because this is the one that gates anything visible:
     * the name, plan, account no and balance all come from that single response, so the
     * page has everything it needs to stop showing skeletons long before the six
     * secondary lists have landed. Gating the balance on isLoading meant a slow
     * service-charge call — data this page never renders — kept the amount due
     * shimmering.
     */
    isDetailLoading: boolean;
    isPaymentsLoading: boolean;
    isInvoicesLoading: boolean;
    isSoaLoading: boolean;
    isServiceChargesLoading: boolean;
    /**
     * What is in the store was restored from the last-known snapshot in localStorage
     * and has not been confirmed against the server yet. Safe to display; not safe to
     * act on — the dashboard keeps Pay Now disabled while this is set, so nobody is
     * charged against a balance that may have moved since.
     */
    isFromCache: boolean;
    error: string | null;
    fetchedAccountNo: string | null;
    /**
     * The account the last fetch was asked for, set whether or not it succeeded.
     *
     * fetchedAccountNo is only set on success, so after a failed first load there
     * was nothing to retry with and refreshCustomerData became a no-op — the
     * dashboard stayed empty until the customer signed in again.
     */
    requestedAccountNo: string | null;

    /**
     * What fetchBillsData needs to issue its own requests, captured by the main
     * load so Bills does not have to resolve the billing account a second time.
     */
    billsAccountNo: string | null;
    billsBillingId: number | null;
    billsIsCustomerRole: boolean;

    /**
     * Bills has loaded once this session. Opening the tab again reads what is
     * already in the store rather than refetching, so switching between tabs is
     * immediate; a refresh clears it.
     */
    billsLoaded: boolean;

    fetchCustomerData: (usernameOrAccountNo: string, isCustomerRole?: boolean) => Promise<void>;

    /**
     * Invoices, statements and service charges — the three lists only Bills
     * renders. Deliberately not part of the dashboard load: see the note where
     * they used to be fetched.
     *
     * Safe to call on every render of Bills. It returns immediately when the
     * data is already loaded or a load is already running.
     */
    fetchBillsData: (force?: boolean) => Promise<void>;

    refreshCustomerData: () => Promise<void>;
}

/**
 * How long the secondary lists wait for the balance before going out anyway.
 *
 * Covers the summary's first attempt and the pause before its second, so the
 * lists do not compete with the try that answers on most connections. Not the
 * whole ladder: a balance on its long third attempt must not hold the rest of
 * the page back for the best part of a minute.
 */
const SECONDARY_REQUEST_GRACE_MS = 9000;

const byDateDesc = <T extends { date: string }>(rows: T[]): T[] =>
    rows.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

export const useCustomerDashboardStore = create<CustomerDashboardState>((set, get) => ({
    customerDetail: null,
    paySummary: null,
    isPaySummaryLoading: false,
    soaRecords: [],
    invoiceRecords: [],
    paymentRecords: [],
    serviceChargeRecords: [],
    isLoading: false,
    isDetailLoading: false,
    isPaymentsLoading: false,
    isInvoicesLoading: false,
    isSoaLoading: false,
    isServiceChargesLoading: false,
    billsAccountNo: null,
    billsBillingId: null,
    billsIsCustomerRole: true,
    billsLoaded: false,
    isFromCache: false,
    error: null,
    fetchedAccountNo: null,
    requestedAccountNo: null,

    fetchCustomerData: async (usernameOrAccountNo: string, isCustomerRole = true) => {
        const { fetchedAccountNo, isLoading } = get();

        // Prevent refetching for the same user if already loaded
        if (fetchedAccountNo === usernameOrAccountNo || isLoading) return;

        // Put the last-known figures on screen before the first request even goes out,
        // so on a slow connection the page opens with content instead of a skeleton.
        // Only when nothing is in memory yet: a stored snapshot must never overwrite a
        // response already fetched this session.
        if (!get().customerDetail) {
            const cached = readDashboardCache(usernameOrAccountNo);
            if (cached) {
                set({
                    customerDetail: cached.customerDetail,
                    soaRecords: cached.soaRecords,
                    invoiceRecords: cached.invoiceRecords,
                    paymentRecords: cached.paymentRecords,
                    serviceChargeRecords: cached.serviceChargeRecords,
                    isFromCache: true,
                });
            }
        }

        set({
            isLoading: true,
            isDetailLoading: true,
            isPaySummaryLoading: true,
            isPaymentsLoading: true,
            // NOT set: this load no longer requests invoices, statements or
            // service charges. Marking them in-flight when no request exists
            // would leave Bills' skeletons up for a load that is never coming,
            // and the dashboard reads isInvoicesLoading for its due-date
            // fallback.
            error: null,
            requestedAccountNo: usernameOrAccountNo,
        });

        // Every in-flight flag has to come down on a bail-out too, or the page keeps
        // waiting on requests that are never going to be made.
        const settle = (patch: Partial<CustomerDashboardState>) =>
            set({
                ...patch,
                isLoading: false,
                isDetailLoading: false,
                isPaymentsLoading: false,
                isInvoicesLoading: false,
                isSoaLoading: false,
                isServiceChargesLoading: false,
            });

        // Started BEFORE the detail request is awaited, so the two are concurrent. This is
        // the whole point: the balance arrives on the short request instead of behind the
        // long one, and Pay Now unlocks as soon as it does.
        // One retry before giving up.
        //
        // getCustomerPaySummary never throws — it returns null for a refused
        // request, a timeout and an empty body alike — so a single blip on an
        // otherwise fast connection ended the balance's only fast path and left
        // the customer reading "Balance unavailable" with a figure sitting in the
        // database. The endpoint is a cheap read of one row, so asking twice
        // costs little and recovers the common case.
        //
        // Three attempts, each on a longer leash than the last.
        //
        // The balance is the one figure the page exists to show: everything
        // else can arrive late, but without this the customer cannot pay. So it
        // is asked for first, retried hardest, and given progressively more time
        // rather than being abandoned for being slow — see PAY_SUMMARY_TIMEOUTS_MS
        // for why a single short leash could not serve both a stalled request
        // and a slow connection.
        //
        // Backed off a little between tries so a server catching its breath is
        // given a moment rather than hit three times in a row.
        const fetchPaySummary = async () => {
            const waits = [0, 400, 1200];

            for (let attempt = 0; attempt < PAY_SUMMARY_TIMEOUTS_MS.length; attempt++) {
                if (waits[attempt] > 0) {
                    await new Promise((resolve) => setTimeout(resolve, waits[attempt]));
                }

                const summary = await getCustomerPaySummary(
                    usernameOrAccountNo,
                    PAY_SUMMARY_TIMEOUTS_MS[attempt]
                );

                if (summary) {
                    if (attempt > 0) {
                        console.info('[Dashboard] Pay summary recovered on attempt', attempt + 1);
                    }
                    return summary;
                }
            }

            console.warn('[Dashboard] Pay summary unavailable after 3 attempts', usernameOrAccountNo);
            return null;
        };

        const paySummaryDone = fetchPaySummary()
            .then((summary) => {
                // isFromCache clears here too. Whichever of the two responses lands first
                // has confirmed the figure the flag exists to guard, so the card should
                // stop labelling it as carried over from the last visit.
                set(summary
                    ? { paySummary: summary, isPaySummaryLoading: false, isFromCache: false }
                    : { isPaySummaryLoading: false });
            })
            .catch(() => {
                set({ isPaySummaryLoading: false });
            });

        let detail: CustomerDetailData | null = null;
        try {
            detail = await getCustomerDetail(usernameOrAccountNo);
        } catch (err: any) {
            console.error('Failed to fetch customer dashboard data:', err);
            await paySummaryDone;
            settle({ error: err?.message || 'Error loading dashboard data' });
            return;
        }

        if (!detail || !detail.billingAccount) {
            await paySummaryDone;
            settle({ error: 'Customer billing details not found' });
            return;
        }

        // Publish the primary record on its own, the moment it arrives. Everything the
        // header, profile card and balance card render lives in this one response, so
        // the customer sees their real name, plan and amount due one round trip in
        // rather than waiting on the list calls below. isFromCache clears here:
        // from this point what is on screen is server-confirmed.
        set({ customerDetail: detail, isDetailLoading: false, isFromCache: false });

        const accNo = detail.billingAccount.accountNo;
        const billingId = detail.billingAccount.id;

        // The balance gets a clear run at the connection before the payment
        // lists below compete with it for one.
        //
        // A browser will only hold a handful of requests to a host at once. On a
        // fast line that never matters — the summary has landed long before this
        // point and the race resolves immediately. On a slow one it decides
        // whether the figure the customer came for arrives before, or behind,
        // lists of history they have not scrolled to yet.
        //
        // Bounded by the grace period rather than by the summary alone: if the
        // balance is on its third and longest attempt, the rest of the page
        // should not be held back for the best part of a minute waiting on it.
        await Promise.race([
            paySummaryDone,
            new Promise((resolve) => setTimeout(resolve, SECONDARY_REQUEST_GRACE_MS)),
        ]);

        // Invoices, statements and service charges are NOT requested here.
        //
        // Nothing on the dashboard renders them: statements and service charges
        // belong to Bills alone, and the dashboard's only use of invoices is a
        // due-date fallback for when the pay-summary — which already carries
        // dueDate — has failed. Fetching all three on load meant three requests
        // per visit for data most visits never look at, competing with the one
        // request the page actually depends on.
        //
        // Bills asks for them itself through fetchBillsData(), which is where
        // they are read. See the accNo/billingId kept on the store for it.
        set({ billsAccountNo: accNo, billsBillingId: billingId, billsIsCustomerRole: isCustomerRole });

        // Payments are one list assembled from two sources, so these two do have to
        // meet before the merged result can be published.
        const payments = Promise.all([
            paymentPortalLogsService.getLogsByAccountNo(accNo).catch(() => []),
            transactionService.getTransactionsByAccountNo(accNo).catch(() => ({ success: false, data: [] })),
        ]).then(([logsRes, txRes]) => {
            // Process Payments
            const formattedLogs: Payment[] = Array.isArray(logsRes) ? logsRes.map((l: any) => ({
                id: `log-${l.id}`,
                date: l.date_time,
                reference: l.reference_no,
                amount: parseFloat(l.total_amount),
                source: 'Online',
                status: l.status || 'Success'
            })) : [];

            let formattedTxs: Payment[] = [];
            if (txRes && txRes.success && Array.isArray(txRes.data)) {
                formattedTxs = txRes.data
                    .map((t: any) => ({
                        id: `tx-${t.id}`,
                        date: t.payment_date || t.created_at,
                        reference: t.or_no || t.reference_no || `TR-${t.id}`,
                        amount: parseFloat(t.received_payment || t.amount || 0),
                        source: 'Manual',
                        status: 'Computed'
                    }));
            }

            set({
                paymentRecords: byDateDesc([...formattedLogs, ...formattedTxs]),
                isPaymentsLoading: false,
            });
        });

        // Service charges are Bills' too — fetchBillsData owns them now.

        // Every list is already on screen by this point; awaiting them here only keeps
        // the promise honest for callers that await fetchCustomerData and then read the
        // store expecting a complete result.
        //
        // allSettled, not all. `all` rejects the moment any one of these does, and this
        // await sits outside the try/catch above — so a single malformed response from
        // any secondary list skipped the line below and left `isLoading` true for ever.
        // From then on the guard at the top of this function early-returned on every
        // later call, so the dashboard could never load again for that session: no
        // refresh, no live update, and Try again did nothing either. The balance was
        // whatever had landed before the throw, which is exactly the intermittent
        // "no value on a fast connection" this was reported as.
        //
        // None of these lists is worth that. They are already rendered or already
        // failed on their own terms; what matters here is that the flag comes down.
        const names = ['pay-summary', 'payments'];
        const settled = await Promise.allSettled([paySummaryDone, payments]);

        settled.forEach((outcome, index) => {
            if (outcome.status === 'rejected') {
                console.error(`[Dashboard] ${names[index]} threw while loading`, outcome.reason);
            }
        });

        set({ fetchedAccountNo: usernameOrAccountNo, isLoading: false });

        // Written last, from what actually landed, so the next page load starts from
        // this rather than from an empty screen.
        const loaded = get();
        writeDashboardCache(usernameOrAccountNo, {
            customerDetail: loaded.customerDetail,
            soaRecords: loaded.soaRecords,
            invoiceRecords: loaded.invoiceRecords,
            paymentRecords: loaded.paymentRecords,
            serviceChargeRecords: loaded.serviceChargeRecords,
        });
    },

    /**
     * The three lists only Bills renders, fetched when Bills is opened.
     *
     * Guarded three ways so it can be called from a render without thought:
     * already-loaded returns immediately, an in-flight load is not started
     * twice, and a load before the main fetch has resolved the account is
     * deferred rather than issued against a null.
     */
    fetchBillsData: async (force = false) => {
        const {
            billsLoaded, billsAccountNo, billsBillingId, billsIsCustomerRole,
            isInvoicesLoading, isSoaLoading, isServiceChargesLoading,
        } = get();

        // Already have it, and nobody asked for it again.
        if (billsLoaded && !force) return;

        // Already running. Without this, Bills' effect firing twice — a remount,
        // StrictMode, a dependency changing — issued every request twice.
        if (isInvoicesLoading || isSoaLoading || isServiceChargesLoading) return;

        // The main load has not resolved the account yet. Bills calls this again
        // when customerDetail lands, so there is nothing to queue here.
        if (!billsAccountNo) return;

        set({ isInvoicesLoading: true, isSoaLoading: true, isServiceChargesLoading: true });

        const accNo = billsAccountNo;
        const billingId = billsBillingId ?? 0;
        const isCustomerRole = billsIsCustomerRole;

        // Each list publishes as it lands and owns its own failure: one list
        // going missing must not cost the other two, so every request carries a
        // catch and every branch clears its own flag.
        // Each resolves to whether it actually landed, which is what decides
        // below whether this counts as loaded.
        const invoices = (isCustomerRole
            ? invoiceService.getInvoicesByAccountNo(accNo)
            : invoiceService.getInvoicesByAccount(billingId))
            .then((invoiceRes) => {
                set({ invoiceRecords: Array.isArray(invoiceRes) ? invoiceRes : [], isInvoicesLoading: false });
                return true;
            })
            .catch((err) => {
                console.error('[Bills] invoices failed', err);
                set({ isInvoicesLoading: false });
                return false;
            });

        const soa = (isCustomerRole
            ? soaService.getStatementsByAccountNo(accNo)
            : soaService.getStatementsByAccount(billingId))
            .then((soaRes) => {
                set({ soaRecords: Array.isArray(soaRes) ? soaRes : [], isSoaLoading: false });
                return true;
            })
            .catch((err) => {
                console.error('[Bills] statements failed', err);
                set({ isSoaLoading: false });
                return false;
            });

        // Manual charge logs and the charges carried on service orders are shown
        // as one list, so these two do have to meet before publishing.
        let serviceChargesPartial = false;
        const serviceCharges = Promise.all([
            serviceChargeService.getServiceChargeLogsByAccountNo(accNo)
                .catch((err) => { console.error('[Bills] charge logs failed', err); serviceChargesPartial = true; return []; }),
            serviceChargeService.getServiceOrdersByAccountNo(accNo)
                .catch((err) => { console.error('[Bills] service orders failed', err); serviceChargesPartial = true; return []; }),
        ]).then(([serviceChargeLogsRes, serviceOrdersRes]) => {
            const formattedServiceChargeLogs: ServiceChargeRecord[] = Array.isArray(serviceChargeLogsRes)
                ? serviceChargeLogsRes.map((l: any) => ({
                    id: `log-${l.id}`,
                    date: l.created_at,
                    amount: parseFloat(l.service_charge),
                    type: 'Manual Charge',
                    status: l.status || 'Unused',
                    remarks: l.remarks,
                    source: 'Log',
                }))
                : [];

            const formattedServiceOrderCharges: ServiceChargeRecord[] = Array.isArray(serviceOrdersRes)
                ? serviceOrdersRes
                    .filter((so: any) => parseFloat(so.service_charge) > 0)
                    .map((so: any) => ({
                        id: `so-${so.id}`,
                        date: so.created_at || so.timestamp,
                        amount: parseFloat(so.service_charge),
                        type: so.concern || 'Service Order',
                        status: so.status === 'used' ? 'Used' : 'Unused',
                        remarks: so.concern_remarks,
                        source: 'Order',
                    }))
                : [];

            set({
                serviceChargeRecords: byDateDesc([...formattedServiceChargeLogs, ...formattedServiceOrderCharges]),
                isServiceChargesLoading: false,
            });
            return !serviceChargesPartial;
        }).catch((err) => {
            // The mapping above can throw on an unexpected shape, not just the
            // requests. Either way the flag has to come down or Bills shimmers
            // for ever.
            console.error('[Bills] service charges failed', err);
            set({ isServiceChargesLoading: false });
            return false;
        });

        // allSettled: a rejection here must not skip the bookkeeping below, or
        // the three in-flight flags would be the only thing left holding the
        // door and a later visit could not get in.
        const outcomes = await Promise.allSettled([invoices, soa, serviceCharges]);

        // Only a clean pass counts as loaded. A tab whose lists failed retries on
        // the next visit rather than staying empty for the rest of the session —
        // and since only mounting Bills calls this, that is at most one more
        // attempt per visit, not a loop.
        const allLanded = outcomes.every((o) => o.status === 'fulfilled' && o.value === true);

        set({ billsLoaded: allLanded });
    },

    refreshCustomerData: async () => {
        // Falls back to the requested account so this can also recover a load that
        // failed outright, which is the case that used to need a fresh sign-in.
        const { fetchedAccountNo, requestedAccountNo } = get();
        const target = fetchedAccountNo || requestedAccountNo;
        if (target) {
            // Both flags are cleared, not just the account.
            //
            // fetchCustomerData bails out early while `isLoading` is set, so a
            // Try again pressed during a stalled request did nothing at all —
            // the very moment the customer is most likely to press it. Clearing
            // isLoading here is what makes the button mean something: the old
            // request's promise may still be running, but its result is no
            // longer what the page is waiting on.
            //
            // billsLoaded is cleared too, so a refresh genuinely refreshes:
            // Bills fetches its three lists again the next time it is opened,
            // rather than showing what was loaded before the refresh.
            set({ fetchedAccountNo: null, isLoading: false, billsLoaded: false });
            await get().fetchCustomerData(target);
        }
    }
}));
