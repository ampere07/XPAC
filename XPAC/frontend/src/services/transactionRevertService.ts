import apiClient from '../config/api';

interface ApiResponse<T = any> {
    success?: boolean;
    data?: T;
    message?: string;
    error?: string;
    count?: number;
    total?: number;
}

export interface TransactionRevert {
    id: number;
    transaction_id: number;
    remarks: string | null;
    reason: string | null;
    status: string;
    requested_by: number | null;
    updated_by: number | null;
    organization_id?: number | null;
    created_at: string;
    updated_at: string;
    transaction?: {
        id: number;
        account_no: string;
        transaction_type: string;
        received_payment: number;
        payment_date: string;
        date_processed: string;
        processed_by_user: string;
        payment_method: string;
        reference_no: string;
        or_no: string;
        remarks: string;
        status: string;
        approved_by?: string;
        account?: {
            account_no: string;
            account_balance: number;
            customer?: {
                full_name: string;
                contact_number_primary: string;
                barangay: string;
                city: string;
                region: string;
                address: string;
                desired_plan: string;
            };
        };
        processor?: {
            email_address: string;
            full_name: string;
        };
        payment_method_info?: {
            id: number;
            payment_method: string;
        };
    };
    requester?: {
        id: number;
        email_address: string;
        full_name: string;
    };
    updater?: {
        id: number;
        email_address: string;
        full_name: string;
    };
}

export interface CreateTransactionRevertPayload {
    transaction_id: number;
    remarks?: string;
    reason: string;
    status?: string;
    requested_by?: string; // email address
    updated_by?: string; // email address
}

export const transactionRevertService = {
    createRevertRequest: async (payload: CreateTransactionRevertPayload): Promise<{ success: boolean; message?: string; data?: TransactionRevert }> => {
        try {
            const response = await apiClient.post<ApiResponse>('/transaction-reverts', payload);
            return {
                success: true,
                message: response.data.message || 'Revert request submitted successfully',
                data: response.data.data
            };
        } catch (error: any) {
            console.error('Error creating revert request:', error);
            return {
                success: false,
                message: error.response?.data?.message || error.message || 'Failed to submit revert request'
            };
        }
    },

    getAllRevertRequests: async (updatedSince?: string): Promise<{ success: boolean; data: TransactionRevert[]; count: number; serverTime?: string }> => {
        try {
            const response = await apiClient.get<ApiResponse>('/transaction-reverts', {
                params: { updated_since: updatedSince }
            });
            return {
                success: true,
                data: response.data.data || [],
                count: response.data.count || 0,
                serverTime: (response.data as any).server_time
            };
        } catch (error: any) {
            console.error('Error fetching revert requests:', error);
            return {
                success: false,
                data: [],
                count: 0
            };
        }
    },

    getRevertRequestById: async (id: number): Promise<{ success: boolean; data?: TransactionRevert }> => {
        try {
            const response = await apiClient.get<ApiResponse>(`/transaction-reverts/${id}`);
            return {
                success: true,
                data: response.data.data
            };
        } catch (error: any) {
            console.error('Error fetching revert request:', error);
            return {
                success: false
            };
        }
    },

    updateRevertStatus: async (id: number, status: string, updatedBy?: string): Promise<{ success: boolean; message?: string; data?: TransactionRevert }> => {
        try {
            const response = await apiClient.put<ApiResponse>(`/transaction-reverts/${id}/status`, {
                status,
                updated_by: updatedBy
            });
            return {
                success: true,
                message: response.data.message || 'Status updated successfully',
                data: response.data.data
            };
        } catch (error: any) {
            console.error('Error updating revert status:', error);
            return {
                success: false,
                message: error.response?.data?.message || error.message || 'Failed to update status'
            };
        }
    }
};
