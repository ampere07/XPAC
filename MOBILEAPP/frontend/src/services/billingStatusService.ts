import apiClient from '../config/api';

export interface BillingStatus {
    id: number;
    status_name: string;
}

interface ApiResponse<T> {
    success: boolean;
    data: T;
    message?: string;
}

export const billingStatusService = {
    getAll: async (): Promise<BillingStatus[]> => {
        try {
            const response = await apiClient.get<ApiResponse<BillingStatus[]>>('/billing-statuses');
            return response.data.data || [];
        } catch (error) {
            console.error('Error fetching billing statuses:', error);
            return [];
        }
    }
};
