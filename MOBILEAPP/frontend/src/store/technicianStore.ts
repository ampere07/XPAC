import { create } from 'zustand';
import { Technician } from '../types/api';
import { technicianService } from '../services/technicianService';

interface TechnicianState {
    technicians: Technician[];
    isLoading: boolean;
    error: string | null;
    lastUpdated: Date | null;
    isInitialFetch: boolean;

    // Actions
    fetchTechnicians: (force?: boolean) => Promise<void>;
    refreshTechnicians: () => Promise<void>;
    addTechnician: (tech: Technician) => void;
    updateTechnician: (tech: Technician) => void;
    removeTechnician: (techId: number) => void;
    setTechnician: (techs: Technician[]) => void;
}

export const useTechnicianStore = create<TechnicianState>((set, get) => ({
    technicians: [],
    isLoading: false,
    error: null,
    lastUpdated: null,
    isInitialFetch: true,

    fetchTechnicians: async (force = false) => {
        const { technicians, isInitialFetch, isLoading } = get();
        
        if (!force && technicians.length > 0 && !isInitialFetch) {
            return;
        }

        if (isLoading) return;

        set({ isLoading: true, error: null });

        try {
            const response = await technicianService.getAllTechnicians();
            if (response.success && response.data) {
                set({
                    technicians: response.data,
                    lastUpdated: new Date(),
                    isInitialFetch: false,
                    error: null
                });
            } else {
                set({ error: response.message || 'Failed to fetch technicians' });
            }
        } catch (err: any) {
            set({ error: err.message || 'An unexpected error occurred' });
        } finally {
            set({ isLoading: false });
        }
    },

    refreshTechnicians: async () => {
        await get().fetchTechnicians(true);
    },

    addTechnician: (tech: Technician) => {
        set((state) => ({
            technicians: [tech, ...state.technicians]
        }));
    },

    updateTechnician: (tech: Technician) => {
        set((state) => ({
            technicians: state.technicians.map((t) => (t.id === tech.id ? tech : t))
        }));
    },

    removeTechnician: (techId: number) => {
        set((state) => ({
            technicians: state.technicians.filter((t) => t.id !== techId)
        }));
    },

    setTechnician: (techs: Technician[]) => set({ technicians: techs })
}));
