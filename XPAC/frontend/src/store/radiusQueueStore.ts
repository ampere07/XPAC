import { create } from 'zustand';
import { getRadiusQueue, RadiusQueueRecord } from '../services/radiusQueueService';

/**
 * The RADIUS queue, cached the way the data-logs store caches its rows: fetched
 * once on first open, and only re-fetched when something asks for it.
 */
interface RadiusQueueStore {
    queueRecords: RadiusQueueRecord[];
    isLoading: boolean;
    error: string | null;
    fetchQueueRecords: (force?: boolean) => Promise<void>;
    refreshQueueRecords: () => Promise<void>;
}

export const useRadiusQueueStore = create<RadiusQueueStore>((set, get) => ({
    queueRecords: [],
    isLoading: false,
    error: null,

    fetchQueueRecords: async (force = false) => {
        const { queueRecords, isLoading } = get();

        if (isLoading || (queueRecords.length > 0 && !force)) return;

        set({ isLoading: true, error: null });

        try {
            const result = await getRadiusQueue({ limit: 1000 });
            set({ queueRecords: result.data, isLoading: false });
        } catch (err: any) {
            console.error('Error in radius queue store fetch:', err);
            set({
                error: err.message || 'Failed to load the radius queue',
                isLoading: false,
            });
        }
    },

    refreshQueueRecords: async () => {
        await get().fetchQueueRecords(true);
    },
}));
