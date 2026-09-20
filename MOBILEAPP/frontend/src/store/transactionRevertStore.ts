import { create } from 'zustand';
import { TransactionRevert, transactionRevertService } from '../services/transactionRevertService';

interface TransactionRevertState {
    revertRequests: TransactionRevert[];
    isLoading: boolean;
    error: string | null;
    lastUpdated: string | null;
    fetchRevertRequests: (force?: boolean) => Promise<void>;
    fetchUpdates: () => Promise<void>;
}

export const useTransactionRevertStore = create<TransactionRevertState>((set, get) => ({
    revertRequests: [],
    isLoading: false,
    error: null,
    lastUpdated: null,

    fetchRevertRequests: async (force = false) => {
        const { revertRequests, isLoading } = get();
        
        // If data exists and not forcing, skip full fetch
        if (revertRequests.length > 0 && !force) return;

        if (!isLoading) set({ isLoading: true });
        try {
            const result = await transactionRevertService.getAllRevertRequests();
            if (result.success) {
                set({
                    revertRequests: result.data,
                    lastUpdated: result.serverTime || new Date().toISOString(),
                    error: null
                });
            } else {
                set({ error: 'Failed to load revert requests' });
            }
        } catch (err) {
            set({ error: 'An unexpected error occurred' });
        } finally {
            set({ isLoading: false });
        }
    },

    fetchUpdates: async () => {
        const { lastUpdated } = get();
        if (!lastUpdated) {
            await get().fetchRevertRequests(true);
            return;
        }

        try {
            // Using the timestamp directly from serverTime
            const result = await transactionRevertService.getAllRevertRequests(lastUpdated);

            if (result && result.success && result.data && result.data.length > 0) {
                const updatedRequests = result.data;
                const now = result.serverTime || new Date().toISOString();
                
                set((state) => {
                    const currentMap = new Map();
                    state.revertRequests.forEach((r: TransactionRevert) => currentMap.set(r.id, r));
                    
                    updatedRequests.forEach((r: TransactionRevert) => {
                        currentMap.set(r.id, r);
                    });

                    return {
                        revertRequests: Array.from(currentMap.values()).sort((a: any, b: any) => {
                            const dateA = new Date(a.created_at || 0).getTime();
                            const dateB = new Date(b.created_at || 0).getTime();
                            return dateB - dateA;
                        }),
                        lastUpdated: now
                    };
                });
            } else if (result && result.success) {
                set({ lastUpdated: result.serverTime || new Date().toISOString() });
            }
        } catch (err) {
            console.error('[TransactionRevertStore] Polling failed:', err);
        }
    }
}));
