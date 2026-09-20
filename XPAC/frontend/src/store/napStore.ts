import { create } from 'zustand';
import { getNAPs, NAP, createNAP, updateNAP, deleteNAP } from '../services/napService';

interface NapState {
    napItems: NAP[];
    isLoading: boolean;
    error: string | null;
    hasMore: boolean;
    currentPage: number;
    totalCount: number;
    searchQuery: string;

    fetchNapItems: (page?: number, limit?: number, searchQuery?: string, silent?: boolean) => Promise<void>;
    addNapItem: (name: string, email_address?: string) => Promise<void>;
    updateNapItem: (id: number, name: string, email_address?: string) => Promise<void>;
    deleteNapItem: (id: number) => Promise<void>;
    refreshNapItems: () => Promise<void>;
    silentRefresh: () => Promise<void>;
    setSearchQuery: (query: string) => void;
}

export const useNapStore = create<NapState>((set, get) => ({
    napItems: [],
    isLoading: false,
    error: null,
    hasMore: true,
    currentPage: 1,
    totalCount: 0,
    searchQuery: '',

    fetchNapItems: async (page = 1, limit = 50, query = get().searchQuery, silent = false) => {

        // If searching, reset list
        if (query !== get().searchQuery) {
            set({ napItems: [], currentPage: 1, hasMore: true });
        }

        if (!silent) {
            set({ isLoading: true, error: null });
        }

        try {
            const response = await getNAPs(page, limit, query);

            if (response.success && response.data) {
                set((state) => ({
                    napItems: response.data, // Replace items for pagination instead of appending
                    totalCount: response.pagination?.total_items || response.data.length,
                    hasMore: response.pagination?.has_next ?? false,
                    currentPage: response.pagination?.current_page ?? page,
                    searchQuery: query,
                    isLoading: false,
                    error: null
                }));
            } else {
                set({
                    napItems: page === 1 ? [] : get().napItems,
                    hasMore: false,
                    isLoading: false,
                    error: response.message || 'Failed to fetch NAP items'
                });
            }
        } catch (err: any) {
            console.error('Failed to fetch NAP items:', err);
            set({
                error: err.message || 'Failed to load NAP items',
                isLoading: false
            });
        }
    },

    addNapItem: async (name: string, email_address?: string) => {
        set({ isLoading: true, error: null });
        try {
            const response = await createNAP(name, email_address);
            if (response.success && response.data) {
                // Refresh list or prepend
                await get().fetchNapItems(1, 50, get().searchQuery);
            }
        } catch (err: any) {
            set({
                error: err.message || 'Failed to add NAP',
                isLoading: false
            });
            throw err;
        }
    },

    updateNapItem: async (id: number, name: string, email_address?: string) => {
        set({ isLoading: true, error: null });
        try {
            const response = await updateNAP(id, name, email_address);
            if (response.success && response.data) {
                set((state) => ({
                    napItems: state.napItems.map(item => item.id === id ? { ...item, nap_name: name, updated_at: response.data.updated_at } : item),
                    isLoading: false
                }));
            }
        } catch (err: any) {
            set({
                error: err.message || 'Failed to update NAP',
                isLoading: false
            });
            throw err;
        }
    },

    deleteNapItem: async (id: number) => {
        set({ isLoading: true, error: null });
        try {
            await deleteNAP(id);
            set((state) => ({
                napItems: state.napItems.filter(item => item.id !== id),
                isLoading: false,
                totalCount: state.totalCount - 1
            }));
        } catch (err: any) {
            set({
                error: err.message || 'Failed to delete NAP',
                isLoading: false
            });
            throw err;
        }
    },

    refreshNapItems: async () => {
        await get().fetchNapItems(get().currentPage, 50, get().searchQuery);
    },

    silentRefresh: async () => {
        await get().fetchNapItems(get().currentPage, 50, get().searchQuery, true);
    },

    setSearchQuery: (query: string) => {
        set({ searchQuery: query });
    }
}));
