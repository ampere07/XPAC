import { create } from 'zustand';
import { getLCPs, LCP, createLCP, updateLCP, deleteLCP } from '../services/lcpService';

interface LcpState {
    lcpItems: LCP[];
    isLoading: boolean;
    error: string | null;
    hasMore: boolean;
    currentPage: number;
    totalCount: number;
    searchQuery: string;

    fetchLcpItems: (page?: number, limit?: number, searchQuery?: string, silent?: boolean) => Promise<void>;
    addLcpItem: (name: string, email_address?: string) => Promise<void>;
    updateLcpItem: (id: number, name: string, email_address?: string) => Promise<void>;
    deleteLcpItem: (id: number) => Promise<void>;
    refreshLcpItems: () => Promise<void>;
    silentRefresh: () => Promise<void>;
    setSearchQuery: (query: string) => void;
}

export const useLcpStore = create<LcpState>((set, get) => ({
    lcpItems: [],
    isLoading: false,
    error: null,
    hasMore: true,
    currentPage: 1,
    totalCount: 0,
    searchQuery: '',

    fetchLcpItems: async (page = 1, limit = 50, query = get().searchQuery, silent = false) => {
        // If searching, reset list
        if (query !== get().searchQuery) {
            set({ lcpItems: [], currentPage: 1, hasMore: true });
        }

        if (!silent) {
            set({ isLoading: true, error: null });
        }

        try {
            const response = await getLCPs(page, limit, query);

            if (response.success && response.data) {
                set((state) => ({
                    lcpItems: response.data, // Replace items for pagination instead of appending
                    totalCount: response.pagination?.total_items || response.data.length,
                    hasMore: response.pagination?.has_next ?? false,
                    currentPage: response.pagination?.current_page ?? page,
                    searchQuery: query,
                    isLoading: false,
                    error: null
                }));
            } else {
                set({
                    lcpItems: page === 1 ? [] : get().lcpItems,
                    hasMore: false,
                    isLoading: false,
                    error: response.message || 'Failed to fetch LCP items'
                });
            }
        } catch (err: any) {
            console.error('Failed to fetch LCP items:', err);
            set({
                error: err.message || 'Failed to load LCP items',
                isLoading: false
            });
        }
    },

    addLcpItem: async (name: string, email_address?: string) => {
        set({ isLoading: true, error: null });
        try {
            const response = await createLCP(name, email_address);
            if (response.success && response.data) {
                // Refresh list or prepend
                await get().fetchLcpItems(1, 50, get().searchQuery);
            }
        } catch (err: any) {
            set({
                error: err.message || 'Failed to add LCP',
                isLoading: false
            });
            throw err;
        }
    },

    updateLcpItem: async (id: number, name: string, email_address?: string) => {
        set({ isLoading: true, error: null });
        try {
            const response = await updateLCP(id, name, email_address);
            if (response.success && response.data) {
                set((state) => ({
                    lcpItems: state.lcpItems.map(item => item.id === id ? { ...item, lcp_name: name, updated_at: response.data.updated_at } : item),
                    isLoading: false
                }));
            }
        } catch (err: any) {
            set({
                error: err.message || 'Failed to update LCP',
                isLoading: false
            });
            throw err;
        }
    },

    deleteLcpItem: async (id: number) => {
        set({ isLoading: true, error: null });
        try {
            await deleteLCP(id);
            set((state) => ({
                lcpItems: state.lcpItems.filter(item => item.id !== id),
                isLoading: false,
                totalCount: state.totalCount - 1
            }));
        } catch (err: any) {
            set({
                error: err.message || 'Failed to delete LCP',
                isLoading: false
            });
            throw err;
        }
    },

    refreshLcpItems: async () => {
        await get().fetchLcpItems(get().currentPage, 50, get().searchQuery);
    },

    silentRefresh: async () => {
        await get().fetchLcpItems(get().currentPage, 50, get().searchQuery, true);
    },

    setSearchQuery: (query: string) => {
        set({ searchQuery: query });
    }
}));
