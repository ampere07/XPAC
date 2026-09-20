/**
 * The last-known customer dashboard payload, kept in localStorage.
 *
 * The dashboard used to start from an empty store on every page load, so the
 * customer watched a full-page skeleton for as long as the network took — and on the
 * mobile in-app browsers most of them use, that is seconds, every single time.
 * Reading the previous payload back is what lets the page paint real figures on the
 * first frame while the fresh ones are still in flight.
 *
 * Two rules keep a snapshot from ever being mistaken for live data:
 *
 *  - It is keyed by the account it was fetched for and only ever handed back for that
 *    same key, so a second customer signing in on the same device is served nothing.
 *  - The store marks hydrated state `isFromCache`, and the dashboard leaves Pay Now
 *    disabled while that flag is set. A stale balance is fine to *read*; it is not
 *    fine to charge someone against.
 */

const CACHE_KEY = 'customerDashboardCache.v1';

/** Past this age a snapshot is dropped rather than shown, however briefly. */
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Rows kept per list. The dashboard shows four payments and reads the due date off the
 * newest invoice; Bills paginates but refetches in full on mount, so it only needs
 * enough to fill its first page. Everything beyond that would spend the ~5MB
 * localStorage budget on rows nobody looks at before the fresh response replaces them.
 */
const MAX_ROWS = 25;

export interface CustomerDashboardSnapshot {
    customerDetail: any;
    soaRecords: any[];
    invoiceRecords: any[];
    paymentRecords: any[];
    serviceChargeRecords: any[];
}

interface StoredSnapshot extends CustomerDashboardSnapshot {
    accountKey: string;
    savedAt: number;
}

const trim = (rows: unknown): any[] =>
    Array.isArray(rows) ? rows.slice(0, MAX_ROWS) : [];

/**
 * The snapshot for `accountKey`, or null when there is none, it belongs to another
 * account, it has aged out, or storage is unreadable. Never throws: a private-mode
 * WebView refusing localStorage has to degrade to "no cache", not to a broken page.
 */
export const readDashboardCache = (
    accountKey: string
): CustomerDashboardSnapshot | null => {
    if (!accountKey) return null;

    try {
        const raw = localStorage.getItem(CACHE_KEY);
        if (!raw) return null;

        const stored = JSON.parse(raw) as StoredSnapshot;

        if (stored?.accountKey !== accountKey) return null;
        if (!stored.customerDetail) return null;
        if (typeof stored.savedAt !== 'number') return null;
        if (Date.now() - stored.savedAt > MAX_AGE_MS) return null;

        return {
            customerDetail: stored.customerDetail,
            soaRecords: trim(stored.soaRecords),
            invoiceRecords: trim(stored.invoiceRecords),
            paymentRecords: trim(stored.paymentRecords),
            serviceChargeRecords: trim(stored.serviceChargeRecords),
        };
    } catch {
        return null;
    }
};

export const writeDashboardCache = (
    accountKey: string,
    snapshot: CustomerDashboardSnapshot
): void => {
    if (!accountKey || !snapshot.customerDetail) return;

    try {
        const stored: StoredSnapshot = {
            accountKey,
            savedAt: Date.now(),
            customerDetail: snapshot.customerDetail,
            soaRecords: trim(snapshot.soaRecords),
            invoiceRecords: trim(snapshot.invoiceRecords),
            paymentRecords: trim(snapshot.paymentRecords),
            serviceChargeRecords: trim(snapshot.serviceChargeRecords),
        };
        localStorage.setItem(CACHE_KEY, JSON.stringify(stored));
    } catch {
        // Out of quota, or storage is refused outright. Drop whatever is there rather
        // than leaving a half-written entry behind, and carry on — the cache is an
        // accelerator, so failing to write one is not a failure worth surfacing.
        clearDashboardCache();
    }
};

/**
 * Called on sign-out: an explicit sign-out is the point at which the device may be
 * handed to someone else, so the previous customer's figures should not outlive it.
 * (Sign-*in* deliberately does not purge — the account key already makes a mismatched
 * snapshot unreadable, and keeping it is what makes signing back in instant.)
 */
export const clearDashboardCache = (): void => {
    try {
        localStorage.removeItem(CACHE_KEY);
    } catch {
        // Nothing to do; storage is unavailable, so there is nothing stored either.
    }
};
