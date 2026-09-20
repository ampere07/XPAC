import { create } from 'zustand';
import { overdueService, Overdue } from '../services/overdueService';

const CHUNK_SIZE = 2000;

interface OverdueStore {
    overdueRecords: Overdue[];
    totalCount: number;
    isLoading: boolean;
    error: string | null;
    fetchOverdueRecords: (force?: boolean) => Promise<void>;
    refreshOverdueRecords: () => Promise<void>;
    silentRefresh: () => Promise<void>;
}

export const useOverdueStore = create<OverdueStore>((set, get) => ({
    overdueRecords: [],
    totalCount: 0,
    isLoading: false,
    error: null,

    fetchOverdueRecords: async (force = false) => {
        const { overdueRecords, isLoading } = get();

        // If already loading or data already exists (and not forcing), skip
        if (isLoading || (overdueRecords.length > 0 && !force)) return;

        set({ isLoading: true, error: null });

        try {
            // Initial fetch
            const result = await overdueService.getAll(false, 1, CHUNK_SIZE);

            if (!result.success) {
                throw new Error(result.message || 'Failed to fetch overdue records');
            }

            const dbTotal = result.pagination?.total || 0;
            let allFetchedRecords = result.data || [];

            set({
                overdueRecords: allFetchedRecords,
                totalCount: dbTotal,
                isLoading: false
            });

            // Progressive background loading
            let currentPage = 2;
            let hasMore = result.pagination?.has_more || false;

            while (hasMore) {
                try {
                    const nextResult = await overdueService.getAll(false, currentPage, CHUNK_SIZE);

                    if (nextResult && nextResult.success && nextResult.data && nextResult.data.length > 0) {
                        const nextBatch = nextResult.data;
                        allFetchedRecords = [...allFetchedRecords, ...nextBatch];
                        set({
                            overdueRecords: [...allFetchedRecords],
                            totalCount: nextResult.pagination?.total || dbTotal
                        });

                        currentPage++;
                        hasMore = nextResult.pagination?.has_more || false;
                    } else {
                        hasMore = false;
                    }
                } catch (chunkErr) {
                    console.error('Error in progressive overdue fetch:', chunkErr);
                    hasMore = false;
                }
            }
        } catch (err: any) {
            console.error('Error fetching overdue records:', err);
            set({
                error: err.message || 'Failed to load records',
                isLoading: false
            });
        }
    },

    refreshOverdueRecords: async () => {
        set({ overdueRecords: [] });
        await get().fetchOverdueRecords(true);
    },

    silentRefresh: async () => {
        try {
            const result = await overdueService.getAll(false, 1, CHUNK_SIZE);
            if (!result.success) return;

            const dbTotal = result.pagination?.total || 0;
            let allFetchedRecords = result.data || [];

            // Progressive background loading
            let currentPage = 2;
            let hasMore = result.pagination?.has_more || false;

            while (hasMore) {
                try {
                    const nextResult = await overdueService.getAll(false, currentPage, CHUNK_SIZE);

                    if (nextResult && nextResult.success && nextResult.data && nextResult.data.length > 0) {
                        const nextBatch = nextResult.data;
                        allFetchedRecords = [...allFetchedRecords, ...nextBatch];

                        currentPage++;
                        hasMore = nextResult.pagination?.has_more || false;
                    } else {
                        hasMore = false;
                    }
                } catch (chunkErr) {
                    console.error('Error in silent progressive fetch:', chunkErr);
                    hasMore = false;
                }
            }
            
            // Only update the state once ALL records have been fetched
            // This prevents the UI from flickering back to 2000 records and counting up
            set({
                overdueRecords: allFetchedRecords,
                totalCount: dbTotal
            });
        } catch (err: any) {
            console.error('Error in silentRefresh overdue:', err);
        }
    }
}));
