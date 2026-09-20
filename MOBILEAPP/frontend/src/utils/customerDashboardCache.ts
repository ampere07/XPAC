import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * The last-known customer dashboard payload, kept in AsyncStorage.
 *
 * The dashboard starts from empty state on every cold start, so the customer watches
 * skeletons for as long as the network takes — and this is a phone app, on the mobile
 * connections that are worst at exactly the moment someone wants to check what they
 * owe. The OS also kills and relaunches the process freely, so "cold start" is the
 * common case rather than the rare one. Reading the previous payload back is what lets
 * the card paint real figures immediately while the fresh ones are still in flight.
 *
 * Two rules keep a snapshot from ever being mistaken for live data:
 *
 *  - It is keyed by the account it was fetched for and only ever handed back for that
 *    same key, so a second customer signing in on the same handset is served nothing.
 *  - The provider marks hydrated state `isFromCache`, and the dashboard leaves Pay Now
 *    disabled while that flag is set. A stale balance is fine to *read*; it is not
 *    fine to charge someone against.
 *
 * Unlike the web build's equivalent this is async throughout — AsyncStorage has no
 * synchronous read — so nothing here can seed a useState initialiser. The provider
 * awaits it once at the start of its load instead, which costs a local read.
 */

const CACHE_KEY = 'customerDashboardCache.v1';

/** Past this age a snapshot is dropped rather than shown, however briefly. */
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Rows kept per list. The dashboard shows three payments and reads the due date off the
 * newest invoice; the other screens paginate and refetch in full anyway. Everything
 * beyond this would spend storage — and JSON parse time on the launch path, which is
 * the thing being optimised — on rows nobody sees before the fresh response lands.
 */
const MAX_ROWS = 25;

/**
 * Deliberately no `serviceOrders`. Support derives its one-hour ticket cooldown from the
 * newest one, so that list decides whether an action is allowed rather than just what is
 * displayed — and a snapshot that predates a ticket raised on another device would let a
 * second one through. Nothing on the dashboard renders service orders, so leaving them
 * out costs nothing on the path this cache exists to speed up.
 */
export interface CustomerDashboardSnapshot {
    customerDetail: any;
    payments: any[];
    soaRecords: any[];
    invoiceRecords: any[];
}

interface StoredSnapshot extends CustomerDashboardSnapshot {
    accountKey: string;
    savedAt: number;
}

const trim = (rows: unknown): any[] =>
    Array.isArray(rows) ? rows.slice(0, MAX_ROWS) : [];

/**
 * The snapshot for `accountKey`, or null when there is none, it belongs to another
 * account, it has aged out, or storage is unreadable. Never rejects: failing to read a
 * cache has to degrade to "no cache", not to a broken launch.
 */
export const readDashboardCache = async (
    accountKey: string
): Promise<CustomerDashboardSnapshot | null> => {
    if (!accountKey) return null;

    try {
        const raw = await AsyncStorage.getItem(CACHE_KEY);
        if (!raw) return null;

        const stored = JSON.parse(raw) as StoredSnapshot;

        if (stored?.accountKey !== accountKey) return null;
        if (!stored.customerDetail) return null;
        if (typeof stored.savedAt !== 'number') return null;
        if (Date.now() - stored.savedAt > MAX_AGE_MS) return null;

        return {
            customerDetail: stored.customerDetail,
            payments: trim(stored.payments),
            soaRecords: trim(stored.soaRecords),
            invoiceRecords: trim(stored.invoiceRecords),
        };
    } catch {
        return null;
    }
};

export const writeDashboardCache = async (
    accountKey: string,
    snapshot: CustomerDashboardSnapshot
): Promise<void> => {
    if (!accountKey || !snapshot.customerDetail) return;

    try {
        const stored: StoredSnapshot = {
            accountKey,
            savedAt: Date.now(),
            customerDetail: snapshot.customerDetail,
            payments: trim(snapshot.payments),
            soaRecords: trim(snapshot.soaRecords),
            invoiceRecords: trim(snapshot.invoiceRecords),
        };
        await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(stored));
    } catch {
        // Storage full or unavailable. Drop whatever is there rather than leaving a
        // half-written entry behind, and carry on — the cache is an accelerator, so
        // failing to write one is not a failure worth surfacing.
        await clearDashboardCache();
    }
};

/**
 * Called on sign-out: on a shared handset that is the point at which the device may
 * change hands, so the previous customer's figures should not outlive it. (Signing *in*
 * deliberately does not purge — the account key already makes a mismatched snapshot
 * unreadable, and keeping it is what makes signing back in instant.)
 */
export const clearDashboardCache = async (): Promise<void> => {
    try {
        await AsyncStorage.removeItem(CACHE_KEY);
    } catch {
        // Nothing to do; storage is unavailable, so there is nothing stored either.
    }
};
