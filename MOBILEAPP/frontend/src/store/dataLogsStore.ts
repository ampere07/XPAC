import { create } from 'zustand';
import { getDataLogs, DataLogRecord } from '../services/dataLogsService';

interface DataLogsStore {
    logRecords: DataLogRecord[];
    isLoading: boolean;
    error: string | null;
    fetchLogRecords: (force?: boolean) => Promise<void>;
    refreshLogRecords: () => Promise<void>;
}

export const useDataLogsStore = create<DataLogsStore>((set, get) => ({
    logRecords: [],
    isLoading: false,
    error: null,

    fetchLogRecords: async (force = false) => {
        const { logRecords, isLoading } = get();

        // Prevent redundant loading if already loading or if logs exist and force is false
        if (isLoading || (logRecords.length > 0 && !force)) return;

        set({ isLoading: true, error: null });

        try {
            const result = await getDataLogs({ limit: 1000 });
            set({
                logRecords: result.data,
                isLoading: false
            });
        } catch (err: any) {
            console.error('Error in data logs store fetch:', err);
            set({
                error: err.message || 'Failed to load data logs',
                isLoading: false
            });
        }
    },

    refreshLogRecords: async () => {
        await get().fetchLogRecords(true);
    }
}));
