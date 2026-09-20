import { create } from 'zustand';
import { getReconnectionLogs, ReconnectionLogRecord } from '../services/reconnectionService';

const CHUNK_SIZE = 1000;

interface ReconnectionStore {
    logRecords: ReconnectionLogRecord[];
    totalCount: number;
    isLoading: boolean;
    error: string | null;
    fetchLogRecords: (force?: boolean) => Promise<void>;
    refreshLogRecords: () => Promise<void>;
    silentRefresh: () => Promise<void>;
}

export const useReconnectionStore = create<ReconnectionStore>((set, get) => ({
    logRecords: [],
    totalCount: 0,
    isLoading: false,
    error: null,

    fetchLogRecords: async (force = false) => {
        const { logRecords, isLoading } = get();

        if (isLoading || (logRecords.length > 0 && !force)) return;

        set({ isLoading: true, error: null });

        try {
            const result = await getReconnectionLogs(1, CHUNK_SIZE);

            const dbTotal = result.total || 0;
            let allFetchedRecords = result.data;

            set({
                logRecords: allFetchedRecords,
                totalCount: dbTotal,
                isLoading: false
            });

            let currentPage = 2;
            let hasMore = result.hasMore;

            while (hasMore) {
                try {
                    const nextResult = await getReconnectionLogs(currentPage, CHUNK_SIZE);

                    if (nextResult && nextResult.data && nextResult.data.length > 0) {
                        allFetchedRecords = [...allFetchedRecords, ...nextResult.data];
                        set({
                            logRecords: [...allFetchedRecords],
                            totalCount: nextResult.total || dbTotal
                        });

                        currentPage++;
                        hasMore = nextResult.hasMore;
                    } else {
                        hasMore = false;
                    }
                } catch (chunkErr) {
                    console.error('Error in progressive reconnection fetch:', chunkErr);
                    hasMore = false;
                }
            }
        } catch (err: any) {
            console.error('Error fetching reconnection logs:', err);
            set({
                error: err.message || 'Failed to load records',
                isLoading: false
            });
        }
    },

    refreshLogRecords: async () => {
        set({ logRecords: [] });
        await get().fetchLogRecords(true);
    },

    silentRefresh: async () => {
        if (get().logRecords.length === 0) {
            get().fetchLogRecords();
        }
    }
}));
