import apiClient from '../config/api';

export const commissionService = {
    getEarnings: async (limit = 2000, offset = 0, updatedAfter?: string) => {
        const params = new URLSearchParams({
            limit: limit.toString(),
            offset: offset.toString(),
        });
        if (updatedAfter) params.append('updated_after', updatedAfter);
        
        const response = await apiClient.get(`/commissions?${params.toString()}`);
        return response.data;
    },

    getPayoutHistory: async (limit = 2000, offset = 0, updatedAfter?: string) => {
        const params = new URLSearchParams({
            limit: limit.toString(),
            offset: offset.toString(),
        });
        if (updatedAfter) params.append('updated_after', updatedAfter);

        const response = await apiClient.get(`/commissions/history?${params.toString()}`);
        return response.data;
    },

    // Auto-awarded quota incentives from the agent_incentive_history table (cron output).
    getIncentiveHistory: async (limit = 2000, offset = 0, updatedAfter?: string) => {
        const params = new URLSearchParams({
            limit: limit.toString(),
            offset: offset.toString(),
        });
        if (updatedAfter) params.append('updated_after', updatedAfter);

        const response = await apiClient.get(`/commissions/incentive-history?${params.toString()}`);
        return response.data;
    },

    // Manual bonus transactions (add / payout) from the agent_bonus_history table.
    getBonusHistory: async (limit = 2000, offset = 0, updatedAfter?: string) => {
        const params = new URLSearchParams({
            limit: limit.toString(),
            offset: offset.toString(),
        });
        if (updatedAfter) params.append('updated_after', updatedAfter);

        const response = await apiClient.get(`/commissions/bonus-history?${params.toString()}`);
        return response.data;
    }
};

// ─── Agent self-service portal ────────────────────────────────────────────────
// Endpoints backing the Agent dashboard. The backend scopes every one of these to the
// authenticated agent, so an agent can only ever read or write their own records.
// Mirrors the agent helpers in MOBILEAPP/frontend/src/services/api.ts.

export interface AgentCommissionHistoryResponse {
    success: boolean;
    message?: string;
    data: any[];
    total?: number;
    /** The agent's spendable balance, where a claimed achievement reward lands. */
    balance?: number;
    /**
     * Commission earned from approved job orders — agent_balance.commission_value.
     *
     * Not to be confused with agent_balance.commission, which is the RATE one
     * referral pays and is a setting rather than money in hand.
     */
    commission_value?: number;
    incentives?: number;
    bonus?: number;
    achievement?: number;
}

export interface AgentAchievementsResponse {
    success: boolean;
    message?: string;
    data?: Array<{ id: number; agent_id: number; milestone: number; amount: string | number }>;
}

export interface AgentClaimResponse {
    success: boolean;
    message?: string;
    data?: any;
}

export const agentPortalService = {
    // Payout history plus the agent's current balance buckets
    // (commission / incentives / bonus / achievement).
    getCommissionHistory: async (type?: string): Promise<AgentCommissionHistoryResponse> => {
        const params = type && type !== 'all' ? { type } : {};
        const response = await apiClient.get<AgentCommissionHistoryResponse>('/commissions/history', { params });
        return response.data;
    },

    // Quota incentives awarded by the nightly cron.
    getIncentiveHistory: async (params?: Record<string, any>): Promise<{ success: boolean; data?: any[]; message?: string }> => {
        const response = await apiClient.get<{ success: boolean; data?: any[]; message?: string }>(
            '/commissions/incentive-history',
            { params }
        );
        return response.data;
    },

    // Milestones the agent has already claimed.
    getAchievements: async (agentId: string | number): Promise<AgentAchievementsResponse> => {
        const response = await apiClient.get<AgentAchievementsResponse>('/commissions/achievements', {
            params: { agent_id: agentId }
        });
        return response.data;
    },

    // Claim an onboard milestone. The reward amount is re-derived server side.
    // `type` names the tier being claimed ('weekly' / 'monthly'); the milestone
    // is sent alongside it so an older server can still resolve the tier.
    claimAchievement: async (payload: { agent_id: number; type?: string; milestone: number }): Promise<AgentClaimResponse> => {
        const response = await apiClient.post<AgentClaimResponse>('/commissions/achievements', payload);
        return response.data;
    },

    // How many applications this agent has submitted. Counted server side on
    // created_by_user_id: /applications is scoped to an organisation rather than
    // to a caller, so an agent cannot count their own rows from the list.
    getApplicationCount: async (): Promise<{ success: boolean; count?: number }> => {
        const response = await apiClient.get<{ success: boolean; count?: number }>('/applications/my-count');
        return response.data;
    },

    getCommissionTrend: async (filter: string): Promise<{ success: boolean; data?: any[] }> => {
        const response = await apiClient.get<{ success: boolean; data?: any[] }>('/commissions/trend', {
            params: { filter }
        });
        return response.data;
    }
};
