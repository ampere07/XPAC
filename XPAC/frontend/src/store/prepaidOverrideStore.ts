import { create } from 'zustand';
import { PrepaidOverrideRequest, prepaidOverrideService } from '../services/prepaidOverrideService';

interface PrepaidOverrideState {
    overrideRequests: PrepaidOverrideRequest[];
    isLoading: boolean;
    error: string | null;
    lastUpdated: string | null;
    fetchOverrideRequests: (force?: boolean) => Promise<void>;
    fetchUpdates: () => Promise<void>;
}

export const usePrepaidOverrideStore = create<PrepaidOverrideState>((set, get) => ({
    overrideRequests: [],
    isLoading: false,
    error: null,
    lastUpdated: null,

    fetchOverrideRequests: async (force = false) => {
        const { overrideRequests, isLoading } = get();

        // Data already in hand and no explicit refresh asked for — skip the round trip.
        if (overrideRequests.length > 0 && !force) return;

        if (!isLoading) set({ isLoading: true });
        try {
            const result = await prepaidOverrideService.getAllOverrideRequests();
            if (result.success) {
                set({
                    overrideRequests: result.data,
                    lastUpdated: result.serverTime || new Date().toISOString(),
                    error: null,
                });
            } else {
                set({ error: 'Failed to load prepaid override requests' });
            }
        } catch (err) {
            set({ error: 'An unexpected error occurred' });
        } finally {
            set({ isLoading: false });
        }
    },

    /**
     * Incremental poll: asks only for rows touched since the last SERVER timestamp.
     *
     * Anchored to the server's clock rather than the browser's — a client running even slightly
     * fast would otherwise skip past updates written in the gap and never see them.
     */
    fetchUpdates: async () => {
        const { lastUpdated } = get();
        if (!lastUpdated) {
            await get().fetchOverrideRequests(true);
            return;
        }

        try {
            const result = await prepaidOverrideService.getAllOverrideRequests(lastUpdated);

            if (result && result.success && result.data && result.data.length > 0) {
                const now = result.serverTime || new Date().toISOString();

                set((state) => {
                    const currentMap = new Map<number, PrepaidOverrideRequest>();
                    state.overrideRequests.forEach((r) => currentMap.set(r.id, r));
                    result.data.forEach((r) => currentMap.set(r.id, r));

                    return {
                        overrideRequests: Array.from(currentMap.values()).sort((a, b) => {
                            const dateA = new Date(a.created_at || 0).getTime();
                            const dateB = new Date(b.created_at || 0).getTime();
                            return dateB - dateA;
                        }),
                        lastUpdated: now,
                    };
                });
            } else if (result && result.success) {
                set({ lastUpdated: result.serverTime || new Date().toISOString() });
            }
        } catch (err) {
            console.error('[PrepaidOverrideStore] Polling failed:', err);
        }
    },
}));
