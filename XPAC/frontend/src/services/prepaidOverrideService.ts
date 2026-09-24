import apiClient from '../config/api';

interface ApiResponse<T = any> {
    success?: boolean;
    data?: T;
    message?: string;
    error?: string;
    count?: number;
    server_time?: string;
    enforcement?: PrepaidOverrideEnforcement | null;
}

/**
 * What the backend did to RADIUS after an approval landed.
 *
 * Reported separately from `success` on purpose: the expiry adjustment is committed before RADIUS
 * is touched, so the approval can succeed while the reconnect/restrict is only queued for retry.
 * The details panel surfaces this so an approver is not left believing the customer is back online
 * when the change is still sitting in the queue.
 */
export interface PrepaidOverrideEnforcement {
    action: 'reconnected' | 'restricted' | 'queued' | 'skipped' | 'error';
    reason?: string;
    expires_at?: string;
    username?: string;
}

export type PrepaidOverrideStatus = 'pending' | 'approved' | 'processed' | 'rejected';

export interface PrepaidOverrideRequest {
    id: number;
    organization_id?: number | null;
    account_no: string;
    billing_account_id: number | null;
    /** Signed: positive adds days to the prepaid period, negative deducts them. */
    days_adjustment: number;
    reason: string | null;
    remarks: string | null;
    status: PrepaidOverrideStatus | string;
    /** Both sides of the move, filled in when the request is approved. */
    expiry_before: string | null;
    expiry_after: string | null;
    processed_at: string | null;
    requested_by: number | null;
    updated_by: number | null;
    created_at: string;
    updated_at: string;
    billing_account?: {
        id: number;
        account_no: string;
        generation_type?: string | null;
        prepaid_expires_at?: string | null;
        account_balance?: number | string | null;
        billing_status_id?: number | null;
        customer?: {
            full_name?: string;
            contact_number_primary?: string;
            email_address?: string;
            barangay?: string;
            city?: string;
            desired_plan?: string;
        };
        billing_status?: {
            id: number;
            status_name: string;
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

export interface CreatePrepaidOverridePayload {
    account_no: string;
    days_adjustment: number;
    reason: string;
    remarks?: string;
    /** Email address of the requester; the authenticated session still takes precedence. */
    requested_by?: string;
}

export const prepaidOverrideService = {
    createOverrideRequest: async (
        payload: CreatePrepaidOverridePayload
    ): Promise<{ success: boolean; message?: string; data?: PrepaidOverrideRequest }> => {
        try {
            const response = await apiClient.post<ApiResponse<PrepaidOverrideRequest>>('/prepaid-overrides', payload);
            return {
                success: response.data.success !== false,
                message: response.data.message || 'Prepaid override request submitted successfully',
                data: response.data.data,
            };
        } catch (error: any) {
            console.error('Error creating prepaid override request:', error);
            // Laravel returns field errors under `errors`; surface the first so the form can show
            // something more useful than a generic failure.
            const fieldErrors = error.response?.data?.errors;
            const firstFieldError = fieldErrors ? (Object.values(fieldErrors)[0] as string[])?.[0] : undefined;
            return {
                success: false,
                message:
                    firstFieldError ||
                    error.response?.data?.message ||
                    error.message ||
                    'Failed to submit prepaid override request',
            };
        }
    },

    getAllOverrideRequests: async (
        updatedSince?: string
    ): Promise<{ success: boolean; data: PrepaidOverrideRequest[]; count: number; serverTime?: string }> => {
        try {
            const response = await apiClient.get<ApiResponse<PrepaidOverrideRequest[]>>('/prepaid-overrides', {
                params: { updated_since: updatedSince },
            });
            return {
                success: true,
                data: response.data.data || [],
                count: response.data.count || 0,
                serverTime: response.data.server_time,
            };
        } catch (error: any) {
            console.error('Error fetching prepaid override requests:', error);
            return { success: false, data: [], count: 0 };
        }
    },

    getOverrideRequestById: async (id: number): Promise<{ success: boolean; data?: PrepaidOverrideRequest }> => {
        try {
            const response = await apiClient.get<ApiResponse<PrepaidOverrideRequest>>(`/prepaid-overrides/${id}`);
            return { success: true, data: response.data.data };
        } catch (error: any) {
            console.error('Error fetching prepaid override request:', error);
            return { success: false };
        }
    },

    /**
     * Approve or reject a pending request.
     *
     * `approved` applies the adjustment; the record comes back as `processed` because that is the
     * only state in which the days have actually been granted.
     */
    updateOverrideStatus: async (
        id: number,
        status: 'approved' | 'rejected',
        updatedBy?: string,
        remarks?: string
    ): Promise<{
        success: boolean;
        message?: string;
        data?: PrepaidOverrideRequest;
        enforcement?: PrepaidOverrideEnforcement | null;
    }> => {
        try {
            const response = await apiClient.put<ApiResponse<PrepaidOverrideRequest>>(
                `/prepaid-overrides/${id}/status`,
                { status, updated_by: updatedBy, remarks }
            );
            return {
                success: response.data.success !== false,
                message: response.data.message || 'Status updated successfully',
                data: response.data.data,
                enforcement: response.data.enforcement ?? null,
            };
        } catch (error: any) {
            console.error('Error updating prepaid override status:', error);
            return {
                success: false,
                message: error.response?.data?.message || error.message || 'Failed to update status',
            };
        }
    },
};
