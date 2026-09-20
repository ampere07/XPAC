import { create } from 'zustand';
import { Transaction } from '../types/transaction';
import { transactionService } from '../services/transactionService';

interface TransactionState {
    transactions: Transaction[];
    totalCount: number;
    isLoading: boolean;
    error: string | null;
    lastUpdated: Date | null;
    currentFetchId: number | null; // Track current valid fetch
    fetchTransactions: (force?: boolean, silent?: boolean) => Promise<void>;
    silentRefresh: () => Promise<void>;
    refreshTransactions: () => Promise<void>;
    fetchUpdates: () => Promise<void>;
}

export const useTransactionStore = create<TransactionState>((set, get) => ({
    transactions: [],
    totalCount: 0,
    isLoading: false,
    error: null,
    lastUpdated: null,
    currentFetchId: null,

    fetchTransactions: async (force = false, silent = false) => {
        const fetchId = Date.now();
        set({ currentFetchId: fetchId });

        const { transactions, isLoading, totalCount } = get();

        // If explicitly forced, we reset
        const isInitialFetch = transactions.length === 0;

        // Only return if we already have all records and not forced
        if (!force && transactions.length >= totalCount && totalCount > 0) {
            return;
        }

        if (isLoading && !force) return;

        if (!silent && isInitialFetch) {
            set({ isLoading: true });
        }

        try {
            const CHUNK_SIZE = 2000; 
            let allFetchedRecords = force ? [] : [...transactions];
            let dbTotal = totalCount;
            let currentOffset = allFetchedRecords.length;

            // Fetch first/next chunk
            const result = await transactionService.getAllTransactions(CHUNK_SIZE, currentOffset);

            // Check if this fetch is still valid
            if (get().currentFetchId !== fetchId) {
                return;
            }

            if (result && result.success) {
                dbTotal = result.total || result.count || result.data.length;
                const newRecords = result.data;
                allFetchedRecords = [...allFetchedRecords, ...newRecords];

                set({
                    transactions: allFetchedRecords,
                    totalCount: dbTotal,
                    lastUpdated: new Date(),
                    error: null,
                    isLoading: false 
                });

                // Progressive background loading if more remain
                let hasMore = allFetchedRecords.length < dbTotal;

                while (hasMore) {
                    // Check validity inside the loop
                    if (get().currentFetchId !== fetchId) {
                        return;
                    }

                    currentOffset = allFetchedRecords.length;

                    try {
                        const nextResult = await transactionService.getAllTransactions(CHUNK_SIZE, currentOffset);
                        
                        // Check validity again after async call
                        if (get().currentFetchId !== fetchId) return;

                        if (nextResult && nextResult.success && nextResult.data && nextResult.data.length > 0) {
                            allFetchedRecords = [...allFetchedRecords, ...nextResult.data];
                            set({
                                transactions: [...allFetchedRecords],
                                totalCount: nextResult.total || dbTotal
                            });
                            hasMore = allFetchedRecords.length < dbTotal;
                        } else {
                            hasMore = false;
                        }
                    } catch (chunkErr) {
                        console.error('Error in progressive fetch:', chunkErr);
                        hasMore = false;
                    }
                }
            } else {
                throw new Error(result.message || 'Failed to fetch transactions');
            }
        } catch (err: any) {
            console.error('Failed to fetch transactions:', err);
            // Only set error if this is still the active fetch and we have no data
            if (get().currentFetchId === fetchId && !silent && get().transactions.length === 0) {
                set({ error: 'Failed to load transactions. Please try again.' });
            }
        } finally {
            // Only stop loading if this is the active fetch
            if (get().currentFetchId === fetchId) {
                set({ isLoading: false });
            }
        }
    },

    silentRefresh: async () => {
        await get().fetchTransactions(true, true);
    },

    refreshTransactions: async () => {
        await get().fetchTransactions(true, false);
    },

    fetchUpdates: async () => {
        const { lastUpdated } = get();
        if (!lastUpdated) {
            await get().silentRefresh();
            return;
        }

        try {
            const formattedDate = lastUpdated.toISOString().slice(0, 19).replace('T', ' ');

            const result = await (transactionService.getAllTransactions as any)(1000, 0, formattedDate);

            if (result && result.success && result.data && result.data.length > 0) {
                const updatedTransactions = result.data;

                set((state) => {
                    const currentMap = new Map();
                    state.transactions.forEach((t: Transaction) => currentMap.set(t.id, t));
                    
                    updatedTransactions.forEach((t: Transaction) => {
                        currentMap.set(t.id, t);
                    });

                    return {
                        transactions: Array.from(currentMap.values()).sort((a: any, b: any) => {
                            const dateA = new Date(a.created_at || a.payment_date || 0).getTime();
                            const dateB = new Date(b.created_at || b.payment_date || 0).getTime();
                            return dateB - dateA;
                        }),
                        totalCount: result.total || 
                                   (state.totalCount + updatedTransactions.filter((t: Transaction) => !state.transactions.find(o => o.id === t.id)).length),
                        lastUpdated: new Date()
                    };
                });
            } else {
                set({ lastUpdated: new Date() });
            }
        } catch (err) {
            console.error('[TransactionStore] Polling failed:', err);
        }
    }
}));
