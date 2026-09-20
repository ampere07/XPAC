import apiClient from '../config/api';

/**
 * One entry in the RADIUS operation queue.
 *
 * Dates arrive pre-formatted for Manila (mm/dd/yyyy hh:mm AM), the same way the
 * data-logs endpoint hands them over, so the page renders them as-is.
 */
export interface RadiusQueueRecord {
    id: string;
    organization_id: number | null;
    account_no: string;
    operation: string;
    status: string;
    source_type: string;
    source_id: string;
    attempts: number;
    max_attempts: number;
    params: string | null;
    last_error: string | null;
    next_retry_at: string;
    completed_at: string;
    created_at: string;
    updated_at: string;
    created_by: string;
}

export const getRadiusQueue = async (
    params: { search?: string; status?: string; operation?: string; limit?: number } = {}
): Promise<{ data: RadiusQueueRecord[] }> => {
    try {
        const response = await apiClient.get<any>('/radius-queue', {
            params: {
                search: params.search || undefined,
                status: params.status || undefined,
                operation: params.operation || undefined,
                limit: params.limit || undefined,
            },
        });

        const payload = response.data;

        if (payload?.status === 'success' && Array.isArray(payload.data)) {
            return { data: payload.data };
        }

        return { data: [] };
    } catch (error) {
        console.error('Error fetching the radius queue:', error);
        return { data: [] };
    }
};
