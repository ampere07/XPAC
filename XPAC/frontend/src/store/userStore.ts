import { create } from 'zustand';
import { User } from '../types/api';
import { userService } from '../services/userService';

interface UserState {
    users: User[];
    isLoading: boolean;
    error: string | null;
    lastUpdated: Date | null;
    isInitialFetch: boolean;

    // Actions
    fetchUsers: (force?: boolean) => Promise<void>;
    refreshUsers: () => Promise<void>;
    silentRefresh: () => Promise<void>;
    addUser: (user: User) => void;
    updateUser: (user: User) => void;
    removeUser: (userId: number) => void;
    setUsers: (users: User[]) => void;
}

export const useUserStore = create<UserState>((set, get) => ({
    users: [],
    isLoading: false,
    error: null,
    lastUpdated: null,
    isInitialFetch: true,

    fetchUsers: async (force = false) => {
        const { users, isInitialFetch, isLoading } = get();
        
        // If not force and already has data, don't fetch again
        if (!force && users.length > 0 && !isInitialFetch) {
            return;
        }

        if (isLoading) return;

        set({ isLoading: true, error: null });

        try {
            const response = await userService.getAllUsers();
            if (response.success && response.data) {
                set({
                    users: response.data,
                    lastUpdated: new Date(),
                    isInitialFetch: false,
                    error: null
                });
            } else {
                set({ error: response.message || 'Failed to fetch users' });
            }
        } catch (err: any) {
            set({ error: err.message || 'An unexpected error occurred' });
        } finally {
            set({ isLoading: false });
        }
    },

    refreshUsers: async () => {
        await get().fetchUsers(true);
    },

    silentRefresh: async () => {
        const { isLoading } = get();
        if (isLoading) return;

        try {
            const response = await userService.getAllUsers();
            if (response.success && response.data) {
                set({
                    users: response.data,
                    lastUpdated: new Date(),
                    error: null
                });
            }
        } catch (err) {
            console.error('Silent refresh failed:', err);
        }
    },

    addUser: (user: User) => {
        set((state) => ({
            users: [user, ...state.users]
        }));
    },

    updateUser: (user: User) => {
        set((state) => ({
            users: state.users.map((u) => (u.id === user.id ? user : u))
        }));
    },

    removeUser: (userId: number) => {
        set((state) => ({
            users: state.users.filter((u) => u.id !== userId)
        }));
    },

    setUsers: (users: User[]) => set({ users })
}));
