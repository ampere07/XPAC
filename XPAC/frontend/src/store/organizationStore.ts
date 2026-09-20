import { create } from 'zustand';
import { Organization } from '../types/api';
import { organizationService } from '../services/userService';

interface OrganizationState {
    organizations: Organization[];
    isLoading: boolean;
    error: string | null;
    lastUpdated: Date | null;
    isInitialFetch: boolean;

    // Actions
    fetchOrganizations: (force?: boolean) => Promise<void>;
    refreshOrganizations: () => Promise<void>;
    addOrganization: (org: Organization) => void;
    updateOrganization: (org: Organization) => void;
    removeOrganization: (orgId: number) => void;
    setOrganizations: (orgs: Organization[]) => void;
}

export const useOrganizationStore = create<OrganizationState>((set, get) => ({
    organizations: [],
    isLoading: false,
    error: null,
    lastUpdated: null,
    isInitialFetch: true,

    fetchOrganizations: async (force = false) => {
        const { organizations, isInitialFetch, isLoading } = get();
        
        if (!force && organizations.length > 0 && !isInitialFetch) {
            return;
        }

        if (isLoading) return;

        set({ isLoading: true, error: null });

        try {
            const response = await organizationService.getAllOrganizations();
            if (response.success && response.data) {
                set({
                    organizations: response.data,
                    lastUpdated: new Date(),
                    isInitialFetch: false,
                    error: null
                });
            } else {
                set({ error: response.message || 'Failed to fetch organizations' });
            }
        } catch (err: any) {
            set({ error: err.message || 'An unexpected error occurred' });
        } finally {
            set({ isLoading: false });
        }
    },

    refreshOrganizations: async () => {
        await get().fetchOrganizations(true);
    },

    addOrganization: (org: Organization) => {
        set((state) => ({
            organizations: [org, ...state.organizations]
        }));
    },

    updateOrganization: (org: Organization) => {
        set((state) => ({
            organizations: state.organizations.map((o) => (o.id === org.id ? org : o))
        }));
    },

    removeOrganization: (orgId: number) => {
        set((state) => ({
            organizations: state.organizations.filter((o) => o.id !== orgId)
        }));
    },

    setOrganizations: (orgs: Organization[]) => set({ organizations: orgs })
}));
