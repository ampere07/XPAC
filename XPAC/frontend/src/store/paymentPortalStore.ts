import { create } from 'zustand';
import { paymentPortalLogsService, PaymentPortalLog } from '../services/paymentPortalLogsService';

const CHUNK_SIZE = 2000;

interface PaymentPortalStore {
    paymentPortalRecords: PaymentPortalLog[];
    totalCount: number;
    isLoading: boolean;
    error: string | null;
    fetchPaymentPortalRecords: (force?: boolean) => Promise<void>;
    refreshPaymentPortalRecords: () => Promise<void>;
    silentRefresh: () => Promise<void>;
    fetchUpdates: () => Promise<void>;
    lastUpdated: Date | null;
}

export const usePaymentPortalStore = create<PaymentPortalStore>((set, get) => ({
    paymentPortalRecords: [],
    totalCount: 0,
    isLoading: false,
    error: null,
    lastUpdated: null,

    fetchPaymentPortalRecords: async (force = false) => {
        const { paymentPortalRecords, isLoading } = get();

        // If already loading or data already exists (and not forcing), skip
        if (isLoading || (paymentPortalRecords.length > 0 && !force)) return;

        set({ isLoading: true, error: null });

        try {
            // Initial fetch
            const result = await paymentPortalLogsService.getAllLogs({
                limit: CHUNK_SIZE,
                offset: 0
            });

            if (!result.success) {
                throw new Error(result.message || 'Failed to fetch initial payment portal logs');
            }

            const dbTotal = result.total || 0;
            let allFetchedRecords = [...result.data];

            set({
                paymentPortalRecords: allFetchedRecords,
                totalCount: dbTotal,
                isLoading: false,
                lastUpdated: new Date()
            });

            // Progressive background loading
            let currentOffset = CHUNK_SIZE;
            let hasMore = allFetchedRecords.length < dbTotal;

            while (hasMore) {
                try {
                    const nextResult = await paymentPortalLogsService.getAllLogs({
                        limit: CHUNK_SIZE,
                        offset: currentOffset
                    });

                    if (nextResult && nextResult.success && nextResult.data && nextResult.data.length > 0) {
                        allFetchedRecords = [...allFetchedRecords, ...nextResult.data];
                        set({
                            paymentPortalRecords: [...allFetchedRecords],
                            totalCount: nextResult.total || dbTotal
                        });

                        currentOffset += CHUNK_SIZE;
                        hasMore = allFetchedRecords.length < dbTotal;
                    } else {
                        hasMore = false;
                    }
                } catch (chunkErr) {
                    console.error('Error in progressive payment portal fetch:', chunkErr);
                    hasMore = false;
                }
            }
        } catch (err: any) {
            console.error('Error fetching payment portal records:', err);
            set({
                error: err.message || 'Failed to load records',
                isLoading: false
            });
        }
    },

    refreshPaymentPortalRecords: async () => {
        set({ paymentPortalRecords: [] }); // Clear existing data
        await get().fetchPaymentPortalRecords(true);
    },

    silentRefresh: async () => {
        // Just triggers a background fetch if empty
        if (get().paymentPortalRecords.length === 0) {
            get().fetchPaymentPortalRecords();
        }
    },

    fetchUpdates: async () => {
        const { lastUpdated, paymentPortalRecords } = get();
        if (!lastUpdated) {
            await get().silentRefresh();
            return;
        }

        try {
            const formattedDate = lastUpdated.toISOString().slice(0, 19).replace('T', ' ');

            const result = await paymentPortalLogsService.getAllLogs({
                updated_since: formattedDate,
                limit: 1000
            });

            if (result && result.success && result.data && result.data.length > 0) {
                const updatedRecords = result.data;

                set((state) => {
                    const currentMap = new Map();
                    state.paymentPortalRecords.forEach((r: PaymentPortalLog) => currentMap.set(r.id, r));
                    
                    updatedRecords.forEach((r: PaymentPortalLog) => {
                        currentMap.set(r.id, r);
                    });

                    return {
                        paymentPortalRecords: Array.from(currentMap.values()).sort((a: any, b: any) => {
                            const dateA = new Date(a.date_time || 0).getTime();
                            const dateB = new Date(b.date_time || 0).getTime();
                            return dateB - dateA;
                        }),
                        totalCount: result.total || 
                                   (state.totalCount + updatedRecords.filter((r: PaymentPortalLog) => !state.paymentPortalRecords.find((o: PaymentPortalLog) => o.id === r.id)).length),
                        lastUpdated: new Date()
                    };
                });
            } else {
                set({ lastUpdated: new Date() });
            }
        } catch (err) {
            console.error('[PaymentPortalStore] Polling failed:', err);
        }
    }
}));
