import { create } from 'zustand';
import { Agent } from '../types/api';
import { agentService } from '../services/agentService';

interface AgentState {
    agents: Agent[];
    isLoading: boolean;
    error: string | null;
    lastUpdated: Date | null;
    isInitialFetch: boolean;

    // Actions
    fetchAgents: (force?: boolean) => Promise<void>;
    refreshAgents: () => Promise<void>;
    addAgent: (agent: Agent) => void;
    updateAgent: (agent: Agent) => void;
    removeAgent: (agentId: number) => void;
    setAgents: (agents: Agent[]) => void;
}

export const useAgentStore = create<AgentState>((set, get) => ({
    agents: [],
    isLoading: false,
    error: null,
    lastUpdated: null,
    isInitialFetch: true,

    fetchAgents: async (force = false) => {
        const { agents, isInitialFetch, isLoading } = get();
        
        if (!force && agents.length > 0 && !isInitialFetch) {
            return;
        }

        if (isLoading) return;

        set({ isLoading: true, error: null });

        try {
            const response = await agentService.getAllAgents();
            if (response.success && response.data) {
                set({
                    agents: response.data,
                    lastUpdated: new Date(),
                    isInitialFetch: false,
                    error: null
                });
            } else {
                set({ error: response.message || 'Failed to fetch agents' });
            }
        } catch (err: any) {
            set({ error: err.message || 'An unexpected error occurred' });
        } finally {
            set({ isLoading: false });
        }
    },

    refreshAgents: async () => {
        await get().fetchAgents(true);
    },

    addAgent: (agent: Agent) => {
        set((state) => ({
            agents: [agent, ...state.agents]
        }));
    },

    updateAgent: (agent: Agent) => {
        set((state) => ({
            agents: state.agents.map((a) => (a.id === agent.id ? agent : a))
        }));
    },

    removeAgent: (agentId: number) => {
        set((state) => ({
            agents: state.agents.filter((a) => a.id !== agentId)
        }));
    },

    setAgents: (agents: Agent[]) => set({ agents: agents })
}));
