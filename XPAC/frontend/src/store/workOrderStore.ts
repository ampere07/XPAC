import { create } from 'zustand';
import { getWorkOrders } from '../services/workOrderService';
import { WorkOrder } from '../types/workOrder';

interface WorkOrderState {
    workOrders: WorkOrder[];
    totalCount: number;
    isLoading: boolean;
    error: string | null;
    hasMore: boolean;
    currentPage: number;
    lastUpdated: Date | null;

    fetchWorkOrders: (page?: number, limit?: number, search?: string, status?: string, silent?: boolean) => Promise<void>;
    refreshWorkOrders: (status?: string) => Promise<void>;
    silentRefresh: (status?: string) => Promise<void>;
    fetchUpdates: (status?: string) => Promise<void>;
}

export const useWorkOrderStore = create<WorkOrderState>((set, get) => ({
    workOrders: [],
    totalCount: 0,
    isLoading: false,
    error: null,
    hasMore: true,
    currentPage: 1,
    lastUpdated: null,

    fetchWorkOrders: async (page = 1, limit = 50, search = '', status = '', silent = false) => {
        if (!silent) set({ isLoading: true, error: null });
        try {
            const response = await getWorkOrders(false, page, limit, search, status);

            if (response.success) {
                const newWorkOrders = response.workOrders || [];
                set((state) => ({
                    workOrders: page === 1 ? newWorkOrders : [...state.workOrders, ...newWorkOrders],
                    totalCount: response.pagination?.total_items || state.totalCount,
                    hasMore: response.pagination?.has_next ?? false,
                    currentPage: page,
                    lastUpdated: new Date(),
                    isLoading: false
                }));
            } else {
                set({ error: response.message || 'Failed to fetch work orders', isLoading: false });
            }
        } catch (err: any) {
            set({ error: err.message || 'Error occurred while fetching work orders', isLoading: false });
        }
    },

    refreshWorkOrders: async (status?: string) => {
        set({ workOrders: [], currentPage: 1, hasMore: true });
        await get().fetchWorkOrders(1, 10000, '', status);
    },

    silentRefresh: async (status?: string) => {
        await get().fetchWorkOrders(1, 10000, '', status, true);
    },

    fetchUpdates: async (status?: string) => {
        const { lastUpdated } = get();
        if (!lastUpdated) {
            await get().silentRefresh(status);
            return;
        }

        try {
            const formattedDate = lastUpdated.toISOString().slice(0, 19).replace('T', ' ');
            console.log(`[WorkOrderStore] Polling for updates since: ${formattedDate}`);

            const response = await getWorkOrders(false, 1, 1000, '', status, formattedDate);

            if (response.success && response.workOrders && response.workOrders.length > 0) {
                console.log(`[WorkOrderStore] Received ${response.workOrders.length} work order updates`);
                const updatedWOs = response.workOrders;

                set((state) => {
                    const currentMap = new Map();
                    state.workOrders.forEach(wo => currentMap.set(wo.id, wo));
                    
                    updatedWOs.forEach(wo => {
                        currentMap.set(wo.id, wo);
                    });

                    return {
                        workOrders: Array.from(currentMap.values()).sort((a: any, b: any) => {
                            const dateA = new Date(a.requested_date || 0).getTime();
                            const dateB = new Date(b.requested_date || 0).getTime();
                            return dateB - dateA;
                        }),
                        totalCount: response.pagination?.total_items || 
                                   (state.totalCount + updatedWOs.filter(wo => !state.workOrders.find(o => o.id === wo.id)).length),
                        lastUpdated: new Date()
                    };
                });
            } else {
                set({ lastUpdated: new Date() });
            }
        } catch (err) {
            console.error('[WorkOrderStore] Polling failed:', err);
        }
    }
}));
