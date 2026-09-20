import apiClient from '../config/api';

interface ApiResponse<T> {
    success: boolean;
    data: T;
    message?: string;
}

export interface InventoryLog {
    id: string;
    date: string;
    item_name: string;
    item_description?: string;
    account_no?: string;
    sn?: string;
    item_quantity: number;
    log_type: string;
    requested_by?: string;
    requested_with?: string;
    requested_with_10?: string;
    status?: string;
    remarks?: string;
    modified_by?: string;
    modified_date?: string;
    user_email?: string;
    item_id?: number;
}

export const createInventoryLog = async (logData: Partial<InventoryLog>): Promise<ApiResponse<InventoryLog>> => {
    try {
        const response = await apiClient.post<ApiResponse<InventoryLog>>('/inventory-logs', logData);
        return response.data;
    } catch (error: any) {
        console.error('Error creating inventory log:', {
            status: error.response?.status,
            data: error.response?.data,
            message: error.message,
            url: error.config?.url,
            method: error.config?.method
        });
        throw error;
    }
};

export const getAllInventoryLogs = async (): Promise<ApiResponse<InventoryLog[]>> => {
    try {
        const response = await apiClient.get<ApiResponse<InventoryLog[]>>('/inventory-logs');
        return response.data;
    } catch (error: any) {
        console.error('Error fetching inventory logs:', error);
        throw error;
    }
};
