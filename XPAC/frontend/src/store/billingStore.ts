import { create } from 'zustand';
import { getBillingRecords, BillingRecord } from '../services/billingService';

const CHUNK_SIZE = 1000;

interface BillingStore {
    billingRecords: BillingRecord[];
    totalCount: number;
    isLoading: boolean;
    error: string | null;
    lastFetchTimestamp: string | null;
    fetchBillingRecords: (force?: boolean) => Promise<void>;
    refreshBillingRecords: () => Promise<void>;
    silentRefresh: () => Promise<void>;
    refreshLatestData: () => Promise<void>;
}

export const useBillingStore = create<BillingStore>((set, get) => ({
    billingRecords: [],
    totalCount: 0,
    isLoading: false,
    error: null,
    lastFetchTimestamp: null,

    fetchBillingRecords: async (force = false) => {
        const { billingRecords, isLoading } = get();

        // If already loading or data already exists (and not forcing), skip
        if (isLoading || (billingRecords.length > 0 && !force)) return;

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
                lastFetchTimestamp: result.serverTime || new Date().toISOString()
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
                    lastFetchTimestamp: now
                });
            } else {
                set({ lastFetchTimestamp: result.serverTime || now });
            }

        } catch (err: any) {
            console.error('Error refreshing latest data:', err);
            set({
                error: err.message || 'Failed to refresh records'
            });
        }
    }
}));
