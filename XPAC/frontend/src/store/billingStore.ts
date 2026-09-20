import { create } from 'zustand';
import { getBillingRecords, BillingRecord } from '../services/billingService';

const CHUNK_SIZE = 1000;

/**
 * How long loaded records are trusted before a visit is treated as a reason to re-sync.
 *
 * Everything in here is shared: one operator regrades an account, RADIUS drops a session, a
 * colleague takes a payment. A tab that loaded the table an hour ago and then skipped every fetch
 * because it already "has data" is showing an hour-old estate, and the operator has no way to tell.
 * Sixty seconds is short enough that a screen returned to is current, and long enough that moving
 * between pages does not re-query on every mount.
 */
const STALE_AFTER_MS = 60_000;

/**
 * One account's RADIUS session, as it arrives on the `online-status-updated` broadcast.
 */
export interface OnlineStatusUpdate {
    account_no: string;
    session_status?: string | null;
    session_ip?: string | null;
    active_sessions?: number | null;
}

interface BillingStore {
    billingRecords: BillingRecord[];
    totalCount: number;
    isLoading: boolean;
    error: string | null;
    /** Server clock at the last successful fetch. The cursor `updated_since` is given. */
    lastFetchTimestamp: string | null;
    /**
     * Browser clock at the last successful fetch, in epoch ms.
     *
     * Separate from lastFetchTimestamp on purpose. That one is the SERVER's time and is sent back
     * as a delta cursor, so it has to stay exactly as the server reported it; comparing it against
     * Date.now() would fold any clock skew between the two machines into the staleness test — and a
     * server a few minutes ahead would make the data look permanently fresh.
     */
    lastFetchAt: number | null;
    fetchBillingRecords: (force?: boolean) => Promise<void>;
    refreshBillingRecords: () => Promise<void>;
    silentRefresh: () => Promise<void>;
    refreshLatestData: () => Promise<void>;
    applyOnlineStatusBatch: (updates: OnlineStatusUpdate[]) => void;
}

/**
 * Held outside the store so that de-duplicating overlapping refreshes costs no re-render.
 *
 * Components subscribe to this store without a selector, so every state field they can see makes
 * them re-render when it changes — an `isRefreshing` flag in state would re-render the whole
 * customer table twice for each background sync.
 */
let refreshInFlight: Promise<void> | null = null;

export const useBillingStore = create<BillingStore>((set, get) => ({
    billingRecords: [],
    totalCount: 0,
    isLoading: false,
    error: null,
    lastFetchTimestamp: null,
    lastFetchAt: null,

    fetchBillingRecords: async (force = false) => {
        const { billingRecords, isLoading, lastFetchAt } = get();

        if (isLoading) return;

        if (billingRecords.length > 0 && !force) {
            // Records already loaded. This used to return here unconditionally, which meant a tab
            // left open never fetched again for the rest of its life. Re-reading the whole table
            // would be far too heavy for a page visit, so past the staleness window it runs the
            // delta sync instead: one request for what changed, applied in place.
            const age = lastFetchAt === null ? Number.POSITIVE_INFINITY : Date.now() - lastFetchAt;

            if (age >= STALE_AFTER_MS) {
                await get().refreshLatestData();
            }

            return;
        }

        set({ isLoading: true, error: null });

        try {
            // Initial fetch
            const result = await getBillingRecords(1, CHUNK_SIZE);

            const dbTotal = result.total || 0;
            let allFetchedRecords = result.data;

            set({
                billingRecords: allFetchedRecords,
                totalCount: dbTotal,
                isLoading: false,
                lastFetchTimestamp: result.serverTime || new Date().toISOString(),
                lastFetchAt: Date.now()
            });

            // Progressive background loading
            let currentPage = 2;
            let hasMore = result.hasMore;

            while (hasMore) {
                try {
                    const nextResult = await getBillingRecords(currentPage, CHUNK_SIZE);

                    if (nextResult && nextResult.data && nextResult.data.length > 0) {
                        allFetchedRecords = [...allFetchedRecords, ...nextResult.data];
                        set({
                            billingRecords: [...allFetchedRecords],
                            totalCount: nextResult.total || dbTotal
                        });

                        currentPage++;
                        hasMore = nextResult.hasMore;
                    } else {
                        hasMore = false;
                    }
                } catch (chunkErr) {
                    console.error('Error in progressive billing fetch:', chunkErr);
                    hasMore = false;
                }
            }
        } catch (err: any) {
            console.error('Error fetching billing records:', err);
            set({
                error: err.message || 'Failed to load records',
                isLoading: false
            });
        }
    },

    refreshBillingRecords: async () => {
        set({ billingRecords: [] });
        await get().fetchBillingRecords(true);
    },

    silentRefresh: async () => {
        if (get().billingRecords.length === 0) {
            get().fetchBillingRecords();
        }
    },

    refreshLatestData: async () => {
        // A tab becoming visible, a stale mount and a WebSocket nudge can all land at once. They
        // would each ask for the same delta, and the last one to finish would write back a cursor
        // older than the others had already advanced past, silently losing that window's changes.
        if (refreshInFlight) return refreshInFlight;

        refreshInFlight = (async () => {
            const { lastFetchTimestamp } = get();
            set({ error: null });
            try {
                // Use updated_since to fetch only records changed since last fetch
                const result = await getBillingRecords(1, 10000, lastFetchTimestamp || undefined);

                const now = result.serverTime || new Date().toISOString();

                if (result.data.length > 0) {
                    const existingRecords = get().billingRecords;
                    const newRecordsMap = new Map<string, BillingRecord>();
                    result.data.forEach(r => newRecordsMap.set(r.id, r));

                    const existingIds = new Set(existingRecords.map(r => r.id));

                    // Update existing records with fresh data
                    const mergedRecords = existingRecords.map(r =>
                        newRecordsMap.has(r.id) ? newRecordsMap.get(r.id)! : r
                    );

                    // Add brand new records that don't exist yet
                    const brandNewRecords = result.data.filter(r => !existingIds.has(r.id));

                    set({
                        billingRecords: [...brandNewRecords, ...mergedRecords],
                        totalCount: Math.max(get().totalCount, result.total || 0),
                        lastFetchTimestamp: now,
                        lastFetchAt: Date.now()
                    });
                } else {
                    set({ lastFetchTimestamp: now, lastFetchAt: Date.now() });
                }

            } catch (err: any) {
                console.error('Error refreshing latest data:', err);
                set({
                    error: err.message || 'Failed to refresh records'
                });
            }
        })();

        try {
            await refreshInFlight;
        } finally {
            refreshInFlight = null;
        }
    },

    /**
     * Apply one `online-status-updated` broadcast to the records already loaded.
     *
     * The point of taking the batch this way is that it costs no request: the sync has just written
     * these values and told us what they are, so every open screen can show them without anyone
     * re-reading the table.
     *
     * Untouched records keep their existing object identity, so a memoised row only re-renders when
     * that row's own subscriber actually changed — which is what makes a 250-account frame cheap on
     * a table of twenty thousand.
     */
    applyOnlineStatusBatch: (updates: OnlineStatusUpdate[]) => {
        if (!Array.isArray(updates) || updates.length === 0) return;

        const byAccount = new Map<string, OnlineStatusUpdate>();
        updates.forEach(update => {
            if (update && update.account_no) {
                byAccount.set(String(update.account_no), update);
            }
        });

        if (byAccount.size === 0) return;

        const records = get().billingRecords;
        if (records.length === 0) return;

        let changed = false;

        const next = records.map(record => {
            const key = record.account_no || record.accountNo || record.id;
            const update = key ? byAccount.get(String(key)) : undefined;

            if (!update) return record;

            const onlineStatus = update.session_status ?? record.onlineStatus;
            // Normalised to '' the way billingService maps a null address, so a record updated by
            // this path and one loaded from the API compare equal.
            const sessionIP = update.session_ip ?? '';
            const activeSessions = update.active_sessions ?? record.active_sessions;

            if (
                record.onlineStatus === onlineStatus &&
                record.sessionIP === sessionIP &&
                record.active_sessions === activeSessions
            ) {
                return record;
            }

            changed = true;

            return {
                ...record,
                onlineStatus,
                sessionIP,
                active_sessions: activeSessions
            };
        });

        if (changed) {
            set({ billingRecords: next });
        }
    }
}));

/**
 * Re-sync when an operator comes back to the tab.
 *
 * A backgrounded tab misses everything: browsers throttle its timers, and Soketi drops the socket
 * on a laptop that slept. Returning to the tab is the one moment we know the operator is about to
 * read the data, so it is the moment worth spending a request on — and only if what is on screen is
 * already past the staleness window, so flicking between tabs does not re-query.
 *
 * Registered once at module scope rather than per component: several screens read this store, and a
 * listener per mount would fire the same refresh several times over.
 */
if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState !== 'visible') return;

        const { billingRecords, lastFetchAt, isLoading } = useBillingStore.getState();

        // Nothing loaded yet, or the first load is still running — whoever started it owns this.
        if (isLoading || billingRecords.length === 0) return;

        if (lastFetchAt !== null && Date.now() - lastFetchAt < STALE_AFTER_MS) return;

        void useBillingStore.getState().refreshLatestData();
    });
}
