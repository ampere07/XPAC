import { create } from 'zustand';
import { getJobOrders } from '../services/jobOrderService';
import { JobOrder } from '../types/jobOrder';

interface JobOrderState {
    jobOrders: JobOrder[];
    totalCount: number;
    isLoading: boolean;
    error: string | null;
    hasMore: boolean;
    currentPage: number;
    lastUpdated: Date | null;
    isFullyLoaded: boolean;

    fetchJobOrders: (page?: number, limit?: number, search?: string, assignedEmail?: string, silent?: boolean) => Promise<void>;
    refreshJobOrders: (assignedEmail?: string) => Promise<void>;
    silentRefresh: (assignedEmail?: string) => Promise<void>;
    fetchUpdates: (assignedEmail?: string) => Promise<void>;
    clearJobOrders: () => void;
}

export const useJobOrderStore = create<JobOrderState>((set, get) => ({
    jobOrders: [],
    totalCount: 0,
    isLoading: false,
    error: null,
    hasMore: true,
    currentPage: 1,
    lastUpdated: null,
    isFullyLoaded: false,

    fetchJobOrders: async (page = 1, limit = 1000, search = '', assignedEmail?: string, silent = false) => {
        const { jobOrders, isLoading, totalCount } = get();

        // If already loading and it's the first page, ignore to prevent duplicates
        if (isLoading && page === 1) return;

        const isInitialFetch = jobOrders.length === 0 || page === 1;

        // Only show loading spinner if it's the first fetch and not silent
        if (!silent || isInitialFetch) {
            set({ isLoading: true, error: null });
        }

        try {
            const CHUNK_SIZE = limit || 1000;
            const ordersMap = new Map();
            
            // If it's a fresh fetch (page 1), we start with an empty map unless silent
            if (page === 1 && !silent) {
                // Fresh start
            } else {
                jobOrders.forEach(jo => ordersMap.set(jo.id, jo));
            }

            let currentFetchPage = page;

            const firstResult = await getJobOrders(false, currentFetchPage, CHUNK_SIZE, search, assignedEmail);

            if (firstResult && firstResult.success && Array.isArray(firstResult.jobOrders)) {
                const dbTotal = (firstResult.pagination as any)?.total_count || (firstResult.pagination as any)?.total || firstResult.jobOrders.length;
                
                firstResult.jobOrders.forEach(jo => ordersMap.set(jo.id, jo));

                const sortFn = (a: JobOrder, b: JobOrder) => {
                    const timeA = new Date(a.Timestamp || a.timestamp || a.created_at || a.Timestamp || 0).getTime();
                    const timeB = new Date(b.Timestamp || b.timestamp || b.created_at || b.Timestamp || 0).getTime();
                    if (timeA !== timeB) return timeB - timeA;

                    // Fallback to ID sorting if timestamps are same
                    const idA = parseInt(String(a.id)) || 0;
                    const idB = parseInt(String(b.id)) || 0;
                    return idB - idA;
                };

                const mergedOrders = Array.from(ordersMap.values()).sort(sortFn);

                set({
                    jobOrders: mergedOrders,
                    totalCount: dbTotal,
                    lastUpdated: new Date(),
                    error: null,
                    isLoading: false,
                    hasMore: firstResult.pagination?.has_more ?? (mergedOrders.length < dbTotal),
                    isFullyLoaded: dbTotal === 0 || mergedOrders.length >= dbTotal,
                    currentPage: currentFetchPage
                });

                // Progressive Loading: Continue fetching remaining chunks if this was the initial request
                if (page === 1) {
                    let hasMoreChunks = firstResult.pagination?.has_more ?? (mergedOrders.length < dbTotal);
                    currentFetchPage++;

                    while (hasMoreChunks) {
                        try {
                            const result = await getJobOrders(false, currentFetchPage, CHUNK_SIZE, search, assignedEmail);

                            if (result && result.success && Array.isArray(result.jobOrders) && result.jobOrders.length > 0) {
                                result.jobOrders.forEach(jo => ordersMap.set(jo.id, jo));
                                
                                const updatedMerged = Array.from(ordersMap.values()).sort(sortFn);
                                const currentTotal = (result.pagination as any)?.total_count || (result.pagination as any)?.total || dbTotal;
                                
                                set({
                                    jobOrders: updatedMerged,
                                    totalCount: currentTotal,
                                    hasMore: result.pagination?.has_more ?? (updatedMerged.length < currentTotal),
                                    isFullyLoaded: currentTotal === 0 || updatedMerged.length >= currentTotal,
                                    currentPage: currentFetchPage
                                });

                                hasMoreChunks = result.pagination?.has_more ?? (updatedMerged.length < currentTotal);
                                currentFetchPage++;
                            } else {
                                hasMoreChunks = false;
                            }
                        } catch (chunkErr) {
                            console.error(`[JobOrderStore] Error fetching JobOrder chunk:`, chunkErr);
                            hasMoreChunks = false;
                        }
                    }
                }
            } else {
                set({ 
                    isLoading: false, 
                    error: firstResult.message || 'Failed to fetch job orders' 
                });
            }
        } catch (err: any) {
            console.error('[JobOrderStore] Fetch failed:', err);
            set({ error: err.message || 'Failed to fetch job orders', isLoading: false });
        } finally {
            set({ isLoading: false });
        }
    },

    refreshJobOrders: async (assignedEmail?: string) => {
        await get().fetchJobOrders(1, 1000, '', assignedEmail, false);
    },

    silentRefresh: async (assignedEmail?: string) => {
        await get().fetchJobOrders(1, 1000, '', assignedEmail, true);
    },

    clearJobOrders: () => {
        set({
            jobOrders: [],
            totalCount: 0,
            isLoading: false,
            error: null,
            hasMore: true,
            currentPage: 1,
            lastUpdated: null,
            isFullyLoaded: false,
        });
    },

    fetchUpdates: async (assignedEmail?: string) => {
        const { lastUpdated, jobOrders } = get();
        if (!lastUpdated) {
            await get().silentRefresh(assignedEmail);
            return;
        }

        try {
            // Format date for MySQL: YYYY-MM-DD HH:mm:ss
            const formattedDate = lastUpdated.toISOString().slice(0, 19).replace('T', ' ');

            const response = await (getJobOrders as any)(false, 1, 1000, '', assignedEmail, formattedDate);

            if (response.success && response.jobOrders && response.jobOrders.length > 0) {
                const updatedJOs = response.jobOrders;

                set((state) => {
                    const currentMap = new Map();
                    state.jobOrders.forEach(jo => currentMap.set(jo.id, jo));

                    // Merge updates
                    updatedJOs.forEach((jo: any) => {
                        const existing = currentMap.get(jo.id);
                        if (existing) {
                            currentMap.set(jo.id, { ...existing, ...jo });
                        } else {
                            currentMap.set(jo.id, jo);
                        }
                    });

                    const sortFn = (a: JobOrder, b: JobOrder) => {
                        const timeA = new Date(a.Timestamp || a.timestamp || a.created_at || a.Timestamp || 0).getTime();
                        const timeB = new Date(b.Timestamp || b.timestamp || b.created_at || b.Timestamp || 0).getTime();
                        if (timeA !== timeB) return timeB - timeA;
                        const idA = parseInt(String(a.id)) || 0;
                        const idB = parseInt(String(b.id)) || 0;
                        return idB - idA;
                    };

                    return {
                        jobOrders: Array.from(currentMap.values()).sort(sortFn),
                        totalCount: (response.pagination as any)?.total_count || 
                                   (state.totalCount + updatedJOs.filter((jo: any) => !state.jobOrders.find(o => o.id === jo.id)).length),
                        isFullyLoaded: true, // If we're getting updates, we must have finished initial load
                        lastUpdated: new Date()
                    };
                });
            } else {
                set({ lastUpdated: new Date() });
            }
        } catch (err) {
            console.error('[JobOrderStore] Polling failed:', err);
        }
    }
}));
